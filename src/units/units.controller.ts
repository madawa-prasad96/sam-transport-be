import {
  Body,
  Controller,
  ForbiddenException,
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
import { UnitStatus, UserRole } from '../generated/prisma/enums';
import { CreateUnitDto, SetUnitStatusDto, UpdateUnitDto } from './dto/unit.dto';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Roles(UserRole.ORG_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUnitDto) {
    return this.units.create(dto, user.id);
  }

  /** The directory. Every signed-in user needs it to address an inquiry. */
  @Get()
  list(@Query('search') search?: string, @Query('status') status?: UnitStatus) {
    return this.units.list({ search, status });
  }

  /** Units the caller may address — every active unit except their own. */
  @Get('addressable')
  addressable(@CurrentUser() user: AuthUser) {
    return this.units.addressableFrom(user.unitId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.units.findById(user.unitId);
  }

  @Roles(UserRole.ORG_ADMIN, UserRole.UNIT_ADMIN)
  @Patch('me')
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateUnitDto) {
    // A unit admin cannot rename their own unit's code out from under the org.
    if (user.role === UserRole.UNIT_ADMIN) delete dto.code;
    return this.units.update(user.unitId, dto, user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.units.findById(id);
  }

  @Roles(UserRole.ORG_ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.units.update(id, dto, user.id);
  }

  @Roles(UserRole.ORG_ADMIN)
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUnitStatusDto,
  ) {
    if (id === user.unitId && dto.status === UnitStatus.INACTIVE) {
      throw new ForbiddenException(
        'You cannot deactivate the unit you belong to',
      );
    }
    return this.units.setStatus(id, dto.status, user.id);
  }
}
