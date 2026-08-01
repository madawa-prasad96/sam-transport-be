import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { hmac, safeEqual } from '../common/utils/tokens';
import { UserRole } from '../generated/prisma/enums';
import { InboundService } from './inbound.service';
import type { InboundEmailPayload } from './inbound.service';

@Controller()
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Called by the Cloudflare Email Worker, which receives the message, parses
   * it, and forwards it here signed with a shared secret. Inbound handled this
   * way costs nothing and keeps the whole Resend quota available for sending.
   */
  @Public()
  @Post('webhooks/inbound-email')
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: InboundEmailPayload,
    @Headers('x-signature') signature: string,
  ) {
    const secret = this.config.get<string>('mail.inboundWebhookSecret')!;
    // Verify against the raw bytes, not the re-serialised object.
    const body = req.rawBody?.toString('utf8') ?? '';
    const expected = hmac(secret, body);

    if (!signature || !body || !safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return this.inbound.process(payload);
  }

  @Get('inbound/quarantine')
  listQuarantine(@CurrentUser() user: AuthUser) {
    return this.inbound.listQuarantined(this.companyOf(user));
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Delete('inbound/quarantine/:id')
  discard(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inbound.discardQuarantined(this.companyOf(user), id);
  }

  private companyOf(user: AuthUser): string {
    if (!user.companyId) {
      throw new ForbiddenException('This account has no company');
    }
    return user.companyId;
  }
}
