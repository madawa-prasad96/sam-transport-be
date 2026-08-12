import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { seesAllUnits } from '../common/decorators/current-user.decorator';
import { UnitsService } from '../units/units.service';
import {
  CommentSource,
  EmailEventType,
  InquiryStatus,
  RecipientKind,
  RecipientType,
  TimelineEventType,
  UserRole,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { MailTokenService } from '../mail/mail-token.service';
import type { DetailRow } from '../mail/templates/layout';
import { PrismaService } from '../prisma/prisma.service';
import { RecipientsService } from './recipients.service';
import type {
  CreateCommentDto,
  CreateInquiryDto,
  DeclineInquiryDto,
  ListInquiriesDto,
  ProvideVehicleDto,
  UpdateInquiryDto,
} from './dto/inquiry.dto';

/** Fields locked once a vehicle has been committed against them — Rule L3. */
const LOCKED_AFTER_VEHICLE: (keyof UpdateInquiryDto)[] = [
  'pickupLocation',
  'deliveryLocation',
  'readyByAt',
  'requiredByAt',
  'cargoDescription',
  'packageCount',
  'grossWeight',
  'weightUom',
  'volumeCbm',
  'dimensions',
  'packagingType',
];

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly tokens: MailTokenService,
    private readonly audit: AuditService,
    private readonly units: UnitsService,
    private readonly recipients: RecipientsService,
  ) {}

  // -------------------------------------------------------------------------
  // Scoping — the single place tenant visibility is decided (NFR1)
  // -------------------------------------------------------------------------

  /**
   * A unit sees inquiries it raised, plus inquiries addressed to it that have
   * actually been submitted. An org admin sees every submitted inquiry across
   * SAM — but drafts stay private to the unit that is still writing them
   * (Rule L2), because an unsent draft is working material, not a record.
   */
  private scope(user: AuthUser) {
    if (seesAllUnits(user)) {
      return {
        OR: [
          { status: { not: InquiryStatus.DRAFT } },
          { requesterUnitId: user.unitId },
        ],
      };
    }
    return {
      OR: [
        { requesterUnitId: user.unitId },
        {
          providerUnitId: user.unitId,
          status: { not: InquiryStatus.DRAFT },
        },
      ],
    };
  }

  private async requireAccess(user: AuthUser, inquiryId: string) {
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { id: inquiryId, ...this.scope(user) },
      include: { requesterUnit: true, providerUnit: true },
    });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }

  /**
   * Read access is broad for an org admin; acting is not. Submitting, declining
   * or cancelling belongs to the units actually party to the inquiry, so the
   * audit trail always names a real participant.
   */
  private assertIsParty(
    inquiry: { requesterUnitId: string; providerUnitId: string },
    user: AuthUser,
  ) {
    if (
      inquiry.requesterUnitId !== user.unitId &&
      inquiry.providerUnitId !== user.unitId
    ) {
      throw new ForbiddenException(
        'Only the units involved in this inquiry can act on it',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(user: AuthUser, query: ListInquiriesDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);

    const filters: Record<string, unknown>[] = [this.scope(user)];

    if (query.direction === 'incoming') {
      filters.push({ providerUnitId: user.unitId });
    } else if (query.direction === 'outgoing') {
      filters.push({ requesterUnitId: user.unitId });
    }
    if (query.status) filters.push({ status: query.status });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.counterpartyId) {
      filters.push({
        OR: [
          { requesterUnitId: query.counterpartyId },
          { providerUnitId: query.counterpartyId },
        ],
      });
    }
    if (query.createdFrom || query.createdTo) {
      filters.push({
        createdAt: {
          ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
        },
      });
    }
    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      filters.push({
        OR: [
          { number: contains },
          { referenceNumber: contains },
          { cargoDescription: contains },
          { pickupLocation: contains },
          { deliveryLocation: contains },
          { vehicleDetails: { some: { vehicleNumber: contains } } },
          { vehicleDetails: { some: { driverName: contains } } },
        ],
      });
    }

    const where = { AND: filters };

    const [items, total] = await Promise.all([
      this.prisma.inquiry.findMany({
        where,
        include: {
          requesterUnit: { select: { id: true, name: true } },
          providerUnit: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          vehicleDetails: { orderBy: { version: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inquiry.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async findOne(user: AuthUser, inquiryId: string) {
    await this.requireAccess(user, inquiryId);

    const inquiry = await this.prisma.inquiry.findUniqueOrThrow({
      where: { id: inquiryId },
      include: {
        requesterUnit: true,
        providerUnit: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        vehicleDetails: {
          orderBy: { version: 'desc' },
          include: { createdBy: { select: { id: true, fullName: true } } },
        },
        attachments: true,
        recipients: { where: { removedAt: null } },
      },
    });

    return {
      ...inquiry,
      recipients: this.visibleRecipients(inquiry.recipients, user),
    };
  }

  /**
   * Rule R3 — BCC entries are visible only to the person who added them and to
   * admins of the unit that added them. CC is visible to everyone.
   */
  private visibleRecipients<
    T extends {
      type: RecipientType;
      addedByUserId: string | null;
      addedByUnitId: string;
    },
  >(recipients: T[], user: AuthUser): T[] {
    return recipients.filter((recipient) => {
      if (recipient.type !== RecipientType.BCC) return true;
      if (recipient.addedByUserId === user.id) return true;
      // An org admin is SAM's audit authority, so BCC is never hidden from them.
      if (seesAllUnits(user)) return true;
      return (
        user.role === UserRole.UNIT_ADMIN &&
        recipient.addedByUnitId === user.unitId
      );
    });
  }

  async timeline(user: AuthUser, inquiryId: string) {
    await this.requireAccess(user, inquiryId);
    return this.prisma.timelineEvent.findMany({
      where: { inquiryId },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async comments(user: AuthUser, inquiryId: string) {
    await this.requireAccess(user, inquiryId);
    return this.prisma.comment.findMany({
      where: { inquiryId },
      include: {
        author: { select: { id: true, fullName: true, unitId: true } },
        attachments: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The delivery trace that makes the app trustworthy as a mailbox replacement. */
  async emailLog(user: AuthUser, inquiryId: string) {
    await this.requireAccess(user, inquiryId);

    const messages = await this.prisma.emailMessage.findMany({
      where: { inquiryId },
      include: { recipients: true },
      orderBy: { createdAt: 'desc' },
    });

    return messages.map((message) => ({
      id: message.id,
      eventType: message.eventType,
      subject: message.subject,
      status: message.status,
      attempts: message.attempts,
      lastError: message.lastError,
      messageId: message.messageId,
      sentAt: message.sentAt,
      createdAt: message.createdAt,
      recipients: this.maskBccInLog(message.recipients, user),
    }));
  }

  private maskBccInLog(
    recipients: { type: RecipientType; email: string; status: string }[],
    user: AuthUser,
  ) {
    return recipients.map((recipient) =>
      recipient.type === RecipientType.BCC && user.role === UserRole.UNIT_USER
        ? { ...recipient, email: 'hidden' }
        : recipient,
    );
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(user: AuthUser, dto: CreateInquiryDto) {
    await this.units.assertAddressable(user.unitId, dto.providerUnitId);
    this.assertTimingSane(dto.readyByAt, dto.requiredByAt);

    // Validate copied recipients before creating anything. Attaching them after
    // the fact and failing halfway would leave a half-configured inquiry behind.
    const copies = this.normaliseRecipients(dto.recipients);
    await this.assertRecipientsSendable(copies.map((r) => r.email));

    const inquiry = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(tx);
      const created = await tx.inquiry.create({
        data: {
          number,
          status: InquiryStatus.DRAFT,
          requesterUnitId: user.unitId,
          providerUnitId: dto.providerUnitId,
          createdByUserId: user.id,
          pickupLocation: dto.pickupLocation,
          pickupContactName: dto.pickupContactName,
          pickupContactPhone: dto.pickupContactPhone,
          deliveryLocation: dto.deliveryLocation,
          deliveryContactName: dto.deliveryContactName,
          deliveryContactPhone: dto.deliveryContactPhone,
          readyByAt: new Date(dto.readyByAt),
          requiredByAt: new Date(dto.requiredByAt),
          cargoDescription: dto.cargoDescription,
          packageCount: dto.packageCount,
          grossWeight: dto.grossWeight,
          weightUom: dto.weightUom ?? 'KG',
          volumeCbm: dto.volumeCbm,
          dimensions: dto.dimensions,
          packagingType: dto.packagingType,
          requestedVehicleType: dto.requestedVehicleType,
          referenceNumber: dto.referenceNumber,
          priority: dto.priority ?? 'NORMAL',
          specialHandlingNotes: dto.specialHandlingNotes,
          // Placeholder — rewritten below now that we have the real id.
          rootMessageId: `pending-${number}`,
          subjectLine: this.buildSubject(
            number,
            dto.pickupLocation,
            dto.deliveryLocation,
          ),
        },
      });

      return tx.inquiry.update({
        where: { id: created.id },
        data: { rootMessageId: this.tokens.rootMessageId(created.id) },
      });
    });

    // Safe to attach now: the inquiry is a DRAFT, so adding recipients sends no
    // email. They are simply on the list when the submission email goes out.
    for (const copy of copies) {
      await this.recipients.add(user, inquiry.id, {
        email: copy.email,
        name: copy.name,
        type: copy.type,
      });
    }

    await this.recordEvent(
      inquiry.id,
      TimelineEventType.INQUIRY_CREATED,
      user,
      {
        number: inquiry.number,
        copiedRecipients: copies.length,
      },
    );
    await this.audit.record({
      action: 'inquiry.created',
      entityType: 'Inquiry',
      entityId: inquiry.id,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId: inquiry.id,
      after: { number: inquiry.number, status: inquiry.status },
    });

    return inquiry;
  }

  async update(user: AuthUser, inquiryId: string, dto: UpdateInquiryDto) {
    const inquiry = await this.requireAccess(user, inquiryId);

    if (inquiry.requesterUnitId !== user.unitId) {
      throw new ForbiddenException(
        'Only the requesting unit can edit an inquiry',
      );
    }
    if (
      inquiry.status === InquiryStatus.CANCELLED ||
      inquiry.status === InquiryStatus.COMPLETED
    ) {
      throw new BadRequestException('This inquiry is closed');
    }

    // Rule L3 — once a vehicle is committed, the terms it was committed against
    // are frozen. Anything else would let a requester silently change the load
    // under a vehicle that's already been assigned to it.
    if (inquiry.status === InquiryStatus.VEHICLE_PROVIDED) {
      const attempted = LOCKED_AFTER_VEHICLE.filter(
        (field) => dto[field] !== undefined,
      );
      if (attempted.length > 0) {
        throw new BadRequestException(
          `A vehicle has already been assigned. These fields can no longer be changed: ${attempted.join(', ')}. Cancel and raise a new inquiry, or discuss it in a comment.`,
        );
      }
    }

    this.assertTimingSane(
      dto.readyByAt ?? inquiry.readyByAt.toISOString(),
      dto.requiredByAt ?? inquiry.requiredByAt.toISOString(),
    );

    const changes = this.diff(
      inquiry,
      dto as unknown as Record<string, unknown>,
    );
    if (Object.keys(changes).length === 0) return inquiry;

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        ...dto,
        ...(dto.readyByAt ? { readyByAt: new Date(dto.readyByAt) } : {}),
        ...(dto.requiredByAt
          ? { requiredByAt: new Date(dto.requiredByAt) }
          : {}),
      },
    });

    await this.recordEvent(inquiryId, TimelineEventType.INQUIRY_AMENDED, user, {
      changes,
    });
    await this.audit.record({
      action: 'inquiry.amended',
      entityType: 'Inquiry',
      entityId: inquiryId,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId,
      before: changes,
    });

    // Only worth an email once the other side is actually watching.
    if (inquiry.status !== InquiryStatus.DRAFT) {
      await this.mail.enqueueInquiryEmail({
        inquiryId,
        eventType: EmailEventType.INQUIRY_AMENDED,
        actorName: user.fullName,
        actorUnitName: inquiry.requesterUnit.name,
        details: Object.entries(changes).map(([field, value]) => ({
          label: this.humanise(field),
          value: `${this.stringify(value.from)} → ${this.stringify(value.to)}`,
        })),
      });
    }

    return updated;
  }

  async submit(user: AuthUser, inquiryId: string) {
    const inquiry = await this.requireAccess(user, inquiryId);

    if (inquiry.requesterUnitId !== user.unitId) {
      throw new ForbiddenException(
        'Only the requesting unit can submit this inquiry',
      );
    }
    if (
      inquiry.status !== InquiryStatus.DRAFT &&
      inquiry.status !== InquiryStatus.DECLINED
    ) {
      throw new BadRequestException(
        `An inquiry in ${inquiry.status} cannot be submitted`,
      );
    }
    // A declined inquiry can be re-submitted, but not to a company we've since
    // been disconnected from.
    await this.units.assertAddressable(user.unitId, inquiry.providerUnitId);

    const isResubmission = inquiry.status === InquiryStatus.DECLINED;

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        status: InquiryStatus.SUBMITTED,
        submittedAt: inquiry.submittedAt ?? new Date(),
        declineReason: null,
        declinedAt: null,
        lastReminderAt: null,
      },
    });

    await this.seedRecipients(inquiry.id, inquiry.requesterUnitId, user.id);

    const eventType = isResubmission
      ? EmailEventType.INQUIRY_RESUBMITTED
      : EmailEventType.INQUIRY_SUBMITTED;

    await this.recordEvent(
      inquiryId,
      isResubmission
        ? TimelineEventType.INQUIRY_RESUBMITTED
        : TimelineEventType.INQUIRY_SUBMITTED,
      user,
      {},
    );
    await this.mail.enqueueInquiryEmail({
      inquiryId,
      eventType,
      actorName: user.fullName,
      actorUnitName: inquiry.requesterUnit.name,
      details: this.inquiryDetailRows(updated),
    });
    await this.audit.record({
      action: 'inquiry.submitted',
      entityType: 'Inquiry',
      entityId: inquiryId,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId,
      after: { status: updated.status },
    });

    return updated;
  }

  async provideVehicle(
    user: AuthUser,
    inquiryId: string,
    dto: ProvideVehicleDto,
  ) {
    const inquiry = await this.requireAccess(user, inquiryId);

    if (inquiry.providerUnitId !== user.unitId) {
      throw new ForbiddenException(
        'Only the unit the inquiry was addressed to can provide a vehicle',
      );
    }
    if (
      inquiry.status !== InquiryStatus.SUBMITTED &&
      inquiry.status !== InquiryStatus.VEHICLE_PROVIDED
    ) {
      throw new BadRequestException(
        `Cannot provide a vehicle for an inquiry in ${inquiry.status}`,
      );
    }

    const isRevision = inquiry.status === InquiryStatus.VEHICLE_PROVIDED;

    const detail = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.vehicleDetail.findFirst({
        where: { inquiryId },
        orderBy: { version: 'desc' },
      });

      // Rule VD1 — never overwrite. Each revision is a new row.
      const created = await tx.vehicleDetail.create({
        data: {
          inquiryId,
          version: (latest?.version ?? 0) + 1,
          vehicleNumber: dto.vehicleNumber,
          vehicleType: dto.vehicleType,
          transporterName: dto.transporterName,
          driverName: dto.driverName,
          driverPhone: dto.driverPhone,
          expectedPickupAt: new Date(dto.expectedPickupAt),
          notes: dto.notes,
          createdByUserId: user.id,
        },
      });

      await tx.inquiry.update({
        where: { id: inquiryId },
        data: { status: InquiryStatus.VEHICLE_PROVIDED },
      });

      return created;
    });

    await this.recordEvent(
      inquiryId,
      isRevision
        ? TimelineEventType.VEHICLE_UPDATED
        : TimelineEventType.VEHICLE_PROVIDED,
      user,
      { version: detail.version, vehicleNumber: detail.vehicleNumber },
    );

    await this.mail.enqueueInquiryEmail({
      inquiryId,
      eventType: isRevision
        ? EmailEventType.VEHICLE_UPDATED
        : EmailEventType.VEHICLE_PROVIDED,
      actorName: user.fullName,
      actorUnitName: inquiry.providerUnit.name,
      details: [
        { label: 'Vehicle number', value: detail.vehicleNumber },
        { label: 'Vehicle type', value: this.humanise(detail.vehicleType) },
        { label: 'Transporter', value: detail.transporterName },
        { label: 'Driver', value: detail.driverName },
        { label: 'Driver phone', value: detail.driverPhone },
        {
          label: 'Expected pickup',
          value: detail.expectedPickupAt.toISOString(),
        },
        { label: 'Notes', value: detail.notes },
        ...(isRevision
          ? [{ label: 'Revision', value: `Version ${detail.version}` }]
          : []),
      ],
    });

    await this.audit.record({
      action: isRevision
        ? 'inquiry.vehicle_updated'
        : 'inquiry.vehicle_provided',
      entityType: 'VehicleDetail',
      entityId: detail.id,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId,
      after: { version: detail.version, vehicleNumber: detail.vehicleNumber },
    });

    return detail;
  }

  async decline(user: AuthUser, inquiryId: string, dto: DeclineInquiryDto) {
    const inquiry = await this.requireAccess(user, inquiryId);

    if (inquiry.providerUnitId !== user.unitId) {
      throw new ForbiddenException(
        'Only the unit the inquiry was addressed to can decline it',
      );
    }
    if (inquiry.status !== InquiryStatus.SUBMITTED) {
      throw new BadRequestException(
        `Cannot decline an inquiry in ${inquiry.status}`,
      );
    }

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        status: InquiryStatus.DECLINED,
        declineReason: dto.reason,
        declinedAt: new Date(),
      },
    });

    await this.recordEvent(
      inquiryId,
      TimelineEventType.INQUIRY_DECLINED,
      user,
      { reason: dto.reason },
    );
    await this.mail.enqueueInquiryEmail({
      inquiryId,
      eventType: EmailEventType.INQUIRY_DECLINED,
      actorName: user.fullName,
      actorUnitName: inquiry.providerUnit.name,
      message: dto.reason,
      details: [{ label: 'Inquiry', value: inquiry.number }],
    });
    await this.audit.record({
      action: 'inquiry.declined',
      entityType: 'Inquiry',
      entityId: inquiryId,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId,
      after: { status: updated.status, reason: dto.reason },
    });

    return updated;
  }

  async cancel(user: AuthUser, inquiryId: string, reason?: string) {
    const inquiry = await this.requireAccess(user, inquiryId);

    if (inquiry.requesterUnitId !== user.unitId) {
      throw new ForbiddenException(
        'Only the requesting unit can cancel an inquiry',
      );
    }
    if (
      inquiry.status === InquiryStatus.COMPLETED ||
      inquiry.status === InquiryStatus.CANCELLED
    ) {
      throw new BadRequestException('This inquiry is already closed');
    }

    const wasAssigned = inquiry.status === InquiryStatus.VEHICLE_PROVIDED;

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: { status: InquiryStatus.CANCELLED, cancelledAt: new Date() },
    });

    await this.recordEvent(
      inquiryId,
      TimelineEventType.INQUIRY_CANCELLED,
      user,
      { reason, wasAssigned },
    );

    if (inquiry.status !== InquiryStatus.DRAFT) {
      await this.mail.enqueueInquiryEmail({
        inquiryId,
        eventType: EmailEventType.INQUIRY_CANCELLED,
        actorName: user.fullName,
        actorUnitName: inquiry.requesterUnit.name,
        message: reason,
        details: wasAssigned
          ? [
              {
                label: 'Important',
                value:
                  'A vehicle had already been assigned. Please stand it down.',
              },
            ]
          : [],
      });
    }

    await this.audit.record({
      action: 'inquiry.cancelled',
      entityType: 'Inquiry',
      entityId: inquiryId,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId,
      after: { status: updated.status, reason },
    });

    return updated;
  }

  /** Rule L1 — either party may close it out. */
  async complete(user: AuthUser, inquiryId: string) {
    const inquiry = await this.requireAccess(user, inquiryId);

    // Idempotent: whoever gets there first wins, the second call is a no-op.
    if (inquiry.status === InquiryStatus.COMPLETED) return inquiry;

    if (inquiry.status !== InquiryStatus.VEHICLE_PROVIDED) {
      throw new BadRequestException(
        'Only an inquiry with an assigned vehicle can be completed',
      );
    }

    const updated = await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        status: InquiryStatus.COMPLETED,
        completedAt: new Date(),
        completedByUserId: user.id,
      },
    });

    await this.recordEvent(
      inquiryId,
      TimelineEventType.INQUIRY_COMPLETED,
      user,
      {},
    );
    await this.mail.enqueueInquiryEmail({
      inquiryId,
      eventType: EmailEventType.INQUIRY_COMPLETED,
      actorName: user.fullName,
      details: [{ label: 'Inquiry', value: inquiry.number }],
    });
    await this.audit.record({
      action: 'inquiry.completed',
      entityType: 'Inquiry',
      entityId: inquiryId,
      actorUserId: user.id,
      unitId: user.unitId,
      inquiryId,
      after: { status: updated.status },
    });

    return updated;
  }

  async addComment(user: AuthUser, inquiryId: string, dto: CreateCommentDto) {
    const inquiry = await this.requireAccess(user, inquiryId);

    const comment = await this.prisma.comment.create({
      data: {
        inquiryId,
        body: dto.body,
        source: CommentSource.APP,
        authorUserId: user.id,
        authorName: user.fullName,
        authorEmail: user.email,
      },
    });

    await this.recordEvent(inquiryId, TimelineEventType.COMMENT_ADDED, user, {
      commentId: comment.id,
      preview: dto.body.slice(0, 140),
    });

    if (inquiry.status !== InquiryStatus.DRAFT) {
      const actorUnitName =
        inquiry.requesterUnitId === user.unitId
          ? inquiry.requesterUnit.name
          : inquiry.providerUnit.name;

      await this.mail.enqueueInquiryEmail({
        inquiryId,
        eventType: EmailEventType.COMMENT_ADDED,
        actorName: user.fullName,
        actorUnitName,
        message: dto.body,
        details: [],
      });
    }

    return comment;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Seeds the TO recipients — the creator plus the counterparty's primary
   * contact (Rule R1). Idempotent, so re-submitting never duplicates anyone.
   */
  private async seedRecipients(
    inquiryId: string,
    requesterUnitId: string,
    creatorUserId: string,
  ) {
    const inquiry = await this.prisma.inquiry.findUniqueOrThrow({
      where: { id: inquiryId },
      include: { providerUnit: true, createdBy: true },
    });

    const seeds = [
      {
        email: inquiry.createdBy.email,
        name: inquiry.createdBy.fullName,
        userId: inquiry.createdBy.id,
        addedByUnitId: requesterUnitId,
      },
      {
        email: inquiry.providerUnit.primaryContactEmail,
        name: inquiry.providerUnit.primaryContactName,
        userId: null,
        addedByUnitId: inquiry.providerUnitId,
      },
    ];

    for (const seed of seeds) {
      await this.prisma.recipient.upsert({
        where: {
          inquiryId_email: { inquiryId, email: seed.email.toLowerCase() },
        },
        create: {
          inquiryId,
          type: RecipientType.TO,
          kind: seed.userId ? RecipientKind.USER : RecipientKind.EXTERNAL,
          email: seed.email.toLowerCase(),
          name: seed.name,
          userId: seed.userId,
          addedByUnitId: seed.addedByUnitId,
          addedByUserId: creatorUserId,
        },
        update: { removedAt: null },
      });
    }
  }

  /** Lower-cases, trims and de-duplicates, keeping the first mention of an address. */
  private normaliseRecipients(
    input: { email: string; name?: string; type: 'CC' | 'BCC' }[] | undefined,
  ) {
    const seen = new Set<string>();
    const result: { email: string; name?: string; type: 'CC' | 'BCC' }[] = [];

    for (const entry of input ?? []) {
      const email = entry.email.toLowerCase().trim();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      result.push({
        email,
        name: entry.name?.trim() || undefined,
        type: entry.type,
      });
    }
    return result;
  }

  private async assertRecipientsSendable(emails: string[]): Promise<void> {
    if (emails.length === 0) return;

    const suppressed = await this.prisma.suppressedEmail.findMany({
      where: { email: { in: emails } },
      select: { email: true, reason: true },
    });

    if (suppressed.length > 0) {
      throw new BadRequestException(
        `Mail to these addresses has been failing, so they cannot be copied: ${suppressed
          .map((row) => `${row.email} (${row.reason})`)
          .join(', ')}`,
      );
    }
  }

  private async nextNumber(
    tx: Pick<PrismaService, 'inquirySequence'>,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const sequence = await tx.inquirySequence.upsert({
      where: { year },
      create: { year, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `INQ-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
  }

  private buildSubject(number: string, pickup: string, delivery: string) {
    const trim = (value: string) =>
      value.length > 40 ? `${value.slice(0, 37)}...` : value;
    return `[${number}] ${trim(pickup)} → ${trim(delivery)}`;
  }

  private assertTimingSane(readyBy: string | Date, requiredBy: string | Date) {
    // Validation V2: a ready-by date in the past is allowed — back-dated entry
    // is legitimate when catching up on records.
    if (new Date(requiredBy) < new Date(readyBy)) {
      throw new BadRequestException(
        'Required-by must be on or after the ready-by date',
      );
    }
  }

  private diff(
    before: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const previous = before[key];
      const normalisedPrevious =
        previous instanceof Date ? previous.toISOString() : previous;
      const normalisedNext =
        typeof value === 'string' &&
        !Number.isNaN(Date.parse(value)) &&
        previous instanceof Date
          ? new Date(value).toISOString()
          : value;
      if (
        this.stringify(normalisedPrevious) !== this.stringify(normalisedNext)
      ) {
        changes[key] = { from: normalisedPrevious, to: normalisedNext };
      }
    }
    return changes;
  }

  private inquiryDetailRows(inquiry: {
    pickupLocation: string;
    deliveryLocation: string;
    readyByAt: Date;
    requiredByAt: Date;
    cargoDescription: string;
    packageCount: number;
    grossWeight: unknown;
    weightUom: string;
    requestedVehicleType: string | null;
    referenceNumber: string | null;
    priority: string;
    specialHandlingNotes: string | null;
  }): DetailRow[] {
    return [
      { label: 'Pickup', value: inquiry.pickupLocation },
      { label: 'Delivery', value: inquiry.deliveryLocation },
      { label: 'Ready by', value: inquiry.readyByAt.toISOString() },
      { label: 'Required by', value: inquiry.requiredByAt.toISOString() },
      { label: 'Cargo', value: inquiry.cargoDescription },
      { label: 'Packages', value: String(inquiry.packageCount) },
      {
        label: 'Gross weight',
        value: `${String(inquiry.grossWeight)} ${inquiry.weightUom}`,
      },
      {
        label: 'Vehicle requested',
        value: inquiry.requestedVehicleType
          ? this.humanise(inquiry.requestedVehicleType)
          : null,
      },
      { label: 'Reference', value: inquiry.referenceNumber },
      {
        label: 'Priority',
        value: inquiry.priority === 'URGENT' ? 'URGENT' : null,
      },
      { label: 'Special handling', value: inquiry.specialHandlingNotes },
    ];
  }

  /**
   * Renders an arbitrary field value as a string. Diff values are `unknown`, so
   * they can't go straight into a template literal — and an object dropped into
   * one stringifies to the useless `[object Object]`.
   */
  private stringify(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return value.toString();
    }
    if (typeof value === 'object') {
      // Prisma's Decimal (grossWeight, volumeCbm) is an object with a real
      // toString. JSON.stringify would render its internals instead of "1200".
      const candidate = value as { toString: () => string };
      return candidate.toString === Object.prototype.toString
        ? JSON.stringify(value)
        : candidate.toString();
    }
    return JSON.stringify(value) ?? '';
  }

  private humanise(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
  }

  private async recordEvent(
    inquiryId: string,
    type: TimelineEventType,
    user: AuthUser,
    payload: Record<string, unknown>,
  ) {
    await this.prisma.timelineEvent.create({
      data: {
        inquiryId,
        type,
        actorUserId: user.id,
        actorName: user.fullName,
        payload: payload as never,
      },
    });
  }
}
