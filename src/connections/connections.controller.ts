import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConnectionStatus, UserRole } from '../generated/prisma/enums';
import { ConnectionsService } from './connections.service';
import { InviteCounterpartyDto } from './dto/connection.dto';

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.connections.listForCompany(this.companyOf(user));
  }

  /** Companies an inquiry may currently be addressed to. */
  @Get('available')
  available(@CurrentUser() user: AuthUser) {
    return this.connections.listConnectedCompanies(this.companyOf(user));
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Post('invite')
  invite(
    @Body() dto: InviteCounterpartyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.inviteCounterparty(this.companyOf(user), dto, {
      id: user.id,
      fullName: user.fullName,
    });
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Post(':id/respond')
  respond(
    @Param('id') id: string,
    @Body('accept') accept: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.respond(
      this.companyOf(user),
      id,
      accept,
      user.id,
    );
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: ConnectionStatus,
    @CurrentUser() user: AuthUser,
  ) {
    return this.connections.setStatus(
      this.companyOf(user),
      id,
      status,
      user.id,
    );
  }

  private companyOf(user: AuthUser): string {
    if (!user.companyId) {
      throw new ForbiddenException('This account has no company');
    }
    return user.companyId;
  }
}
