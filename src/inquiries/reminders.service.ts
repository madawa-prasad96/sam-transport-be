import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  EmailEventType,
  InquiryStatus,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Chases inquiries the counterparty has left sitting. The whole point of moving
 * off email is that nothing silently falls through — so silence has to be an
 * event the system reacts to, not just an absence.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      await this.sendFirstReminders();
      await this.escalate();
    } catch (error) {
      this.logger.error('Reminder sweep failed', error as Error);
    }
  }

  private async sendFirstReminders(): Promise<void> {
    const hours = this.config.get<number>('reminders.firstHours')!;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const stale = await this.prisma.inquiry.findMany({
      where: {
        status: InquiryStatus.SUBMITTED,
        submittedAt: { lte: cutoff },
        lastReminderAt: null,
      },
      include: { providerCompany: true },
      take: 100,
    });

    for (const inquiry of stale) {
      await this.mail.enqueueInquiryEmail({
        inquiryId: inquiry.id,
        eventType: EmailEventType.NO_RESPONSE_REMINDER,
        actorName: 'Transport Platform',
        details: [
          { label: 'Inquiry', value: inquiry.number },
          { label: 'Submitted', value: inquiry.submittedAt?.toISOString() },
          { label: 'Required by', value: inquiry.requiredByAt.toISOString() },
        ],
      });

      await this.prisma.inquiry.update({
        where: { id: inquiry.id },
        data: { lastReminderAt: new Date() },
      });
    }

    if (stale.length) {
      this.logger.log(`Sent ${stale.length} no-response reminder(s)`);
    }
  }

  /** Second stage: bring the provider's admins in, not just the mailbox. */
  private async escalate(): Promise<void> {
    const hours = this.config.get<number>('reminders.escalationHours')!;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const overdue = await this.prisma.inquiry.findMany({
      where: {
        status: InquiryStatus.SUBMITTED,
        submittedAt: { lte: cutoff },
        lastReminderAt: { not: null, lte: cutoff },
      },
      include: { providerCompany: true, requesterCompany: true },
      take: 100,
    });

    for (const inquiry of overdue) {
      const admins = await this.prisma.user.findMany({
        where: {
          companyId: inquiry.providerCompanyId,
          role: UserRole.COMPANY_ADMIN,
          status: UserStatus.ACTIVE,
        },
      });

      for (const admin of admins) {
        await this.mail.enqueueStandalone({
          eventType: EmailEventType.NO_RESPONSE_REMINDER,
          to: admin.email,
          subject: `Escalation: ${inquiry.number} has had no response for ${hours} hours`,
          html: `<p><strong>${inquiry.number}</strong> from ${inquiry.requesterCompany.name} has been awaiting vehicle details for over ${hours} hours.</p><p>Required by ${inquiry.requiredByAt.toISOString()}.</p><p><a href="${this.config.get<string>('webAppUrl')}/inquiries/${inquiry.id}">Open the inquiry</a></p>`,
          text: `${inquiry.number} from ${inquiry.requesterCompany.name} has been awaiting vehicle details for over ${hours} hours.\nRequired by ${inquiry.requiredByAt.toISOString()}.\n\n${this.config.get<string>('webAppUrl')}/inquiries/${inquiry.id}`,
        });
      }

      await this.prisma.inquiry.update({
        where: { id: inquiry.id },
        data: { lastReminderAt: new Date() },
      });
    }

    if (overdue.length) {
      this.logger.log(`Escalated ${overdue.length} inquiry(ies)`);
    }
  }
}
