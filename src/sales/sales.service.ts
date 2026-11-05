import { createHash, createHmac, timingSafeEqual } from "crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  CreditCondition,
  CustomerLedgerKind,
  LoyaltyTxnKind,
  MovementType,
  PaymentMethod,
  PermissionKey,
  Prisma,
  ReservationStatus,
  TaxCategory,
} from "@prisma/client";
import { ApprovalsService, type ApprovalAction } from "../approvals/approvals.service";
import {
  addDays,
  businessDateString,
  businessDayEnd,
  businessDayStart,
  businessMonthStart,
  businessWeekStart,
  businessYearStart,
  nextMonthStart,
  nextYearStart,
} from "../common/business-time";
import { buildCreatedAtRange } from "../common/date-range.util";
import {
  allocateFromBatches,
  lockInventoryRows,
  productStockSnapshot,
} from "../common/stock.util";
import { ExportService, type ExportColumn } from "../export/export.service";
import { LocationsService } from "../locations/locations.service";
import { NotificationsService } from "../notifications/notifications.service";
import { hasPermission, type Viewer } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  PromotionsService,
  type AppliedPromotion,
} from "../promotions/promotions.service";
import { StoreSettingsService } from "../settings/store-settings.service";
import { ShiftsService } from "../shifts/shifts.service";
import { StorageService } from "../storage/storage.service";
import { FiscalService } from "./fiscal.service";

const toDecimal = (value: string | number) => {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException("Invalid quantity");
  }
};

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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
  unitPrice?: string;
  lineDiscount?: string;
  discountPercent?: string;
  discountReason?: string;
};

export type CheckoutPaymentInput = {
  method: PaymentMethod;
  amount: string;
  reference?: string;
  proofImagePath?: string;
  tenderedAmount?: string;
};

export type CheckoutInput = {
  lines: CheckoutLineInput[];
  notes?: string;
  proofImagePaths?: string[];
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  payments?: CheckoutPaymentInput[];
  cartDiscount?: string;
  cartDiscountPercent?: string;
  discountReason?: string;
  allowExpiredSale?: boolean;
  customerId?: string;
  couponCode?: string;
  loyaltyPointsToRedeem?: number;
  promotionIds?: string[];
};

export type ReturnLineInput = { saleLineId: string; quantity: string };

export type ReturnInput = {
  reason: string;
  condition: CreditCondition;
  refundMethod: PaymentMethod;
  refundReference?: string;
  notes?: string;
  lines: ReturnLineInput[];
};

