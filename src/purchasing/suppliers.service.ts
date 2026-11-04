import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { money2, toDecimal } from "./document-numbers";

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: { q?: string; activeOnly?: boolean; skip?: number; take?: number }) {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.SupplierWhereInput = {};
    if (params.activeOnly !== false) where.isActive = true;
    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { contactName: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return {
      items: items.map((s) => this.mapSupplier(s)),
      total,
      skip,
      take,
    };
  }

  async get(id: string) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new NotFoundException("Supplier not found");
    return this.mapSupplier(s);
  }

  async create(
    userId: string,
    data: {
      name: string;
      contactName?: string;
      phone?: string;
      telegram?: string;
      email?: string;
      address?: string;
      tin?: string;
      paymentTerms?: string;
      leadTimeDays?: number;
      minimumOrder?: string;
      notes?: string;
    },
  ) {
    const name = data.name?.trim();
    if (!name) throw new BadRequestException("Name is required");
    const leadTimeDays = data.leadTimeDays ?? 7;
    if (leadTimeDays < 0) throw new BadRequestException("leadTimeDays cannot be negative");
    const minimumOrder = toDecimal(data.minimumOrder ?? "0");
    if (minimumOrder.lt(0)) throw new BadRequestException("minimumOrder cannot be negative");

    const created = await this.prisma.supplier.create({
      data: {
        name,
        contactName: data.contactName?.trim() || null,
        phone: data.phone?.trim() || null,
        telegram: data.telegram?.trim() || null,
        email: data.email?.trim() || null,
        address: data.address?.trim() || null,
        tin: data.tin?.trim() || null,
        paymentTerms: data.paymentTerms?.trim() || null,
        leadTimeDays,
        minimumOrder,
        currency: "ETB",
        notes: data.notes?.trim() || null,
        createdByUserId: userId,
      },
    });
    await this.audit.log(userId, "SUPPLIER_CREATE", "Supplier", created.id, { name: created.name });
    return this.mapSupplier(created);
  }

  async update(
    userId: string,
    id: string,
    data: {
      name?: string;
      contactName?: string | null;
      phone?: string | null;
      telegram?: string | null;
      email?: string | null;
      address?: string | null;
      tin?: string | null;
      paymentTerms?: string | null;
      leadTimeDays?: number;
      minimumOrder?: string;
      notes?: string | null;
      isActive?: boolean;
    },
  ) {
    await this.get(id);
    if (data.leadTimeDays !== undefined && data.leadTimeDays < 0) {
      throw new BadRequestException("leadTimeDays cannot be negative");
    }
    let minimumOrder: Prisma.Decimal | undefined;
    if (data.minimumOrder !== undefined) {
      minimumOrder = toDecimal(data.minimumOrder);
      if (minimumOrder.lt(0)) throw new BadRequestException("minimumOrder cannot be negative");
    }
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.contactName !== undefined ? { contactName: data.contactName?.trim() || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.telegram !== undefined ? { telegram: data.telegram?.trim() || null } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
        ...(data.tin !== undefined ? { tin: data.tin?.trim() || null } : {}),
        ...(data.paymentTerms !== undefined ? { paymentTerms: data.paymentTerms?.trim() || null } : {}),
        ...(data.leadTimeDays !== undefined ? { leadTimeDays: data.leadTimeDays } : {}),
        ...(minimumOrder !== undefined ? { minimumOrder } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    await this.audit.log(userId, "SUPPLIER_UPDATE", "Supplier", id, data);
    return this.mapSupplier(updated);
  }

  async listProducts(supplierId: string, includeCost: boolean) {
    await this.get(supplierId);
    const rows = await this.prisma.supplierProduct.findMany({
      where: { supplierId },
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplierId,
      productId: r.productId,
      product: r.product,
      supplierSku: r.supplierSku,
      packSize: r.packSize,
      isPreferred: r.isPreferred,
      ...(includeCost ? { lastCost: money2(r.lastCost) } : {}),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async linkProduct(
    userId: string,
    supplierId: string,
    data: {
      productId: string;
      supplierSku?: string;
      lastCost?: string;
      isPreferred?: boolean;
    },
    includeCost: boolean,
  ) {
    await this.get(supplierId);
    const product = await this.prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new NotFoundException("Product not found");

    const lastCost = toDecimal(data.lastCost ?? "0");
    if (lastCost.lt(0)) throw new BadRequestException("lastCost cannot be negative");

    const existing = await this.prisma.supplierProduct.findUnique({
      where: { supplierId_productId: { supplierId, productId: data.productId } },
    });

    const row = await this.prisma.$transaction(async (tx) => {
      const linked = existing
        ? await tx.supplierProduct.update({
            where: { id: existing.id },
            data: {
              supplierSku: data.supplierSku?.trim() || existing.supplierSku,
              packSize: 1,
              lastCost,
              isPreferred: data.isPreferred ?? existing.isPreferred,
            },
            include: { product: { select: { id: true, name: true, sku: true } } },
          })
        : await tx.supplierProduct.create({
            data: {
              supplierId,
              productId: data.productId,
              supplierSku: data.supplierSku?.trim() || null,
              packSize: 1,
              lastCost,
              isPreferred: data.isPreferred ?? false,
            },
            include: { product: { select: { id: true, name: true, sku: true } } },
          });

      const costChanged = !existing || !existing.lastCost.eq(lastCost);
      if (costChanged && lastCost.gt(0)) {
        await tx.supplierCostHistory.create({
          data: {
            supplierId,
            productId: data.productId,
            unitCost: lastCost,
            note: existing ? "Link cost update" : "Initial link cost",
          },
        });
      }
      return linked;
    });

    await this.audit.log(userId, existing ? "SUPPLIER_PRODUCT_UPDATE" : "SUPPLIER_PRODUCT_LINK", "SupplierProduct", row.id, {
      supplierId,
      productId: data.productId,
      lastCost: money2(lastCost),
    });

    return {
      id: row.id,
      supplierId: row.supplierId,
      productId: row.productId,
      product: row.product,
      supplierSku: row.supplierSku,
      packSize: row.packSize,
      isPreferred: row.isPreferred,
      ...(includeCost ? { lastCost: money2(row.lastCost) } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async costHistory(supplierId: string, productId: string, includeCost: boolean) {
    await this.get(supplierId);
    const rows = await this.prisma.supplierCostHistory.findMany({
      where: { supplierId, productId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplierId,
      productId: r.productId,
      note: r.note,
      createdAt: r.createdAt,
      ...(includeCost ? { unitCost: money2(r.unitCost) } : {}),
    }));
  }

  private mapSupplier(s: {
    id: string;
    name: string;
    contactName: string | null;
    phone: string | null;
    telegram: string | null;
    email: string | null;
    address: string | null;
    tin: string | null;
    paymentTerms: string | null;
    leadTimeDays: number;
    minimumOrder: Prisma.Decimal;
    currency: string;
    notes: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      name: s.name,
      contactName: s.contactName,
      phone: s.phone,
      telegram: s.telegram,
      email: s.email,
      address: s.address,
      tin: s.tin,
      paymentTerms: s.paymentTerms,
      leadTimeDays: s.leadTimeDays,
      minimumOrder: money2(s.minimumOrder),
      currency: s.currency,
      notes: s.notes,
      isActive: s.isActive,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
