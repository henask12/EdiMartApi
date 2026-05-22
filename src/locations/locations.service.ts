import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDefault() {
    const loc = await this.prisma.location.findFirst({
      where: { code: "DEFAULT_STORE" },
    });
    if (!loc) {
      throw new NotFoundException("Default location not configured");
    }
    return loc;
  }
}