const MAX_CHECKOUT_ATTEMPTS = 3;
const CHECKOUT_SCOPE = "checkout";
const RECEIPT_TTL_SECONDS = 30 * 24 * 3600;

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
  if (err.code === "P2002") {
    const target = JSON.stringify(err.meta?.target ?? "");
    return /scope|key/i.test(target);
  }
  return false;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const saleInclude = {
  lines: { include: { product: { include: { category: true } } } },
  createdBy: { select: { id: true, displayName: true, email: true } },
  voidedBy: { select: { id: true, displayName: true, email: true } },
  attachments: true,
  payments: true,
  creditNotes: {
    select: {
      id: true,
      creditNumber: true,
      kind: true,
      reason: true,
      refundAmount: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SaleInclude;

type SaleMapped = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly notifications: NotificationsService,
    private readonly exportService: ExportService,
    private readonly storage: StorageService,
    private readonly settings: StoreSettingsService,
    private readonly approvals: ApprovalsService,
    private readonly promotions: PromotionsService,
    private readonly fiscal: FiscalService,
    private readonly shifts: ShiftsService,
  ) {}

  private receiptSecret() {
    return process.env.FILE_URL_SECRET?.trim() || process.env.JWT_SECRET || "dev-only-secret";
  }

  signReceiptToken(saleId: string, ttlSeconds = RECEIPT_TTL_SECONDS) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = createHmac("sha256", this.receiptSecret()).update(`${saleId}\n${exp}`).digest("hex");
    return `${saleId}.${exp}.${sig}`;
  }

  verifyReceiptToken(token: string): string {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new NotFoundException("Receipt not found");
    }
    const [saleId, expRaw, sig] = parts;
    const exp = Number(expRaw);
    if (!saleId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      throw new NotFoundException("Receipt not found");
    }
    const expected = Buffer.from(
      createHmac("sha256", this.receiptSecret()).update(`${saleId}\n${exp}`).digest("hex"),
    );
    const given = Buffer.from(sig ?? "");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new NotFoundException("Receipt not found");
    }
    return saleId;
  }

  private async mapSale(sale: SaleMapped, includeCost: boolean) {
    const { lines, attachments, payments, grandTotal, subtotal, discountTotal, taxTotal, creditNotes, ...rest } =
      sale;
    return {
      ...rest,
      grandTotal: grandTotal.toFixed(2),
      subtotal: subtotal.toFixed(2),
      discountTotal: discountTotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method,
        amount: p.amount.toFixed(2),
        reference: p.reference,
        tenderedAmount: p.tenderedAmount?.toFixed(2) ?? null,
        changeAmount: p.changeAmount?.toFixed(2) ?? null,
        proofImagePath: p.proofImagePath,
        createdByUserId: p.createdByUserId,
        createdAt: p.createdAt,
      })),
      creditNotes: creditNotes.map((c) => ({
        id: c.id,
        creditNumber: c.creditNumber,
        kind: c.kind,
        reason: c.reason,
        refundAmount: c.refundAmount.toFixed(2),
        createdAt: c.createdAt,
      })),
      lines: lines.map((l) => {
        const unitCost = (l.unitCostAtSale.gt(0) ? l.unitCostAtSale : l.product.costPrice).toFixed(2);
        const qty = l.quantity;
        const netProfit = lineNetProfit(l).toFixed(2);
        return {
          id: l.id,
          quantity: qty.toString(),
          unitPrice: l.unitPrice.toFixed(2),
          originalUnitPrice: l.originalUnitPrice?.toFixed(2) ?? null,
          priceOverridden: l.priceOverridden,
          lineDiscount: l.lineDiscount.toFixed(2),
          discountReason: l.discountReason,
          taxAmount: l.taxAmount.toFixed(2),
          lineTotal: l.lineTotal.toFixed(2),
          ...(includeCost ? { unitCostAtSale: unitCost, netProfit } : {}),
          product: {
            id: l.product.id,
            name: l.product.name,
            taxCategory: l.product.taxCategory,
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
    cashierUserId?: string;
    paymentMethod?: PaymentMethod;
    status?: string;
  }): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {};
    const createdAt = buildCreatedAtRange(params.from, params.to);
    if (createdAt) {
      where.createdAt = createdAt;
    }
    if (params.cashierUserId) {
      where.createdByUserId = params.cashierUserId;
    }
    if (params.status) {
      where.status = params.status;
    }
    if (params.paymentMethod) {
      where.payments = { some: { method: params.paymentMethod } };
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

  async listSales(
    params: {
      skip?: number;
      take?: number;
      from?: string;
      to?: string;
      productId?: string;
      categoryId?: string;
      cashierUserId?: string;
      paymentMethod?: PaymentMethod;
      status?: string;
    },
    viewer: Viewer,
  ) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where = this.buildSalesWhere(params);
    if (!viewer.viewAllSales) {
      where.createdByUserId = viewer.userId;
    }
    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: saleInclude,
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
      include: saleInclude,
    });
    if (!sale || (!viewer.viewAllSales && sale.createdByUserId !== viewer.userId)) {
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

  private taxPortion(lineTotal: Prisma.Decimal, taxCategory: TaxCategory, vatRate: Prisma.Decimal) {
    if (taxCategory !== TaxCategory.STANDARD || vatRate.lte(0) || lineTotal.lte(0)) {
      return new Prisma.Decimal(0);
    }
    return money(lineTotal.mul(vatRate).div(vatRate.add(100)));
  }

  private approvalRequired(action: ApprovalAction, message: string) {
    throw new ForbiddenException({
      statusCode: 403,
      error: "Forbidden",
      code: "APPROVAL_REQUIRED",
      action,
      message,
    });
  }

  /**
   * Record a sale.
   *
   * The stock check and the deduction happen inside one transaction that first locks the
   * affected inventory rows, so two cashiers can never both sell the last unit. Serialization
   * failures are retried up to three times. `idempotencyKey` makes the call safe to repeat: the
   * same key with the same request returns the original sale instead of selling twice.
   */
  async checkout(
    actor: Actor,
    input: CheckoutInput,
    idempotencyKey: string,
    viewer: Viewer,
    approvalToken?: string,
    registerId?: string,
  ) {
    if (!input.lines?.length) {
      throw new BadRequestException("Add at least one product");
    }
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key is required");
    }
    const requestHash = this.hashRequest(input);
    const defaultLoc = await this.locations.getDefault();
    await this.ensureSaleCounter(businessDateString());
    const shiftId = await this.shifts.resolveShiftForCheckout(actor, registerId);

    let outcome: { saleId: string; replayed: boolean } | undefined;
    for (let attempt = 1; attempt <= MAX_CHECKOUT_ATTEMPTS; attempt += 1) {
      try {
        outcome = await this.prisma.$transaction(
          (tx) =>
            this.checkoutInTransaction(
              tx,
              actor,
              input,
              idempotencyKey,
              requestHash,
              defaultLoc.id,
              approvalToken,
              shiftId,
            ),
          {
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

    const sale = await this.getSale(outcome.saleId, { ...viewer, viewAllSales: true });
    if (!outcome.replayed) {
      const productIds = [...new Set(input.lines.map((l) => l.productId))];
      for (const productId of productIds) {
        try {
          await this.notifications.checkStockAlertsForProduct(productId);
        } catch (err) {
          this.logger.error(`Stock alert failed for ${productId}: ${String(err)}`);
        }
      }
      void this.fiscal.registerSaleSafe({
        id: sale.id,
        saleNumber: sale.saleNumber,
        grandTotal: sale.grandTotal,
        taxTotal: sale.taxTotal,
      });
    }
    return {
      sale,
      digitalReceipt: this.buildReceiptText(sale),
      receiptToken: this.signReceiptToken(sale.id),
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
          unitPrice: l.unitPrice ?? null,
          lineDiscount: l.lineDiscount ?? null,
          discountPercent: l.discountPercent ?? null,
          discountReason: l.discountReason ?? null,
        }))
        .sort((a, b) =>
          `${a.productId}:${a.reservationId}`.localeCompare(`${b.productId}:${b.reservationId}`),
        ),
      method: input.paymentMethod ?? PaymentMethod.CASH,
      reference: input.paymentReference ?? null,
      payments: (input.payments ?? []).map((p) => ({
        method: p.method,
        amount: p.amount,
        reference: p.reference ?? null,
        proofImagePath: p.proofImagePath ?? null,
        tenderedAmount: p.tenderedAmount ?? null,
      })),
      proofs: [...(input.proofImagePaths ?? [])].sort(),
      notes: input.notes ?? null,
      cartDiscount: input.cartDiscount ?? null,
      cartDiscountPercent: input.cartDiscountPercent ?? null,
      discountReason: input.discountReason ?? null,
      allowExpiredSale: !!input.allowExpiredSale,
      customerId: input.customerId ?? null,
      couponCode: input.couponCode?.trim().toUpperCase() || null,
      loyaltyPointsToRedeem: input.loyaltyPointsToRedeem ?? 0,
      promotionIds: [...(input.promotionIds ?? [])].sort(),
    };
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  }

  private async checkoutInTransaction(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: CheckoutInput,
    idempotencyKey: string,
    requestHash: string,
    locationId: string,
    approvalToken?: string,
    shiftId?: string | null,
  ): Promise<{ saleId: string; replayed: boolean }> {
    const userId = actor.userId;
    const productIds = [...new Set(input.lines.map((l) => l.productId))];

    await lockInventoryRows(tx, productIds, locationId);

    if (shiftId) {
      const open = await tx.shift.findFirst({
        where: { id: shiftId, status: "OPEN" },
      });
      if (!open) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "Forbidden",
          code: "SHIFT_REQUIRED",
          message: "Open a shift before selling",
        });
      }
    }

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

    const storeSettings = await this.settings.getAll();
    const vatRate = new Prisma.Decimal(storeSettings["pos.vatRate"] || "15");
    const discountLimitPercent = new Prisma.Decimal(storeSettings["pos.discountLimitPercent"] || "10");

    type Demand = {
      productId: string;
      quantity: Prisma.Decimal;
      reservationId?: string;
      unitPriceOverride?: Prisma.Decimal;
      lineDiscountFixed?: Prisma.Decimal;
      discountPercent?: Prisma.Decimal;
      discountReason?: string;
    };
    const reservationDemands: Demand[] = [];
    const freeDemand = new Map<string, Demand>();

    for (const line of input.lines) {
      const qty = toDecimal(line.quantity);
      if (qty.lte(0)) {
        throw new BadRequestException("Quantity must be positive");
      }
      let unitPriceOverride: Prisma.Decimal | undefined;
      if (line.unitPrice !== undefined && line.unitPrice !== null && line.unitPrice !== "") {
        unitPriceOverride = toDecimal(line.unitPrice);
        if (unitPriceOverride.lt(0)) {
          throw new BadRequestException("Unit price cannot be negative");
        }
      }
      let lineDiscountFixed: Prisma.Decimal | undefined;
      if (line.lineDiscount !== undefined && line.lineDiscount !== null && line.lineDiscount !== "") {
        lineDiscountFixed = toDecimal(line.lineDiscount);
        if (lineDiscountFixed.lt(0)) {
          throw new BadRequestException("Line discount cannot be negative");
        }
      }
      let discountPercent: Prisma.Decimal | undefined;
      if (line.discountPercent !== undefined && line.discountPercent !== null && line.discountPercent !== "") {
        discountPercent = toDecimal(line.discountPercent);
        if (discountPercent.lt(0)) {
          throw new BadRequestException("Discount percent cannot be negative");
        }
      }
      const demand: Demand = {
        productId: line.productId,
        quantity: qty,
        reservationId: line.reservationId,
        unitPriceOverride,
        lineDiscountFixed,
        discountPercent,
        discountReason: line.discountReason,
      };
      if (line.reservationId) {
        reservationDemands.push(demand);
      } else {
        const prev = freeDemand.get(line.productId);
        if (prev) {
          // Same product free lines are merged for stock check; keep first pricing overrides.
          prev.quantity = prev.quantity.add(qty);
        } else {
          freeDemand.set(line.productId, { ...demand });
        }
      }
    }

    // Pricing must follow original cart lines (not merged), so recompute from input.lines.
    const pricingLines: Demand[] = input.lines.map((line) => {
      const qty = toDecimal(line.quantity);
      let unitPriceOverride: Prisma.Decimal | undefined;
      if (line.unitPrice !== undefined && line.unitPrice !== null && line.unitPrice !== "") {
        unitPriceOverride = toDecimal(line.unitPrice);
      }
      let lineDiscountFixed: Prisma.Decimal | undefined;
      if (line.lineDiscount !== undefined && line.lineDiscount !== null && line.lineDiscount !== "") {
        lineDiscountFixed = toDecimal(line.lineDiscount);
      }
      let discountPercent: Prisma.Decimal | undefined;
      if (line.discountPercent !== undefined && line.discountPercent !== null && line.discountPercent !== "") {
        discountPercent = toDecimal(line.discountPercent);
      }
      return {
        productId: line.productId,
        quantity: qty,
        reservationId: line.reservationId,
        unitPriceOverride,
        lineDiscountFixed,
        discountPercent,
        discountReason: line.discountReason,
      };
    });

    const stockDemands: Demand[] = [
      ...reservationDemands,
      ...[...freeDemand.values()].map((d) => ({
        productId: d.productId,
        quantity: d.quantity,
        reservationId: undefined,
      })),
    ];

    const movementPlans: Array<{
      inventoryItemId: string;
      productId: string;
      quantity: Prisma.Decimal;
      reservationId?: string;
      reservationCustomer?: string | null;
    }> = [];

    for (const demand of stockDemands) {
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

      movementPlans.push({
        inventoryItemId: inv.id,
        productId: demand.productId,
        quantity: demand.quantity,
        reservationId: demand.reservationId,
        reservationCustomer,
      });
    }

    const computed: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      originalUnitPrice: Prisma.Decimal | null;
      priceOverridden: boolean;
      lineDiscount: Prisma.Decimal;
      discountReason: string | null;
      taxAmount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      unitCostAtSale: Prisma.Decimal;
      taxCategory: TaxCategory;
    }> = [];

    let hasPriceOverride = false;
    let lineDiscountSum = new Prisma.Decimal(0);

    for (const demand of pricingLines) {
      const product = productById.get(demand.productId)!;
      const inv = await tx.inventoryItem.findUniqueOrThrow({
        where: { productId_locationId: { productId: demand.productId, locationId } },
      });
      const shelf = product.sellingPrice;
      const unitPrice = demand.unitPriceOverride ?? shelf;
      const priceOverridden = !!demand.unitPriceOverride && !demand.unitPriceOverride.eq(shelf);
      if (priceOverridden) {
        hasPriceOverride = true;
      }
      const gross = money(unitPrice.mul(demand.quantity));
      let lineDiscount = new Prisma.Decimal(0);
      if (demand.lineDiscountFixed) {
        lineDiscount = money(demand.lineDiscountFixed);
      } else if (demand.discountPercent) {
        lineDiscount = money(gross.mul(demand.discountPercent).div(100));
      }
      if (lineDiscount.gt(gross)) {
        throw new BadRequestException("Line discount cannot exceed line total");
      }
      lineDiscountSum = lineDiscountSum.add(lineDiscount);
      const lineTotal = money(gross.sub(lineDiscount));
      computed.push({
        productId: product.id,
        quantity: demand.quantity,
        unitPrice,
        originalUnitPrice: priceOverridden ? shelf : null,
        priceOverridden,
        lineDiscount,
        discountReason: demand.discountReason ?? null,
        taxAmount: new Prisma.Decimal(0),
        lineTotal,
        unitCostAtSale: inv.averageCost,
        taxCategory: product.taxCategory,
      });
    }

    const subtotal = money(computed.reduce((acc, l) => acc.add(l.lineTotal), new Prisma.Decimal(0)));
    let cartDiscount = new Prisma.Decimal(0);
    if (input.cartDiscount !== undefined && input.cartDiscount !== null && input.cartDiscount !== "") {
      cartDiscount = money(toDecimal(input.cartDiscount));
    } else if (
      input.cartDiscountPercent !== undefined &&
      input.cartDiscountPercent !== null &&
      input.cartDiscountPercent !== ""
    ) {
      cartDiscount = money(subtotal.mul(toDecimal(input.cartDiscountPercent)).div(100));
    }
    if (cartDiscount.lt(0)) {
      throw new BadRequestException("Cart discount cannot be negative");
    }
    if (cartDiscount.gt(subtotal)) {
      throw new BadRequestException("Cart discount cannot exceed subtotal");
    }

    const totalDiscount = money(lineDiscountSum.add(cartDiscount));
    const preDiscountSubtotal = money(subtotal.add(lineDiscountSum));
    const discountPercentOfPre =
      preDiscountSubtotal.gt(0) ? totalDiscount.mul(100).div(preDiscountSubtotal) : new Prisma.Decimal(0);

    if (totalDiscount.gt(0) && !hasPermission(actor, PermissionKey.DISCOUNT_APPLY)) {
      throw new ForbiddenException("You need permission to apply discounts");
    }

    const overLimit =
      totalDiscount.gt(0) &&
      discountPercentOfPre.gt(discountLimitPercent) &&
      !hasPermission(actor, PermissionKey.DISCOUNT_ABOVE_LIMIT);
    const needsPriceApproval = hasPriceOverride && !hasPermission(actor, PermissionKey.PRICE_OVERRIDE);

    const requiredApprovals: ApprovalAction[] = [];
    if (needsPriceApproval) {
      requiredApprovals.push("PRICE_OVERRIDE");
    }
    if (overLimit) {
      requiredApprovals.push("DISCOUNT_OVER_LIMIT");
    }

    const approvedBy: Record<string, string> = {};
    if (requiredApprovals.length > 0) {
      if (!approvalToken) {
        this.approvalRequired(
          requiredApprovals[0],
          requiredApprovals.length > 1
            ? `Manager approval required for: ${requiredApprovals.join(", ")}`
            : requiredApprovals[0] === "PRICE_OVERRIDE"
              ? "A manager must approve this price override"
              : "A manager must approve this discount above the limit",
        );
      }
      if (requiredApprovals.length > 1) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "Forbidden",
          code: "APPROVAL_REQUIRED",
          actions: requiredApprovals,
          message: `Manager approval required for: ${requiredApprovals.join(", ")}. Approve one action at a time.`,
        });
      }
      const action = requiredApprovals[0];
      approvedBy[action] = (await this.approvals.consume(tx, approvalToken!, action, userId)).approverId;
    }

    // Phase 7: customer, promotions, loyalty redeem — after cart discounts, before payments.
    let customerId: string | null = input.customerId?.trim() || null;
    let lockedCustomer: {
      id: string;
      isActive: boolean;
      creditLimit: Prisma.Decimal;
      creditBalance: Prisma.Decimal;
      storeCreditBalance: Prisma.Decimal;
      loyaltyPoints: number;
    } | null = null;

    if (customerId) {
      await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
      lockedCustomer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!lockedCustomer || !lockedCustomer.isActive) {
        throw new BadRequestException("Customer not found or inactive");
      }
    }

    let promoDiscount = new Prisma.Decimal(0);
    let appliedPromos: AppliedPromotion[] = [];
    const afterCart = money(subtotal.sub(cartDiscount));
    const evalLines = computed.map((l) => ({
      productId: l.productId,
      categoryId: productById.get(l.productId)?.categoryId ?? null,
      lineTotal: l.lineTotal.toFixed(2),
    }));
    {
      const evaluated = await this.promotions.evaluate(
        {
          lines: evalLines,
          subtotal: afterCart.toFixed(2),
          couponCode: input.couponCode,
          customerId,
          promotionIds: input.promotionIds,
        },
        tx,
      );
      appliedPromos = evaluated.promotions;
      promoDiscount = money(new Prisma.Decimal(evaluated.totalDiscount));
      if (promoDiscount.gt(afterCart)) {
        promoDiscount = afterCart;
      }
    }

    let loyaltyDiscount = new Prisma.Decimal(0);
    let loyaltyPointsRedeemed = 0;
    const loyaltyEnabled = (storeSettings["loyalty.enabled"] || "true").toLowerCase() === "true";
    const pointsToRedeem = Math.max(0, Math.floor(Number(input.loyaltyPointsToRedeem ?? 0) || 0));
    if (pointsToRedeem > 0) {
      if (!lockedCustomer) {
        throw new BadRequestException("customerId is required to redeem loyalty points");
      }
      if (!loyaltyEnabled) {
        throw new BadRequestException("Loyalty is disabled");
      }
      if (pointsToRedeem > lockedCustomer.loyaltyPoints) {
        throw new BadRequestException("Not enough loyalty points");
      }
      const birrPerPoint = new Prisma.Decimal(storeSettings["loyalty.birrPerRedeemPoint"] || "0.1");
      const remainingAfterPromo = money(afterCart.sub(promoDiscount));
      const maxByPoints = money(new Prisma.Decimal(pointsToRedeem).mul(birrPerPoint));
      loyaltyDiscount = money(Prisma.Decimal.min(maxByPoints, remainingAfterPromo));
      if (birrPerPoint.gt(0) && loyaltyDiscount.gt(0)) {
        loyaltyPointsRedeemed = Math.min(
          pointsToRedeem,
          Math.ceil(Number(loyaltyDiscount.div(birrPerPoint).toFixed(8))),
        );
        loyaltyDiscount = money(
          Prisma.Decimal.min(
            new Prisma.Decimal(loyaltyPointsRedeemed).mul(birrPerPoint),
            remainingAfterPromo,
          ),
        );
      }
    }

    const cartLevelDiscount = money(cartDiscount.add(promoDiscount).add(loyaltyDiscount));
    const payable = money(subtotal.sub(cartLevelDiscount));
    const scale = subtotal.gt(0) ? payable.div(subtotal) : new Prisma.Decimal(1);
    let taxTotal = new Prisma.Decimal(0);
    for (const line of computed) {
      const rawTax = this.taxPortion(line.lineTotal, line.taxCategory, vatRate);
      line.taxAmount = money(rawTax.mul(scale));
      taxTotal = taxTotal.add(line.taxAmount);
    }
    taxTotal = money(taxTotal);
    const grandTotal = payable;
    const discountTotal = money(lineDiscountSum.add(cartLevelDiscount));

    // Payments: split array or legacy single method.
    type PayRow = {
      method: PaymentMethod;
      amount: Prisma.Decimal;
      reference: string | null;
      proofImagePath: string | null;
      tenderedAmount: Prisma.Decimal | null;
      changeAmount: Prisma.Decimal | null;
    };
    const payRows: PayRow[] = [];
    if (input.payments?.length) {
      for (const p of input.payments) {
        const amount = money(toDecimal(p.amount));
        if (amount.lte(0)) {
          throw new BadRequestException("Payment amount must be positive");
        }
        let tenderedAmount: Prisma.Decimal | null = null;
        let changeAmount: Prisma.Decimal | null = null;
        if (p.tenderedAmount !== undefined && p.tenderedAmount !== null && p.tenderedAmount !== "") {
          tenderedAmount = money(toDecimal(p.tenderedAmount));
        }
        if (p.method === PaymentMethod.CASH && tenderedAmount) {
          changeAmount = money(Prisma.Decimal.max(tenderedAmount.sub(amount), new Prisma.Decimal(0)));
        }
        const proof = p.proofImagePath?.trim() || null;
        if (proof && (!proof.startsWith("/uploads/") || proof.includes(".."))) {
          throw new BadRequestException("Invalid proof image path");
        }
        payRows.push({
          method: p.method,
          amount,
          reference: p.reference?.trim() || null,
          proofImagePath: proof,
          tenderedAmount,
          changeAmount,
        });
      }
    } else {
      payRows.push({
        method: input.paymentMethod ?? PaymentMethod.CASH,
        amount: grandTotal,
        reference: input.paymentReference?.trim() || null,
        proofImagePath: null,
        tenderedAmount: null,
        changeAmount: null,
      });
    }

    const paidSum = money(payRows.reduce((a, p) => a.add(p.amount), new Prisma.Decimal(0)));
    if (!paidSum.eq(grandTotal)) {
      throw new BadRequestException(
        `Payments must sum to grand total (${grandTotal.toFixed(2)}; got ${paidSum.toFixed(2)})`,
      );
    }

    const proofPaths = (input.proofImagePaths ?? []).filter(
      (p) => p.startsWith("/uploads/") && !p.includes(".."),
    );
    for (const p of payRows) {
      if (p.proofImagePath) {
        proofPaths.push(p.proofImagePath);
      }
    }

    const saleNumber = await this.nextSaleNumber(tx, businessDateString());

    // Validate store credit / customer account against locked customer before writing the sale.
    const storeCreditPay = money(
      payRows
        .filter((p) => p.method === PaymentMethod.STORE_CREDIT)
        .reduce((a, p) => a.add(p.amount), new Prisma.Decimal(0)),
    );
    const accountPay = money(
      payRows
        .filter((p) => p.method === PaymentMethod.CUSTOMER_ACCOUNT)
        .reduce((a, p) => a.add(p.amount), new Prisma.Decimal(0)),
    );
    if (storeCreditPay.gt(0) || accountPay.gt(0) || loyaltyPointsRedeemed > 0) {
      if (!lockedCustomer) {
        throw new BadRequestException("customerId is required for store credit, account, or loyalty");
      }
    }
    if (storeCreditPay.gt(0) && lockedCustomer && storeCreditPay.gt(lockedCustomer.storeCreditBalance)) {
      throw new BadRequestException(
        `Insufficient store credit (available ${lockedCustomer.storeCreditBalance.toFixed(2)})`,
      );
    }
    if (accountPay.gt(0)) {
      if (!hasPermission(actor, PermissionKey.CUSTOMER_CREDIT_MANAGE)) {
        throw new ForbiddenException("You need permission to charge a customer account");
      }
      if (!lockedCustomer) {
        throw new BadRequestException("customerId is required for CUSTOMER_ACCOUNT payment");
      }
      const newBalance = money(lockedCustomer.creditBalance.add(accountPay));
      if (newBalance.gt(lockedCustomer.creditLimit)) {
        throw new BadRequestException(
          `Credit limit exceeded (limit ${lockedCustomer.creditLimit.toFixed(2)}, balance would be ${newBalance.toFixed(2)})`,
        );
      }
    }

    let loyaltyPointsEarned = 0;
    if (lockedCustomer && loyaltyEnabled && grandTotal.gt(0)) {
      const pointsPerBirr = new Prisma.Decimal(storeSettings["loyalty.pointsPerBirr"] || "0.1");
      loyaltyPointsEarned = Math.max(
        0,
        Math.floor(Number(grandTotal.mul(pointsPerBirr).toFixed(8))),
      );
    }

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        status: "COMPLETED",
        subtotal,
        discountTotal,
        taxTotal,
        grandTotal,
        notes: input.notes?.trim() || null,
        discountReason: input.discountReason?.trim() || null,
        createdByUserId: userId,
        shiftId: shiftId ?? null,
        customerId,
        loyaltyPointsEarned,
        loyaltyPointsRedeemed,
        lines: {
          create: computed.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            originalUnitPrice: l.originalUnitPrice,
            priceOverridden: l.priceOverridden,
            unitCostAtSale: l.unitCostAtSale,
            lineDiscount: l.lineDiscount,
            discountReason: l.discountReason,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
          })),
        },
        payments: {
          create: payRows.map((p) => ({
            method: p.method,
            amount: p.amount,
            reference: p.reference,
            tenderedAmount: p.tenderedAmount,
            changeAmount: p.changeAmount,
            proofImagePath: p.proofImagePath,
            createdByUserId: userId,
          })),
        },
        attachments: proofPaths.length
          ? { create: [...new Set(proofPaths)].map((imagePath) => ({ imagePath })) }
          : undefined,
      },
    });

    for (const promo of appliedPromos) {
      await tx.promotionUsage.create({
        data: {
          promotionId: promo.promotionId,
          saleId: sale.id,
          customerId,
          discountAmount: money(new Prisma.Decimal(promo.discountAmount)),
        },
      });
      await tx.promotion.update({
        where: { id: promo.promotionId },
        data: { usageCount: { increment: 1 } },
      });
    }

    if (lockedCustomer) {
      let storeCreditBalance = lockedCustomer.storeCreditBalance;
      let creditBalance = lockedCustomer.creditBalance;
      let loyaltyPoints = lockedCustomer.loyaltyPoints;

      if (storeCreditPay.gt(0)) {
        storeCreditBalance = money(storeCreditBalance.sub(storeCreditPay));
        await tx.customerLedgerEntry.create({
          data: {
            customerId: lockedCustomer.id,
            kind: CustomerLedgerKind.STORE_CREDIT_REDEEM,
            amount: storeCreditPay,
            balanceAfter: storeCreditBalance,
            saleId: sale.id,
            notes: "Redeemed at POS",
            createdByUserId: userId,
          },
        });
      }
      if (accountPay.gt(0)) {
        creditBalance = money(creditBalance.add(accountPay));
        await tx.customerLedgerEntry.create({
          data: {
            customerId: lockedCustomer.id,
            kind: CustomerLedgerKind.SALE_CREDIT,
            amount: accountPay,
            balanceAfter: creditBalance,
            saleId: sale.id,
            notes: "Pay later",
            createdByUserId: userId,
          },
        });
      }
      if (loyaltyPointsRedeemed > 0) {
        loyaltyPoints -= loyaltyPointsRedeemed;
        await tx.loyaltyTransaction.create({
          data: {
            customerId: lockedCustomer.id,
            kind: LoyaltyTxnKind.REDEEM,
            points: -loyaltyPointsRedeemed,
            balanceAfter: loyaltyPoints,
            saleId: sale.id,
            notes: `Redeemed for Br ${loyaltyDiscount.toFixed(2)}`,
            createdByUserId: userId,
          },
        });
      }
      if (loyaltyPointsEarned > 0) {
        loyaltyPoints += loyaltyPointsEarned;
        await tx.loyaltyTransaction.create({
          data: {
            customerId: lockedCustomer.id,
            kind: LoyaltyTxnKind.EARN,
            points: loyaltyPointsEarned,
            balanceAfter: loyaltyPoints,
            saleId: sale.id,
            notes: `Earned on sale ${saleNumber}`,
            createdByUserId: userId,
          },
        });
      }

      await tx.customer.update({
        where: { id: lockedCustomer.id },
        data: { storeCreditBalance, creditBalance, loyaltyPoints },
      });
    }

    const saleLines = await tx.saleLine.findMany({ where: { saleId: sale.id } });
    const saleLineByProduct = new Map<string, string>();
    for (const sl of saleLines) {
      if (!saleLineByProduct.has(sl.productId)) {
        saleLineByProduct.set(sl.productId, sl.id);
      }
    }

    for (const plan of movementPlans) {
      const inv = await tx.inventoryItem.findUniqueOrThrow({ where: { id: plan.inventoryItemId } });
      const deducted = await tx.inventoryItem.updateMany({
        where: { id: inv.id, quantityOnHand: { gte: plan.quantity } },
        data: { quantityOnHand: { decrement: plan.quantity } },
      });
      if (deducted.count !== 1) {
        throw new ConflictException("Not enough stock on hand");
      }

      const product = productById.get(plan.productId);
      const allowExpired = !!input.allowExpiredSale;
      const skipExpired = product?.trackBatches && !allowExpired;

      let running = inv.quantityOnHand;
      const allocations = await allocateFromBatches(tx, plan.productId, plan.quantity, {
        locationId,
        allowExpired: !skipExpired,
      });
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
          paymentMethod: payRows.map((p) => p.method).join("+"),
          discountTotal: discountTotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          customerId,
          promoDiscount: promoDiscount.toFixed(2),
          loyaltyDiscount: loyaltyDiscount.toFixed(2),
          loyaltyPointsEarned,
          loyaltyPointsRedeemed,
          promotionIds: appliedPromos.map((p) => p.promotionId),
          ...(Object.keys(approvedBy).length ? { approvedBy } : {}),
        },
      },
    });
    await tx.idempotencyKey.create({
      data: { scope: CHECKOUT_SCOPE, key: idempotencyKey, requestHash, userId, saleId: sale.id },
    });

    return { saleId: sale.id, replayed: false };
  }

  // ─── Parked carts ───────────────────────────────────────────────────────────

  async listParked(viewer: Viewer) {
    const now = new Date();
    const where: Prisma.ParkedCartWhereInput = {
      expiresAt: { gt: now },
      resumedAt: null,
      ...(!viewer.viewAllSales ? { createdByUserId: viewer.userId } : {}),
    };
    const items = await this.prisma.parkedCart.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { id: true, displayName: true, email: true } } },
    });
    return items.map((p) => ({
      id: p.id,
      label: p.label,
      notes: p.notes,
      payload: p.payload,
      expiresAt: p.expiresAt,
      createdAt: p.createdAt,
      createdBy: p.createdBy,
    }));
  }

  async parkCart(userId: string, input: { label: string; notes?: string; payload: unknown }) {
    if (!input.label?.trim()) {
      throw new BadRequestException("Label is required");
    }
    if (input.payload === undefined || input.payload === null) {
      throw new BadRequestException("Payload is required");
    }
    const today = businessDateString();
    const cart = await this.prisma.parkedCart.create({
      data: {
        label: input.label.trim(),
        notes: input.notes?.trim() || null,
        payload: input.payload as Prisma.InputJsonValue,
        createdByUserId: userId,
        expiresAt: businessDayEnd(today),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: "PARK_CART",
        entity: "ParkedCart",
        entityId: cart.id,
        metadata: { label: cart.label },
      },
    });
    return cart;
  }

  async deleteParked(id: string, viewer: Viewer) {
    const cart = await this.prisma.parkedCart.findUnique({ where: { id } });
    if (!cart || (!viewer.viewAllSales && cart.createdByUserId !== viewer.userId)) {
      throw new NotFoundException("Parked cart not found");
    }
    await this.prisma.parkedCart.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        userId: viewer.userId,
        action: "DELETE_PARKED_CART",
        entity: "ParkedCart",
        entityId: id,
      },
    });
    return { ok: true };
  }

  async resumeParked(id: string, viewer: Viewer) {
    const cart = await this.prisma.parkedCart.findUnique({ where: { id } });
    if (!cart || (!viewer.viewAllSales && cart.createdByUserId !== viewer.userId)) {
      throw new NotFoundException("Parked cart not found");
    }
    if (cart.resumedAt || cart.expiresAt <= new Date()) {
      throw new BadRequestException("This parked cart has expired or was already resumed");
    }
    const updated = await this.prisma.parkedCart.update({
      where: { id },
      data: { resumedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: viewer.userId,
        action: "RESUME_PARKED_CART",
        entity: "ParkedCart",
        entityId: id,
      },
    });
    return { id: updated.id, label: updated.label, notes: updated.notes, payload: updated.payload };
  }

  // ─── Void / return ──────────────────────────────────────────────────────────

  private async ensureCreditCounter(date: string) {
    await this.prisma.$executeRaw`
      INSERT INTO "DocumentCounter" ("scope", "date", "value")
      VALUES ('CREDIT', ${date}, 0)
      ON CONFLICT ("scope", "date") DO NOTHING`;
  }

  private async nextCreditNumber(tx: Prisma.TransactionClient, date: string) {
    let rows = await tx.$queryRaw<{ value: number }[]>`
      UPDATE "DocumentCounter" SET "value" = "value" + 1
       WHERE "scope" = 'CREDIT' AND "date" = ${date}
   RETURNING "value"`;
    if (rows.length === 0) {
      rows = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO "DocumentCounter" ("scope", "date", "value") VALUES ('CREDIT', ${date}, 1)
        ON CONFLICT ("scope", "date") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
        RETURNING "value"`;
    }
    return `CN-${date.replace(/-/g, "")}-${String(rows[0].value).padStart(4, "0")}`;
  }

  private async ensureInventoryItem(
    tx: Prisma.TransactionClient,
    productId: string,
    locationId: string,
  ) {
    let inv = await tx.inventoryItem.findUnique({
      where: { productId_locationId: { productId, locationId } },
    });
    if (!inv) {
      inv = await tx.inventoryItem.create({
        data: {
          productId,
          locationId,
          quantityOnHand: new Prisma.Decimal(0),
          averageCost: new Prisma.Decimal(0),
        },
      });
    }
    return inv;
  }

  private async restockQuantity(
    tx: Prisma.TransactionClient,
    opts: {
      productId: string;
      quantity: Prisma.Decimal;
      locationId: string;
      userId: string;
      saleId: string;
      saleLineId: string;
      notes?: string | null;
      allocations?: { stockBatchId: string | null; quantity: Prisma.Decimal }[];
    },
  ) {
    const inv = await this.ensureInventoryItem(tx, opts.productId, opts.locationId);
    await lockInventoryRows(tx, [opts.productId], opts.locationId);
    const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inv.id } });
    let running = current.quantityOnHand;
    let remaining = opts.quantity;

    const allocs =
      opts.allocations?.length ?
        opts.allocations
      : [{ stockBatchId: null as string | null, quantity: opts.quantity }];

    for (const alloc of allocs) {
      if (remaining.lte(0)) {
        break;
      }
      const qty = Prisma.Decimal.min(alloc.quantity, remaining);
      if (qty.lte(0)) {
        continue;
      }
      if (alloc.stockBatchId) {
        await tx.stockBatch.update({
          where: { id: alloc.stockBatchId },
          data: { qtyRemaining: { increment: qty } },
        });
      }
      const after = running.add(qty);
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          stockBatchId: alloc.stockBatchId,
          type: MovementType.RETURN,
          qtyDelta: qty,
          beforeOnHand: running,
          afterOnHand: after,
          refType: "SALE_RETURN",
          refId: opts.saleId,
          notes: opts.notes,
          createdByUserId: opts.userId,
          metadata: { saleLineId: opts.saleLineId },
        },
      });
      running = after;
      remaining = remaining.sub(qty);
    }

    if (remaining.gt(0)) {
      const after = running.add(remaining);
      await tx.stockMovement.create({
        data: {
          inventoryItemId: current.id,
          type: MovementType.RETURN,
          qtyDelta: remaining,
          beforeOnHand: running,
          afterOnHand: after,
          refType: "SALE_RETURN",
          refId: opts.saleId,
          notes: opts.notes,
          createdByUserId: opts.userId,
          metadata: { saleLineId: opts.saleLineId },
        },
      });
      running = after;
    }

    await tx.inventoryItem.update({
      where: { id: current.id },
      data: { quantityOnHand: running },
    });
  }

  async voidSale(
    actor: Actor,
    saleId: string,
    input: { reason: string },
    approvalToken?: string,
    viewer?: Viewer,
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException("Reason is required");
    }
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        lines: { include: { batchAllocations: true, product: true } },
        payments: true,
      },
    });
    if (!sale) {
      throw new NotFoundException("Sale not found");
    }
    if (sale.status === "VOIDED") {
      throw new BadRequestException("Sale is already voided");
    }
    if (sale.status === "REFUNDED" || sale.status === "PARTIALLY_REFUNDED") {
      throw new BadRequestException("Cannot void a sale that has returns");
    }

    const saleDay = businessDateString(sale.createdAt);
    const today = businessDateString();
    const sameDay = saleDay === today;
    if (!sameDay) {
      if (!approvalToken) {
        this.approvalRequired(
          "SALE_VOID",
          "Voiding a sale from a previous business day needs manager approval",
        );
      }
    }

    const defaultLoc = await this.locations.getDefault();
    await this.ensureCreditCounter(today);

    await this.prisma.$transaction(async (tx) => {
      let approvedByUserId: string | undefined;
      if (!sameDay && approvalToken) {
        approvedByUserId = (await this.approvals.consume(tx, approvalToken, "SALE_VOID", actor.userId))
          .approverId;
      }

      const productIds = [...new Set(sale.lines.map((l) => l.productId))];
      await lockInventoryRows(tx, productIds, defaultLoc.id);

      for (const line of sale.lines) {
        await this.restockQuantity(tx, {
          productId: line.productId,
          quantity: line.quantity,
          locationId: defaultLoc.id,
          userId: actor.userId,
          saleId: sale.id,
          saleLineId: line.id,
          notes: input.reason,
          allocations: line.batchAllocations.map((a) => ({
            stockBatchId: a.stockBatchId,
            quantity: a.quantity,
          })),
        });
      }

      const creditNumber = await this.nextCreditNumber(tx, today);
      await tx.creditNote.create({
        data: {
          creditNumber,
          saleId: sale.id,
          kind: "VOID",
          reason: input.reason.trim(),
          condition: CreditCondition.RESTOCK,
          refundMethod: sale.payments[0]?.method ?? PaymentMethod.CASH,
          refundAmount: sale.grandTotal,
          createdByUserId: actor.userId,
          lines: {
            create: sale.lines.map((l) => ({
              saleLineId: l.id,
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              restockLocationId: defaultLoc.id,
            })),
          },
        },
      });

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidReason: input.reason.trim(),
          voidedByUserId: actor.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: "VOID_SALE",
          entity: "Sale",
          entityId: sale.id,
          metadata: {
            reason: input.reason.trim(),
            creditNumber,
            ...(approvedByUserId ? { approvedByUserId } : {}),
          },
        },
      });
    });

    return this.getSale(saleId, viewer ?? { userId: actor.userId, includeCost: false, viewAllSales: true });
  }

  async returnSale(
    actor: Actor,
    saleId: string,
    input: ReturnInput,
    approvalToken?: string,
    viewer?: Viewer,
  ) {
    if (!input.reason?.trim()) {
      throw new BadRequestException("Reason is required");
    }
    if (!input.lines?.length) {
      throw new BadRequestException("Add at least one line to return");
    }

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        lines: { include: { batchAllocations: true, creditLines: true, product: true } },
        creditNotes: true,
      },
    });
    if (!sale) {
      throw new NotFoundException("Sale not found");
    }
    if (sale.status === "VOIDED") {
      throw new BadRequestException("Cannot return a voided sale");
    }
    if (sale.status === "REFUNDED") {
      throw new BadRequestException("Sale is already fully refunded");
    }

    const settings = await this.settings.getAll();
    const windowDays = Number(settings["pos.returnWindowDays"] || "7");
    const saleDay = businessDateString(sale.createdAt);
    const lastDay = addDays(saleDay, windowDays);
    const today = businessDateString();
    const outsideWindow = today > lastDay;
    if (outsideWindow && !approvalToken) {
      this.approvalRequired(
        "REFUND_OUTSIDE_WINDOW",
        `Returns are allowed within ${windowDays} days; this sale needs manager approval`,
      );
    }

    const restockLoc =
      input.condition === CreditCondition.RESTOCK
        ? await this.locations.getDefault()
        : await this.locations.getQuarantine();

    await this.ensureCreditCounter(today);

    await this.prisma.$transaction(async (tx) => {
      let approvedByUserId: string | undefined;
      if (outsideWindow && approvalToken) {
        approvedByUserId = (
          await this.approvals.consume(tx, approvalToken, "REFUND_OUTSIDE_WINDOW", actor.userId)
        ).approverId;
      }

      const productIds = [...new Set(input.lines.map((l) => {
        const line = sale.lines.find((sl) => sl.id === l.saleLineId);
        return line?.productId;
      }).filter(Boolean) as string[])];
      await lockInventoryRows(tx, productIds, restockLoc.id);

      const creditLines: Array<{
        saleLineId: string;
        productId: string;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
      }> = [];

      for (const req of input.lines) {
        const qty = toDecimal(req.quantity);
        if (qty.lte(0)) {
          throw new BadRequestException("Return quantity must be positive");
        }
        const line = sale.lines.find((l) => l.id === req.saleLineId);
        if (!line) {
          throw new BadRequestException("Sale line not found on this sale");
        }
        const already = line.creditLines.reduce((a, c) => a.add(c.quantity), new Prisma.Decimal(0));
        const remaining = line.quantity.sub(already);
        if (qty.gt(remaining)) {
          throw new BadRequestException(
            `Cannot return more than remaining quantity for ${line.product.name} (remaining ${remaining.toString()})`,
          );
        }

        const share = line.quantity.gt(0) ? qty.div(line.quantity) : new Prisma.Decimal(0);
        const lineTotal = money(line.lineTotal.mul(share));
        creditLines.push({
          saleLineId: line.id,
          productId: line.productId,
          quantity: qty,
          unitPrice: line.unitPrice,
          lineTotal,
        });

        // Proportional batch restock from original FEFO allocations.
        const allocs: { stockBatchId: string | null; quantity: Prisma.Decimal }[] = [];
        let left = qty;
        for (const a of line.batchAllocations) {
          if (left.lte(0)) {
            break;
          }
          const take = Prisma.Decimal.min(a.quantity.mul(share), left);
          if (take.gt(0)) {
            allocs.push({ stockBatchId: a.stockBatchId, quantity: take });
            left = left.sub(take);
          }
        }
        if (left.gt(0)) {
          allocs.push({ stockBatchId: null, quantity: left });
        }

        await this.restockQuantity(tx, {
          productId: line.productId,
          quantity: qty,
          locationId: restockLoc.id,
          userId: actor.userId,
          saleId: sale.id,
          saleLineId: line.id,
          notes: input.reason,
          allocations: allocs,
        });
      }

      const refundAmount = money(
        creditLines.reduce((a, l) => a.add(l.lineTotal), new Prisma.Decimal(0)),
      );
      const creditNumber = await this.nextCreditNumber(tx, today);

      if (input.refundMethod === PaymentMethod.STORE_CREDIT) {
        if (!sale.customerId) {
          throw new BadRequestException(
            "Store credit refunds require the sale to have a customer; attach a customer or choose another refund method",
          );
        }
      }

      const creditNote = await tx.creditNote.create({
        data: {
          creditNumber,
          saleId: sale.id,
          kind: "RETURN",
          reason: input.reason.trim(),
          condition: input.condition,
          refundMethod: input.refundMethod,
          refundAmount,
          refundReference: input.refundReference?.trim() || null,
          notes: input.notes?.trim() || null,
          createdByUserId: actor.userId,
          lines: {
            create: creditLines.map((l) => ({
              saleLineId: l.saleLineId,
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              restockLocationId: restockLoc.id,
            })),
          },
        },
      });

      if (input.refundMethod === PaymentMethod.STORE_CREDIT && sale.customerId) {
        await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${sale.customerId} FOR UPDATE`;
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
        if (!customer) {
          throw new BadRequestException("Customer on this sale was not found");
        }
        const storeCreditBalance = money(customer.storeCreditBalance.add(refundAmount));
        await tx.customer.update({
          where: { id: customer.id },
          data: { storeCreditBalance },
        });
        await tx.customerLedgerEntry.create({
          data: {
            customerId: customer.id,
            kind: CustomerLedgerKind.STORE_CREDIT_ISSUE,
            amount: refundAmount,
            balanceAfter: storeCreditBalance,
            saleId: sale.id,
            creditNoteId: creditNote.id,
            notes: `Return ${creditNumber}`,
            createdByUserId: actor.userId,
          },
        });
      }

      // Recompute remaining sellable qty across all lines.
      const allCreditLines = await tx.creditNoteLine.findMany({
        where: { creditNote: { saleId: sale.id } },
      });
      const returnedByLine = new Map<string, Prisma.Decimal>();
      for (const cl of allCreditLines) {
        returnedByLine.set(
          cl.saleLineId,
          (returnedByLine.get(cl.saleLineId) ?? new Prisma.Decimal(0)).add(cl.quantity),
        );
      }
      const fullyReturned = sale.lines.every((l) => {
        const ret = returnedByLine.get(l.id) ?? new Prisma.Decimal(0);
        return ret.gte(l.quantity);
      });

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: fullyReturned ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: "RETURN_SALE",
          entity: "Sale",
          entityId: sale.id,
          metadata: {
            reason: input.reason.trim(),
            condition: input.condition,
            refundAmount: refundAmount.toFixed(2),
            creditNumber,
            ...(approvedByUserId ? { approvedByUserId } : {}),
          },
        },
      });
    });

    return this.getSale(saleId, viewer ?? { userId: actor.userId, includeCost: false, viewAllSales: true });
  }

  // ─── Receipts ───────────────────────────────────────────────────────────────

  async getReceipt(saleId: string, viewer: Viewer) {
    const sale = await this.getSale(saleId, viewer);
    const settings = await this.settings.getAll();
    return {
      shop: {
        name: settings["pos.shopName"],
        address: settings["pos.shopAddress"],
        phone: settings["pos.shopPhone"],
        tin: settings["pos.receiptTin"],
        footer: settings["pos.receiptFooter"],
      },
      labelAsTaxInvoice: settings["pos.labelAsTaxInvoice"] === "true",
      vatRate: settings["pos.vatRate"],
      pricesIncludeVat: settings["pos.pricesIncludeVat"] === "true",
      sale,
      fiscal: {
        status: sale.fiscalStatus,
        registrationNumber: sale.fiscalRegistrationNumber,
        qrPayload: sale.fiscalQrPayload,
      },
      receiptToken: this.signReceiptToken(sale.id),
      text: this.buildReceiptText(sale),
    };
  }

  async getPublicReceipt(token: string) {
    const saleId = this.verifyReceiptToken(token);
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: saleInclude,
    });
    if (!sale) {
      throw new NotFoundException("Receipt not found");
    }
    // Public digital receipt never includes cost/profit.
    const mapped = await this.mapSale(sale, false);
    const settings = await this.settings.getAll();
    return {
      shop: {
        name: settings["pos.shopName"],
        address: settings["pos.shopAddress"],
        phone: settings["pos.shopPhone"],
        tin: settings["pos.receiptTin"],
        footer: settings["pos.receiptFooter"],
      },
      labelAsTaxInvoice: settings["pos.labelAsTaxInvoice"] === "true",
      vatRate: settings["pos.vatRate"],
      pricesIncludeVat: settings["pos.pricesIncludeVat"] === "true",
      sale: mapped,
      fiscal: {
        status: mapped.fiscalStatus,
        registrationNumber: mapped.fiscalRegistrationNumber,
        qrPayload: mapped.fiscalQrPayload,
      },
      text: this.buildReceiptText(mapped),
    };
  }

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

  private async nextSaleNumber(tx: Prisma.TransactionClient, date: string) {
    let rows = await tx.$queryRaw<{ value: number }[]>`
      UPDATE "DocumentCounter" SET "value" = "value" + 1
       WHERE "scope" = 'SALE' AND "date" = ${date}
   RETURNING "value"`;
    if (rows.length === 0) {
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
      where: {
        createdAt: { gte: range.start, lt: range.end },
        status: { not: "VOIDED" },
      },
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
    discountTotal?: string;
    taxTotal?: string;
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
      ...(sale.discountTotal && sale.discountTotal !== "0.00" ? [`Discount: ${sale.discountTotal}`] : []),
      ...(sale.taxTotal ? [`VAT: ${sale.taxTotal}`] : []),
      `Total: ${sale.grandTotal}`,
    ].join("\n");
  }
}
