import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { UnitStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Units are created outright by an org admin — there is no invite-and-accept
   * dance, because every unit belongs to SAM already.
   */
  async create(dto: CreateUnitDto, actorUserId: string) {
    const code = dto.code.toUpperCase().trim();

    const clash = await this.prisma.unit.findUnique({ where: { code } });
    if (clash) {
      throw new BadRequestException(`Unit code "${code}" is already in use`);
    }

    const unit = await this.prisma.unit.create({
      data: {
        name: dto.name,
        code,
        registrationNumber: dto.registrationNumber,
        addressLine: dto.addressLine,
        country: dto.country,
        primaryContactName: dto.primaryContactName,
        primaryContactEmail: dto.primaryContactEmail.toLowerCase().trim(),
        primaryContactPhone: dto.primaryContactPhone,
        timezone: dto.timezone ?? 'UTC',
        defaultWeightUom: dto.defaultWeightUom ?? 'KG',
      },
    });

    await this.audit.record({
      action: 'unit.created',
      entityType: 'Unit',
      entityId: unit.id,
      actorUserId,
      unitId: unit.id,
      after: { name: unit.name, code: unit.code },
    });

    return unit;
  }

  /**
   * Every user can see the unit directory — it is what populates the "send to"
   * picker, and inside one company there is nothing secret about it.
   */
  async list(params: { search?: string; status?: UnitStatus } = {}) {
    return this.prisma.unit.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' as const } },
                { code: { contains: params.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            users: true,
            requestedInquiries: true,
            providedInquiries: true,
          },
        },
      },
    });
  }

  /** Units a given unit may address: every other active unit. */
  async addressableFrom(unitId: string) {
    return this.prisma.unit.findMany({
      where: { status: UnitStatus.ACTIVE, id: { not: unitId } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  async findById(unitId: string) {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  /**
   * Guard for addressing an inquiry. Replaces the old cross-company connection
   * check: internally the only real constraints are that the target exists, is
   * active, and is not the sender itself.
   */
  async assertAddressable(fromUnitId: string, toUnitId: string) {
    if (fromUnitId === toUnitId) {
      throw new BadRequestException(
        'An inquiry cannot be addressed to your own unit',
      );
    }

    const target = await this.prisma.unit.findUnique({
      where: { id: toUnitId },
      select: { id: true, name: true, status: true },
    });

    if (!target) throw new NotFoundException('Unit not found');
    if (target.status !== UnitStatus.ACTIVE) {
      throw new BadRequestException(`${target.name} is not currently active`);
    }
    return target;
  }

  async update(unitId: string, dto: UpdateUnitDto, actorUserId: string) {
    const before = await this.findById(unitId);

    if (dto.code && dto.code.toUpperCase().trim() !== before.code) {
      const clash = await this.prisma.unit.findUnique({
        where: { code: dto.code.toUpperCase().trim() },
      });
      if (clash) {
        throw new BadRequestException('That unit code is already in use');
      }
    }

    const after = await this.prisma.unit.update({
      where: { id: unitId },
      data: {
        ...dto,
        ...(dto.code ? { code: dto.code.toUpperCase().trim() } : {}),
        ...(dto.primaryContactEmail
          ? { primaryContactEmail: dto.primaryContactEmail.toLowerCase().trim() }
          : {}),
      },
    });

    await this.audit.record({
      action: 'unit.updated',
      entityType: 'Unit',
      entityId: unitId,
      actorUserId,
      unitId,
      before,
      after,
    });

    return after;
  }

  async setStatus(unitId: string, status: UnitStatus, actorUserId: string) {
    const before = await this.findById(unitId);

    if (status === UnitStatus.INACTIVE) {
      // Deactivating a unit with live inquiries would strand them mid-flight.
      const open = await this.prisma.inquiry.count({
        where: {
          status: { in: ['SUBMITTED', 'VEHICLE_PROVIDED'] },
          OR: [{ requesterUnitId: unitId }, { providerUnitId: unitId }],
        },
      });
      if (open > 0) {
        throw new BadRequestException(
          `${before.name} still has ${open} inquiry(ies) in progress. Close or cancel them before deactivating.`,
        );
      }
    }

    const after = await this.prisma.unit.update({
      where: { id: unitId },
      data: { status },
    });

    await this.audit.record({
      action: `unit.${status.toLowerCase()}`,
      entityType: 'Unit',
      entityId: unitId,
      actorUserId,
      unitId,
      before: { status: before.status },
      after: { status: after.status },
    });

    return after;
  }
}
