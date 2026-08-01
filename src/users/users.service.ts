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
  InvitationStatus,
  InvitationType,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  InviteUserDto,
  UpdateProfileDto,
} from './dto/user.dto';

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  notificationPreference: true,
  companyId: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  listForCompany(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      select: SAFE_SELECT,
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    });
  }

  async invite(companyId: string, dto: InviteUserDto, actor: { id: string; fullName: string }) {
    if (dto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admins cannot be invited to a company');
    }

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.status !== UserStatus.INVITED) {
      throw new BadRequestException(
        'A user with that email already exists on the platform',
      );
    }

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
    });

    const token = generateOpaqueToken();

    await this.prisma.$transaction(async (tx) => {
      if (!existing) {
        await tx.user.create({
          data: {
            email,
            fullName: dto.fullName,
            phone: dto.phone,
            role: dto.role,
            status: UserStatus.INVITED,
            companyId,
          },
        });
      }

      // Any earlier outstanding invite for this address is superseded.
      await tx.invitation.updateMany({
        where: { email, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.REVOKED },
      });

      await tx.invitation.create({
        data: {
          type: InvitationType.USER,
          email,
          tokenHash: hashToken(token),
          companyId,
          role: dto.role,
          invitedByUserId: actor.id,
          expiresAt: new Date(
            Date.now() +
              this.config.get<number>('invitationTtlHours')! * 60 * 60 * 1000,
          ),
        },
      });
    });

    await this.mail.enqueueUserInvitation({
      to: email,
      inviterName: actor.fullName,
      companyName: company.name,
      token,
    });

    await this.audit.record({
      action: 'user.invited',
      entityType: 'User',
      entityId: email,
      actorUserId: actor.id,
      companyId,
      after: { email, role: dto.role },
    });

    return { ok: true };
  }

  async setStatus(
    companyId: string,
    userId: string,
    status: UserStatus,
    actorUserId: string,
  ) {
    const user = await this.requireCompanyUser(companyId, userId);

    if (status === UserStatus.DEACTIVATED) {
      await this.assertNotLastAdmin(companyId, user.id, user.role);
      if (user.id === actorUserId) {
        throw new BadRequestException('You cannot deactivate your own account');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id: userId },
        data: { status },
        select: SAFE_SELECT,
      });
      // Deactivation must end existing sessions, not just block new logins.
      if (status === UserStatus.DEACTIVATED) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return result;
    });

    await this.audit.record({
      action: `user.${status.toLowerCase()}`,
      entityType: 'User',
      entityId: userId,
      actorUserId,
      companyId,
      before: { status: user.status },
      after: { status },
    });

    return updated;
  }

  async setRole(
    companyId: string,
    userId: string,
    role: UserRole,
    actorUserId: string,
  ) {
    if (role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Cannot grant super admin from a company');
    }
    const user = await this.requireCompanyUser(companyId, userId);

    if (user.role === UserRole.COMPANY_ADMIN && role !== UserRole.COMPANY_ADMIN) {
      await this.assertNotLastAdmin(companyId, userId, user.role);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'user.role_changed',
      entityType: 'User',
      entityId: userId,
      actorUserId,
      companyId,
      before: { role: user.role },
      after: { role },
    });

    return updated;
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: SAFE_SELECT,
    });
  }

  private async requireCompanyUser(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
    });
    // Scoping the lookup by company is what stops one company touching another's
    // users — a plain findUnique here would be a cross-tenant hole.
    if (!user) throw new NotFoundException('User not found in this company');
    return user;
  }

  /** Rule U3 — a company must always retain at least one active admin. */
  private async assertNotLastAdmin(
    companyId: string,
    userId: string,
    role: UserRole,
  ) {
    if (role !== UserRole.COMPANY_ADMIN) return;
    const remaining = await this.prisma.user.count({
      where: {
        companyId,
        role: UserRole.COMPANY_ADMIN,
        status: UserStatus.ACTIVE,
        id: { not: userId },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'This company must keep at least one active administrator',
      );
    }
  }
}
