import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  actorUserId?: string | null;
  companyId?: string | null;
  inquiryId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auditing must never break the operation it records, so failures are logged
   * rather than thrown. Pass `tx` to make the audit row part of the same
   * transaction when the write genuinely must be atomic with the change.
   */
  async record(
    input: AuditInput,
    tx?: Pick<PrismaService, 'auditEvent'>,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditEvent.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          actorUserId: input.actorUserId ?? null,
          companyId: input.companyId ?? null,
          inquiryId: input.inquiryId ?? null,
          before: (input.before ?? null) as never,
          after: (input.after ?? null) as never,
          ipAddress: input.ipAddress ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit event ${input.action} for ${input.entityType}:${input.entityId}`,
        error as Error,
      );
    }
  }
}
