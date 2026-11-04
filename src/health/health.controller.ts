import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness plus a real database round trip, for uptime monitors and the platform health check. */
  @Public()
  @Get()
  async get() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ ok: false, service: "edimart-api", db: "down" });
    }
    return { ok: true, service: "edimart-api", db: "up" };
  }
}
