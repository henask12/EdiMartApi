import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from ".prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { InventoryService } from "../inventory/inventory.service";
import { productStockSnapshot } from "../common/stock.util";
import { ExportService, type ExportColumn } from "../export/export.service";

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
} as const;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

type EnrichedProduct = Omit<ProductWithRelations, "sellingPrice" | "costPrice"> & {
  imageUrl: string | null;
  onHand: string;
  reserved: string;
  available: string;
  stockStatus: StockStatus;
  sellingPrice: string;
  costPrice: string;
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
  ): Promise<EnrichedProduct> {
    const { onHand, reserved, available } = await productStockSnapshot(
      this.prisma,
      product.id,
      locationId,
    );
    const imageUrl = product.imagePath
      ? `${(process.env.PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "")}${product.imagePath}`
      : null;
    return {
      ...product,
      imageUrl,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      stockStatus: this.stockStatus(available, product.restockAt),
      sellingPrice: product.sellingPrice.toFixed(2),
      costPrice: product.costPrice.toFixed(2),
    };
  }

  private buildWhere(params: {
    q?: string;
    categoryId?: string;
    productTypeId?: string;
  }): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: "insensitive" } },
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

  async listProducts(params: {
    q?: string;
    categoryId?: string;
    productTypeId?: string;
    stockStatus?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 100, 200);
    const skip = params.skip ?? 0;
    const where = this.buildWhere(params);
    const defaultLoc = await this.locations.getDefault();
    const stockFilter = normalizeStockStatus(params.stockStatus);

    if (stockFilter) {
      const raw = await this.prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        include: productInclude,
      });
      const enriched = await Promise.all(raw.map((p) => this.enrichProduct(p, defaultLoc.id)));
      const filtered = enriched.filter((p) => p.stockStatus === stockFilter);
      const total = filtered.length;
      const items = filtered.slice(skip, skip + take);
      return { items, total, skip, take };
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
      raw.map((p) => this.enrichProduct(p, defaultLoc.id)),
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
  ) {
    const { items } = await this.listProducts({
      ...params,
      skip: 0,
      take: 10000,
    });
    const columns: ExportColumn[] = [
      { header: "SKU", key: "sku" },
      { header: "Name", key: "name" },
      { header: "Type", key: "type" },
      { header: "Category", key: "category" },
      { header: "On hand", key: "onHand" },
      { header: "Available", key: "available" },
      { header: "Status", key: "status" },
      { header: "Cost", key: "cost" },
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
      cost: p.costPrice,
      price: p.sellingPrice,
    }));
    return this.exportService.build(format, `products-${Date.now()}`, columns, rows);
  }

  async getProduct(id: string): Promise<EnrichedProduct> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    const defaultLoc = await this.locations.getDefault();
    return this.enrichProduct(product, defaultLoc.id);
  }

  async createProduct(
    userId: string,
    data: {
      name: string;
      categoryId: string;
      productTypeId?: string;
      sellingPrice: string;
      costPrice?: string;
      restockAt?: number;
      restockQty?: number;
      imagePath?: string;
      description?: string;
      originCountry?: string;
      initialQuantity?: string;
      initialExpiryDate?: string;
      expiryDate?: string;
    },
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
      const created = await tx.product.create({
        data: {
          sku: autoSku(name),
          name,
          categoryId: data.categoryId,
          productTypeId: data.productTypeId ?? null,
          imagePath: data.imagePath,
          description: data.description?.trim() || null,
          originCountry: data.originCountry?.trim() || null,
          sellingPrice: toDecimal(data.sellingPrice),
          costPrice: cost,
          restockAt: data.restockAt ?? 0,
          restockQty: data.restockQty ?? 0,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        },
      });
      await tx.inventoryItem.create({
        data: {
          productId: created.id,
          locationId: defaultLoc.id,
          quantityOnHand: new Prisma.Decimal(0),
          averageCost: cost,
        },
      });
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

    return this.getProduct(product.id);
  }

  async updateProduct(
    userId: string,
    id: string,
    data: Partial<{
      name: string;
      categoryId: string;
      productTypeId: string | null;
      sellingPrice: string;
      costPrice: string;
      restockAt: number;
      restockQty: number;
      isActive: boolean;
      imagePath: string;
      description: string | null;
      originCountry: string | null;
      expiryDate: string | null;
    }>,
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
    await this.prisma.product.update({
      where: { id },
      data: {
        name: data.name?.trim(),
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
        isActive: data.isActive,
        expiryDate:
          data.expiryDate !== undefined
            ? data.expiryDate
              ? new Date(data.expiryDate)
              : null
            : undefined,
      },
    });
    await this.audit.log(userId, "UPDATE", "Product", id, { name: data.name });
    return this.getProduct(id);
  }

  private async ensureProduct(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) {
      throw new NotFoundException("Product not found");
    }
    return p;
  }
}
