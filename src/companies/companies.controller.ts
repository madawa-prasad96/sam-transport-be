import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CompanyStatus, UserRole } from '../generated/prisma/enums';
import { CompaniesService } from './companies.service';
import { RegisterCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  // --- Super Admin -------------------------------------------------------

  @Roles(UserRole.SUPER_ADMIN)
  @Post()
  register(@Body() dto: RegisterCompanyDto, @CurrentUser() user: AuthUser) {
    return this.companies.register(dto, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  listAll(
    @Query('search') search?: string,
    @Query('status') status?: CompanyStatus,
  ) {
    return this.companies.listAll({ search, status });
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: CompanyStatus,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companies.setStatus(id, status, user.id);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Post(':id/resend-invitation')
  resendInvitation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.companies.resendAdminInvitation(id, user.id);
  }

  // --- Company-scoped ----------------------------------------------------

  @Get('me')
  myCompany(@CurrentUser() user: AuthUser) {
    if (!user.companyId) {
      throw new ForbiddenException('This account has no company');
    }
    return this.companies.findById(user.companyId);
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Patch('me')
  updateMyCompany(
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!user.companyId) {
      throw new ForbiddenException('This account has no company');
    }
    return this.companies.update(user.companyId, dto, user.id);
  }
}
