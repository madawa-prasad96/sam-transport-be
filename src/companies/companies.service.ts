import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashToken } from '../common/utils/tokens';
import {
  CompanyStatus,
  InvitationStatus,
  InvitationType,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RegisterCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Super Admin path: create the company and seed its first Company Admin. */
  async register(dto: RegisterCompanyDto, actorUserId: string) {
    const email = dto.primaryContactEmail.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException(
        'That contact email already belongs to a user on the platform',
      );
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() +
        this.config.get<number>('invitationTtlHours')! * 60 * 60 * 1000,
    );

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: dto.name,
          registrationNumber: dto.registrationNumber,
          addressLine: dto.addressLine,
          country: dto.country,
          primaryContactName: dto.primaryContactName,
          primaryContactEmail: email,
          primaryContactPhone: dto.primaryContactPhone,
          timezone: dto.timezone ?? 'UTC',
          defaultWeightUom: dto.defaultWeightUom ?? 'KG',
          // Becomes ACTIVE when the seeded admin accepts their invitation.
          status: CompanyStatus.PENDING,
        },
      });

      await tx.user.create({
        data: {
          email,
          fullName: dto.primaryContactName,
          phone: dto.primaryContactPhone,
          role: UserRole.COMPANY_ADMIN,
          status: UserStatus.INVITED,
          companyId: created.id,
        },
      });

      await tx.invitation.create({
        data: {
          type: InvitationType.COMPANY,
          email,
          tokenHash: hashToken(token),
          companyId: created.id,
          role: UserRole.COMPANY_ADMIN,
          invitedByUserId: actorUserId,
          expiresAt,
        },
      });

      return created;
    });

    await this.mail.enqueueUserInvitation({
      to: email,
      inviterName: 'The platform team',
      companyName: company.name,
      token,
    });

    await this.audit.record({
      action: 'company.registered',
      entityType: 'Company',
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      after: { name: company.name, status: company.status },
    });

    return company;
  }

  async listAll(params: { search?: string; status?: CompanyStatus }) {
    return this.prisma.company.findMany({
      where: {
        ...(params.status ? { status: params.status } : {}),
        ...(params.search
          ? { name: { contains: params.search, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
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

  async findById(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async update(companyId: string, dto: UpdateCompanyDto, actorUserId: string) {
    const before = await this.findById(companyId);
    const after = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...dto,
        ...(dto.primaryContactEmail
          ? { primaryContactEmail: dto.primaryContactEmail.toLowerCase().trim() }
          : {}),
      },
    });

    await this.audit.record({
      action: 'company.updated',
      entityType: 'Company',
      entityId: companyId,
      actorUserId,
      companyId,
      before,
      after,
    });

    return after;
  }

  async setStatus(
    companyId: string,
    status: CompanyStatus,
    actorUserId: string,
  ) {
    const before = await this.findById(companyId);
    const after = await this.prisma.company.update({
      where: { id: companyId },
      data: { status },
    });

    await this.audit.record({
      action: `company.${status.toLowerCase()}`,
      entityType: 'Company',
      entityId: companyId,
      actorUserId,
      companyId,
      before: { status: before.status },
      after: { status: after.status },
    });

    return after;
  }

  /** Resends the seeded admin's invitation, replacing any outstanding one. */
  async resendAdminInvitation(companyId: string, actorUserId: string) {
    const company = await this.findById(companyId);
    const token = generateOpaqueToken();

    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: {
          companyId,
          email: company.primaryContactEmail,
          status: InvitationStatus.PENDING,
        },
        data: { status: InvitationStatus.REVOKED },
      });
      await tx.invitation.create({
        data: {
          type: InvitationType.COMPANY,
          email: company.primaryContactEmail,
          tokenHash: hashToken(token),
          companyId,
          role: UserRole.COMPANY_ADMIN,
          invitedByUserId: actorUserId,
          expiresAt: new Date(
            Date.now() +
              this.config.get<number>('invitationTtlHours')! * 60 * 60 * 1000,
          ),
        },
      });
    });

    await this.mail.enqueueUserInvitation({
      to: company.primaryContactEmail,
      inviterName: 'The platform team',
      companyName: company.name,
      token,
    });

    return { ok: true };
  }
}
