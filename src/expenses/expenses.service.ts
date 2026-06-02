import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { buildCreatedAtRange } from "../common/date-range.util";
import { PrismaService } from "../prisma/prisma.service";

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: { skip?: number; take?: number; from?: string; to?: string }) {
    const take = Math.min(params.take ?? 20, 100);
    const skip = params.skip ?? 0;
    const where: Prisma.ExpenseWhereInput = {};
    const expenseDate = buildCreatedAtRange(params.from, params.to);
    if (expenseDate) {
      where.expenseDate = expenseDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take,
        orderBy: { expenseDate: "desc" },
        include: {
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        amount: item.amount.toFixed(2),
      })),
      total,
      skip,
      take,
    };
  }

  async create(
    userId: string,
    data: {
      detail: string;
      amount: string;
      expenseDate: string;
    },
  ) {
    const amount = toDecimal(data.amount);
    if (amount.lte(0)) {
      throw new BadRequestException("Amount must be greater than zero");
    }
    const detail = data.detail.trim();
    if (!detail) {
      throw new BadRequestException("Detail is required");
    }
    const expenseDate = new Date(data.expenseDate);
    if (Number.isNaN(expenseDate.getTime())) {
      throw new BadRequestException("Invalid expense date");
    }
    return this.prisma.expense.create({
      data: {
        detail,
        amount,
        expenseDate,
        createdByUserId: userId,
      },
    });
  }

  async update(
    id: string,
    data: {
      detail?: string;
      amount?: string;
      expenseDate?: string;
    },
  ) {
    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Expense not found");
    }

    let amount: Prisma.Decimal | undefined;
    if (data.amount !== undefined) {
      amount = toDecimal(data.amount);
      if (amount.lte(0)) {
        throw new BadRequestException("Amount must be greater than zero");
      }
    }

    let expenseDate: Date | undefined;
    if (data.expenseDate !== undefined) {
      expenseDate = new Date(data.expenseDate);
      if (Number.isNaN(expenseDate.getTime())) {
        throw new BadRequestException("Invalid expense date");
      }
    }

    const detail = data.detail !== undefined ? data.detail.trim() : undefined;
    if (detail !== undefined && !detail) {
      throw new BadRequestException("Detail is required");
    }

    return this.prisma.expense.update({
      where: { id },
      data: {
        detail,
        amount,
        expenseDate,
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.expense.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Expense not found");
    }
    await this.prisma.expense.delete({ where: { id } });
    return { ok: true };
  }
}
