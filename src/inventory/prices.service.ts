import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { LabelJobStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

const toDecimal = (v: string | number) => new Prisma.Decimal(v);

@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Change a product's selling price. Creates a PriceChange record and a LabelReprintQueue entry.
   */
  async changePrice(
    userId: string,
    data: {
      productId: string;
      newPrice: string;
      note?: string;
    },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new NotFoundException("Product not found");

    const newPrice = toDecimal(data.newPrice);
    if (newPrice.lt(0)) throw new BadRequestException("Price cannot be negative");
    if (newPrice.eq(product.sellingPrice)) {
      throw new BadRequestException("New price is the same as current price");
    }

    const oldPrice = product.sellingPrice;

    const [updated] = await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: data.productId },
        data: { sellingPrice: newPrice },
      }),
      this.prisma.priceChange.create({
        data: {
          productId: data.productId,
          oldPrice,
          newPrice,
          createdByUserId: userId,
          note: data.note?.trim() || null,
        },
      }),
      this.prisma.labelReprintQueue.create({
        data: {
          productId: data.productId,
          reason: `Price changed from ${oldPrice.toFixed(2)} to ${newPrice.toFixed(2)}`,
          status: LabelJobStatus.PENDING,
        },
      }),
    ]);

    await this.audit.log(userId, "PRICE_CHANGE", "Product", data.productId, {
      oldPrice: oldPrice.toFixed(2),
      newPrice: newPrice.toFixed(2),
    });

    return {
      productId: data.productId,
      oldPrice: oldPrice.toFixed(2),
      newPrice: newPrice.toFixed(2),
    };
  }

  /**
   * Price change history for a product.
   */
  async priceHistory(productId: string, params?: { skip?: number; take?: number }) {
    const take = Math.min(params?.take ?? 50, 200);
    const skip = params?.skip ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.priceChange.findMany({
        where: { productId },
        orderBy: { effectiveAt: "desc" },
        skip,
        take,
        include: {
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.priceChange.count({ where: { productId } }),
    ]);
    return { items, total, skip, take };
  }
}
