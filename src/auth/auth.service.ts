import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  generateOpaqueToken,
  hashToken,
} from '../common/utils/tokens';
import {
  CompanyStatus,
  InvitationStatus,
  InvitationType,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, LoginDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      include: { company: true },
    });

    // Same error for unknown email and wrong password — don't leak which
    // addresses are registered.
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user?.passwordHash) throw invalid;

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw invalid;

    if (user.status === UserStatus.INVITED) {
      throw new UnauthorizedException(
        'Please accept your invitation before signing in',
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('This account has been deactivated');
    }
    if (user.company && user.company.status !== CompanyStatus.ACTIVE) {
      throw new UnauthorizedException('This company account is not active');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      companyId: user.companyId,
    };

    return { user: authUser, tokens: await this.issueTokens(user.id) };
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    if (stored.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    // Rotate: a refresh token is single-use, so a stolen one is only good until
    // the legitimate client next refreshes.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.userId);
  }

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async acceptInvitation(
    dto: AcceptInvitationDto,
  ): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { company: true },
    });

    if (!invitation || invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is no longer valid');
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('This invitation has expired');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.$transaction(async (tx) => {
      // A COMPANY invitation also activates the company and completes its profile.
      if (invitation.type === InvitationType.COMPANY && invitation.companyId) {
        await tx.company.update({
          where: { id: invitation.companyId },
          data: {
            status: CompanyStatus.ACTIVE,
            ...(dto.companyName ? { name: dto.companyName } : {}),
            ...(dto.addressLine ? { addressLine: dto.addressLine } : {}),
            ...(dto.country ? { country: dto.country } : {}),
            ...(dto.primaryContactPhone
              ? { primaryContactPhone: dto.primaryContactPhone }
              : {}),
            ...(dto.fullName ? { primaryContactName: dto.fullName } : {}),
          },
        });

        // Activate every connection that was waiting on this company joining.
        await tx.connection.updateMany({
          where: {
            status: 'INVITED',
            OR: [
              { companyAId: invitation.companyId },
              { companyBId: invitation.companyId },
            ],
          },
          data: { status: 'ACTIVE' },
        });
      }

      const existing = await tx.user.findUnique({
        where: { email: invitation.email },
      });

      const created = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              status: UserStatus.ACTIVE,
              ...(dto.fullName ? { fullName: dto.fullName } : {}),
              ...(dto.phone ? { phone: dto.phone } : {}),
            },
          })
        : await tx.user.create({
            data: {
              email: invitation.email,
              fullName: dto.fullName ?? invitation.email,
              phone: dto.phone,
              passwordHash,
              role: invitation.role ?? UserRole.COMPANY_USER,
              status: UserStatus.ACTIVE,
              companyId: invitation.companyId,
            },
          });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });

      return created;
    });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      companyId: user.companyId,
    };

    return { user: authUser, tokens: await this.issueTokens(user.id) };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, currentPassword))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await argon2.hash(newPassword, {
            type: argon2.argon2id,
          }),
        },
      }),
      // Changing a password invalidates every other session.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: (this.config.get<string>('jwt.accessTtl') ??
          '15m') as JwtSignOptions['expiresIn'],
      },
    );

    const refreshToken = generateOpaqueToken();
    const ttlDays = Number.parseInt(
      (this.config.get<string>('jwt.refreshTtl') ?? '7d').replace('d', ''),
      10,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(
          Date.now() + (Number.isNaN(ttlDays) ? 7 : ttlDays) * 86_400_000,
        ),
      },
    });

    return { accessToken, refreshToken };
  }
}
