import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { runSeed, SeedRefusedError } from "../seed/seed-runner";

@Injectable()
export class SetupService implements OnModuleInit {
  private readonly logger = new Logger(SetupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.AUTO_SEED !== "1") {
      return;
    }
    try {
      this.logger.log("AUTO_SEED=1 - seeding the empty database...");
      const summary = await runSeed(this.prisma, { log: (m) => this.logger.warn(m) });
      this.logger.log(`Seed complete: ${JSON.stringify(summary)}`);
    } catch (err) {
      if (err instanceof SeedRefusedError) {
        this.logger.log("AUTO_SEED skipped - the database already has data.");
        return;
      }
      throw err;
    }
  }

  seedDatabase() {
    return runSeed(this.prisma, { log: (m) => this.logger.warn(m) });
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
