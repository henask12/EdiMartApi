import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PermissionKey, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StoreSettingsService } from "../settings/store-settings.service";
import { hasPermission, type Viewer } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { money2, nextDocumentNumber, qty4, toDecimal } from "./document-numbers";

type PoLineInput = { productId: string; quantity: string; unitCost: string };

const OPEN_INCOMING_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.SENT,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

const PO_INCLUDE = {
  supplier: true,
  lines: { include: { product: { select: { id: true, name: true, sku: true } } } },
  createdBy: { select: { id: true, displayName: true, email: true } },
  approvedBy: { select: { id: true, displayName: true, email: true } },
} as const;

type PoLoaded = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: StoreSettingsService,
  ) {}

  async list(
    viewer: Viewer,
    params: {
      status?: PurchaseOrderStatus;
      supplierId?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.supplierId) where.supplierId = params.supplierId;
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: PO_INCLUDE,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return {
      items: items.map((po) => this.mapPo(po, viewer.includeCost)),
      total,
      skip,
      take,
    };
  }

  async get(id: string, viewer: Viewer) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    return this.mapPo(po, viewer.includeCost);
  }

  async create(actor: Actor, data: { supplierId: string; notes?: string; expectedAt?: string; lines: PoLineInput[] }, viewer: Viewer) {
    if (!data.lines?.length) throw new BadRequestException("At least one line is required");
    const supplier = await this.prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier || !supplier.isActive) throw new NotFoundException("Supplier not found");

    const prepared = await this.prepareLines(data.lines);
    const subtotal = prepared.reduce((acc, l) => acc.add(l.lineTotal), new Prisma.Decimal(0));

    const created = await this.prisma.$transaction(async (tx) => {
      const poNumber = await nextDocumentNumber(tx, "PO", "PO");
      return tx.purchaseOrder.create({
        data: {
          poNumber,
          status: PurchaseOrderStatus.DRAFT,
          supplierId: data.supplierId,
          notes: data.notes?.trim() || null,
          expectedAt: data.expectedAt ? new Date(data.expectedAt) : null,
          subtotal,
          createdByUserId: actor.userId,
          lines: {
            create: prepared.map((l) => ({
              productId: l.productId,
              quantityOrdered: l.quantityOrdered,
              quantityReceived: new Prisma.Decimal(0),
              unitCost: l.unitCost,
              lineTotal: l.lineTotal,
            })),
          },
        },
        include: PO_INCLUDE,
      });
    });

    await this.audit.log(actor.userId, "PO_CREATE", "PurchaseOrder", created.id, {
      poNumber: created.poNumber,
      subtotal: money2(subtotal),
    });
    return this.mapPo(created, viewer.includeCost);
  }

  async updateDraft(
    actor: Actor,
    id: string,
    data: { notes?: string; expectedAt?: string | null; lines?: PoLineInput[] },
    viewer: Viewer,
  ) {
    const existing = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!existing) throw new NotFoundException("Purchase order not found");
    if (existing.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException("Only draft purchase orders can be edited");
    }

    let prepared: Awaited<ReturnType<PurchaseOrdersService["prepareLines"]>> | undefined;
    let subtotal = existing.subtotal;
    if (data.lines) {
      if (!data.lines.length) throw new BadRequestException("At least one line is required");
      prepared = await this.prepareLines(data.lines);
      subtotal = prepared.reduce((acc, l) => acc.add(l.lineTotal), new Prisma.Decimal(0));
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (prepared) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: prepared.map((l) => ({
            purchaseOrderId: id,
            productId: l.productId,
            quantityOrdered: l.quantityOrdered,
            quantityReceived: new Prisma.Decimal(0),
            unitCost: l.unitCost,
            lineTotal: l.lineTotal,
          })),
        });
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
          ...(data.expectedAt !== undefined
            ? { expectedAt: data.expectedAt ? new Date(data.expectedAt) : null }
            : {}),
          ...(prepared ? { subtotal } : {}),
        },
        include: PO_INCLUDE,
      });
    });

    await this.audit.log(actor.userId, "PO_UPDATE", "PurchaseOrder", id, {});
    return this.mapPo(updated, viewer.includeCost);
  }

  async approve(actor: Actor, id: string, viewer: Viewer) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException("Only draft purchase orders can be approved");
    }
    if (po.lines.length === 0) throw new BadRequestException("Purchase order has no lines");

    const threshold = await this.settings.getPoApproveThreshold();
    if (po.subtotal.gt(threshold) && !hasPermission(actor, PermissionKey.PURCHASE_APPROVE)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "PURCHASE_APPROVE_REQUIRED",
        message: `This PO subtotal (${money2(po.subtotal)} Birr) is above the ${money2(threshold)} Birr approval threshold.`,
        subtotal: money2(po.subtotal),
        threshold: money2(threshold),
      });
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
      },
      include: PO_INCLUDE,
    });
    await this.audit.log(actor.userId, "PO_APPROVE", "PurchaseOrder", id, {
      poNumber: po.poNumber,
      subtotal: money2(po.subtotal),
    });
    return this.mapPo(updated, viewer.includeCost);
  }

  async send(actor: Actor, id: string, viewer: Viewer) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    if (po.status !== PurchaseOrderStatus.APPROVED) {
      throw new BadRequestException("Only approved purchase orders can be sent");
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.SENT, sentAt: new Date() },
      include: PO_INCLUDE,
    });

    const payload = this.buildSendPayload(updated);
    this.logger.log(`Telegram PO send stub (no-op): ${payload.poNumber} → ${payload.supplier.telegram ?? "n/a"}`);

    await this.audit.log(actor.userId, "PO_SEND", "PurchaseOrder", id, { poNumber: po.poNumber });
    return {
      purchaseOrder: this.mapPo(updated, viewer.includeCost),
      /** Structured document for PDF / email clients. */
      document: payload,
      channels: {
        email: payload.supplier.email ? { status: "READY", to: payload.supplier.email } : { status: "SKIPPED" },
        telegram: { status: "STUB", to: payload.supplier.telegram },
      },
    };
  }

  async cancel(actor: Actor, id: string, viewer: Viewer) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    const cancellable: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.DRAFT,
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.SENT,
    ];
    if (!cancellable.includes(po.status)) {
      throw new BadRequestException(`Cannot cancel a purchase order in status ${po.status}`);
    }
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
      include: PO_INCLUDE,
    });
    await this.audit.log(actor.userId, "PO_CANCEL", "PurchaseOrder", id, { poNumber: po.poNumber });
    return this.mapPo(updated, viewer.includeCost);
  }

  async close(actor: Actor, id: string, viewer: Viewer) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException("Purchase order not found");
    const closable: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.RECEIVED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ];
    if (!closable.includes(po.status)) {
      throw new BadRequestException(`Cannot close a purchase order in status ${po.status}`);
    }
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CLOSED, closedAt: new Date() },
      include: PO_INCLUDE,
    });
    await this.audit.log(actor.userId, "PO_CLOSE", "PurchaseOrder", id, { poNumber: po.poNumber });
    return this.mapPo(updated, viewer.includeCost);
  }

  /**
   * Remaining ordered qty on open POs (APPROVED / SENT / PARTIALLY_RECEIVED).
   */
  async incomingForProduct(productId: string): Promise<Prisma.Decimal> {
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        productId,
        purchaseOrder: { status: { in: OPEN_INCOMING_STATUSES } },
      },
      select: { quantityOrdered: true, quantityReceived: true },
    });
    return lines.reduce((acc, l) => {
      const remaining = l.quantityOrdered.sub(l.quantityReceived);
      return remaining.gt(0) ? acc.add(remaining) : acc;
    }, new Prisma.Decimal(0));
  }

  async incomingMap(productIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const map = new Map<string, Prisma.Decimal>();
    if (!productIds.length) return map;
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: { status: { in: OPEN_INCOMING_STATUSES } },
      },
      select: { productId: true, quantityOrdered: true, quantityReceived: true },
    });
    for (const l of lines) {
      const remaining = l.quantityOrdered.sub(l.quantityReceived);
      if (remaining.lte(0)) continue;
      map.set(l.productId, (map.get(l.productId) ?? new Prisma.Decimal(0)).add(remaining));
    }
    return map;
  }

  private async prepareLines(lines: PoLineInput[]) {
    const productIds = lines.map((l) => l.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    const found = new Set(products.map((p) => p.id));
    const prepared: Array<{
      productId: string;
      quantityOrdered: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }> = [];
    for (const line of lines) {
      if (!found.has(line.productId)) {
        throw new BadRequestException(`Unknown product ${line.productId}`);
      }
      const qty = toDecimal(line.quantity);
      const unitCost = toDecimal(line.unitCost);
      if (qty.lte(0)) throw new BadRequestException("Line quantity must be positive");
      if (unitCost.lt(0)) throw new BadRequestException("Line unit cost must be non-negative");
      const lineTotal = qty.mul(unitCost).toDecimalPlaces(2);
      prepared.push({ productId: line.productId, quantityOrdered: qty, unitCost, lineTotal });
    }
    return prepared;
  }

  private buildSendPayload(po: PoLoaded) {
    return {
      poNumber: po.poNumber,
      status: po.status,
      sentAt: po.sentAt?.toISOString() ?? null,
      expectedAt: po.expectedAt?.toISOString() ?? null,
      notes: po.notes,
      currency: "ETB",
      subtotal: money2(po.subtotal),
      supplier: {
        id: po.supplier.id,
        name: po.supplier.name,
        email: po.supplier.email,
        phone: po.supplier.phone,
        telegram: po.supplier.telegram,
        address: po.supplier.address,
        tin: po.supplier.tin,
        paymentTerms: po.supplier.paymentTerms,
      },
      lines: po.lines.map((l) => ({
        productId: l.productId,
        sku: l.product.sku,
        name: l.product.name,
        quantity: qty4(l.quantityOrdered),
        unitCost: money2(l.unitCost),
        lineTotal: money2(l.lineTotal),
      })),
    };
  }

  private mapPo(po: PoLoaded, includeCost: boolean) {
    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      supplierId: po.supplierId,
      supplier: {
        id: po.supplier.id,
        name: po.supplier.name,
        email: po.supplier.email,
        phone: po.supplier.phone,
        telegram: po.supplier.telegram,
      },
      notes: po.notes,
      expectedAt: po.expectedAt,
      subtotal: money2(po.subtotal),
      createdByUserId: po.createdByUserId,
      createdBy: po.createdBy,
      approvedByUserId: po.approvedByUserId,
      approvedBy: po.approvedBy,
      approvedAt: po.approvedAt,
      sentAt: po.sentAt,
      closedAt: po.closedAt,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      lines: po.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        product: l.product,
        quantityOrdered: qty4(l.quantityOrdered),
        quantityReceived: qty4(l.quantityReceived),
        lineTotal: money2(l.lineTotal),
        ...(includeCost ? { unitCost: money2(l.unitCost) } : {}),
      })),
    };
  }
}

export { OPEN_INCOMING_STATUSES };
