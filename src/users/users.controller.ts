import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import {
  InviteUserDto,
  MoveUserDto,
  UpdateProfileDto,
  UpdateUserRoleDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unitId') unitId?: string) {
    return this.users.list(user, unitId);
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.UNIT_ADMIN)
  @Post('invite')
  invite(@Body() dto: InviteUserDto, @CurrentUser() user: AuthUser) {
    return this.users.invite(user, dto);
  }

  // Declared before ':id/...' so "me" is never parsed as a user id.
  @Patch('me')
  updateProfile(@Body() dto: UpdateProfileDto, @CurrentUser() user: AuthUser) {
    return this.users.updateProfile(user.id, dto);
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.UNIT_ADMIN)
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: UserStatus,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.setStatus(user, id, status);
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.UNIT_ADMIN)
  @Patch(':id/role')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.setRole(user, id, dto.role);
  }

  @Roles(UserRole.ORG_ADMIN)
  @Patch(':id/unit')
  moveToUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.moveToUnit(user, id, dto.unitId);
  }
}
