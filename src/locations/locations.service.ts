import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Primary shop-floor location (legacy code DEFAULT_STORE). */
  async getDefault() {
    const loc = await this.prisma.location.findFirst({
      where: { code: "DEFAULT_STORE", isActive: true },
    });
    if (!loc) {
      throw new NotFoundException("Default location not configured");
    }
    return loc;
  }

  /** Non-sellable quarantine location (damaged / inspection returns). */
  async getQuarantine() {
    const loc = await this.prisma.location.findFirst({
      where: {
        isActive: true,
        OR: [{ code: "QUARANTINE" }, { storeCode: "QUARANTINE" }],
      },
      orderBy: { sortOrder: "asc" },
    });
    if (!loc) {
      throw new NotFoundException("Quarantine location not configured");
    }
    return loc;
  }

  async listSellableLocationIds(storeCode = "DEFAULT_STORE"): Promise<string[]> {
    const rows = await this.prisma.location.findMany({
      where: { storeCode, sellable: true, isActive: true },
      select: { id: true },
      orderBy: { sortOrder: "asc" },
    });
    return rows.map((r) => r.id);
  }

  async listLocations(includeInactive = false) {
    return this.prisma.location.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ storeCode: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async getLocation(id: string) {
    const loc = await this.prisma.location.findUnique({ where: { id } });
    if (!loc) {
      throw new NotFoundException("Location not found");
    }
    return loc;
  }

  async createLocation(
    userId: string,
    data: {
      code: string;
      name: string;
      storeCode?: string;
      sellable?: boolean;
      sortOrder?: number;
      binCode?: string | null;
    },
  ) {
    const code = data.code.trim().toUpperCase().replace(/\s+/g, "_");
    if (!code || !data.name.trim()) {
      throw new BadRequestException("code and name are required");
    }
    try {
      const loc = await this.prisma.location.create({
        data: {
          code,
          name: data.name.trim(),
          storeCode: data.storeCode?.trim() || "DEFAULT_STORE",
          sellable: data.sellable ?? true,
          sortOrder: data.sortOrder ?? 100,
          binCode: data.binCode?.trim() || null,
        },
      });
      await this.audit.log(userId, "CREATE", "Location", loc.id, { code: loc.code });
      return loc;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("A location with that code already exists");
      }
      throw e;
    }
  }

  async updateLocation(
    userId: string,
    id: string,
    data: {
      name?: string;
      sellable?: boolean;
      sortOrder?: number;
      binCode?: string | null;
      isActive?: boolean;
    },
  ) {
    await this.getLocation(id);
    const loc = await this.prisma.location.update({
      where: { id },
      data: {
        ...(data.name != null ? { name: data.name.trim() } : {}),
        ...(data.sellable != null ? { sellable: data.sellable } : {}),
        ...(data.sortOrder != null ? { sortOrder: data.sortOrder } : {}),
        ...(data.binCode !== undefined ? { binCode: data.binCode?.trim() || null } : {}),
        ...(data.isActive != null ? { isActive: data.isActive } : {}),
      },
    });
    await this.audit.log(userId, "UPDATE", "Location", loc.id, data);
    return loc;
  }
}
