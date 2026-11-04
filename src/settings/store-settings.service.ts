import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

/** Known settings and their defaults. Values are stored as JSON in StoreSetting rows. */
export const SETTING_DEFAULTS = {
  /**
   * A stock correction worth more than this (quantity x average cost, in Birr) needs a manager's
   * PIN approval unless the person making it can approve (STOCK_COUNT_APPROVE).
   */
  "inventory.adjustmentApprovalThreshold": "5000",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

@Injectable()
export class StoreSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getAll(): Promise<Record<SettingKey, string>> {
    const rows = await this.prisma.storeSetting.findMany();
    const result: Record<string, string> = { ...SETTING_DEFAULTS };
    for (const row of rows) {
      if (row.key in SETTING_DEFAULTS && typeof row.value === "string") {
        result[row.key] = row.value;
      }
    }
    return result as Record<SettingKey, string>;
  }

  async getAdjustmentThreshold(): Promise<Prisma.Decimal> {
    const all = await this.getAll();
    return new Prisma.Decimal(all["inventory.adjustmentApprovalThreshold"]);
  }

  async update(userId: string, changes: { adjustmentApprovalThreshold?: string }) {
    if (changes.adjustmentApprovalThreshold !== undefined) {
      let value: Prisma.Decimal;
      try {
        value = new Prisma.Decimal(changes.adjustmentApprovalThreshold);
      } catch {
        throw new BadRequestException("The approval limit must be a number");
      }
      if (value.lt(0)) {
        throw new BadRequestException("The approval limit cannot be negative");
      }
      const key: SettingKey = "inventory.adjustmentApprovalThreshold";
      await this.prisma.storeSetting.upsert({
        where: { key },
        update: { value: value.toString(), updatedByUserId: userId },
        create: { key, value: value.toString(), updatedByUserId: userId },
      });
      await this.audit.log(userId, "UPDATE_SETTING", "StoreSetting", key, { value: value.toString() });
    }
    return this.getAll();
  }
}
