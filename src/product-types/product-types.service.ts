import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class ProductTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.productType.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
  }

  async get(id: string) {
    const row = await this.prisma.productType.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!row) {
      throw new NotFoundException("Product type not found");
    }
    return row;
  }

  async create(userId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException("Type name is required");
    }
    const existing = await this.prisma.productType.findUnique({ where: { name: trimmed } });
    if (existing) {
      throw new BadRequestException("Product type already exists");
    }
    const row = await this.prisma.productType.create({ data: { name: trimmed } });
    await this.audit.log(userId, "CREATE", "ProductType", row.id, { name: trimmed });
    return row;
  }

  async update(userId: string, id: string, name: string) {
    await this.get(id);
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException("Type name is required");
    }
    const dup = await this.prisma.productType.findFirst({
      where: { name: trimmed, NOT: { id } },
    });
    if (dup) {
      throw new BadRequestException("Product type name already in use");
    }
    const row = await this.prisma.productType.update({
      where: { id },
      data: { name: trimmed },
    });
    await this.audit.log(userId, "UPDATE", "ProductType", id, { name: trimmed });
    return row;
  }

  async remove(userId: string, id: string) {
    const count = await this.prisma.product.count({ where: { productTypeId: id } });
    if (count > 0) {
      throw new BadRequestException("Cannot delete type with products");
    }
    await this.prisma.productType.delete({ where: { id } });
    await this.audit.log(userId, "DELETE", "ProductType", id);
    return { ok: true };
  }
}
