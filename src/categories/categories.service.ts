import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
  }

  async get(id: string) {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!cat) {
      throw new NotFoundException("Category not found");
    }
    return cat;
  }

  async create(userId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException("Category name is required");
    }
    const existing = await this.prisma.category.findUnique({
      where: { name: trimmed },
    });
    if (existing) {
      throw new BadRequestException("Category already exists");
    }
    const cat = await this.prisma.category.create({ data: { name: trimmed } });
    await this.audit.log(userId, "CREATE", "Category", cat.id, { name: trimmed });
    return cat;
  }

  async update(userId: string, id: string, name: string) {
    await this.get(id);
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException("Category name is required");
    }
    const dup = await this.prisma.category.findFirst({
      where: { name: trimmed, NOT: { id } },
    });
    if (dup) {
      throw new BadRequestException("Category name already in use");
    }
    const cat = await this.prisma.category.update({
      where: { id },
      data: { name: trimmed },
    });
    await this.audit.log(userId, "UPDATE", "Category", id, { name: trimmed });
    return cat;
  }

  async remove(userId: string, id: string) {
    const count = await this.prisma.product.count({ where: { categoryId: id } });
    if (count > 0) {
      throw new BadRequestException("Cannot delete category with products");
    }
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log(userId, "DELETE", "Category", id);
    return { ok: true };
  }
}
