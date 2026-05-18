import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { runSeed } from "../seed/seed-runner";

@Injectable()
export class SetupService implements OnModuleInit {
  private readonly logger = new Logger(SetupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.AUTO_SEED !== "1") {
      return;
    }
    const users = await this.prisma.user.count();
    if (users > 0) {
      this.logger.log("AUTO_SEED skipped — users already exist.");
      return;
    }
    this.logger.log("AUTO_SEED=1 — seeding empty database...");
    const summary = await runSeed(this.prisma);
    this.logger.log(`Seed complete: ${JSON.stringify(summary)}`);
  }

  async seedDatabase() {
    return runSeed(this.prisma);
  }

  async getStatus() {
    const [users, products, categories] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.product.count(),
      this.prisma.category.count(),
    ]);
    return { users, products, categories, ready: users > 0 };
  }
}
