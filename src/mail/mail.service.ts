import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  EmailEventType,
  NotificationPreference,
  RecipientType,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { MailTokenService } from './mail-token.service';
import {
  renderCompanyInvitation,
  renderInquiryEmail,
  renderUserInvitation,
  type InquiryEmailContext,
} from './templates/inquiry.templates';
import type { DetailRow } from './templates/layout';

/**
 * Events so time-critical that a digest subscriber still gets them immediately.
 * A cancelled inquiry may mean a truck is already rolling.
 */
const ALWAYS_INSTANT: EmailEventType[] = [
  EmailEventType.INQUIRY_SUBMITTED,
  EmailEventType.INQUIRY_DECLINED,
  EmailEventType.INQUIRY_CANCELLED,
  EmailEventType.VEHICLE_PROVIDED,
  EmailEventType.VEHICLE_UPDATED,
  EmailEventType.INQUIRY_RESUBMITTED,
  EmailEventType.USER_INVITED,
  EmailEventType.COMPANY_INVITED,
  EmailEventType.RECIPIENT_ADDED,
];

export interface EnqueueInquiryEmailInput {
  inquiryId: string;
  eventType: EmailEventType;
  actorName: string;
  actorCompanyName?: string;
  details?: DetailRow[];
  message?: string;
  /** When set, only these addresses receive the mail (used for BCC-only notices). */
  onlyEmails?: string[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokens: MailTokenService,
  ) {}

  /**
   * Composes an inquiry email and writes it to the outbox. Sending happens in
   * the background processor, so a mail outage never fails a user's action.
   */
  async enqueueInquiryEmail(input: EnqueueInquiryEmailInput): Promise<void> {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: input.inquiryId },
      include: {
        requesterCompany: true,
        providerCompany: true,
        recipients: {
          where: { removedAt: null },
          include: { user: true },
        },
      },
    });
    if (!inquiry) return;

    const suppressed = new Set(
      (
        await this.prisma.suppressedEmail.findMany({
          select: { email: true },
        })
      ).map((row) => row.email.toLowerCase()),
    );

    const allowInstant = (recipient: (typeof inquiry.recipients)[number]) => {
      if (suppressed.has(recipient.email.toLowerCase())) return false;
      if (input.onlyEmails && !input.onlyEmails.includes(recipient.email)) {
        return false;
      }
      if (
        recipient.user?.notificationPreference ===
          NotificationPreference.DAILY_DIGEST &&
        !ALWAYS_INSTANT.includes(input.eventType)
      ) {
        return false;
      }
      return true;
    };

    const eligible = inquiry.recipients.filter(allowInstant);
    if (eligible.length === 0) return;

    const pick = (type: RecipientType) =>
      eligible.filter((r) => r.type === type);

    const to = pick(RecipientType.TO);
    const cc = pick(RecipientType.CC);
    const bcc = pick(RecipientType.BCC);

    // If everyone left is BCC (e.g. a BCC-only notice), they become the To of
    // their own message rather than a message with no visible recipient.
    const toAddresses = to.length
      ? to.map((r) => r.email)
      : bcc.length && !cc.length
        ? bcc.map((r) => r.email)
        : [];
    const bccAddresses =
      to.length || cc.length ? bcc.map((r) => r.email) : [];

    const rendered = renderInquiryEmail(input.eventType, {
      inquiryNumber: inquiry.number,
      subjectLine: inquiry.subjectLine,
      actorName: input.actorName,
      actorCompanyName: input.actorCompanyName ?? '',
      requesterCompanyName: inquiry.requesterCompany.name,
      providerCompanyName: inquiry.providerCompany.name,
      inquiryUrl: `${this.config.get<string>('webAppUrl')}/inquiries/${inquiry.id}`,
      details: input.details ?? [],
      message: input.message,
    } satisfies InquiryEmailContext);

    const rootMessageId = inquiry.rootMessageId;
    const isFirst =
      (await this.prisma.emailMessage.count({
        where: { inquiryId: inquiry.id },
      })) === 0;

    const messageId = isFirst
      ? rootMessageId
      : this.tokens.childMessageId(inquiry.id, randomUUID().slice(0, 8));

    await this.prisma.emailMessage.create({
      data: {
        inquiryId: inquiry.id,
        eventType: input.eventType,
        subject: rendered.subject,
        bodyHtml: rendered.html,
        bodyText: rendered.text,
        fromAddress: this.config.get<string>('mail.fromAddress')!,
        messageId,
        inReplyTo: isFirst ? null : rootMessageId,
        references: isFirst ? null : rootMessageId,
        recipients: {
          create: [
            ...toAddresses.map((email) => ({
              type: RecipientType.TO,
              email,
              replyToAddress: this.tokens.replyAddress(inquiry.id),
              name: eligible.find((r) => r.email === email)?.name ?? null,
              userId: eligible.find((r) => r.email === email)?.userId ?? null,
            })),
            ...cc.map((r) => ({
              type: RecipientType.CC,
              email: r.email,
              replyToAddress: this.tokens.replyAddress(inquiry.id),
              name: r.name,
              userId: r.userId,
            })),
            ...bccAddresses.map((email) => ({
              type: RecipientType.BCC,
              email,
              replyToAddress: this.tokens.replyAddress(inquiry.id),
              name: eligible.find((r) => r.email === email)?.name ?? null,
              userId: eligible.find((r) => r.email === email)?.userId ?? null,
            })),
          ],
        },
      },
    });
  }

  /** One-off mail with no inquiry thread — invitations, password resets. */
  async enqueueStandalone(input: {
    eventType: EmailEventType;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    await this.prisma.emailMessage.create({
      data: {
        eventType: input.eventType,
        subject: input.subject,
        bodyHtml: input.html,
        bodyText: input.text,
        fromAddress: this.config.get<string>('mail.fromAddress')!,
        messageId: `<msg-${randomUUID()}@${this.config.get<string>('mail.domain')}>`,
        recipients: {
          create: [
            {
              type: RecipientType.TO,
              email: input.to,
              replyToAddress: this.config.get<string>('mail.fromAddress')!,
            },
          ],
        },
      },
    });
  }

  async enqueueUserInvitation(input: {
    to: string;
    inviterName: string;
    companyName: string;
    token: string;
  }): Promise<void> {
    const rendered = renderUserInvitation({
      inviterName: input.inviterName,
      companyName: input.companyName,
      acceptUrl: `${this.config.get<string>('webAppUrl')}/accept-invitation?token=${input.token}`,
      expiresInHours: this.config.get<number>('invitationTtlHours')!,
    });
    await this.enqueueStandalone({
      eventType: EmailEventType.USER_INVITED,
      to: input.to,
      ...rendered,
    });
  }

  async enqueueCompanyInvitation(input: {
    to: string;
    inviterName: string;
    inviterCompanyName: string;
    invitedCompanyName: string;
    token: string;
  }): Promise<void> {
    const rendered = renderCompanyInvitation({
      inviterName: input.inviterName,
      inviterCompanyName: input.inviterCompanyName,
      invitedCompanyName: input.invitedCompanyName,
      acceptUrl: `${this.config.get<string>('webAppUrl')}/accept-invitation?token=${input.token}`,
      expiresInHours: this.config.get<number>('invitationTtlHours')!,
    });
    await this.enqueueStandalone({
      eventType: EmailEventType.COMPANY_INVITED,
      to: input.to,
      ...rendered,
    });
  }
}
