import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommentSource,
  EmailEventType,
  InboundEmailStatus,
  InquiryStatus,
  RecipientType,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { MailTokenService } from '../mail/mail-token.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  extractAddress,
  isAutoReply,
  stripQuotedText,
} from './reply-parser';

export interface InboundEmailPayload {
  to: string;
  from: string;
  fromName?: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  text: string;
  headers?: Record<string, string | undefined>;
}

export type InboundOutcome =
  | { result: 'posted'; commentId: string; inquiryId: string }
  | { result: 'quarantined'; reason: string }
  | { result: 'discarded'; reason: string };

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: MailTokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async process(payload: InboundEmailPayload): Promise<InboundOutcome> {
    const from = extractAddress(payload.from);

    // 1. Loop protection — never ingest our own mail or an autoresponder.
    const ourFrom = extractAddress(
      this.config.get<string>('mail.fromAddress') ?? '',
    );
    if (from === ourFrom) {
      return this.discard(payload, from, 'Message came from our own address');
    }
    if (isAutoReply(payload.headers ?? {})) {
      return this.discard(payload, from, 'Automatic reply');
    }

    // 2. The reply address must carry a valid HMAC for a real inquiry.
    const inquiryId = this.tokens.parseReplyAddress(payload.to);
    if (!inquiryId) {
      return this.quarantine(
        payload,
        from,
        null,
        null,
        'Reply address is missing or its token failed verification',
      );
    }

    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      include: { recipients: { where: { removedAt: null } } },
    });
    if (!inquiry) {
      return this.quarantine(
        payload,
        from,
        null,
        null,
        'The inquiry this reply refers to no longer exists',
      );
    }

    // 3. The sender must be someone actually on the thread. This is what makes
    // a forwarded email useless to an outsider: the token proves the inquiry,
    // the From address proves the person.
    const recipient = inquiry.recipients.find(
      (r) => r.email.toLowerCase() === from,
    );
    if (!recipient) {
      return this.quarantine(
        payload,
        from,
        inquiry.id,
        null,
        `${from} is not a recipient on this inquiry`,
      );
    }

    // 4. Rule R6 — a BCC recipient replying would expose them to the thread,
    // so it is held for the person who added them to release.
    if (recipient.type === RecipientType.BCC) {
      return this.quarantine(
        payload,
        from,
        inquiry.id,
        recipient.id,
        'Reply from a BCC recipient — releasing it would reveal them to the thread',
      );
    }

    // 5. Closed inquiries accept no new comments without a human deciding.
    if (
      inquiry.status === InquiryStatus.COMPLETED ||
      inquiry.status === InquiryStatus.CANCELLED
    ) {
      return this.quarantine(
        payload,
        from,
        inquiry.id,
        recipient.id,
        `Reply arrived on an inquiry that is already ${inquiry.status}`,
      );
    }

    const parsed = stripQuotedText(payload.text ?? '');
    if (!parsed.text) {
      return this.discard(payload, from, 'Reply had no readable content');
    }

    const isExternal = recipient.kind === 'EXTERNAL';

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          inquiryId: inquiry.id,
          body: parsed.text,
          source: CommentSource.EMAIL,
          isExternal,
          authorUserId: recipient.userId,
          authorEmail: from,
          authorName: recipient.name ?? payload.fromName ?? from,
        },
      });

      await tx.inboundEmail.create({
        data: {
          inquiryId: inquiry.id,
          recipientId: recipient.id,
          fromAddress: from,
          fromName: payload.fromName,
          subject: payload.subject,
          rawMessageId: payload.messageId,
          inReplyTo: payload.inReplyTo,
          bodyText: payload.text ?? '',
          strippedText: parsed.text,
          status: InboundEmailStatus.PROCESSED,
          commentId: created.id,
          processedAt: new Date(),
        },
      });

      await tx.timelineEvent.create({
        data: {
          inquiryId: inquiry.id,
          type: 'INBOUND_REPLY',
          actorUserId: recipient.userId,
          actorName: recipient.name ?? from,
          payload: {
            commentId: created.id,
            via: 'email',
            isExternal,
          } as never,
        },
      });

      return created;
    });

    await this.mail.enqueueInquiryEmail({
      inquiryId: inquiry.id,
      eventType: EmailEventType.INBOUND_REPLY,
      actorName: recipient.name ?? from,
      message: parsed.text,
      details: [],
    });

    this.logger.log(`Posted inbound reply from ${from} to ${inquiry.number}`);
    return { result: 'posted', commentId: comment.id, inquiryId: inquiry.id };
  }

  async listQuarantined(companyId: string) {
    return this.prisma.inboundEmail.findMany({
      where: {
        status: InboundEmailStatus.QUARANTINED,
        inquiry: {
          OR: [
            { requesterCompanyId: companyId },
            { providerCompanyId: companyId },
          ],
        },
      },
      include: {
        inquiry: { select: { id: true, number: true, subjectLine: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async discardQuarantined(companyId: string, id: string) {
    const record = await this.prisma.inboundEmail.findFirst({
      where: {
        id,
        inquiry: {
          OR: [
            { requesterCompanyId: companyId },
            { providerCompanyId: companyId },
          ],
        },
      },
    });
    if (!record) return { ok: false };

    await this.prisma.inboundEmail.update({
      where: { id },
      data: {
        status: InboundEmailStatus.DISCARDED,
        processedAt: new Date(),
      },
    });
    return { ok: true };
  }

  private async quarantine(
    payload: InboundEmailPayload,
    from: string,
    inquiryId: string | null,
    recipientId: string | null,
    reason: string,
  ): Promise<InboundOutcome> {
    await this.prisma.inboundEmail.create({
      data: {
        inquiryId,
        recipientId,
        fromAddress: from,
        fromName: payload.fromName,
        subject: payload.subject,
        rawMessageId: payload.messageId,
        inReplyTo: payload.inReplyTo,
        bodyText: payload.text ?? '',
        status: InboundEmailStatus.QUARANTINED,
        quarantineReason: reason,
      },
    });
    this.logger.warn(`Quarantined inbound mail from ${from}: ${reason}`);
    return { result: 'quarantined', reason };
  }

  private async discard(
    payload: InboundEmailPayload,
    from: string,
    reason: string,
  ): Promise<InboundOutcome> {
    await this.prisma.inboundEmail.create({
      data: {
        fromAddress: from,
        fromName: payload.fromName,
        subject: payload.subject,
        rawMessageId: payload.messageId,
        bodyText: payload.text ?? '',
        status: InboundEmailStatus.DISCARDED,
        quarantineReason: reason,
        processedAt: new Date(),
      },
    });
    return { result: 'discarded', reason };
  }
}
