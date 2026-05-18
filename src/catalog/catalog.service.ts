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

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

const autoSku = (name: string) =>
  `auto-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
  ) {}

  private async enrichProduct(
    product: Prisma.ProductGetPayload<{
      include: { category: true; inventoryItems: true };
    }>,
    locationId: string,
  ) {
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
      sellingPrice: product.sellingPrice.toFixed(2),
      costPrice: product.costPrice.toFixed(2),
    };
  }

  async listProducts(params: {
    q?: string;
    categoryId?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 100, 200);
    const skip = params.skip ?? 0;
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (params.q) {
      where.name = { contains: params.q, mode: "insensitive" };
    }
    if (params.categoryId) {
      where.categoryId = params.categoryId;
    }
    const defaultLoc = await this.locations.getDefault();
    const [raw, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { name: "asc" },
        include: { category: true, inventoryItems: true },
      }),
      this.prisma.product.count({ where }),
    ]);
    const items = await Promise.all(
      raw.map((p) => this.enrichProduct(p, defaultLoc.id)),
    );
    return { items, total, skip, take };
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        inventoryItems: { include: { location: true } },
      },
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
      sellingPrice: string;
      costPrice?: string;
      restockAt?: number;
      restockQty?: number;
      imagePath?: string;
      description?: string;
      originCountry?: string;
      initialQuantity?: string;
      initialExpiryDate?: string;
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
          imagePath: data.imagePath,
          description: data.description?.trim() || null,
          originCountry: data.originCountry?.trim() || null,
          sellingPrice: toDecimal(data.sellingPrice),
          costPrice: cost,
          restockAt: data.restockAt ?? 0,
          restockQty: data.restockQty ?? 0,
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
        expiryDate: data.initialExpiryDate,
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
      sellingPrice: string;
      costPrice: string;
      restockAt: number;
      restockQty: number;
      isActive: boolean;
      imagePath: string;
      description: string;
      originCountry: string;
    }>,
  ) {
    await this.ensureProduct(id);
    if (data.name && data.categoryId) {
      const dup = await this.prisma.product.findFirst({
        where: {
          categoryId: data.categoryId,
          name: data.name.trim(),
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
        imagePath: data.imagePath,
        description:
          data.description !== undefined ? data.description.trim() || null : undefined,
        originCountry:
          data.originCountry !== undefined ? data.originCountry.trim() || null : undefined,
        sellingPrice:
          data.sellingPrice !== undefined ? toDecimal(data.sellingPrice) : undefined,
        costPrice: data.costPrice !== undefined ? toDecimal(data.costPrice) : undefined,
        restockAt: data.restockAt,
        restockQty: data.restockQty,
        isActive: data.isActive,
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
