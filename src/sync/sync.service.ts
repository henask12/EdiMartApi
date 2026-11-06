import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { Actor } from "../permissions/permissions.service";

export type CreateSyncConflictInput = {
  kind: string;
  clientRef?: string;
  payload: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
};

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createConflict(actor: Actor, input: CreateSyncConflictInput) {
    const kind = input.kind?.trim().toUpperCase();
    if (!kind) {
      throw new BadRequestException("kind is required");
    }
    if (!input.payload || typeof input.payload !== "object") {
      throw new BadRequestException("payload is required");
    }
    const row = await this.prisma.syncConflict.create({
      data: {
        kind,
        status: "OPEN",
        clientRef: input.clientRef?.trim() || null,
        payload: input.payload as Prisma.InputJsonValue,
        errorCode: input.errorCode?.trim() || null,
        errorMessage: input.errorMessage?.trim() || null,
        createdByUserId: actor.userId,
      },
    });
    await this.audit.log(actor.userId, "SYNC_CONFLICT_CREATE", "SyncConflict", row.id, {
      kind: row.kind,
      clientRef: row.clientRef,
      errorCode: row.errorCode,
    });
    return row;
  }

  async listConflicts(params: {
    status?: string;
    kind?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.SyncConflictWhereInput = {};
    if (params.status) {
      where.status = params.status.trim().toUpperCase();
    }
    if (params.kind) {
      where.kind = params.kind.trim().toUpperCase();
    }
    const [items, total] = await Promise.all([
      this.prisma.syncConflict.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      this.prisma.syncConflict.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async resolveConflict(
    actor: Actor,
    id: string,
    body: { note?: string; dismiss?: boolean },
  ) {
    const existing = await this.prisma.syncConflict.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Sync conflict not found");
    }
    if (existing.status !== "OPEN") {
      throw new BadRequestException("Conflict is already closed");
    }
    const status = body.dismiss ? "DISMISSED" : "RESOLVED";
    const updated = await this.prisma.syncConflict.update({
      where: { id },
      data: {
        status,
        resolvedAt: new Date(),
        resolvedByUserId: actor.userId,
        resolutionNote: body.note?.trim() || null,
      },
    });
    await this.audit.log(actor.userId, "SYNC_CONFLICT_RESOLVE", "SyncConflict", id, {
      status,
      note: body.note ?? null,
    });
    return updated;
  }
}
