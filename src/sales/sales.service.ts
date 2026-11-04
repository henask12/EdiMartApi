import { createHash } from "crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, PaymentMethod, Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { StorageService } from "../storage/storage.service";
import { buildCreatedAtRange } from "../common/date-range.util";
import {
  addDays,
  businessDateString,
  businessDayStart,
  businessMonthStart,
  businessWeekStart,
  businessYearStart,
  nextMonthStart,
  nextYearStart,
} from "../common/business-time";
import {
  allocateFromBatches,
  lockInventoryRows,
  productStockSnapshot,
} from "../common/stock.util";
import { ExportService, type ExportColumn } from "../export/export.service";
import type { Viewer } from "../permissions/access";

const toDecimal = (value: string | number) => {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException("Invalid quantity");
  }
};

type SaleLineForProfit = {
  quantity: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  unitCostAtSale: Prisma.Decimal;
  product: { costPrice: Prisma.Decimal };
};

const lineNetProfit = (line: SaleLineForProfit) => {
  const unitCost = line.unitCostAtSale.gt(0) ? line.unitCostAtSale : line.product.costPrice;
  return line.lineTotal.sub(unitCost.mul(line.quantity));
};

export type CheckoutLineInput = {
  productId: string;
  quantity: string;
  reservationId?: string;
};

export type CheckoutInput = {
  lines: CheckoutLineInput[];
  notes?: string;
  proofImagePaths?: string[];
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
};

const MAX_CHECKOUT_ATTEMPTS = 3;
const CHECKOUT_SCOPE = "checkout";

