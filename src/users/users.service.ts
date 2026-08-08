import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { seesAllUnits } from '../common/decorators/current-user.decorator';
import { generateOpaqueToken, hashToken } from '../common/utils/tokens';
import {
  InvitationStatus,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { InviteUserDto, UpdateProfileDto } from './dto/user.dto';

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  notificationPreference: true,
  unitId: true,
  unit: { select: { id: true, name: true, code: true } },
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

  /**
   * A unit admin sees their own unit. An org admin sees everyone, optionally
   * filtered to one unit.
   */
  list(user: AuthUser, unitIdFilter?: string) {
    const unitId = seesAllUnits(user) ? unitIdFilter : user.unitId;
    return this.prisma.user.findMany({
      where: unitId ? { unitId } : {},
      select: SAFE_SELECT,
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    });
  }

  async invite(actor: AuthUser, dto: InviteUserDto) {
    // Only an org admin may mint another org admin, or place a user in a unit
    // other than their own.
    if (dto.role === UserRole.ORG_ADMIN && !seesAllUnits(actor)) {
      throw new ForbiddenException('Only an org admin can grant org admin');
    }

    const unitId = dto.unitId ?? actor.unitId;
    if (unitId !== actor.unitId && !seesAllUnits(actor)) {
      throw new ForbiddenException(
        'You can only invite people into your own unit',
      );
    }

    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Unit not found');

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.status !== UserStatus.INVITED) {
      throw new BadRequestException(
        'A user with that email already exists',
      );
    }

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
            unitId,
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
          email,
          tokenHash: hashToken(token),
          unitId,
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
      unitName: unit.name,
      token,
    });

    await this.audit.record({
      action: 'user.invited',
      entityType: 'User',
      entityId: email,
      actorUserId: actor.id,
      unitId,
      after: { email, role: dto.role, unit: unit.name },
    });

    return { ok: true };
  }

  async setStatus(actor: AuthUser, userId: string, status: UserStatus) {
    const user = await this.requireManageable(actor, userId);

    if (status === UserStatus.DEACTIVATED) {
      await this.assertNotLastAdmin(user.unitId, user.id, user.role);
      if (user.id === actor.id) {
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
      actorUserId: actor.id,
      unitId: user.unitId,
      before: { status: user.status },
      after: { status },
    });

    return updated;
  }

  async setRole(actor: AuthUser, userId: string, role: UserRole) {
    if (role === UserRole.ORG_ADMIN && !seesAllUnits(actor)) {
      throw new ForbiddenException('Only an org admin can grant org admin');
    }

    const user = await this.requireManageable(actor, userId);

    if (user.role === UserRole.UNIT_ADMIN && role !== UserRole.UNIT_ADMIN) {
      await this.assertNotLastAdmin(user.unitId, userId, user.role);
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
      actorUserId: actor.id,
      unitId: user.unitId,
      before: { role: user.role },
      after: { role },
    });

    return updated;
  }

  /** Org admin only: move someone to a different unit. */
  async moveToUnit(actor: AuthUser, userId: string, unitId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Unit not found');

    if (user.unitId === unitId) return user;
    await this.assertNotLastAdmin(user.unitId, userId, user.role);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { unitId },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'user.moved_unit',
      entityType: 'User',
      entityId: userId,
      actorUserId: actor.id,
      unitId,
      before: { unitId: user.unitId },
      after: { unitId },
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

  /**
   * A unit admin may only touch users in their own unit; an org admin may touch
   * anyone. Scoping the lookup rather than checking afterwards is what keeps a
   * forgotten guard from becoming a hole.
   */
  private async requireManageable(actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        ...(seesAllUnits(actor) ? {} : { unitId: actor.unitId }),
      },
    });
    if (!user) throw new NotFoundException('User not found in your unit');
    return user;
  }

  /** Every unit keeps at least one active administrator. */
  private async assertNotLastAdmin(
    unitId: string,
    userId: string,
    role: UserRole,
  ) {
    if (role !== UserRole.UNIT_ADMIN && role !== UserRole.ORG_ADMIN) return;
    const remaining = await this.prisma.user.count({
      where: {
        unitId,
        role: { in: [UserRole.UNIT_ADMIN, UserRole.ORG_ADMIN] },
        status: UserStatus.ACTIVE,
        id: { not: userId },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        'This unit must keep at least one active administrator',
      );
    }
  }
}
