import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, PaymentMethod, Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { productStockSnapshot } from "../common/stock.util";
import { NotificationsService } from "../notifications/notifications.service";
import { buildCreatedAtRange } from "../common/date-range.util";
import { ExportService, type ExportColumn } from "../export/export.service";

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

const apiBase = () =>
  (process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

type CheckoutLineInput = {
  productId: string;
  quantity: string;
  reservationId?: string;
};

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly exportService: ExportService,
  ) {}

  private mapSale(
    sale: Prisma.SaleGetPayload<{
      include: {
        lines: { include: { product: { include: { category: true } } } };
        createdBy: { select: { id: true; displayName: true; email: true } };
        attachments: true;
      };
    }>,
  ) {
    const { lines, attachments, grandTotal, subtotal, ...rest } = sale;
    return {
      ...rest,
      grandTotal: grandTotal.toFixed(2),
      subtotal: subtotal.toFixed(2),
      lines: lines.map((l) => ({
        id: l.id,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        product: {
          id: l.product.id,
          name: l.product.name,
          category: {
            id: l.product.category.id,
            name: l.product.category.name,
          },
        },
      })),
      attachments: attachments.map((a) => ({
        id: a.id,
        imagePath: a.imagePath,
        imageUrl: `${apiBase()}${a.imagePath}`,
        createdAt: a.createdAt,
      })),
    };
  }

  private buildSalesWhere(params: {
    from?: string;
    to?: string;
    productId?: string;
    categoryId?: string;
  }): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {};
    const createdAt = buildCreatedAtRange(params.from, params.to);
    if (createdAt) {
      where.createdAt = createdAt;
    }
    if (params.productId && params.categoryId) {
      where.lines = {
        some: { productId: params.productId, product: { categoryId: params.categoryId } },
      };
    } else if (params.productId) {
      where.lines = { some: { productId: params.productId } };
    } else if (params.categoryId) {
      where.lines = { some: { product: { categoryId: params.categoryId } } };
    }
    return where;
  }

  async listSales(params: {
    skip?: number;
    take?: number;
    from?: string;
    to?: string;
    productId?: string;
    categoryId?: string;
  }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where = this.buildSalesWhere(params);
    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          lines: { include: { product: { include: { category: true } } } },
          createdBy: { select: { id: true, displayName: true, email: true } },
          attachments: true,
        },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return {
      items: items.map((s) => this.mapSale(s)),
      total,
      skip,
      take,
    };
  }

  async getSale(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        lines: { include: { product: { include: { category: true } } } },
        createdBy: { select: { id: true, displayName: true, email: true } },
        attachments: true,
        payments: true,
      },
    });
    if (!sale) {
      throw new NotFoundException("Sale not found");
    }
    return this.mapSale(sale);
  }

  async exportSales(
    format: "csv" | "xlsx" | "pdf",
    params: { from?: string; to?: string; productId?: string; categoryId?: string },
  ) {
    const { items } = await this.listSales({ ...params, skip: 0, take: 5000 });
    const columns: ExportColumn[] = [
      { header: "Date", key: "date" },
      { header: "Product", key: "product" },
      { header: "Category", key: "category" },
      { header: "Quantity", key: "quantity" },
      { header: "Unit price", key: "unitPrice" },
      { header: "Line total", key: "lineTotal" },
      { header: "Sale #", key: "saleNumber" },
      { header: "Cashier", key: "cashier" },
    ];
    const rows: Record<string, string>[] = [];
    for (const s of items) {
      const date = s.createdAt.toISOString().slice(0, 16).replace("T", " ");
      const cashier = s.createdBy.displayName ?? s.createdBy.email;
      for (const l of s.lines) {
        rows.push({
          date,
          product: l.product.name,
          category: l.product.category.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          saleNumber: s.saleNumber,
          cashier,
        });
      }
    }
    return this.exportService.build(format, `sales-${Date.now()}`, columns, rows);
  }

  async checkout(
    userId: string,
    input: { lines: CheckoutLineInput[]; notes?: string; proofImagePaths?: string[] },
  ) {
    if (!input.lines?.length) {
      throw new BadRequestException("Add at least one product");
    }

    const defaultLoc = await this.locations.getDefault();
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const computedLines: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      reservationId?: string;
    }> = [];

    for (const line of input.lines) {
      const product = productById.get(line.productId);
      if (!product) {
        throw new NotFoundException(`Product not found`);
      }
      const qty = toDecimal(line.quantity);
      if (qty.lte(0)) {
        throw new BadRequestException("Quantity must be positive");
      }

      if (line.reservationId) {
        const reservation = await this.prisma.reservation.findUnique({
          where: { id: line.reservationId },
        });
        if (!reservation || reservation.status !== ReservationStatus.RESERVED) {
          throw new BadRequestException("Reservation is not active");
        }
        if (reservation.productId !== line.productId) {
          throw new BadRequestException("Reservation does not match product");
        }
        if (!reservation.quantity.eq(qty)) {
          throw new BadRequestException("Quantity must match reservation");
        }
        const { onHand } = await productStockSnapshot(
          this.prisma,
          line.productId,
          defaultLoc.id,
        );
        if (onHand.lt(qty)) {
          throw new BadRequestException(`Not enough stock on hand for ${product.name}`);
        }
      } else {
        const { available } = await productStockSnapshot(
          this.prisma,
          line.productId,
          defaultLoc.id,
        );
        if (available.lt(qty)) {
          throw new BadRequestException(`Not enough available stock for ${product.name}`);
        }
      }

      const lineTotal = product.sellingPrice.mul(qty);
      computedLines.push({
        productId: product.id,
        quantity: qty,
        unitPrice: product.sellingPrice,
        lineTotal,
        reservationId: line.reservationId,
      });
    }

    const grandTotal = computedLines.reduce(
      (acc, l) => acc.add(l.lineTotal),
      new Prisma.Decimal(0),
    );

    const proofPaths = (input.proofImagePaths ?? []).filter((p) => p.startsWith("/uploads/"));

    const receipt = await this.prisma.$transaction(
      async (tx) => {
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        const count = await tx.sale.count({
          where: { createdAt: { gte: start } },
        });
        const y = start.getUTCFullYear();
        const m = String(start.getUTCMonth() + 1).padStart(2, "0");
        const d = String(start.getUTCDate()).padStart(2, "0");
        const seq = String(count + 1).padStart(4, "0");
        const saleNumber = `SALE-${y}${m}${d}-${seq}`;

        const sale = await tx.sale.create({
          data: {
            saleNumber,
            subtotal: grandTotal,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal,
            createdByUserId: userId,
            lines: {
              create: computedLines.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                lineDiscount: 0,
                taxAmount: 0,
                lineTotal: l.lineTotal,
              })),
            },
            payments: {
              create: [{ method: PaymentMethod.CASH, amount: grandTotal }],
            },
            attachments: proofPaths.length
              ? { create: proofPaths.map((imagePath) => ({ imagePath })) }
              : undefined,
          },
          include: {
            lines: { include: { product: true } },
            attachments: true,
          },
        });

        for (const line of computedLines) {
          const inv = await tx.inventoryItem.findUniqueOrThrow({
            where: {
              productId_locationId: {
                productId: line.productId,
                locationId: defaultLoc.id,
              },
            },
          });
          const beforeOnHand = inv.quantityOnHand;
          const afterOnHand = beforeOnHand.sub(line.quantity);
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: MovementType.SALE,
              qtyDelta: line.quantity.mul(new Prisma.Decimal(-1)),
              beforeOnHand,
              afterOnHand,
              refType: "SALE",
              refId: sale.id,
              createdByUserId: userId,
              notes: input.notes,
            },
          });
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data: { quantityOnHand: afterOnHand },
          });

          if (line.reservationId) {
            await tx.reservation.update({
              where: { id: line.reservationId },
              data: { status: ReservationStatus.COMPLETED },
            });
            await tx.stockMovement.create({
              data: {
                inventoryItemId: inv.id,
                type: MovementType.RELEASE_RESERVE,
                qtyDelta: line.quantity.mul(new Prisma.Decimal(-1)),
                refType: "RESERVATION",
                refId: line.reservationId,
                createdByUserId: userId,
                metadata: { reservationId: line.reservationId, fulfilledBySale: sale.id },
              },
            });
          }
        }

        return sale;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      },
    );

    await this.audit.log(userId, "SELL", "Sale", receipt.id, {
      saleNumber: receipt.saleNumber,
    });

    for (const line of computedLines) {
      await this.notifications.checkStockAlertsForProduct(line.productId);
    }

    const full = await this.getSale(receipt.id);

    return {
      sale: full,
      digitalReceipt: this.buildReceiptText(receipt),
    };
  }

  async todaySummary() {
    return this.salesInRange(this.dayBounds(new Date()));
  }

  async salesInRange(range: { start: Date; end: Date; label: string }) {
    const sales = await this.prisma.sale.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { lines: { include: { product: true } } },
    });
    const total = sales.reduce((a, s) => a.add(s.grandTotal), new Prisma.Decimal(0));
    const productQty = new Map<string, { name: string; qty: Prisma.Decimal; revenue: Prisma.Decimal }>();
    for (const sale of sales) {
      for (const line of sale.lines) {
        const key = line.productId;
        const prev = productQty.get(key) ?? {
          name: line.product.name,
          qty: new Prisma.Decimal(0),
          revenue: new Prisma.Decimal(0),
        };
        prev.qty = prev.qty.add(line.quantity);
        prev.revenue = prev.revenue.add(line.lineTotal);
        productQty.set(key, prev);
      }
    }
    const topProducts = [...productQty.values()]
      .sort((a, b) => (b.revenue.gt(a.revenue) ? 1 : -1))
      .slice(0, 5)
      .map((p) => ({
        name: p.name,
        quantity: p.qty.toString(),
        revenue: p.revenue.toFixed(2),
      }));

    return {
      period: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      saleCount: sales.length,
      grandTotal: total.toFixed(2),
      topProducts,
    };
  }

  salesForPeriod(period: "day" | "week" | "month" | "year", anchor?: string) {
    const base = anchor ? new Date(anchor) : new Date();
    if (Number.isNaN(base.getTime())) {
      throw new BadRequestException("Invalid date");
    }
    switch (period) {
      case "day":
        return this.salesInRange(this.dayBounds(base));
      case "week":
        return this.salesInRange(this.weekBounds(base));
      case "month":
        return this.salesInRange(this.monthBounds(base));
      case "year":
        return this.salesInRange(this.yearBounds(base));
      default:
        throw new BadRequestException("Invalid period");
    }
  }

  private dayBounds(d: Date) {
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, label: start.toISOString().slice(0, 10) };
  }

  private weekBounds(d: Date) {
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      start,
      end,
      label: `week-${start.toISOString().slice(0, 10)}`,
    };
  }

  private monthBounds(d: Date) {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return {
      start,
      end,
      label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    };
  }

  private yearBounds(d: Date) {
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear() + 1, 0, 1);
    return { start, end, label: String(start.getFullYear()) };
  }

  private buildReceiptText(
    sale: Prisma.SaleGetPayload<{ include: { lines: { include: { product: true } } } }>,
  ) {
    const lines = sale.lines
      .map(
        (l) =>
          `${l.product.name} x${l.quantity.toString()} @ ${l.unitPrice.toFixed(2)} = ${l.lineTotal.toFixed(2)}`,
      )
      .join("\n");
    return [
      "Edi's Collection",
      `Sale ${sale.saleNumber}`,
      "----------------",
      lines,
      "----------------",
      `Total: ${sale.grandTotal.toFixed(2)}`,
    ].join("\n");
  }
}
