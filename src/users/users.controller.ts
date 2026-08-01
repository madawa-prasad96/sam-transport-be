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
import { UserRole, UserStatus } from '../generated/prisma/enums';
import {
  InviteUserDto,
  UpdateProfileDto,
  UpdateUserRoleDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.listForCompany(this.companyOf(user));
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Post('invite')
  invite(@Body() dto: InviteUserDto, @CurrentUser() user: AuthUser) {
    return this.users.invite(this.companyOf(user), dto, {
      id: user.id,
      fullName: user.fullName,
    });
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: UserStatus,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.setStatus(this.companyOf(user), id, status, user.id);
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Patch(':id/role')
  setRole(
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.setRole(this.companyOf(user), id, dto.role, user.id);
  }

  @Patch('me')
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.updateProfile(user.id, dto);
  }

  private companyOf(user: AuthUser): string {
    if (!user.companyId) {
      throw new ForbiddenException('This account has no company');
    }
    return user.companyId;
  }
}
