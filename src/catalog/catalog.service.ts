import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { productStockSnapshot } from "../common/stock.util";
import { ExportService, type ExportColumn } from "../export/export.service";
import { StorageService } from "../storage/storage.service";
import { omit } from "../permissions/access";

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

/** PATCH may send `null` for cleared optional text fields — avoid calling `.trim()` on null. */
const optionalTrimmedString = (
  value: string | null | undefined,
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value == null || value === "") {
    return null;
  }
  return value.trim();
};

const autoSku = (name: string) =>
  `auto-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;

type StockStatus = "in_stock" | "low stock" | "out of stock";

const productInclude = {
  category: true,
  productType: true,
  inventoryItems: { include: { location: true } },
  barcodes: true,
} as const;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type EnrichedProduct = Omit<ProductWithRelations, "sellingPrice" | "costPrice" | "inventoryItems"> & {
  inventoryItems: (Omit<ProductWithRelations["inventoryItems"][number], "averageCost"> & {
    averageCost?: Prisma.Decimal;
  })[];
  imageUrl: string | null;
  onHand: string;
  reserved: string;
  available: string;
  stockStatus: StockStatus;
  sellingPrice: string;
  /** Only present for people allowed to see costs (REPORTS_VIEW_COST_PROFIT). */
  costPrice?: string;
};

const normalizeStockStatus = (value?: string): StockStatus | undefined => {
  if (!value) return undefined;
  const v = value.toLowerCase().trim();
  if (v === "out" || v === "out of stock") return "out of stock";
  if (v === "low" || v === "low stock") return "low stock";
  if (v === "in_stock" || v === "in stock") return "in_stock";
  return undefined;
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly exportService: ExportService,
    private readonly storage: StorageService,
  ) {}

  private stockStatus(available: Prisma.Decimal, restockAt: number): StockStatus {
    if (available.lte(0)) {
      return "out of stock";
    }
    if (available.lte(restockAt)) {
      return "low stock";
    }
    return "in_stock";
  }

  private async enrichProduct(
    product: ProductWithRelations,
    locationId: string,
    includeCost: boolean,
  ): Promise<EnrichedProduct> {
    const { onHand, reserved, available } = await productStockSnapshot(
      this.prisma,
      product.id,
      locationId,
    );
    const imageUrl = await this.storage.publicUrl(product.imagePath);
    return {
      // the raw row carries costPrice; it is added back below only for people allowed to see it
      ...omit(product, "costPrice"),
      // the average cost of each stock row is as secret as the product's cost price
      inventoryItems: includeCost
        ? product.inventoryItems
        : product.inventoryItems.map((item) => omit(item, "averageCost")),
      imageUrl,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      stockStatus: this.stockStatus(available, product.restockAt),
      sellingPrice: product.sellingPrice.toFixed(2),
      ...(includeCost ? { costPrice: product.costPrice.toFixed(2) } : {}),
    };
  }

  private buildWhere(params: {
    q?: string;
    categoryId?: string;
    productTypeId?: string;
    /** When set, restrict to these product ids (from trgm search). */
    ids?: string[];
  }): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (params.ids) {
      where.id = { in: params.ids };
    } else if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: "insensitive" } },
        { nameAm: { contains: params.q, mode: "insensitive" } },
        { brand: { contains: params.q, mode: "insensitive" } },
        { sku: { contains: params.q, mode: "insensitive" } },
      ];
    }
    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }
    if (params.productTypeId) {
      where.productTypeId = params.productTypeId;
    }
    return where;
  }

  /**
   * Prefer pg_trgm `%` / similarity when the extension is available; fall back to ILIKE.
   * Returns null when q is empty; empty array when nothing matches.
   */
  private async searchProductIdsByTrgm(q: string): Promise<string[] | null> {
    const term = q.trim();
    if (!term) {
      return null;
    }
    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id
          FROM "Product" p
         WHERE p."isActive" = true
           AND (
             p.name % ${term}
             OR COALESCE(p."nameAm", '') % ${term}
             OR COALESCE(p.brand, '') % ${term}
             OR p.sku ILIKE ${"%" + term + "%"}
             OR p.name ILIKE ${"%" + term + "%"}
           )
         ORDER BY GREATEST(
           similarity(p.name, ${term}),
           similarity(COALESCE(p."nameAm", ''), ${term}),
           similarity(COALESCE(p.brand, ''), ${term})
         ) DESC,
         p.name ASC
         LIMIT 500`;
      return rows.map((r) => r.id);
    } catch {
      return null;
    }
  }

  async listProducts(
    params: {
      q?: string;
      categoryId?: string;
      productTypeId?: string;
      stockStatus?: string;
      skip?: number;
      take?: number;
    },
    includeCost = false,
  ) {
    const take = Math.min(params.take ?? 100, 200);
    const skip = params.skip ?? 0;
    let ids: string[] | undefined;
    if (params.q?.trim()) {
      const trgmIds = await this.searchProductIdsByTrgm(params.q);
      if (trgmIds) {
        ids = trgmIds;
      }
    }
    const where = this.buildWhere({ ...params, ids });
    const defaultLoc = await this.locations.getDefault();
    const stockFilter = normalizeStockStatus(params.stockStatus);

    if (stockFilter) {
      const raw = await this.prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        include: productInclude,
      });
      const enriched = await Promise.all(
        raw.map((p) => this.enrichProduct(p, defaultLoc.id, includeCost)),
      );
      const filtered = enriched.filter((p) => p.stockStatus === stockFilter);
      const total = filtered.length;
      const items = filtered.slice(skip, skip + take);
      return { items, total, skip, take };
    }

    // Preserve trgm relevance order when we have ids from similarity search.
    if (ids) {
      if (ids.length === 0) {
        return { items: [], total: 0, skip, take };
      }
      const pageIds = ids.slice(skip, skip + take);
      const raw = await this.prisma.product.findMany({
        where: { ...where, id: { in: pageIds } },
        include: productInclude,
      });
      const byId = new Map(raw.map((p) => [p.id, p]));
      const ordered = pageIds.map((id) => byId.get(id)).filter(Boolean) as ProductWithRelations[];
      const items = await Promise.all(
        ordered.map((p) => this.enrichProduct(p, defaultLoc.id, includeCost)),
      );
      return { items, total: ids.length, skip, take };
    }

    const [raw, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { name: "asc" },
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);
    const items = await Promise.all(
      raw.map((p) => this.enrichProduct(p, defaultLoc.id, includeCost)),
    );
    return { items, total, skip, take };
  }

  async exportProducts(
    format: "csv" | "xlsx" | "pdf",
    params: {
      q?: string;
      categoryId?: string;
      productTypeId?: string;
      stockStatus?: string;
    },
    includeCost = false,
  ) {
    const { items } = await this.listProducts(
      {
        ...params,
        skip: 0,
        take: 10000,
      },
      includeCost,
    );
    const columns: ExportColumn[] = [
      { header: "SKU", key: "sku" },
      { header: "Name", key: "name" },
      { header: "Type", key: "type" },
      { header: "Category", key: "category" },
      { header: "On hand", key: "onHand" },
      { header: "Available", key: "available" },
      { header: "Status", key: "status" },
      ...(includeCost ? [{ header: "Cost", key: "cost" }] : []),
      { header: "Price", key: "price" },
    ];
    const rows = items.map((p) => ({
      sku: p.sku ?? "",
      name: p.name,
      type: p.productType?.name ?? "",
      category: p.category.name,  
      onHand: p.onHand,
      available: p.available,
      status: p.stockStatus,
      ...(includeCost ? { cost: p.costPrice } : {}),
      price: p.sellingPrice,
    }));
    return this.exportService.build(format, `products-${Date.now()}`, columns, rows);
  }

  async getProduct(id: string, includeCost = false): Promise<EnrichedProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    const defaultLoc = await this.locations.getDefault();
    return this.enrichProduct(product, defaultLoc.id, includeCost);
  }

  async createProduct(
    userId: string,
    data: {
      name: string;
      nameAm?: string;
      brand?: string;
      categoryId: string;
      productTypeId?: string;
      sellingPrice: string;
      costPrice?: string;
      restockAt?: number;
      restockQty?: number;
      minStock?: number;
      maxStock?: number;
      leadTimeDays?: number;
      trackBatches?: boolean;
      barcode?: string;
      imagePath?: string;
      description?: string;
      originCountry?: string;
      initialQuantity?: string;
      initialExpiryDate?: string;
      expiryDate?: string;
    },
    includeCost = false,
  ) {
    const name = data.name.trim();
    if (!name) {
      throw new BadRequestException("Product name is required");
    }
    const category = await this.prisma.category.findUnique({
      where: { id: data.categoryId },
    });
    if (!category) {
      throw new BadRequestException("Category not found");
    }
    if (data.productTypeId) {
      const pt = await this.prisma.productType.findUnique({ where: { id: data.productTypeId } });
      if (!pt) {
        throw new BadRequestException("Product type not found");
      }
    }
    const existing = await this.prisma.product.findUnique({
      where: { categoryId_name: { categoryId: data.categoryId, name } },
    });
    if (existing) {
      throw new BadRequestException("A product with this name already exists in this category");
    }
    const defaultLoc = await this.locations.getDefault();
    const cost = toDecimal(data.costPrice ?? 0);
    const product = await this.prisma.$transaction(async (tx) => {
      const createData: Prisma.ProductUncheckedCreateInput = {
        sku: autoSku(name),
        name,
        nameAm: data.nameAm?.trim() || null,
        brand: data.brand?.trim() || null,
        categoryId: data.categoryId,
        productTypeId: data.productTypeId ?? null,
        imagePath: data.imagePath,
        description: data.description?.trim() || null,
        originCountry: data.originCountry?.trim() || null,
        sellingPrice: toDecimal(data.sellingPrice),
        costPrice: cost,
        restockAt: data.restockAt ?? 0,
        restockQty: data.restockQty ?? 0,
        minStock: data.minStock ?? 0,
        maxStock: data.maxStock ?? 0,
        leadTimeDays: data.leadTimeDays ?? 0,
        trackBatches: data.trackBatches ?? Boolean(data.expiryDate),
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      };
      const created = await tx.product.create({ data: createData });
      await tx.inventoryItem.create({
        data: {
          productId: created.id,
          locationId: defaultLoc.id,
          quantityOnHand: new Prisma.Decimal(0),
          averageCost: cost,
        },
      });
      const barcode = data.barcode?.trim();
      if (barcode) {
        await tx.productBarcode.create({
          data: {
            productId: created.id,
            barcode,
            kind: "INTERNAL",
            isPrimary: true,
          },
        });
      }
      return created;
    });
    await this.audit.log(userId, "CREATE", "Product", product.id, { name });

    const initialQty = data.initialQuantity ? toDecimal(data.initialQuantity) : new Prisma.Decimal(0);
    if (initialQty.gt(0)) {
      await this.inventory.receiveGoods(userId, {
        productId: product.id,
        quantity: initialQty.toString(),
        unitCost: cost.toString(),
        expiryDate: data.initialExpiryDate ?? data.expiryDate,
        notes: "Opening stock",
      });
    }

    return this.getProduct(product.id, includeCost);
  }

  async updateProduct(
    userId: string,
    id: string,
    data: Partial<{
      name: string;
      nameAm: string | null;
      brand: string | null;
      categoryId: string;
      productTypeId: string | null;
      sellingPrice: string;
      costPrice: string;
      restockAt: number;
      restockQty: number;
      minStock: number;
      maxStock: number;
      leadTimeDays: number;
      trackBatches: boolean;
      barcode: string;
      isActive: boolean;
      imagePath: string;
      description: string | null;
      originCountry: string | null;
      expiryDate: string | null;
    }>,
    includeCost = false,
  ) {
    const existing = await this.ensureProduct(id);
    if (data.productTypeId) {
      const pt = await this.prisma.productType.findUnique({ where: { id: data.productTypeId } });
      if (!pt) {
        throw new BadRequestException("Product type not found");
      }
    }
    if (data.categoryId) {
      const cat = await this.prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!cat) {
        throw new BadRequestException("Category not found");
      }
    }
    if (data.name !== undefined || data.categoryId !== undefined) {
      const targetCategoryId = data.categoryId ?? existing.categoryId;
      const targetName = (data.name ?? existing.name).trim();
      const dup = await this.prisma.product.findFirst({
        where: {
          categoryId: targetCategoryId,
          name: targetName,
          NOT: { id },
        },
      });
      if (dup) {
        throw new BadRequestException("A product with this name already exists in this category");
      }
    }
    const updateData: Prisma.ProductUncheckedUpdateInput = {
      name: data.name?.trim(),
      nameAm: optionalTrimmedString(data.nameAm),
      brand: optionalTrimmedString(data.brand),
      categoryId: data.categoryId,
      productTypeId:
        data.productTypeId !== undefined ? data.productTypeId : undefined,
      ...(data.imagePath !== undefined ? { imagePath: data.imagePath } : {}),
      description: optionalTrimmedString(data.description),
      originCountry: optionalTrimmedString(data.originCountry),
      sellingPrice:
        data.sellingPrice !== undefined ? toDecimal(data.sellingPrice) : undefined,
      costPrice: data.costPrice !== undefined ? toDecimal(data.costPrice) : undefined,
      restockAt: data.restockAt,
      restockQty: data.restockQty,
      minStock: data.minStock,
      maxStock: data.maxStock,
      leadTimeDays: data.leadTimeDays,
      trackBatches: data.trackBatches,
      isActive: data.isActive,
      expiryDate:
        data.expiryDate !== undefined
          ? data.expiryDate
            ? new Date(data.expiryDate)
            : null
          : undefined,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: updateData });
      const barcode = data.barcode?.trim();
      if (barcode) {
        const existingPrimary = await tx.productBarcode.findFirst({
          where: { productId: id, isPrimary: true },
        });
        if (existingPrimary) {
          await tx.productBarcode.update({
            where: { id: existingPrimary.id },
            data: { barcode },
          });
        } else {
          await tx.productBarcode.create({
            data: { productId: id, barcode, kind: "INTERNAL", isPrimary: true },
          });
        }
      }
    });
    await this.audit.log(userId, "UPDATE", "Product", id, { name: data.name });
    return this.getProduct(id, includeCost);
  }

  private async ensureProduct(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) {
      throw new NotFoundException("Product not found");
    }
    return p;
  }
}
