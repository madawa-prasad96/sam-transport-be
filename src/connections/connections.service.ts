import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashToken } from '../common/utils/tokens';
import {
  CompanyStatus,
  ConnectionStatus,
  InvitationType,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { InviteCounterpartyDto } from './dto/connection.dto';

/**
 * A connection is undirected. Storing the pair in a fixed order is what makes
 * the unique constraint actually enforce "at most one connection between any
 * two companies" (Rule C3) — otherwise (A,B) and (B,A) would both be allowed.
 */
const orderedPair = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async listForCompany(companyId: string) {
    const connections = await this.prisma.connection.findMany({
      where: { OR: [{ companyAId: companyId }, { companyBId: companyId }] },
      include: { companyA: true, companyB: true },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map((connection) => {
      const counterparty =
        connection.companyAId === companyId
          ? connection.companyB
          : connection.companyA;
      return {
        id: connection.id,
        status: connection.status,
        createdAt: connection.createdAt,
        /// True when we sent the invitation — only the receiving side may accept.
        initiatedByUs: connection.companyAId === companyId
          ? connection.invitedByUserId !== null
          : false,
        counterparty: {
          id: counterparty.id,
          name: counterparty.name,
          country: counterparty.country,
          status: counterparty.status,
          primaryContactName: counterparty.primaryContactName,
          primaryContactEmail: counterparty.primaryContactEmail,
        },
      };
    });
  }

  /** Companies we may currently address an inquiry to. */
  async listConnectedCompanies(companyId: string) {
    const connections = await this.prisma.connection.findMany({
      where: {
        status: ConnectionStatus.ACTIVE,
        OR: [{ companyAId: companyId }, { companyBId: companyId }],
      },
      include: { companyA: true, companyB: true },
    });

    return connections
      .map((c) => (c.companyAId === companyId ? c.companyB : c.companyA))
      .filter((company) => company.status === CompanyStatus.ACTIVE)
      .map((company) => ({ id: company.id, name: company.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async inviteCounterparty(
    companyId: string,
    dto: InviteCounterpartyDto,
    actor: { id: string; fullName: string },
  ) {
    const email = dto.contactEmail.toLowerCase().trim();
    const inviter = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    // Case 1 — the address already belongs to a company on the platform.
    // Don't create a duplicate company; just request a connection to theirs.
    if (existingUser?.companyId) {
      if (existingUser.companyId === companyId) {
        throw new BadRequestException('You cannot connect a company to itself');
      }
      return this.requestConnectionToExisting(
        companyId,
        existingUser.companyId,
        actor,
        inviter.name,
        existingUser.company!.name,
      );
    }

    // Case 2 — brand new company, invited into existence.
    const token = generateOpaqueToken();
    const connection = await this.prisma.$transaction(async (tx) => {
      const invited = await tx.company.create({
        data: {
          name: dto.companyName,
          addressLine: 'To be completed',
          country: dto.country ?? inviter.country,
          primaryContactName: dto.contactName,
          primaryContactEmail: email,
          primaryContactPhone: dto.contactPhone ?? '',
          status: CompanyStatus.PENDING,
        },
      });

      await tx.user.create({
        data: {
          email,
          fullName: dto.contactName,
          phone: dto.contactPhone,
          role: UserRole.COMPANY_ADMIN,
          status: UserStatus.INVITED,
          companyId: invited.id,
        },
      });

      await tx.invitation.create({
        data: {
          type: InvitationType.COMPANY,
          email,
          tokenHash: hashToken(token),
          companyId: invited.id,
          invitedCompanyName: dto.companyName,
          role: UserRole.COMPANY_ADMIN,
          invitedByUserId: actor.id,
          expiresAt: new Date(
            Date.now() +
              this.config.get<number>('invitationTtlHours')! * 60 * 60 * 1000,
          ),
        },
      });

      const [companyAId, companyBId] = orderedPair(companyId, invited.id);
      return tx.connection.create({
        data: {
          companyAId,
          companyBId,
          // Activated automatically when they accept — they already agreed by
          // accepting the invitation itself.
          status: ConnectionStatus.INVITED,
          invitedByUserId: actor.id,
        },
      });
    });

    await this.mail.enqueueCompanyInvitation({
      to: email,
      inviterName: actor.fullName,
      inviterCompanyName: inviter.name,
      invitedCompanyName: dto.companyName,
      token,
    });

    await this.audit.record({
      action: 'connection.invited',
      entityType: 'Connection',
      entityId: connection.id,
      actorUserId: actor.id,
      companyId,
      after: { invitedEmail: email, companyName: dto.companyName },
    });

    return connection;
  }

  private async requestConnectionToExisting(
    companyId: string,
    targetCompanyId: string,
    actor: { id: string; fullName: string },
    inviterName: string,
    targetName: string,
  ) {
    const [companyAId, companyBId] = orderedPair(companyId, targetCompanyId);

    const existing = await this.prisma.connection.findUnique({
      where: { companyAId_companyBId: { companyAId, companyBId } },
    });
    if (existing) {
      if (existing.status === ConnectionStatus.ACTIVE) {
        throw new BadRequestException(
          `You are already connected to ${targetName}`,
        );
      }
      if (existing.status === ConnectionStatus.INVITED) {
        throw new BadRequestException(
          `A connection request to ${targetName} is already pending`,
        );
      }
      // Suspended or rejected — reopen it rather than creating a duplicate.
      return this.prisma.connection.update({
        where: { id: existing.id },
        data: {
          status: ConnectionStatus.INVITED,
          invitedByUserId: actor.id,
        },
      });
    }

    const connection = await this.prisma.connection.create({
      data: {
        companyAId,
        companyBId,
        status: ConnectionStatus.INVITED,
        invitedByUserId: actor.id,
      },
    });

    const admins = await this.prisma.user.findMany({
      where: {
        companyId: targetCompanyId,
        role: UserRole.COMPANY_ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    for (const admin of admins) {
      await this.mail.enqueueStandalone({
        eventType: 'COMPANY_INVITED',
        to: admin.email,
        subject: `${inviterName} wants to connect on the Transport Inquiry Platform`,
        html: `<p>${actor.fullName} at <strong>${inviterName}</strong> has requested a connection with ${targetName}.</p><p>Once you accept, either company can raise transport inquiries with the other.</p><p><a href="${this.config.get<string>('webAppUrl')}/connections">Review the request</a></p>`,
        text: `${actor.fullName} at ${inviterName} has requested a connection with ${targetName}.\n\nReview it at ${this.config.get<string>('webAppUrl')}/connections`,
      });
    }

    return connection;
  }

  async respond(
    companyId: string,
    connectionId: string,
    accept: boolean,
    actorUserId: string,
  ) {
    const connection = await this.requireMembership(companyId, connectionId);

    if (connection.status !== ConnectionStatus.INVITED) {
      throw new BadRequestException('This connection is not awaiting a response');
    }
    // Only the side that did NOT send the invitation may accept it.
    const isInviter = await this.prisma.user.findFirst({
      where: { id: connection.invitedByUserId ?? '', companyId },
      select: { id: true },
    });
    if (isInviter) {
      throw new ForbiddenException(
        'The inviting company cannot accept its own request',
      );
    }

    const updated = await this.prisma.connection.update({
      where: { id: connectionId },
      data: {
        status: accept ? ConnectionStatus.ACTIVE : ConnectionStatus.REJECTED,
      },
    });

    await this.audit.record({
      action: accept ? 'connection.accepted' : 'connection.rejected',
      entityType: 'Connection',
      entityId: connectionId,
      actorUserId,
      companyId,
      after: { status: updated.status },
    });

    return updated;
  }

  async setStatus(
    companyId: string,
    connectionId: string,
    status: ConnectionStatus,
    actorUserId: string,
  ) {
    const connection = await this.requireMembership(companyId, connectionId);

    const updated = await this.prisma.connection.update({
      where: { id: connectionId },
      data: { status },
    });

    await this.audit.record({
      action: `connection.${status.toLowerCase()}`,
      entityType: 'Connection',
      entityId: connectionId,
      actorUserId,
      companyId,
      before: { status: connection.status },
      after: { status },
    });

    return updated;
  }

  /**
   * Rule C1 — an inquiry may only be addressed to an actively connected company.
   * This is the guardrail that stops the platform becoming a spam surface.
   */
  async assertActiveConnection(
    companyId: string,
    counterpartyId: string,
  ): Promise<void> {
    if (companyId === counterpartyId) {
      throw new BadRequestException(
        'An inquiry cannot be addressed to your own company',
      );
    }
    const [companyAId, companyBId] = orderedPair(companyId, counterpartyId);
    const connection = await this.prisma.connection.findUnique({
      where: { companyAId_companyBId: { companyAId, companyBId } },
    });

    if (!connection || connection.status !== ConnectionStatus.ACTIVE) {
      throw new ForbiddenException(
        'You are not connected to that company. Send them a connection invitation first.',
      );
    }
  }

  private async requireMembership(companyId: string, connectionId: string) {
    const connection = await this.prisma.connection.findFirst({
      where: {
        id: connectionId,
        OR: [{ companyAId: companyId }, { companyBId: companyId }],
      },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return connection;
  }
}
