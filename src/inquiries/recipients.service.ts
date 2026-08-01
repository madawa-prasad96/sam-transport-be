import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import {
  EmailEventType,
  InquiryStatus,
  RecipientKind,
  RecipientType,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AddRecipientInput {
  email: string;
  name?: string;
  type: RecipientType;
}

@Injectable()
export class RecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async add(user: AuthUser, inquiryId: string, input: AddRecipientInput) {
    const companyId = user.companyId!;
    const inquiry = await this.requireAccess(companyId, inquiryId);

    if (input.type === RecipientType.TO) {
      throw new BadRequestException(
        'TO recipients are set automatically and cannot be added by hand',
      );
    }

    const email = input.email.toLowerCase().trim();

    const suppressed = await this.prisma.suppressedEmail.findUnique({
      where: { email },
    });
    if (suppressed) {
      throw new BadRequestException(
        `Mail to ${email} has been failing (${suppressed.reason}), so it can't be added`,
      );
    }

    const existing = await this.prisma.recipient.findUnique({
      where: { inquiryId_email: { inquiryId, email } },
    });
    if (existing && !existing.removedAt) {
      throw new BadRequestException(
        'That address is already on this inquiry',
      );
    }

    // A registered user gets linked so their notification preference and
    // deactivation status are honoured; anyone else is an external address.
    const linkedUser = await this.prisma.user.findFirst({
      where: { email, status: UserStatus.ACTIVE },
    });

    const recipient = existing
      ? await this.prisma.recipient.update({
          where: { id: existing.id },
          data: {
            removedAt: null,
            type: input.type,
            kind: linkedUser ? RecipientKind.USER : RecipientKind.EXTERNAL,
            userId: linkedUser?.id ?? null,
            name: input.name ?? linkedUser?.fullName ?? null,
            addedByCompanyId: companyId,
            addedByUserId: user.id,
          },
        })
      : await this.prisma.recipient.create({
          data: {
            inquiryId,
            type: input.type,
            kind: linkedUser ? RecipientKind.USER : RecipientKind.EXTERNAL,
            email,
            name: input.name ?? linkedUser?.fullName ?? null,
            userId: linkedUser?.id ?? null,
            addedByCompanyId: companyId,
            addedByUserId: user.id,
          },
        });

    // Rule R3 — BCC is always audited even though it is hidden in the UI.
    // A BCC nobody can ever account for is a compliance hazard.
    await this.audit.record({
      action: `inquiry.recipient_added.${input.type.toLowerCase()}`,
      entityType: 'Recipient',
      entityId: recipient.id,
      actorUserId: user.id,
      companyId,
      inquiryId,
      after: { email, type: input.type, kind: recipient.kind },
    });

    if (inquiry.status !== InquiryStatus.DRAFT) {
      if (input.type === RecipientType.CC) {
        // Visible on the timeline and announced to the whole thread.
        await this.prisma.timelineEvent.create({
          data: {
            inquiryId,
            type: 'RECIPIENT_ADDED',
            actorUserId: user.id,
            actorName: user.fullName,
            payload: { email, type: input.type } as never,
          },
        });
        await this.mail.enqueueInquiryEmail({
          inquiryId,
          eventType: EmailEventType.RECIPIENT_ADDED,
          actorName: user.fullName,
          details: [{ label: 'Added to this thread', value: email }],
        });
      } else {
        // BCC: no timeline entry (it would leak), and only the new address is
        // told. Everyone else on the thread stays unaware, which is the point.
        await this.mail.enqueueInquiryEmail({
          inquiryId,
          eventType: EmailEventType.RECIPIENT_ADDED,
          actorName: user.fullName,
          details: [{ label: 'Inquiry', value: inquiry.number }],
          onlyEmails: [email],
        });
      }
    }

    return recipient;
  }

  async remove(user: AuthUser, inquiryId: string, recipientId: string) {
    const companyId = user.companyId!;
    await this.requireAccess(companyId, inquiryId);

    const recipient = await this.prisma.recipient.findFirst({
      where: { id: recipientId, inquiryId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    // Rule R4 — each company manages only its own side of the list.
    if (recipient.addedByCompanyId !== companyId) {
      throw new ForbiddenException(
        'Only the company that added this recipient can remove them',
      );
    }
    if (recipient.type === RecipientType.TO) {
      throw new BadRequestException(
        'The original parties on an inquiry cannot be removed',
      );
    }

    const updated = await this.prisma.recipient.update({
      where: { id: recipientId },
      data: { removedAt: new Date() },
    });

    await this.audit.record({
      action: 'inquiry.recipient_removed',
      entityType: 'Recipient',
      entityId: recipientId,
      actorUserId: user.id,
      companyId,
      inquiryId,
      before: { email: recipient.email, type: recipient.type },
    });

    if (recipient.type === RecipientType.CC) {
      await this.prisma.timelineEvent.create({
        data: {
          inquiryId,
          type: 'RECIPIENT_REMOVED',
          actorUserId: user.id,
          actorName: user.fullName,
          payload: { email: recipient.email } as never,
        },
      });
    }

    return updated;
  }

  private async requireAccess(companyId: string, inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findFirst({
      where: {
        id: inquiryId,
        OR: [
          { requesterCompanyId: companyId },
          {
            providerCompanyId: companyId,
            status: { not: InquiryStatus.DRAFT },
          },
        ],
      },
    });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }
}
