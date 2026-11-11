import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  CashMovementType,
  NotificationType,
  PaymentMethod,
  PermissionKey,
  Prisma,
  ShiftCountKind,
  ShiftStatus,
} from "@prisma/client";
import { ApprovalsService } from "../approvals/approvals.service";
import { AuditService } from "../audit/audit.service";
import { businessDateString } from "../common/business-time";
import { NotificationsService } from "../notifications/notifications.service";
import { hasPermission } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { StoreSettingsService } from "../settings/store-settings.service";

const SHIFT_SCOPE = "SHIFT";
const DEFAULT_REGISTER_CODE = "REGISTER-1";

const toDecimal = (value: string | number) => {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException("Invalid number");
  }
};

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const shiftInclude = {
  register: true,
  openedBy: { select: { id: true, displayName: true, email: true } },
  closedBy: { select: { id: true, displayName: true, email: true } },
  counts: { orderBy: { createdAt: "asc" as const } },
  cashMovements: { orderBy: { createdAt: "asc" as const } },
} as const;

export type DenominationMap = Record<string, number>;

@Injectable()
export class ShiftsService {
  private readonly logger = new Logger(ShiftsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: StoreSettingsService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
  ) {}

  async ensureDefaultRegister() {
    return this.prisma.register.upsert({
      where: { code: DEFAULT_REGISTER_CODE },
      update: {},
      create: {
        id: "reg_default_phase5",
        code: DEFAULT_REGISTER_CODE,
        name: "Main till",
        storeCode: "DEFAULT_STORE",
        isActive: true,
      },
    });
  }

