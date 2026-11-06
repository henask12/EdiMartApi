import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    userId: string | undefined,
    action: string,
    entity: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        metadata: metadata as object | undefined,
      },
    });
  }

  async list(params: {
    action?: string;
    entity?: string;
    userId?: string;
    from?: string;
    to?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.AuditLogWhereInput = {};
    if (params.action?.trim()) {
      where.action = { contains: params.action.trim(), mode: "insensitive" };
    }
    if (params.entity?.trim()) {
      where.entity = { contains: params.entity.trim(), mode: "insensitive" };
    }
    if (params.userId?.trim()) {
      where.userId = params.userId.trim();
    }
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) {
        where.createdAt.gte = new Date(params.from);
      }
      if (params.to) {
        where.createdAt.lte = new Date(params.to);
      }
    }
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, skip, take };
  }
}

