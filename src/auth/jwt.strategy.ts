import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
}

const fromCookie = (req: Request): string | null =>
  (req?.cookies?.access_token as string) ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret')!,
    });
  }

  /**
   * The DB lookup on every request is deliberate: it means deactivating a user
   * or deactivating a unit takes effect immediately rather than when their
   * access token happens to expire.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { unit: true },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
    if (user.unit.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your unit is not active');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      unitId: user.unitId,
    };
  }
}