  async listRegisters(includeInactive = false) {
    await this.ensureDefaultRegister();
    return this.prisma.register.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { code: "asc" },
    });
  }

  async createRegister(
    userId: string,
    input: { code: string; name: string; storeCode?: string; deviceTokenHint?: string },
  ) {
    const code = input.code.trim().toUpperCase();
    if (!code) {
      throw new BadRequestException("Register code is required");
    }
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException("Register name is required");
    }
    try {
      const register = await this.prisma.register.create({
        data: {
          code,
          name,
          storeCode: input.storeCode?.trim() || "DEFAULT_STORE",
          deviceTokenHint: input.deviceTokenHint?.trim() || null,
          createdByUserId: userId,
        },
      });
      await this.audit.log(userId, "CREATE_REGISTER", "Register", register.id, { code });
      return register;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A register with that code already exists");
      }
      throw err;
    }
  }

  async updateRegister(
    userId: string,
    id: string,
    input: {
      name?: string;
      isActive?: boolean;
      deviceTokenHint?: string | null;
      storeCode?: string;
    },
  ) {
    const existing = await this.prisma.register.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Register not found");
    }
    const register = await this.prisma.register.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.storeCode !== undefined ? { storeCode: input.storeCode.trim() } : {}),
        ...(input.deviceTokenHint !== undefined
          ? { deviceTokenHint: input.deviceTokenHint?.trim() || null }
          : {}),
      },
    });
    await this.audit.log(userId, "UPDATE_REGISTER", "Register", id, input as Record<string, unknown>);
    return register;
  }

  async listShifts(
    actor: Actor,
    params: {
      status?: ShiftStatus;
      from?: string;
      to?: string;
      registerId?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const viewAll = hasPermission(actor, PermissionKey.SHIFT_VIEW_ALL);
    const where: Prisma.ShiftWhereInput = {};
    if (!viewAll) {
      where.openedByUserId = actor.userId;
    }
    if (params.status) {
      where.status = params.status;
    }
    if (params.registerId) {
      where.registerId = params.registerId;
    }
    if (params.from || params.to) {
      where.openedAt = {};
      if (params.from) {
        where.openedAt.gte = new Date(params.from);
      }
      if (params.to) {
        where.openedAt.lte = new Date(params.to);
      }
    }
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.shift.findMany({
        where,
        include: {
          register: true,
          openedBy: { select: { id: true, displayName: true, email: true } },
          closedBy: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { openedAt: "desc" },
        skip,
        take,
      }),
      this.prisma.shift.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async getCurrentShift(actor: Actor, registerId?: string) {
    const where: Prisma.ShiftWhereInput = {
      status: ShiftStatus.OPEN,
      openedByUserId: actor.userId,
    };
    if (registerId) {
      where.registerId = registerId;
    }
    return this.prisma.shift.findFirst({
      where,
      include: shiftInclude,
      orderBy: { openedAt: "desc" },
    });
  }

  async getShift(actor: Actor, id: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: shiftInclude,
    });
    if (!shift) {
      throw new NotFoundException("Shift not found");
    }
    this.assertCanView(actor, shift.openedByUserId);
    return shift;
  }

  async openShift(
    actor: Actor,
    input: { registerId?: string; denominations: DenominationMap; notes?: string },
  ) {
    if (!hasPermission(actor, PermissionKey.SHIFT_MANAGE)) {
      throw new ForbiddenException("You need permission to open a shift");
    }
    await this.ensureDefaultRegister();
    let registerId = input.registerId?.trim();
    if (!registerId) {
      const def = await this.prisma.register.findUnique({ where: { code: DEFAULT_REGISTER_CODE } });
      if (!def) {
        throw new NotFoundException("Default register not found");
      }
      registerId = def.id;
    }
    const register = await this.prisma.register.findUnique({ where: { id: registerId } });
    if (!register || !register.isActive) {
      throw new NotFoundException("Register not found or inactive");
    }

    const existingOpen = await this.prisma.shift.findFirst({
      where: { registerId, status: ShiftStatus.OPEN },
    });
    if (existingOpen) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "SHIFT_ALREADY_OPEN",
        message: "This register already has an open shift",
        shiftId: existingOpen.id,
      });
    }

    const { total: openingFloat, denominations } = await this.totalFromDenominations(input.denominations);
    const shiftNumber = await this.nextShiftNumber();

    const shift = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shift.create({
        data: {
          shiftNumber,
          status: ShiftStatus.OPEN,
          registerId,
          openedByUserId: actor.userId,
          openingFloat,
          notes: input.notes?.trim() || null,
          counts: {
            create: {
              kind: ShiftCountKind.OPENING,
              denominations,
              total: openingFloat,
            },
          },
        },
        include: shiftInclude,
      });
      await this.audit.log(actor.userId, "OPEN_SHIFT", "Shift", created.id, {
        shiftNumber,
        registerId,
        openingFloat: openingFloat.toString(),
      });
      return created;
    });

    return shift;
  }

  async cashIn(
    actor: Actor,
    shiftId: string,
    input: { amount: string | number; reason: string },
  ) {
    return this.addCashMovement(actor, shiftId, CashMovementType.CASH_IN, input);
  }

  async cashOut(
    actor: Actor,
    shiftId: string,
    input: { amount: string | number; reason: string },
  ) {
    return this.addCashMovement(actor, shiftId, CashMovementType.CASH_OUT, input);
  }

  async noSale(
    actor: Actor,
    shiftId: string,
    input: { reason?: string },
    approvalToken?: string,
  ) {
    const shift = await this.requireOpenShiftAccess(actor, shiftId);
    const canOpen = hasPermission(actor, PermissionKey.CASH_DRAWER_OPEN);
    if (!canOpen) {
      if (!approvalToken) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "Forbidden",
          code: "APPROVAL_REQUIRED",
          action: "NO_SALE_DRAWER_OPEN",
          message: "A manager must approve opening the cash drawer without a sale",
        });
      }
      await this.prisma.$transaction(async (tx) => {
        await this.approvals.consume(tx, approvalToken, "NO_SALE_DRAWER_OPEN", actor.userId);
      });
    }

    // No hardware kick — log only.
    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        type: CashMovementType.NO_SALE_OPEN,
        amount: new Prisma.Decimal(0),
        reason: input.reason?.trim() || "NO_SALE_OPEN",
        createdByUserId: actor.userId,
      },
    });
    await this.audit.log(actor.userId, "NO_SALE_OPEN", "Shift", shift.id, {
      cashMovementId: movement.id,
      reason: movement.reason,
    });
    this.logger.log(`NO_SALE_OPEN shift=${shift.id} (no hardware drawer kick)`);
    return movement;
  }

  async closeShift(
    actor: Actor,
    shiftId: string,
    input: { denominations: DenominationMap; notes?: string; approvalToken?: string },
  ) {
    const shift = await this.requireOpenShiftAccess(actor, shiftId);
    const { total: countedCash, denominations } = await this.totalFromDenominations(input.denominations);

    // Blind count: compute expected only after accepting the count (do not reveal beforehand).
    const expectedCash = await this.computeExpectedCash(shift.id, shift.openingFloat);
    const variance = money(countedCash.sub(expectedCash));
    const threshold = await this.settings.getPosNumber("shifts.varianceApprovalThreshold", "100");
    const absVariance = variance.abs();
    const overLimit = absVariance.gt(threshold);
    const canApproveOwn = hasPermission(actor, PermissionKey.SHIFT_VIEW_ALL);

    let varianceApprovedByUserId: string | null = null;
    if (overLimit && !canApproveOwn) {
      if (!input.approvalToken) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "Forbidden",
          code: "APPROVAL_REQUIRED",
          action: "SHIFT_VARIANCE_OVER_LIMIT",
          message: `Cash variance ${variance.toFixed(2)} exceeds the limit of ${threshold.toFixed(2)} Birr`,
          variance: variance.toFixed(2),
          threshold: threshold.toFixed(2),
          // Blind: still do not reveal expected until approved close completes.
        });
      }
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      if (overLimit && !canApproveOwn && input.approvalToken) {
        const { approverId } = await this.approvals.consume(
          tx,
          input.approvalToken,
          "SHIFT_VARIANCE_OVER_LIMIT",
          actor.userId,
        );
        varianceApprovedByUserId = approverId;
      } else if (overLimit && canApproveOwn) {
        varianceApprovedByUserId = actor.userId;
      }

      const stillOpen = await tx.shift.findFirst({
        where: { id: shift.id, status: ShiftStatus.OPEN },
      });
      if (!stillOpen) {
        throw new ConflictException("This shift is already closed");
      }

      await tx.shiftCount.create({
        data: {
          shiftId: shift.id,
          kind: ShiftCountKind.CLOSING,
          denominations,
          total: countedCash,
        },
      });

      return tx.shift.update({
        where: { id: shift.id },
        data: {
          status: ShiftStatus.CLOSED,
          closedAt: new Date(),
          closedByUserId: actor.userId,
          countedCash,
          expectedCash,
          variance,
          varianceApprovedByUserId,
          notes: input.notes?.trim() || shift.notes,
        },
        include: shiftInclude,
      });
    });

    await this.audit.log(actor.userId, "CLOSE_SHIFT", "Shift", shift.id, {
      countedCash: countedCash.toString(),
      expectedCash: expectedCash.toString(),
      variance: variance.toString(),
      varianceApprovedByUserId,
    });

    void this.sendEodBestEffort(closed).catch((err) =>
      this.logger.error(`EOD summary failed for ${shift.id}: ${String(err)}`),
    );

    return closed;
  }

  async xReport(actor: Actor, shiftId: string) {
    const shift = await this.getShift(actor, shiftId);
    const snapshot = await this.buildReportSnapshot(shift.id, shift.openingFloat);
    return {
      kind: "X",
      shift: {
        id: shift.id,
        shiftNumber: shift.shiftNumber,
        status: shift.status,
        register: shift.register,
        openedAt: shift.openedAt,
        openedBy: shift.openedBy,
      },
      ...snapshot,
      printable: true,
    };
  }

  async zReport(actor: Actor, shiftId: string) {
    const shift = await this.getShift(actor, shiftId);
    if (shift.status !== ShiftStatus.CLOSED) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "SHIFT_STILL_OPEN",
        message: "Z-report is only available after the shift is closed",
      });
    }
    const snapshot = await this.buildReportSnapshot(shift.id, shift.openingFloat);
    return {
      kind: "Z",
      shift: {
        id: shift.id,
        shiftNumber: shift.shiftNumber,
        status: shift.status,
        register: shift.register,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        openedBy: shift.openedBy,
        closedBy: shift.closedBy,
      },
      ...snapshot,
      countedCash: shift.countedCash,
      expectedCash: shift.expectedCash,
      variance: shift.variance,
      printable: true,
    };
  }

  /**
   * Resolve the open shift to attach to a sale when `shifts.requireOpenShift` is on.
   * Prefers `x-register-id` when provided; otherwise any open shift opened by the actor.
   */
  async resolveShiftForCheckout(actor: Actor, registerId?: string): Promise<string | null> {
    const all = await this.settings.getAll();
    const required = (all["shifts.requireOpenShift"] || "false").toLowerCase() === "true";
    if (!required) {
      // Still attach an open shift when one exists, without blocking.
      const optional = await this.findOpenShiftForActor(actor.userId, registerId);
      return optional?.id ?? null;
    }
    const open = await this.findOpenShiftForActor(actor.userId, registerId);
    if (!open) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "SHIFT_REQUIRED",
        message: "Open a shift before selling",
      });
    }
    return open.id;
  }

  private async findOpenShiftForActor(userId: string, registerId?: string) {
    const where: Prisma.ShiftWhereInput = {
      status: ShiftStatus.OPEN,
      openedByUserId: userId,
    };
    if (registerId) {
      where.registerId = registerId;
    }
    return this.prisma.shift.findFirst({
      where,
      orderBy: { openedAt: "desc" },
    });
  }

  private assertCanView(actor: Actor, openedByUserId: string) {
    if (openedByUserId === actor.userId) {
      return;
    }
    if (!hasPermission(actor, PermissionKey.SHIFT_VIEW_ALL)) {
      throw new ForbiddenException("You can only view your own shifts");
    }
  }

  private async requireOpenShiftAccess(actor: Actor, shiftId: string) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { register: true },
    });
    if (!shift) {
      throw new NotFoundException("Shift not found");
    }
    if (shift.status !== ShiftStatus.OPEN) {
      throw new ConflictException("This shift is closed");
    }
    if (
      shift.openedByUserId !== actor.userId &&
      !hasPermission(actor, PermissionKey.SHIFT_VIEW_ALL)
    ) {
      throw new ForbiddenException("You can only manage your own open shift");
    }
    return shift;
  }

  private async addCashMovement(
    actor: Actor,
    shiftId: string,
    type: typeof CashMovementType.CASH_IN | typeof CashMovementType.CASH_OUT,
    input: { amount: string | number; reason: string },
  ) {
    const shift = await this.requireOpenShiftAccess(actor, shiftId);
    if (!hasPermission(actor, PermissionKey.SHIFT_MANAGE)) {
      throw new ForbiddenException("You need permission to record cash movements");
    }
    const amount = money(toDecimal(input.amount));
    if (amount.lte(0)) {
      throw new BadRequestException("Amount must be positive");
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException("Reason is required");
    }
    const movement = await this.prisma.cashMovement.create({
      data: {
        shiftId: shift.id,
        type,
        amount,
        reason,
        createdByUserId: actor.userId,
      },
    });
    await this.audit.log(actor.userId, type, "CashMovement", movement.id, {
      shiftId: shift.id,
      amount: amount.toString(),
      reason,
    });
    return movement;
  }

  private async totalFromDenominations(raw: DenominationMap | undefined) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("denominations must be an object of denomination → quantity");
    }
    const settings = await this.settings.getAll();
    const defaultAllowed = [1, 5, 10, 50, 100, 200];
    const legacyAllowed = [50, 100, 200, 500, 1000];
    let allowed: number[] = defaultAllowed;
    try {
      const parsed = JSON.parse(settings["pos.cashDenominations"] || "[]");
      if (Array.isArray(parsed) && parsed.length) {
        const next = parsed
          .map((n: unknown) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0);
        const isLegacy =
          next.length === legacyAllowed.length &&
          next.every((n, i) => n === legacyAllowed[i]);
        allowed = isLegacy || next.length === 0 ? defaultAllowed : next;
      }
    } catch {
      /* keep defaults */
    }
    const allowedSet = new Set(allowed.map(String));
    const denominations: Record<string, number> = {};
    let total = new Prisma.Decimal(0);
    for (const [key, qtyRaw] of Object.entries(raw)) {
      if (!allowedSet.has(String(key))) {
        throw new BadRequestException(`Unknown denomination: ${key}`);
      }
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
        throw new BadRequestException(`Quantity for ${key} must be a non-negative integer`);
      }
      denominations[String(key)] = qty;
      total = total.add(new Prisma.Decimal(key).mul(qty));
    }
    return { total: money(total), denominations };
  }

  private async nextShiftNumber(): Promise<string> {
    const date = businessDateString();
    const rows = await this.prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO "DocumentCounter" ("scope", "date", "value") VALUES (${SHIFT_SCOPE}, ${date}, 1)
      ON CONFLICT ("scope", "date") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
      RETURNING "value"`;
    return `SHF-${date.replace(/-/g, "")}-${String(rows[0].value).padStart(4, "0")}`;
  }

  /**
   * expectedCash = openingFloat + cash sales (non-voided) + cash_in − cash_out − cash refunds.
   */
  async computeExpectedCash(shiftId: string, openingFloat: Prisma.Decimal): Promise<Prisma.Decimal> {
    const cashSales = await this.prisma.paymentAllocation.aggregate({
      where: {
        method: PaymentMethod.CASH,
        sale: { shiftId, status: { not: "VOIDED" } },
      },
      _sum: { amount: true },
    });
    const cashIn = await this.prisma.cashMovement.aggregate({
      where: { shiftId, type: CashMovementType.CASH_IN },
      _sum: { amount: true },
    });
    const cashOut = await this.prisma.cashMovement.aggregate({
      where: { shiftId, type: CashMovementType.CASH_OUT },
      _sum: { amount: true },
    });
    const cashRefunds = await this.prisma.creditNote.aggregate({
      where: {
        refundMethod: PaymentMethod.CASH,
        sale: { shiftId },
        kind: { in: ["RETURN", "VOID"] },
      },
      _sum: { refundAmount: true },
    });

    const salesCash = cashSales._sum.amount ?? new Prisma.Decimal(0);
    const inAmt = cashIn._sum.amount ?? new Prisma.Decimal(0);
    const outAmt = cashOut._sum.amount ?? new Prisma.Decimal(0);
    const refunds = cashRefunds._sum.refundAmount ?? new Prisma.Decimal(0);

    return money(openingFloat.add(salesCash).add(inAmt).sub(outAmt).sub(refunds));
  }

  private async buildReportSnapshot(shiftId: string, openingFloat: Prisma.Decimal) {
    const sales = await this.prisma.sale.findMany({
      where: { shiftId },
      include: { payments: true, creditNotes: true },
    });
    const byMethod: Record<string, Prisma.Decimal> = {};
    let voids = 0;
    let voidTotal = new Prisma.Decimal(0);
    let refundTotal = new Prisma.Decimal(0);
    let discountTotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    let salesTotal = new Prisma.Decimal(0);
    let completedCount = 0;

    for (const sale of sales) {
      if (sale.status === "VOIDED") {
        voids += 1;
        voidTotal = voidTotal.add(sale.grandTotal);
        continue;
      }
      completedCount += 1;
      salesTotal = salesTotal.add(sale.grandTotal);
      discountTotal = discountTotal.add(sale.discountTotal);
      taxTotal = taxTotal.add(sale.taxTotal);
      for (const p of sale.payments) {
        const key = p.method;
        byMethod[key] = (byMethod[key] ?? new Prisma.Decimal(0)).add(p.amount);
      }
      for (const cn of sale.creditNotes) {
        if (cn.kind === "RETURN") {
          refundTotal = refundTotal.add(cn.refundAmount);
        }
      }
    }

    const movements = await this.prisma.cashMovement.findMany({
      where: { shiftId },
      orderBy: { createdAt: "asc" },
    });
    const cashIn = movements
      .filter((m) => m.type === CashMovementType.CASH_IN)
      .reduce((a, m) => a.add(m.amount), new Prisma.Decimal(0));
    const cashOut = movements
      .filter((m) => m.type === CashMovementType.CASH_OUT)
      .reduce((a, m) => a.add(m.amount), new Prisma.Decimal(0));
    const noSaleOpens = movements.filter((m) => m.type === CashMovementType.NO_SALE_OPEN).length;

    const expectedCash = await this.computeExpectedCash(shiftId, openingFloat);

    return {
      sales: {
        count: completedCount,
        total: money(salesTotal),
        byMethod: Object.fromEntries(
          Object.entries(byMethod).map(([k, v]) => [k, money(v).toFixed(2)]),
        ),
        discountTotal: money(discountTotal),
        taxTotal: money(taxTotal),
        voids: { count: voids, total: money(voidTotal) },
        refunds: { total: money(refundTotal) },
      },
      cashMovements: {
        cashIn: money(cashIn),
        cashOut: money(cashOut),
        noSaleOpens,
        items: movements,
      },
      openingFloat: money(openingFloat),
      expectedCash,
    };
  }

  private async sendEodBestEffort(
    shift: {
      id: string;
      shiftNumber: string;
      countedCash: Prisma.Decimal | null;
      expectedCash: Prisma.Decimal | null;
      variance: Prisma.Decimal | null;
      openedAt: Date;
      closedAt: Date | null;
      register: { code: string; name: string };
      openedBy: { displayName: string | null; email: string };
    },
  ) {
    const all = await this.settings.getAll();
    if ((all["shifts.eodEmailEnabled"] || "true").toLowerCase() !== "true") {
      return;
    }
    const subject = `EOD shift ${shift.shiftNumber} (${shift.register.code})`;
    const html = `<h2>End of day — ${shift.shiftNumber}</h2>
      <p>Register: ${shift.register.name} (${shift.register.code})</p>
      <p>Cashier: ${shift.openedBy.displayName ?? shift.openedBy.email}</p>
      <p>Opened: ${shift.openedAt.toISOString()}</p>
      <p>Closed: ${shift.closedAt?.toISOString() ?? "—"}</p>
      <p>Counted: ${shift.countedCash?.toFixed(2) ?? "—"}</p>
      <p>Expected: ${shift.expectedCash?.toFixed(2) ?? "—"}</p>
      <p>Variance: ${shift.variance?.toFixed(2) ?? "—"}</p>`;
    await this.notifications.sendTypedMail(subject, html, NotificationType.SHIFT_EOD, {
      shiftId: shift.id,
    });
    this.logger.log(`Telegram EOD stub (no-op): ${shift.shiftNumber}`);
  }
}
