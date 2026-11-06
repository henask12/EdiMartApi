import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PromotionTarget, PromotionType } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { BUSINESS_TZ } from "../common/business-time";
import { PrismaService } from "../prisma/prisma.service";

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const money2 = (d: Prisma.Decimal) => money(d).toFixed(2);

const toDecimal = (value: string | number) => {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException("Invalid amount");
  }
};

export type EvaluateLine = {
  productId: string;
  categoryId?: string | null;
  lineTotal: string | Prisma.Decimal;
};

export type EvaluateInput = {
  lines: EvaluateLine[];
  subtotal: string | Prisma.Decimal;
  couponCode?: string | null;
  customerId?: string | null;
  promotionIds?: string[] | null;
  now?: Date | string | null;
};

export type AppliedPromotion = {
  promotionId: string;
  name: string;
  code: string | null;
  type: PromotionType;
  priority: number;
  stackable: boolean;
  discountAmount: string;
};

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private mapPromo(p: {
    id: string;
    name: string;
    code: string | null;
    type: PromotionType;
    value: Prisma.Decimal;
    minSpend: Prisma.Decimal | null;
    target: PromotionTarget;
    productId: string | null;
    categoryId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    daysOfWeek: number[];
    startHour: number | null;
    endHour: number | null;
    priority: number;
    stackable: boolean;
    maxUses: number | null;
    maxUsesPerCustomer: number | null;
    usageCount: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      value: money2(p.value),
      minSpend: p.minSpend ? money2(p.minSpend) : null,
      target: p.target,
      productId: p.productId,
      categoryId: p.categoryId,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      daysOfWeek: p.daysOfWeek,
      startHour: p.startHour,
      endHour: p.endHour,
      priority: p.priority,
      stackable: p.stackable,
      maxUses: p.maxUses,
      maxUsesPerCustomer: p.maxUsesPerCustomer,
      usageCount: p.usageCount,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private businessParts(at: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TZ,
      weekday: "short",
      hour: "numeric",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(at);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourRaw = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return { dayOfWeek: weekdayMap[weekday] ?? at.getUTCDay(), hour: hourRaw % 24 };
  }

  private inWindow(
    p: {
      startsAt: Date | null;
      endsAt: Date | null;
      daysOfWeek: number[];
      startHour: number | null;
      endHour: number | null;
    },
    now: Date,
  ) {
    if (p.startsAt && now < p.startsAt) return false;
    if (p.endsAt && now > p.endsAt) return false;
    const { dayOfWeek, hour } = this.businessParts(now);
    if (p.daysOfWeek.length > 0 && !p.daysOfWeek.includes(dayOfWeek)) return false;
    if (p.startHour != null && hour < p.startHour) return false;
    if (p.endHour != null && hour >= p.endHour) return false;
    return true;
  }

  private eligibleBase(
    lines: Array<{ productId: string; categoryId?: string | null; lineTotal: Prisma.Decimal }>,
    p: { target: PromotionTarget; productId: string | null; categoryId: string | null },
  ) {
    if (p.target === PromotionTarget.ALL) {
      return money(lines.reduce((a, l) => a.add(l.lineTotal), new Prisma.Decimal(0)));
    }
    if (p.target === PromotionTarget.PRODUCT) {
      return money(
        lines
          .filter((l) => l.productId === p.productId)
          .reduce((a, l) => a.add(l.lineTotal), new Prisma.Decimal(0)),
      );
    }
    return money(
      lines
        .filter((l) => l.categoryId && l.categoryId === p.categoryId)
        .reduce((a, l) => a.add(l.lineTotal), new Prisma.Decimal(0)),
    );
  }

  private computeDiscount(
    p: {
      type: PromotionType;
      value: Prisma.Decimal;
      minSpend: Prisma.Decimal | null;
      target: PromotionTarget;
      productId: string | null;
      categoryId: string | null;
    },
    lines: Array<{ productId: string; categoryId?: string | null; lineTotal: Prisma.Decimal }>,
    cartSubtotal: Prisma.Decimal,
  ): Prisma.Decimal {
    if (p.minSpend && cartSubtotal.lt(p.minSpend)) {
      return new Prisma.Decimal(0);
    }
    const base = this.eligibleBase(lines, p);
    if (base.lte(0)) {
      return new Prisma.Decimal(0);
    }

    switch (p.type) {
      case PromotionType.PERCENT_OFF:
      case PromotionType.MIN_SPEND_PERCENT: {
        if (p.type === PromotionType.MIN_SPEND_PERCENT && (!p.minSpend || cartSubtotal.lt(p.minSpend))) {
          return new Prisma.Decimal(0);
        }
        return money(Prisma.Decimal.min(base.mul(p.value).div(100), base));
      }
      case PromotionType.FIXED_OFF:
      case PromotionType.MIN_SPEND_FIXED: {
        if (p.type === PromotionType.MIN_SPEND_FIXED && (!p.minSpend || cartSubtotal.lt(p.minSpend))) {
          return new Prisma.Decimal(0);
        }
        return money(Prisma.Decimal.min(p.value, base));
      }
      default:
        return new Prisma.Decimal(0);
    }
  }

  async list(params: { activeOnly?: boolean; skip?: number; take?: number; q?: string }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.PromotionWhereInput = {};
    if (params.activeOnly !== false) {
      where.isActive = true;
    }
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.promotion.findMany({ where, orderBy: [{ priority: "desc" }, { name: "asc" }], skip, take }),
      this.prisma.promotion.count({ where }),
    ]);
    return { items: items.map((p) => this.mapPromo(p)), total, skip, take };
  }

  async get(id: string) {
    const p = await this.prisma.promotion.findUnique({ where: { id } });
    if (!p) {
      throw new NotFoundException("Promotion not found");
    }
    return this.mapPromo(p);
  }

  async create(
    userId: string,
    data: {
      name: string;
      code?: string;
      type: PromotionType;
      value: string;
      minSpend?: string;
      target?: PromotionTarget;
      productId?: string;
      categoryId?: string;
      startsAt?: string;
      endsAt?: string;
      daysOfWeek?: number[];
      startHour?: number;
      endHour?: number;
      priority?: number;
      stackable?: boolean;
      maxUses?: number;
      maxUsesPerCustomer?: number;
      isActive?: boolean;
    },
  ) {
    const name = data.name?.trim();
    if (!name) {
      throw new BadRequestException("Name is required");
    }
    const value = money(toDecimal(data.value));
    if (value.lt(0)) {
      throw new BadRequestException("value cannot be negative");
    }
    const target = data.target ?? PromotionTarget.ALL;
    if (target === PromotionTarget.PRODUCT && !data.productId) {
      throw new BadRequestException("productId is required for PRODUCT target");
    }
    if (target === PromotionTarget.CATEGORY && !data.categoryId) {
      throw new BadRequestException("categoryId is required for CATEGORY target");
    }
    const minSpend =
      data.minSpend !== undefined && data.minSpend !== null && data.minSpend !== ""
        ? money(toDecimal(data.minSpend))
        : null;
    if (minSpend && minSpend.lt(0)) {
      throw new BadRequestException("minSpend cannot be negative");
    }
    const code = data.code?.trim() ? data.code.trim().toUpperCase() : null;

    try {
      const created = await this.prisma.promotion.create({
        data: {
          name,
          code,
          type: data.type,
          value,
          minSpend,
          target,
          productId: target === PromotionTarget.PRODUCT ? data.productId! : null,
          categoryId: target === PromotionTarget.CATEGORY ? data.categoryId! : null,
          startsAt: data.startsAt ? new Date(data.startsAt) : null,
          endsAt: data.endsAt ? new Date(data.endsAt) : null,
          daysOfWeek: data.daysOfWeek ?? [],
          startHour: data.startHour ?? null,
          endHour: data.endHour ?? null,
          priority: data.priority ?? 0,
          stackable: data.stackable ?? false,
          maxUses: data.maxUses ?? null,
          maxUsesPerCustomer: data.maxUsesPerCustomer ?? null,
          isActive: data.isActive ?? true,
          createdByUserId: userId,
        },
      });
      await this.audit.log(userId, "PROMOTION_CREATE", "Promotion", created.id, { name, code });
      return this.mapPromo(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BadRequestException("A promotion with this code already exists");
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      code?: string | null;
      type?: PromotionType;
      value?: string;
      minSpend?: string | null;
      target?: PromotionTarget;
      productId?: string | null;
      categoryId?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
      daysOfWeek?: number[];
      startHour?: number | null;
      endHour?: number | null;
      priority?: number;
      stackable?: boolean;
      maxUses?: number | null;
      maxUsesPerCustomer?: number | null;
      isActive?: boolean;
    },
  ) {
    await this.get(id);
    let value: Prisma.Decimal | undefined;
    if (data.value !== undefined) {
      value = money(toDecimal(data.value));
      if (value.lt(0)) {
        throw new BadRequestException("value cannot be negative");
      }
    }
    let minSpend: Prisma.Decimal | null | undefined;
    if (data.minSpend === null) {
      minSpend = null;
    } else if (data.minSpend !== undefined) {
      minSpend = money(toDecimal(data.minSpend));
      if (minSpend.lt(0)) {
        throw new BadRequestException("minSpend cannot be negative");
      }
    }
    let code: string | null | undefined;
    if (data.code === null) {
      code = null;
    } else if (data.code !== undefined) {
      code = data.code.trim() ? data.code.trim().toUpperCase() : null;
    }

    try {
      const updated = await this.prisma.promotion.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(value !== undefined ? { value } : {}),
          ...(minSpend !== undefined ? { minSpend } : {}),
          ...(data.target !== undefined ? { target: data.target } : {}),
          ...(data.productId !== undefined ? { productId: data.productId } : {}),
          ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
          ...(data.startsAt !== undefined
            ? { startsAt: data.startsAt ? new Date(data.startsAt) : null }
            : {}),
          ...(data.endsAt !== undefined
            ? { endsAt: data.endsAt ? new Date(data.endsAt) : null }
            : {}),
          ...(data.daysOfWeek !== undefined ? { daysOfWeek: data.daysOfWeek } : {}),
          ...(data.startHour !== undefined ? { startHour: data.startHour } : {}),
          ...(data.endHour !== undefined ? { endHour: data.endHour } : {}),
          ...(data.priority !== undefined ? { priority: data.priority } : {}),
          ...(data.stackable !== undefined ? { stackable: data.stackable } : {}),
          ...(data.maxUses !== undefined ? { maxUses: data.maxUses } : {}),
          ...(data.maxUsesPerCustomer !== undefined
            ? { maxUsesPerCustomer: data.maxUsesPerCustomer }
            : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
      await this.audit.log(userId, "PROMOTION_UPDATE", "Promotion", id, data);
      return this.mapPromo(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BadRequestException("A promotion with this code already exists");
      }
      throw err;
    }
  }

  async usage(id: string, params: { skip?: number; take?: number }) {
    await this.get(id);
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where = { promotionId: id };
    const [items, total] = await Promise.all([
      this.prisma.promotionUsage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          sale: { select: { id: true, saleNumber: true, createdAt: true } },
          customer: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.promotionUsage.count({ where }),
    ]);
    return {
      items: items.map((u) => ({
        id: u.id,
        discountAmount: money2(u.discountAmount),
        createdAt: u.createdAt,
        sale: u.sale,
        customer: u.customer,
      })),
      total,
      skip,
      take,
    };
  }

  /**
   * Pick applicable promotions: highest-priority exclusive (non-stackable) OR any number of
   * stackable promos (priority desc), plus a matching coupon when provided.
   */
  async evaluate(input: EvaluateInput, db: Db = this.prisma): Promise<{
    promotions: AppliedPromotion[];
    totalDiscount: string;
  }> {
    const now =
      input.now instanceof Date
        ? input.now
        : input.now
          ? new Date(input.now)
          : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException("Invalid now timestamp");
    }

    const lines = (input.lines ?? []).map((l) => ({
      productId: l.productId,
      categoryId: l.categoryId ?? null,
      lineTotal: money(toDecimal(l.lineTotal as string)),
    }));
    const subtotal = money(toDecimal(input.subtotal as string));
    if (!lines.length) {
      return { promotions: [], totalDiscount: "0.00" };
    }

    const couponCode = input.couponCode?.trim()
      ? input.couponCode.trim().toUpperCase()
      : null;
    const explicitIds = input.promotionIds?.filter(Boolean) ?? [];

    const candidates = await db.promotion.findMany({
      where: {
        isActive: true,
        ...(explicitIds.length ? { id: { in: explicitIds } } : {}),
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    type Cand = (typeof candidates)[number] & { discount: Prisma.Decimal };
    const applicable: Cand[] = [];

    for (const p of candidates) {
      if (!this.inWindow(p, now)) continue;
      if (p.maxUses != null && p.usageCount >= p.maxUses) continue;
      if (p.maxUsesPerCustomer != null && input.customerId) {
        const used = await db.promotionUsage.count({
          where: { promotionId: p.id, customerId: input.customerId },
        });
        if (used >= p.maxUsesPerCustomer) continue;
      }
      if (p.code && couponCode && p.code.toUpperCase() !== couponCode) {
        // coupon promos only apply when the code matches; auto-evaluate skips coded promos unless explicit
        if (!explicitIds.includes(p.id)) continue;
      }
      if (p.code && !couponCode && !explicitIds.includes(p.id)) {
        continue;
      }
      const discount = this.computeDiscount(p, lines, subtotal);
      if (discount.lte(0)) continue;
      applicable.push({ ...p, discount });
    }

    if (couponCode) {
      const coupon = candidates.find((p) => p.code?.toUpperCase() === couponCode);
      if (!coupon) {
        throw new BadRequestException("Coupon code is not valid");
      }
      if (!applicable.some((a) => a.id === coupon.id)) {
        throw new BadRequestException("Coupon code is not applicable to this cart");
      }
    }

    // Priority desc; coupon first when present. Non-stackable cannot combine with anything else.
    const ordered = [...applicable].sort((a, b) => {
      if (couponCode) {
        const ac = a.code?.toUpperCase() === couponCode ? 1 : 0;
        const bc = b.code?.toUpperCase() === couponCode ? 1 : 0;
        if (ac !== bc) return bc - ac;
      }
      return b.priority - a.priority || b.discount.cmp(a.discount);
    });

    const chosen: Cand[] = [];
    let remaining = subtotal;
    for (const cand of ordered) {
      if (chosen.some((c) => c.id === cand.id)) continue;
      if (chosen.some((c) => !c.stackable)) break;
      if (chosen.length > 0 && !cand.stackable) continue;
      if (chosen.length > 0 && !chosen.every((c) => c.stackable)) continue;
      const take = money(Prisma.Decimal.min(cand.discount, remaining));
      if (take.lte(0)) continue;
      chosen.push({ ...cand, discount: take });
      remaining = money(remaining.sub(take));
      if (!cand.stackable) break;
    }

    const promotions: AppliedPromotion[] = chosen.map((c) => ({
      promotionId: c.id,
      name: c.name,
      code: c.code,
      type: c.type,
      priority: c.priority,
      stackable: c.stackable,
      discountAmount: money2(c.discount),
    }));
    const totalDiscount = money(
      promotions.reduce((a, p) => a.add(new Prisma.Decimal(p.discountAmount)), new Prisma.Decimal(0)),
    );
    return { promotions, totalDiscount: money2(totalDiscount) };
  }
}
