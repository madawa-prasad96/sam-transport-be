import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailStatus, RecipientType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAIL_TRANSPORT,
  type MailTransport,
} from './transports/mail-transport.interface';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Drains the outbox. Emails are written to the database inside the same request
 * that caused them, then sent here — so a mail provider outage delays delivery
 * but never fails a user's action or loses a notification.
 */
@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async drain(): Promise<void> {
    if (this.running) return; // never overlap runs
    this.running = true;
    try {
      await this.processBatch();
    } catch (error) {
      this.logger.error('Outbox drain failed', error as Error);
    } finally {
      this.running = false;
    }
  }

  private async processBatch(): Promise<void> {
    const due = await this.prisma.emailMessage.findMany({
      where: {
        status: EmailStatus.QUEUED,
        scheduledAt: { lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      include: { recipients: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const message of due) {
      const pick = (type: RecipientType) =>
        message.recipients.filter((r) => r.type === type).map((r) => r.email);

      try {
        const result = await this.transport.send({
          from: message.fromAddress,
          to: pick(RecipientType.TO),
          cc: pick(RecipientType.CC),
          bcc: pick(RecipientType.BCC),
          replyTo: message.recipients[0]?.replyToAddress,
          subject: message.subject,
          html: message.bodyHtml,
          text: message.bodyText,
          messageId: message.messageId,
          inReplyTo: message.inReplyTo,
          references: message.references,
        });

        await this.prisma.$transaction([
          this.prisma.emailMessage.update({
            where: { id: message.id },
            data: {
              status: EmailStatus.SENT,
              sentAt: new Date(),
              attempts: { increment: 1 },
              providerMessageId: result.providerMessageId,
              lastError: null,
            },
          }),
          this.prisma.emailRecipient.updateMany({
            where: { emailMessageId: message.id },
            data: { status: EmailStatus.SENT },
          }),
        ]);
      } catch (error) {
        const attempts = message.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;

        await this.prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            attempts,
            lastError: (error as Error).message.slice(0, 1000),
            status: failed ? EmailStatus.FAILED : EmailStatus.QUEUED,
            // Exponential backoff: 1m, 2m, 4m, 8m.
            scheduledAt: failed
              ? message.scheduledAt
              : new Date(Date.now() + 60_000 * 2 ** (attempts - 1)),
          },
        });

        this.logger.warn(
          `Send failed for ${message.messageId} (attempt ${attempts}/${MAX_ATTEMPTS}): ${(error as Error).message}`,
        );
      }
    }
  }
}
