import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { productMultiLocationAvailable } from "../common/stock.util";
import {
  addDays,
  businessDateString,
  businessDayStart,
} from "../common/business-time";
import { money2, qty4, toDecimal } from "./document-numbers";
import { PurchaseOrdersService } from "./purchase-orders.service";
import type { Viewer } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";

@Injectable()
export class ReorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly purchaseOrders: PurchaseOrdersService,
  ) {}

  /**
   * Per product (with preferred/any supplier link): available, incoming, avg daily sales (~30d),
   * days of cover, suggested qty to maxStock or restockQty, leadTimeDays.
   * Seasonality uplift is off (owner default).
   */
  async suggestions(includeCost: boolean) {
    const sellableIds = await this.locations.listSellableLocationIds();
    const links = await this.prisma.supplierProduct.findMany({
      include: {
        product: true,
        supplier: true,
      },
      orderBy: [{ isPreferred: "desc" }, { updatedAt: "desc" }],
    });

    // Prefer preferred supplier per product; else first link
    const byProduct = new Map<string, (typeof links)[number]>();
    for (const link of links) {
      const existing = byProduct.get(link.productId);
      if (!existing || (link.isPreferred && !existing.isPreferred)) {
        byProduct.set(link.productId, link);
      }
    }

    const productIds = [...byProduct.keys()];
    const incomingMap = await this.purchaseOrders.incomingMap(productIds);
    const salesByProduct = await this.avgDailySales(productIds, 30);

    const items = [];
    for (const [productId, link] of byProduct) {
      const { available } = await productMultiLocationAvailable(
        this.prisma,
        productId,
        sellableIds,
      );
      const incoming = incomingMap.get(productId) ?? new Prisma.Decimal(0);
      const avgDaily = salesByProduct.get(productId) ?? new Prisma.Decimal(0);
      const coverBase = available.add(incoming);
      const daysOfCover =
        avgDaily.gt(0) ? coverBase.div(avgDaily).toDecimalPlaces(1).toNumber() : null;

      const target =
        link.product.maxStock > 0
          ? new Prisma.Decimal(link.product.maxStock)
          : link.product.restockQty > 0
            ? new Prisma.Decimal(link.product.restockQty)
            : new Prisma.Decimal(0);
      let suggested = target.gt(0) ? Prisma.Decimal.max(0, target.sub(coverBase)) : new Prisma.Decimal(0);
      // Round up to whole sell units (packSize always 1)
      if (suggested.gt(0)) {
        suggested = suggested.toDecimalPlaces(0, Prisma.Decimal.ROUND_UP);
      }

      const leadTimeDays =
        link.product.leadTimeDays > 0 ? link.product.leadTimeDays : link.supplier.leadTimeDays;

      items.push({
        productId,
        product: {
          id: link.product.id,
          name: link.product.name,
          sku: link.product.sku,
          minStock: link.product.minStock,
          maxStock: link.product.maxStock,
          restockQty: link.product.restockQty,
        },
        supplierId: link.supplierId,
        supplierName: link.supplier.name,
        isPreferred: link.isPreferred,
        available: qty4(available),
        incoming: qty4(incoming),
        avgDailySales: qty4(avgDaily),
        daysOfCover,
        suggestedQty: qty4(suggested),
        leadTimeDays,
        ...(includeCost ? { lastCost: money2(link.lastCost) } : {}),
      });
    }

    return {
      items: items.sort((a, b) => Number(b.suggestedQty) - Number(a.suggestedQty)),
      seasonalityUplift: false,
    };
  }

  async createDraftPos(
    actor: Actor,
    data: {
      supplierId: string;
      lines: Array<{ productId: string; quantity: string; unitCost?: string }>;
    },
    viewer: Viewer,
  ) {
    if (!data.lines?.length) throw new BadRequestException("At least one line is required");
    const supplier = await this.prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier || !supplier.isActive) throw new NotFoundException("Supplier not found");

    const lines = [];
    for (const line of data.lines) {
      const qty = toDecimal(line.quantity);
      if (qty.lte(0)) throw new BadRequestException("Quantity must be positive");
      let unitCost = line.unitCost ? toDecimal(line.unitCost) : null;
      if (unitCost === null) {
        const link = await this.prisma.supplierProduct.findUnique({
          where: {
            supplierId_productId: { supplierId: data.supplierId, productId: line.productId },
          },
        });
        if (link && link.lastCost.gt(0)) unitCost = link.lastCost;
        else {
          const product = await this.prisma.product.findUnique({ where: { id: line.productId } });
          if (!product) throw new BadRequestException(`Unknown product ${line.productId}`);
          unitCost = product.costPrice;
        }
      }
      lines.push({
        productId: line.productId,
        quantity: qty.toString(),
        unitCost: unitCost.toString(),
      });
    }

    // Grouped by supplier — this endpoint already takes one supplierId; create one draft PO.
    return this.purchaseOrders.create(
      actor,
      { supplierId: data.supplierId, notes: "Created from reorder suggestions", lines },
      viewer,
    );
  }

  /**
   * Average daily sales over ~windowDays. Prefer excluding zero-stock days when
   * InventorySnapshot rows exist; otherwise divide by the full window.
   */
  private async avgDailySales(productIds: string[], windowDays: number) {
    const result = new Map<string, Prisma.Decimal>();
    if (!productIds.length) return result;

    const end = businessDateString();
    const start = addDays(end, -(windowDays - 1));
    const startAt = businessDayStart(start);

    const lines = await this.prisma.saleLine.findMany({
      where: {
        productId: { in: productIds },
        sale: { status: { not: "VOIDED" }, createdAt: { gte: startAt } },
      },
      select: { productId: true, quantity: true, sale: { select: { createdAt: true } } },
    });

    const sold = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      sold.set(l.productId, (sold.get(l.productId) ?? new Prisma.Decimal(0)).add(l.quantity));
    }

    const snapshots = await this.prisma.inventorySnapshot.findMany({
      where: { productId: { in: productIds }, date: { gte: start, lte: end } },
      select: { productId: true, date: true, quantity: true },
    });

    const stockByProductDay = new Map<string, Map<string, Prisma.Decimal>>();
    for (const s of snapshots) {
      let days = stockByProductDay.get(s.productId);
      if (!days) {
        days = new Map();
        stockByProductDay.set(s.productId, days);
      }
      days.set(s.date, (days.get(s.date) ?? new Prisma.Decimal(0)).add(s.quantity));
    }

    for (const productId of productIds) {
      const total = sold.get(productId) ?? new Prisma.Decimal(0);
      const daysMap = stockByProductDay.get(productId);
      let divisor = windowDays;
      if (daysMap && daysMap.size > 0) {
        let nonZero = 0;
        for (let i = 0; i < windowDays; i++) {
          const d = addDays(start, i);
          const qty = daysMap.get(d) ?? new Prisma.Decimal(0);
          if (qty.gt(0)) nonZero += 1;
        }
        // If we have snapshot coverage, skip zero-stock days; fall back to window if all zero.
        divisor = nonZero > 0 ? nonZero : windowDays;
      }
      result.set(productId, total.div(divisor));
    }
    return result;
  }
}
