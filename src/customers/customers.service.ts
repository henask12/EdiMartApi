import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CustomerLedgerKind, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { businessDateString } from "../common/business-time";
import { PrismaService } from "../prisma/prisma.service";
import { StoreSettingsService } from "../settings/store-settings.service";
import { normalizeEthiopianPhone } from "./phone";

const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const money2 = (d: Prisma.Decimal) => money(d).toFixed(2);

const toDecimal = (value: string | number) => {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException("Invalid amount");
  }
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: StoreSettingsService,
  ) {}

  private mapCustomer(c: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    birthday: Date | null;
    notes: string | null;
    tags: string[];
    creditLimit: Prisma.Decimal;
    creditBalance: Prisma.Decimal;
    storeCreditBalance: Prisma.Decimal;
    loyaltyPoints: number;
    loyaltyTier: string | null;
    marketingOptOut: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      birthday: c.birthday,
      notes: c.notes,
      tags: c.tags,
      creditLimit: money2(c.creditLimit),
      creditBalance: money2(c.creditBalance),
      storeCreditBalance: money2(c.storeCreditBalance),
      loyaltyPoints: c.loyaltyPoints,
      loyaltyTier: c.loyaltyTier,
      marketingOptOut: c.marketingOptOut,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  async list(params: { q?: string; activeOnly?: boolean; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.CustomerWhereInput = {};
    if (params.activeOnly !== false) {
      where.isActive = true;
    }
    if (params.q?.trim()) {
      const q = params.q.trim();
      let phoneQ: string | undefined;
      try {
        phoneQ = normalizeEthiopianPhone(q);
      } catch {
        phoneQ = undefined;
      }
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        ...(phoneQ ? [{ phone: phoneQ }] : []),
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items: items.map((c) => this.mapCustomer(c)), total, skip, take };
  }

  async get(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) {
      throw new NotFoundException("Customer not found");
    }
    return this.mapCustomer(c);
  }

  async getProfile(id: string) {
    const c = await this.prisma.customer.findUnique({ where: { id } });
    if (!c) {
      throw new NotFoundException("Customer not found");
    }

    const sales = await this.prisma.sale.findMany({
      where: { customerId: id, status: { not: "VOIDED" } },
      orderBy: { createdAt: "desc" },
      include: {
        lines: { include: { product: { include: { category: true } } } },
      },
    });

    const completed = sales.filter((s) => s.status !== "VOIDED");
    const totalSpend = money(
      completed.reduce((a, s) => a.add(s.grandTotal), new Prisma.Decimal(0)),
    );
    const saleCount = completed.length;
    const averageBasket =
      saleCount > 0 ? money(totalSpend.div(saleCount)) : new Prisma.Decimal(0);
    const lastVisit = completed[0]?.createdAt ?? null;

    const categorySpend = new Map<string, { name: string; total: Prisma.Decimal; qty: Prisma.Decimal }>();
    for (const sale of completed) {
      for (const line of sale.lines) {
        const cat = line.product.category;
        const prev = categorySpend.get(cat.id) ?? {
          name: cat.name,
          total: new Prisma.Decimal(0),
          qty: new Prisma.Decimal(0),
        };
        prev.total = prev.total.add(line.lineTotal);
        prev.qty = prev.qty.add(line.quantity);
        categorySpend.set(cat.id, prev);
      }
    }
    const favouriteCategories = [...categorySpend.entries()]
      .map(([categoryId, v]) => ({
        categoryId,
        name: v.name,
        spend: money2(v.total),
        quantity: v.qty.toString(),
      }))
      .sort((a, b) => Number(b.spend) - Number(a.spend))
      .slice(0, 5);

    const returns = await this.prisma.creditNote.count({
      where: { sale: { customerId: id }, kind: "RETURN" },
    });

    return {
      ...this.mapCustomer(c),
      stats: {
        saleCount,
        returnCount: returns,
        totalSpend: money2(totalSpend),
        averageBasket: money2(averageBasket),
        lastVisit,
        favouriteCategories,
      },
      recentSales: completed.slice(0, 10).map((s) => ({
        id: s.id,
        saleNumber: s.saleNumber,
        status: s.status,
        grandTotal: money2(s.grandTotal),
        createdAt: s.createdAt,
      })),
    };
  }

  async create(
    userId: string,
    data: {
      name: string;
      phone: string;
      email?: string;
      birthday?: string;
      notes?: string;
      tags?: string[];
      creditLimit?: string;
      marketingOptOut?: boolean;
    },
  ) {
    const name = data.name?.trim();
    if (!name) {
      throw new BadRequestException("Name is required");
    }
    const phone = normalizeEthiopianPhone(data.phone);
    const settings = await this.settings.getAll();
    const defaultLimit = toDecimal(settings["customers.defaultCreditLimit"] || "0");
    let creditLimit = defaultLimit;
    if (data.creditLimit !== undefined && data.creditLimit !== null && data.creditLimit !== "") {
      creditLimit = toDecimal(data.creditLimit);
      if (creditLimit.lt(0)) {
        throw new BadRequestException("creditLimit cannot be negative");
      }
    }

    let birthday: Date | null = null;
    if (data.birthday) {
      birthday = new Date(data.birthday);
      if (Number.isNaN(birthday.getTime())) {
        throw new BadRequestException("Invalid birthday");
      }
    }

    try {
      const created = await this.prisma.customer.create({
        data: {
          name,
          phone,
          email: data.email?.trim() || null,
          birthday,
          notes: data.notes?.trim() || null,
          tags: data.tags ?? [],
          creditLimit,
          marketingOptOut: !!data.marketingOptOut,
          createdByUserId: userId,
        },
      });
      await this.audit.log(userId, "CUSTOMER_CREATE", "Customer", created.id, {
        name: created.name,
        phone: created.phone,
      });
      return this.mapCustomer(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BadRequestException("A customer with this phone already exists");
      }
      throw err;
    }
  }

  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      phone?: string;
      email?: string | null;
      birthday?: string | null;
      notes?: string | null;
      tags?: string[];
      marketingOptOut?: boolean;
      isActive?: boolean;
      loyaltyTier?: string | null;
    },
  ) {
    await this.get(id);
    let phone: string | undefined;
    if (data.phone !== undefined) {
      phone = normalizeEthiopianPhone(data.phone);
    }
    let birthday: Date | null | undefined;
    if (data.birthday === null) {
      birthday = null;
    } else if (data.birthday !== undefined) {
      birthday = new Date(data.birthday);
      if (Number.isNaN(birthday.getTime())) {
        throw new BadRequestException("Invalid birthday");
      }
    }

    try {
      const updated = await this.prisma.customer.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
          ...(birthday !== undefined ? { birthday } : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
          ...(data.tags !== undefined ? { tags: data.tags } : {}),
          ...(data.marketingOptOut !== undefined ? { marketingOptOut: data.marketingOptOut } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.loyaltyTier !== undefined ? { loyaltyTier: data.loyaltyTier?.trim() || null } : {}),
        },
      });
      await this.audit.log(userId, "CUSTOMER_UPDATE", "Customer", id, data);
      return this.mapCustomer(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new BadRequestException("A customer with this phone already exists");
      }
      throw err;
    }
  }

  async listOverdue(params: { skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.CustomerWhereInput = {
      creditBalance: { gt: 0 },
      isActive: true,
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { creditBalance: "desc" },
        skip,
        take,
      }),
      this.prisma.customer.count({ where }),
    ]);

    const today = businessDateString();
    const enriched = await Promise.all(
      items.map(async (c) => {
        const lastCredit = await this.prisma.customerLedgerEntry.findFirst({
          where: { customerId: c.id, kind: CustomerLedgerKind.SALE_CREDIT },
          orderBy: { createdAt: "desc" },
        });
        let daysSinceLastCredit: number | null = null;
        if (lastCredit) {
          const creditDay = businessDateString(lastCredit.createdAt);
          const start = new Date(`${creditDay}T12:00:00Z`).getTime();
          const end = new Date(`${today}T12:00:00Z`).getTime();
          daysSinceLastCredit = Math.max(0, Math.round((end - start) / 86_400_000));
        }
        return {
          ...this.mapCustomer(c),
          daysSinceLastCredit,
          lastCreditAt: lastCredit?.createdAt ?? null,
        };
      }),
    );
    return { items: enriched, total, skip, take };
  }

  async repay(
    userId: string,
    id: string,
    data: { amount: string; method?: string; reference?: string; notes?: string },
  ) {
    const amount = money(toDecimal(data.amount));
    if (amount.lte(0)) {
      throw new BadRequestException("Amount must be positive");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) {
        throw new NotFoundException("Customer not found");
      }
      if (amount.gt(customer.creditBalance)) {
        throw new BadRequestException(
          `Repayment cannot exceed credit balance (${money2(customer.creditBalance)})`,
        );
      }
      const creditBalance = money(customer.creditBalance.sub(amount));
      await tx.customer.update({
        where: { id },
        data: { creditBalance },
      });
      const entry = await tx.customerLedgerEntry.create({
        data: {
          customerId: id,
          kind: CustomerLedgerKind.REPAYMENT,
          amount,
          balanceAfter: creditBalance,
          notes:
            [data.method, data.reference, data.notes]
              .filter((x) => x && String(x).trim())
              .map((x) => String(x).trim())
              .join(" · ") || null,
          createdByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "CUSTOMER_REPAY",
          entity: "Customer",
          entityId: id,
          metadata: {
            amount: money2(amount),
            method: data.method ?? null,
            reference: data.reference ?? null,
            creditBalance: money2(creditBalance),
            ledgerEntryId: entry.id,
          },
        },
      });
      return tx.customer.findUniqueOrThrow({ where: { id } });
    });

    return this.mapCustomer(result);
  }

  async setCreditLimit(userId: string, id: string, creditLimitRaw: string) {
    const creditLimit = money(toDecimal(creditLimitRaw));
    if (creditLimit.lt(0)) {
      throw new BadRequestException("creditLimit cannot be negative");
    }
    await this.get(id);
    const updated = await this.prisma.customer.update({
      where: { id },
      data: { creditLimit },
    });
    await this.audit.log(userId, "CUSTOMER_CREDIT_LIMIT", "Customer", id, {
      creditLimit: money2(creditLimit),
    });
    return this.mapCustomer(updated);
  }

  async adjustStoreCredit(userId: string, id: string, data: { amount: string; notes?: string }) {
    const delta = money(toDecimal(data.amount));
    if (delta.eq(0)) {
      throw new BadRequestException("Amount cannot be zero");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${id} FOR UPDATE`;
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) {
        throw new NotFoundException("Customer not found");
      }
      const storeCreditBalance = money(customer.storeCreditBalance.add(delta));
      if (storeCreditBalance.lt(0)) {
        throw new BadRequestException("Store credit balance cannot go negative");
      }
      await tx.customer.update({
        where: { id },
        data: { storeCreditBalance },
      });
      const entry = await tx.customerLedgerEntry.create({
        data: {
          customerId: id,
          kind: CustomerLedgerKind.ADJUSTMENT,
          amount: delta,
          balanceAfter: storeCreditBalance,
          notes: data.notes?.trim() || "Store credit adjustment",
          createdByUserId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "CUSTOMER_STORE_CREDIT_ADJUST",
          entity: "Customer",
          entityId: id,
          metadata: {
            amount: money2(delta),
            storeCreditBalance: money2(storeCreditBalance),
            ledgerEntryId: entry.id,
          },
        },
      });
      return tx.customer.findUniqueOrThrow({ where: { id } });
    });

    return this.mapCustomer(result);
  }

  async ledger(id: string, params: { skip?: number; take?: number }) {
    await this.get(id);
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where = { customerId: id };
    const [items, total] = await Promise.all([
      this.prisma.customerLedgerEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.customerLedgerEntry.count({ where }),
    ]);
    return {
      items: items.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: money2(e.amount),
        balanceAfter: money2(e.balanceAfter),
        saleId: e.saleId,
        creditNoteId: e.creditNoteId,
        notes: e.notes,
        createdAt: e.createdAt,
        createdBy: e.createdBy,
      })),
      total,
      skip,
      take,
    };
  }

  async loyalty(id: string, params: { skip?: number; take?: number }) {
    await this.get(id);
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where = { customerId: id };
    const [items, total] = await Promise.all([
      this.prisma.loyaltyTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.loyaltyTransaction.count({ where }),
    ]);
    return {
      items: items.map((e) => ({
        id: e.id,
        kind: e.kind,
        points: e.points,
        balanceAfter: e.balanceAfter,
        saleId: e.saleId,
        notes: e.notes,
        createdAt: e.createdAt,
        createdBy: e.createdBy,
      })),
      total,
      skip,
      take,
    };
  }

  async statement(id: string) {
    const customer = await this.get(id);
    const ledger = await this.prisma.customerLedgerEntry.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "asc" },
      include: {
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    return {
      generatedAt: new Date().toISOString(),
      customer,
      balances: {
        creditLimit: customer.creditLimit,
        creditBalance: customer.creditBalance,
        storeCreditBalance: customer.storeCreditBalance,
        loyaltyPoints: customer.loyaltyPoints,
      },
      ledger: ledger.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: money2(e.amount),
        balanceAfter: money2(e.balanceAfter),
        saleId: e.saleId,
        creditNoteId: e.creditNoteId,
        notes: e.notes,
        createdAt: e.createdAt,
        createdBy: e.createdBy,
      })),
    };
  }
}
