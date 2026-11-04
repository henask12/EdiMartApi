import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentMethod, Prisma, SupplierBillStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { businessDateString, businessDayStart } from "../common/business-time";
import { money2, nextDocumentNumber, toDecimal } from "./document-numbers";

const BILL_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
  receipts: { include: { goodsReceipt: { select: { id: true, receiptNumber: true } } } },
  payments: {
    include: { createdBy: { select: { id: true, displayName: true, email: true } } },
    orderBy: { paidAt: "desc" as const },
  },
  createdBy: { select: { id: true, displayName: true, email: true } },
} as const;

type BillLoaded = Prisma.SupplierBillGetPayload<{ include: typeof BILL_INCLUDE }>;

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: {
    supplierId?: string;
    status?: SupplierBillStatus;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.SupplierBillWhereInput = {};
    if (params.supplierId) where.supplierId = params.supplierId;
    if (params.status) where.status = params.status;
    const [items, total] = await Promise.all([
      this.prisma.supplierBill.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: BILL_INCLUDE,
      }),
      this.prisma.supplierBill.count({ where }),
    ]);
    return { items: items.map((b) => this.mapBill(b)), total, skip, take };
  }

  async get(id: string) {
    const bill = await this.prisma.supplierBill.findUnique({
      where: { id },
      include: BILL_INCLUDE,
    });
    if (!bill) throw new NotFoundException("Supplier bill not found");
    return this.mapBill(bill);
  }

  async create(
    userId: string,
    data: {
      supplierId: string;
      purchaseOrderId?: string;
      goodsReceiptIds?: string[];
      supplierInvoiceRef?: string;
      amountDue: string;
      dueDate?: string;
      notes?: string;
    },
  ) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier) throw new NotFoundException("Supplier not found");
    const amountDue = toDecimal(data.amountDue);
    if (amountDue.lte(0)) throw new BadRequestException("amountDue must be positive");

    if (data.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findUnique({ where: { id: data.purchaseOrderId } });
      if (!po || po.supplierId !== data.supplierId) {
        throw new BadRequestException("purchaseOrderId does not belong to this supplier");
      }
    }

    const receiptIds = data.goodsReceiptIds ?? [];
    if (receiptIds.length) {
      const receipts = await this.prisma.goodsReceipt.findMany({
        where: { id: { in: receiptIds } },
      });
      if (receipts.length !== receiptIds.length) {
        throw new BadRequestException("One or more goodsReceiptIds are invalid");
      }
    }

    const dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException("Invalid dueDate");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const billNumber = await nextDocumentNumber(tx, "BILL", "BILL");
      return tx.supplierBill.create({
        data: {
          billNumber,
          supplierId: data.supplierId,
          purchaseOrderId: data.purchaseOrderId || null,
          supplierInvoiceRef: data.supplierInvoiceRef?.trim() || null,
          amountDue,
          amountPaid: new Prisma.Decimal(0),
          status: SupplierBillStatus.OPEN,
          dueDate,
          notes: data.notes?.trim() || null,
          createdByUserId: userId,
          receipts: receiptIds.length
            ? { create: receiptIds.map((goodsReceiptId) => ({ goodsReceiptId })) }
            : undefined,
        },
        include: BILL_INCLUDE,
      });
    });

    await this.audit.log(userId, "SUPPLIER_BILL_CREATE", "SupplierBill", created.id, {
      billNumber: created.billNumber,
      amountDue: money2(amountDue),
    });
    return this.mapBill(created);
  }

  async recordPayment(
    userId: string,
    billId: string,
    data: { amount: string; method?: PaymentMethod; reference?: string; paidAt?: string },
  ) {
    const bill = await this.prisma.supplierBill.findUnique({ where: { id: billId } });
    if (!bill) throw new NotFoundException("Supplier bill not found");
    if (bill.status === SupplierBillStatus.VOID || bill.status === SupplierBillStatus.PAID) {
      throw new BadRequestException(`Cannot pay a bill in status ${bill.status}`);
    }

    const amount = toDecimal(data.amount);
    if (amount.lte(0)) throw new BadRequestException("Payment amount must be positive");
    const remaining = bill.amountDue.sub(bill.amountPaid);
    if (amount.gt(remaining)) {
      throw new BadRequestException(`Payment exceeds remaining balance of ${money2(remaining)}`);
    }

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new BadRequestException("Invalid paidAt");

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.supplierPayment.create({
        data: {
          supplierBillId: billId,
          amount,
          method: data.method ?? PaymentMethod.CASH,
          reference: data.reference?.trim() || null,
          paidAt,
          createdByUserId: userId,
        },
      });
      const amountPaid = bill.amountPaid.add(amount);
      const status = amountPaid.gte(bill.amountDue)
        ? SupplierBillStatus.PAID
        : SupplierBillStatus.PARTIAL;
      return tx.supplierBill.update({
        where: { id: billId },
        data: { amountPaid, status },
        include: BILL_INCLUDE,
      });
    });

    await this.audit.log(userId, "SUPPLIER_PAYMENT", "SupplierBill", billId, {
      amount: money2(amount),
      status: updated.status,
    });
    return this.mapBill(updated);
  }

  /** Aged payables buckets: current, 1–30, 31–60, 61–90, 90+. */
  async agedPayables() {
    const today = businessDateString();
    const bills = await this.prisma.supplierBill.findMany({
      where: { status: { in: [SupplierBillStatus.OPEN, SupplierBillStatus.PARTIAL] } },
      include: { supplier: { select: { id: true, name: true } } },
    });

    const buckets = {
      current: new Prisma.Decimal(0),
      days1to30: new Prisma.Decimal(0),
      days31to60: new Prisma.Decimal(0),
      days61to90: new Prisma.Decimal(0),
      over90: new Prisma.Decimal(0),
    };
    const bySupplier = new Map<
      string,
      { supplierId: string; supplierName: string; outstanding: Prisma.Decimal }
    >();

    for (const bill of bills) {
      const outstanding = bill.amountDue.sub(bill.amountPaid);
      if (outstanding.lte(0)) continue;
      const due = bill.dueDate
        ? businessDateString(bill.dueDate)
        : businessDateString(bill.createdAt);
      const daysPastDue = Math.max(
        0,
        Math.floor(
          (businessDayStart(today).getTime() - businessDayStart(due).getTime()) / (24 * 3600 * 1000),
        ),
      );
      if (daysPastDue === 0 && due >= today) buckets.current = buckets.current.add(outstanding);
      else if (daysPastDue <= 30) buckets.days1to30 = buckets.days1to30.add(outstanding);
      else if (daysPastDue <= 60) buckets.days31to60 = buckets.days31to60.add(outstanding);
      else if (daysPastDue <= 90) buckets.days61to90 = buckets.days61to90.add(outstanding);
      else buckets.over90 = buckets.over90.add(outstanding);

      const prev = bySupplier.get(bill.supplierId);
      if (prev) prev.outstanding = prev.outstanding.add(outstanding);
      else {
        bySupplier.set(bill.supplierId, {
          supplierId: bill.supplierId,
          supplierName: bill.supplier.name,
          outstanding,
        });
      }
    }

    const total = Object.values(buckets).reduce((a, b) => a.add(b), new Prisma.Decimal(0));
    return {
      asOf: today,
      total: money2(total),
      buckets: {
        current: money2(buckets.current),
        days1to30: money2(buckets.days1to30),
        days31to60: money2(buckets.days31to60),
        days61to90: money2(buckets.days61to90),
        over90: money2(buckets.over90),
      },
      bySupplier: [...bySupplier.values()]
        .map((s) => ({
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          outstanding: money2(s.outstanding),
        }))
        .sort((a, b) => Number(b.outstanding) - Number(a.outstanding)),
    };
  }

  private mapBill(b: BillLoaded) {
    return {
      id: b.id,
      billNumber: b.billNumber,
      supplierId: b.supplierId,
      supplier: b.supplier,
      purchaseOrderId: b.purchaseOrderId,
      purchaseOrder: b.purchaseOrder,
      supplierInvoiceRef: b.supplierInvoiceRef,
      status: b.status,
      amountDue: money2(b.amountDue),
      amountPaid: money2(b.amountPaid),
      balance: money2(b.amountDue.sub(b.amountPaid)),
      dueDate: b.dueDate,
      notes: b.notes,
      createdBy: b.createdBy,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      receipts: b.receipts.map((r) => r.goodsReceipt),
      payments: b.payments.map((p) => ({
        id: p.id,
        amount: money2(p.amount),
        method: p.method,
        reference: p.reference,
        paidAt: p.paidAt,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
      })),
    };
  }
}
