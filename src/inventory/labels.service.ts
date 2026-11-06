import { Injectable, NotFoundException } from "@nestjs/common";
import { LabelJobStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List pending label reprint jobs.
   */
  async listPending(params?: { skip?: number; take?: number }) {
    const take = Math.min(params?.take ?? 100, 500);
    const skip = params?.skip ?? 0;
    const where: Prisma.LabelReprintQueueWhereInput = {
      status: LabelJobStatus.PENDING,
    };
    const [items, total] = await Promise.all([
      this.prisma.labelReprintQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          product: { select: { id: true, name: true, sku: true, sellingPrice: true } },
        },
      }),
      this.prisma.labelReprintQueue.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  /**
   * Mark label jobs as printed.
   */
  async markPrinted(ids: string[]) {
    if (!ids.length) return { updated: 0 };
    const result = await this.prisma.labelReprintQueue.updateMany({
      where: { id: { in: ids }, status: LabelJobStatus.PENDING },
      data: { status: LabelJobStatus.PRINTED, printedAt: new Date() },
    });
    return { updated: result.count };
  }
}