/** Serialization failures and deadlocks are safe to retry from the top. */
const isRetryable = (err: unknown) => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (err.code === "P2034") {
    return true;
  }
  if (err.code === "P2010" && /40001|40P01|could not serialize|deadlock/i.test(err.message)) {
    return true;
  }
  // Two requests with the same Idempotency-Key raced; the retry will find the stored result.
  if (err.code === "P2002") {
    const target = JSON.stringify(err.meta?.target ?? "");
    return /scope|key/i.test(target);
  }
  return false;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly notifications: NotificationsService,
    private readonly exportService: ExportService,
    private readonly storage: StorageService,
  ) {}

  private async mapSale(
    sale: Prisma.SaleGetPayload<{
      include: {
        lines: { include: { product: { include: { category: true } } } };
        createdBy: { select: { id: true; displayName: true; email: true } };
        attachments: true;
        payments: true;
      };
    }>,
    includeCost: boolean,
  ) {
    const { lines, attachments, payments, grandTotal, subtotal, ...rest } = sale;
    return {
      ...rest,
      grandTotal: grandTotal.toFixed(2),
      subtotal: subtotal.toFixed(2),
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount.toFixed(2),
        reference: p.reference,
      })),
      lines: lines.map((l) => {
        const unitCost = (l.unitCostAtSale.gt(0) ? l.unitCostAtSale : l.product.costPrice).toFixed(2);
        const qty = l.quantity;
        const netProfit = lineNetProfit(l).toFixed(2);
        return {
          id: l.id,
          quantity: qty.toString(),
          unitPrice: l.unitPrice.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          // what an item cost and what the sale earned are only for people allowed to see them
          ...(includeCost ? { unitCostAtSale: unitCost, netProfit } : {}),
          product: {
            id: l.product.id,
            name: l.product.name,
            category: {
              id: l.product.category.id,
              name: l.product.category.name,
            },
          },
        };
      }),
      attachments: await Promise.all(
        attachments.map(async (a) => ({
          id: a.id,
          imagePath: a.imagePath,
          imageUrl: await this.storage.privateUrl(a.imagePath),
          createdAt: a.createdAt,
        })),
      ),
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
  }, viewer: Viewer) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where = this.buildSalesWhere(params);
    if (!viewer.viewAllSales) {
      // without "view all sales" a person only ever sees the sales they recorded themselves
      where.createdByUserId = viewer.userId;
    }
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
          payments: true,
        },
      }),
      this.prisma.sale.count({ where }),
    ]);
    return {
      items: await Promise.all(items.map((s) => this.mapSale(s, viewer.includeCost))),
      total,
      skip,
      take,
    };
  }

  async getSale(id: string, viewer: Viewer) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        lines: { include: { product: { include: { category: true } } } },
        createdBy: { select: { id: true, displayName: true, email: true } },
        attachments: true,
        payments: true,
      },
    });
    if (!sale || (!viewer.viewAllSales && sale.createdByUserId !== viewer.userId)) {
      // someone else's sale looks exactly like a sale that does not exist
      throw new NotFoundException("Sale not found");
    }
    return this.mapSale(sale, viewer.includeCost);
  }

  async exportSales(
    format: "csv" | "xlsx" | "pdf",
    params: { from?: string; to?: string; productId?: string; categoryId?: string },
    viewer: Viewer,
  ) {
    const { items } = await this.listSales({ ...params, skip: 0, take: 5000 }, viewer);
    const columns: ExportColumn[] = [
      { header: "Sales date", key: "date" },
      { header: "Item", key: "product" },
      { header: "Category", key: "category" },
      { header: "Cashier", key: "cashier" },
      { header: "Payment", key: "payment" },
      { header: "Unit price", key: "unitPrice" },
      { header: "Quantity", key: "quantity" },
      { header: "Total price", key: "lineTotal" },
      ...(viewer.includeCost ? [{ header: "Net profit", key: "netProfit" }] : []),
      { header: "Sale #", key: "saleNumber" },
    ];
    const rows: Record<string, string>[] = [];
    for (const s of items) {
      const date = s.createdAt.toISOString().slice(0, 16).replace("T", " ");
      const cashier = s.createdBy.displayName ?? s.createdBy.email;
      const payment = s.payments.map((p) => p.method).join("+");
      for (const l of s.lines) {
        rows.push({
          date,
          product: l.product.name,
          category: l.product.category.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          ...(viewer.includeCost && "netProfit" in l ? { netProfit: l.netProfit } : {}),
          saleNumber: s.saleNumber,
          cashier,
          payment,
        });
      }
    }
    return this.exportService.build(format, `sales-${Date.now()}`, columns, rows);
  }

  /**
   * Record a sale.
   *
   * The stock check and the deduction happen inside one transaction that first locks the
   * affected inventory rows, so two cashiers can never both sell the last unit. Serialization
   * failures are retried up to three times. `idempotencyKey` makes the call safe to repeat: the
   * same key with the same request returns the original sale instead of selling twice.
   */
  async checkout(userId: string, input: CheckoutInput, idempotencyKey: string, viewer: Viewer) {
    if (!input.lines?.length) {
      throw new BadRequestException("Add at least one product");
    }
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key is required");
    }
    const requestHash = this.hashRequest(input);
    const defaultLoc = await this.locations.getDefault();
    await this.ensureSaleCounter(businessDateString());

    let outcome: { saleId: string; replayed: boolean } | undefined;
    for (let attempt = 1; attempt <= MAX_CHECKOUT_ATTEMPTS; attempt += 1) {
      try {
        outcome = await this.prisma.$transaction(
          (tx) =>
            this.checkoutInTransaction(tx, userId, input, idempotencyKey, requestHash, defaultLoc.id),
          {
            // Correctness comes from the explicit row locks taken in checkoutInTransaction, which
            // queue concurrent sales instead of failing them. (Serializable isolation would abort
            // most of a burst and rely on retries.)
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 10_000,
            timeout: 20_000,
          },
        );
        break;
      } catch (err) {
        if (!isRetryable(err)) {
          throw err;
        }
        if (attempt === MAX_CHECKOUT_ATTEMPTS) {
          this.logger.warn(`Checkout gave up after ${attempt} attempts: ${String(err)}`);
          throw new ConflictException("The shop is busy right now, please try again");
        }
        await sleep(30 * attempt + Math.floor(Math.random() * 40));
      }
    }
    if (!outcome) {
      throw new ConflictException("The shop is busy right now, please try again");
    }

    // the sale just recorded is the caller's own, so it can always be shown to them
    const sale = await this.getSale(outcome.saleId, { ...viewer, viewAllSales: true });
    if (!outcome.replayed) {
      // The sale is already committed; an alert failure must never turn it into an error.
      const productIds = [...new Set(input.lines.map((l) => l.productId))];
      for (const productId of productIds) {
        try {
          await this.notifications.checkStockAlertsForProduct(productId);
        } catch (err) {
          this.logger.error(`Stock alert failed for ${productId}: ${String(err)}`);
        }
      }
    }
    return {
      sale,
      digitalReceipt: this.buildReceiptText(sale),
      replayed: outcome.replayed,
    };
  }

  private hashRequest(input: CheckoutInput) {
    const normalized = {
      lines: [...input.lines]
        .map((l) => ({
          productId: l.productId,
          quantity: toDecimal(l.quantity).toString(),
          reservationId: l.reservationId ?? null,
        }))
        .sort((a, b) =>
          `${a.productId}:${a.reservationId}`.localeCompare(`${b.productId}:${b.reservationId}`),
        ),
      method: input.paymentMethod ?? PaymentMethod.CASH,
      reference: input.paymentReference ?? null,
      proofs: [...(input.proofImagePaths ?? [])].sort(),
      notes: input.notes ?? null,
    };
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  }

  private async checkoutInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CheckoutInput,
    idempotencyKey: string,
    requestHash: string,
    locationId: string,
  ): Promise<{ saleId: string; replayed: boolean }> {
    const productIds = [...new Set(input.lines.map((l) => l.productId))];

    // Lock first, then read: from here until commit nobody else can change these stock rows.
    // A duplicate request with the same key queues here and then finds the first one's result.
    await lockInventoryRows(tx, productIds, locationId);

    const existingKey = await tx.idempotencyKey.findUnique({
      where: { scope_key: { scope: CHECKOUT_SCOPE, key: idempotencyKey } },
    });
    if (existingKey) {
      if (existingKey.requestHash !== requestHash || !existingKey.saleId) {
        throw new ConflictException("This Idempotency-Key was already used for a different sale");
      }
      return { saleId: existingKey.saleId, replayed: true };
    }

    const products = await tx.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) {
      if (!productById.has(id)) {
        throw new NotFoundException("Product not found");
      }
    }

    // Reservation-backed lines are fulfilled first; the remaining lines are merged per product
    // so that two lines for the same product cannot each pass the check on their own.
    type Demand = { productId: string; quantity: Prisma.Decimal; reservationId?: string };
    const reservationDemands: Demand[] = [];
    const freeDemand = new Map<string, Prisma.Decimal>();
    for (const line of input.lines) {
      const qty = toDecimal(line.quantity);
      if (qty.lte(0)) {
        throw new BadRequestException("Quantity must be positive");
      }
      if (line.reservationId) {
        reservationDemands.push({ productId: line.productId, quantity: qty, reservationId: line.reservationId });
      } else {
        freeDemand.set(line.productId, (freeDemand.get(line.productId) ?? new Prisma.Decimal(0)).add(qty));
      }
    }
    const demands: Demand[] = [
      ...reservationDemands,
      ...[...freeDemand.entries()].map(([productId, quantity]) => ({ productId, quantity })),
    ];

    const computed: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      unitCostAtSale: Prisma.Decimal;
      reservationId?: string;
    }> = [];
    const movementPlans: Array<{
      inventoryItemId: string;
      productId: string;
      quantity: Prisma.Decimal;
      reservationId?: string;
      reservationCustomer?: string | null;
    }> = [];

    for (const demand of demands) {
      const product = productById.get(demand.productId)!;
      const inv = await tx.inventoryItem.findUnique({
        where: { productId_locationId: { productId: demand.productId, locationId } },
      });
      if (!inv) {
        throw new NotFoundException(`No inventory for ${product.name}`);
      }

      let reservationCustomer: string | null | undefined;
      if (demand.reservationId) {
        const reservation = await tx.reservation.findUnique({ where: { id: demand.reservationId } });
        if (!reservation || reservation.status !== ReservationStatus.RESERVED) {
          throw new BadRequestException("Reservation is not active");
        }
        if (reservation.productId !== demand.productId) {
          throw new BadRequestException("Reservation does not match product");
        }
        if (!reservation.quantity.eq(demand.quantity)) {
          throw new BadRequestException("Quantity must match reservation");
        }
        if (inv.quantityOnHand.lt(demand.quantity)) {
          throw new ConflictException(`Not enough stock on hand for ${product.name}`);
        }
        reservationCustomer = reservation.customerName;
      } else {
        const { available } = await productStockSnapshot(tx, demand.productId, locationId);
        if (available.lt(demand.quantity)) {
          throw new ConflictException(
            `Not enough available stock for ${product.name} (available ${available.toString()}, requested ${demand.quantity.toString()})`,
          );
        }
      }

      computed.push({
        productId: product.id,
        quantity: demand.quantity,
        unitPrice: product.sellingPrice,
        lineTotal: product.sellingPrice.mul(demand.quantity),
        unitCostAtSale: inv.averageCost,
        reservationId: demand.reservationId,
      });
      movementPlans.push({
        inventoryItemId: inv.id,
        productId: demand.productId,
        quantity: demand.quantity,
        reservationId: demand.reservationId,
        reservationCustomer,
      });
    }

    const grandTotal = computed.reduce((acc, l) => acc.add(l.lineTotal), new Prisma.Decimal(0));
    const proofPaths = (input.proofImagePaths ?? []).filter(
      (p) => p.startsWith("/uploads/") && !p.includes(".."),
    );

    // Taken last so the hot counter row is held for as short a time as possible.
    const saleNumber = await this.nextSaleNumber(tx, businessDateString());

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        subtotal: grandTotal,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal,
        createdByUserId: userId,
        lines: {
          create: computed.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCostAtSale: l.unitCostAtSale,
            lineDiscount: 0,
            taxAmount: 0,
            lineTotal: l.lineTotal,
          })),
        },
        payments: {
          create: [
            {
              method: input.paymentMethod ?? PaymentMethod.CASH,
              amount: grandTotal,
              reference: input.paymentReference?.trim() || null,
            },
          ],
        },
        attachments: proofPaths.length
          ? { create: proofPaths.map((imagePath) => ({ imagePath })) }
          : undefined,
      },
    });

    // Map sale line id by productId+index for SaleLineBatch creation
    const saleLines = await tx.saleLine.findMany({ where: { saleId: sale.id } });
    const saleLineByProduct = new Map<string, string>();
    for (const sl of saleLines) {
      saleLineByProduct.set(sl.productId, sl.id);
    }

    for (const plan of movementPlans) {
      // Re-read under the lock so before/after reflect earlier lines of this same sale.
      const inv = await tx.inventoryItem.findUniqueOrThrow({ where: { id: plan.inventoryItemId } });
      const deducted = await tx.inventoryItem.updateMany({
        where: { id: inv.id, quantityOnHand: { gte: plan.quantity } },
        data: { quantityOnHand: { decrement: plan.quantity } },
      });
      if (deducted.count !== 1) {
        throw new ConflictException("Not enough stock on hand");
      }

      // Check for expired batches when product tracks batches
      const product = productById.get(plan.productId);
      const allowExpired = !!(input as Record<string, unknown>).allowExpiredSale;
      const skipExpired = product?.trackBatches && !allowExpired;

      let running = inv.quantityOnHand;
      const allocations = await allocateFromBatches(
        tx,
        plan.productId,
        plan.quantity,
        { locationId, allowExpired: !skipExpired },
      );
      for (const allocation of allocations) {
        const after = running.sub(allocation.quantity);
        await tx.stockMovement.create({
          data: {
            inventoryItemId: inv.id,
            stockBatchId: allocation.batchId,
            type: MovementType.SALE,
            qtyDelta: allocation.quantity.neg(),
            beforeOnHand: running,
            afterOnHand: after,
            refType: "SALE",
            refId: sale.id,
            createdByUserId: userId,
            notes: input.notes,
          },
        });
        running = after;

        // Write SaleLineBatch for FEFO traceability
        const saleLineId = saleLineByProduct.get(plan.productId);
        if (saleLineId) {
          await tx.saleLineBatch.create({
            data: {
              saleLineId,
              stockBatchId: allocation.batchId,
              quantity: allocation.quantity,
            },
          });
        }
      }

      if (plan.reservationId) {
        const { available: availBefore } = await productStockSnapshot(tx, plan.productId, locationId);
        await tx.reservation.update({
          where: { id: plan.reservationId },
          data: { status: ReservationStatus.COMPLETED },
        });
        await tx.stockMovement.create({
          data: {
            inventoryItemId: inv.id,
            type: MovementType.RELEASE_RESERVE,
            qtyDelta: plan.quantity.neg(),
            beforeOnHand: running,
            afterOnHand: running,
            refType: "RESERVATION",
            refId: plan.reservationId,
            createdByUserId: userId,
            metadata: {
              reservationId: plan.reservationId,
              fulfilledBySale: sale.id,
              reservedQty: plan.quantity.neg().toString(),
              availableBefore: availBefore.toString(),
              availableAfter: availBefore.toString(),
              customerName: plan.reservationCustomer ?? null,
            },
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId,
        action: "SELL",
        entity: "Sale",
        entityId: sale.id,
        metadata: {
          saleNumber,
          grandTotal: grandTotal.toFixed(2),
          paymentMethod: input.paymentMethod ?? PaymentMethod.CASH,
        },
      },
    });
    await tx.idempotencyKey.create({
      data: { scope: CHECKOUT_SCOPE, key: idempotencyKey, requestHash, userId, saleId: sale.id },
    });

    return { saleId: sale.id, replayed: false };
  }

  /**
   * Make sure today's counter row exists. A new day starts after any number already issued by
   * the older count-based scheme (so the switch-over day cannot collide with itself). Runs
   * outside the checkout transaction so the full-table look at Sale never takes part in it.
   */
  private async ensureSaleCounter(date: string) {
    const compact = date.replace(/-/g, "");
    const pattern = `^SALE-${compact}-[0-9]+$`;
    await this.prisma.$executeRaw`
      INSERT INTO "DocumentCounter" ("scope", "date", "value")
      VALUES (
        'SALE', ${date},
        COALESCE(
          (SELECT MAX(CAST(SPLIT_PART("saleNumber", '-', 3) AS INTEGER))
             FROM "Sale" WHERE "saleNumber" ~ ${pattern}),
          0
        )
      )
      ON CONFLICT ("scope", "date") DO NOTHING`;
  }

  /** Next `SALE-YYYYMMDD-NNNN` for the business day: one atomic increment of the counter row. */
  private async nextSaleNumber(tx: Prisma.TransactionClient, date: string) {
    let rows = await tx.$queryRaw<{ value: number }[]>`
      UPDATE "DocumentCounter" SET "value" = "value" + 1
       WHERE "scope" = 'SALE' AND "date" = ${date}
   RETURNING "value"`;
    if (rows.length === 0) {
      // The business day rolled over between ensureSaleCounter and now.
      rows = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO "DocumentCounter" ("scope", "date", "value") VALUES ('SALE', ${date}, 1)
        ON CONFLICT ("scope", "date") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
        RETURNING "value"`;
    }
    return `SALE-${date.replace(/-/g, "")}-${String(rows[0].value).padStart(4, "0")}`;
  }

  async todaySummary(includeCost = false) {
    return this.salesInRange(this.dayBounds(new Date()), includeCost);
  }

  async salesInRange(range: { start: Date; end: Date; label: string }, includeCost = false) {
    const sales = await this.prisma.sale.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      include: { lines: { include: { product: true } } },
    });
    const total = sales.reduce((a, s) => a.add(s.grandTotal), new Prisma.Decimal(0));
    let netProfitTotal = new Prisma.Decimal(0);
    const productQty = new Map<string, { name: string; qty: Prisma.Decimal; revenue: Prisma.Decimal }>();
    for (const sale of sales) {
      for (const line of sale.lines) {
        netProfitTotal = netProfitTotal.add(lineNetProfit(line));
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
      ...(includeCost ? { netProfit: netProfitTotal.toFixed(2) } : {}),
      topProducts,
    };
  }

  salesForPeriod(period: "day" | "week" | "month" | "year", anchor?: string, includeCost = false) {
    const base = anchor ? new Date(anchor) : new Date();
    if (Number.isNaN(base.getTime())) {
      throw new BadRequestException("Invalid date");
    }
    switch (period) {
      case "day":
        return this.salesInRange(this.dayBounds(base), includeCost);
      case "week":
        return this.salesInRange(this.weekBounds(base), includeCost);
      case "month":
        return this.salesInRange(this.monthBounds(base), includeCost);
      case "year":
        return this.salesInRange(this.yearBounds(base), includeCost);
      default:
        throw new BadRequestException("Invalid period");
    }
  }

  // Report periods follow the business calendar (Africa/Addis_Ababa), not the server's zone.
  private dayBounds(d: Date) {
    const date = businessDateString(d);
    return { start: businessDayStart(date), end: businessDayStart(addDays(date, 1)), label: date };
  }

  private weekBounds(d: Date) {
    const start = businessWeekStart(businessDateString(d));
    return {
      start: businessDayStart(start),
      end: businessDayStart(addDays(start, 7)),
      label: `week-${start}`,
    };
  }

  private monthBounds(d: Date) {
    const start = businessMonthStart(businessDateString(d));
    return {
      start: businessDayStart(start),
      end: businessDayStart(nextMonthStart(start)),
      label: start.slice(0, 7),
    };
  }

  private yearBounds(d: Date) {
    const start = businessYearStart(businessDateString(d));
    return {
      start: businessDayStart(start),
      end: businessDayStart(nextYearStart(start)),
      label: start.slice(0, 4),
    };
  }

  private buildReceiptText(sale: {
    saleNumber: string;
    grandTotal: string;
    lines: { product: { name: string }; quantity: string; unitPrice: string; lineTotal: string }[];
  }) {
    const lines = sale.lines
      .map((l) => `${l.product.name} x${l.quantity} @ ${l.unitPrice} = ${l.lineTotal}`)
      .join("\n");
    return [
      "Edi's Collection",
      `Sale ${sale.saleNumber}`,
      "----------------",
      lines,
      "----------------",
      `Total: ${sale.grandTotal}`,
    ].join("\n");
  }
}
