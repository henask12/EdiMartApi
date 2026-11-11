import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_POS_PAYMENT_METHODS = JSON.stringify([
  { method: "CASH", enabled: true, requireReference: false, requireProof: false },
  { method: "TELEBIRR", enabled: true, requireReference: true, requireProof: false },
  { method: "CBE_BIRR", enabled: true, requireReference: true, requireProof: false },
  { method: "MPESA", enabled: true, requireReference: true, requireProof: false },
  { method: "BANK_TRANSFER", enabled: true, requireReference: true, requireProof: false },
  { method: "CARD", enabled: true, requireReference: false, requireProof: false },
  { method: "STORE_CREDIT", enabled: true, requireReference: false, requireProof: false },
  { method: "CUSTOMER_ACCOUNT", enabled: true, requireReference: false, requireProof: false },
]);

/** Known settings and their defaults. Values are stored as JSON in StoreSetting rows. */
export const SETTING_DEFAULTS = {
  /**
   * A stock correction worth more than this (quantity x average cost, in Birr) needs a manager's
   * PIN approval unless the person making it can approve (STOCK_COUNT_APPROVE).
   */
  "inventory.adjustmentApprovalThreshold": "5000",
  "pos.vatRate": "15",
  "pos.pricesIncludeVat": "true",
  "pos.discountLimitPercent": "10",
  "pos.returnWindowDays": "7",
  "pos.receiptFooter": "",
  "pos.receiptTin": "",
  "pos.shopName": "Edi's Collection",
  "pos.shopAddress": "",
  "pos.shopPhone": "",
  "pos.scannerBeep": "true",
  "pos.favourites": "[]",
  "pos.paymentMethods": DEFAULT_POS_PAYMENT_METHODS,
  "pos.cashDenominations": "[1,5,10,50,100,200]",
  "pos.labelAsTaxInvoice": "false",
  "shifts.requireOpenShift": "false",
  "shifts.varianceApprovalThreshold": "100",
  "shifts.eodEmailEnabled": "true",
  /** PO subtotal (Birr) above this needs PURCHASE_APPROVE (or owner). */
  "purchasing.poApproveThreshold": "10000",
  /** Points earned per Birr spent (0.1 = 1 point per Br 10). */
  "loyalty.pointsPerBirr": "0.1",
  /** Birr discount per loyalty point redeemed (0.1 = 100 points = Br 10). */
  "loyalty.birrPerRedeemPoint": "0.1",
  "loyalty.enabled": "true",
  "customers.defaultCreditLimit": "0",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

/** PATCH body aliases (camelCase) → setting keys. */
const UPDATE_ALIASES: Record<string, SettingKey> = {
  adjustmentApprovalThreshold: "inventory.adjustmentApprovalThreshold",
  vatRate: "pos.vatRate",
  pricesIncludeVat: "pos.pricesIncludeVat",
  discountLimitPercent: "pos.discountLimitPercent",
  returnWindowDays: "pos.returnWindowDays",
  receiptFooter: "pos.receiptFooter",
  receiptTin: "pos.receiptTin",
  shopName: "pos.shopName",
  shopAddress: "pos.shopAddress",
  shopPhone: "pos.shopPhone",
  scannerBeep: "pos.scannerBeep",
  favourites: "pos.favourites",
  paymentMethods: "pos.paymentMethods",
  cashDenominations: "pos.cashDenominations",
  labelAsTaxInvoice: "pos.labelAsTaxInvoice",
  requireOpenShift: "shifts.requireOpenShift",
  varianceApprovalThreshold: "shifts.varianceApprovalThreshold",
  eodEmailEnabled: "shifts.eodEmailEnabled",
  poApproveThreshold: "purchasing.poApproveThreshold",
  pointsPerBirr: "loyalty.pointsPerBirr",
  birrPerRedeemPoint: "loyalty.birrPerRedeemPoint",
  loyaltyEnabled: "loyalty.enabled",
  defaultCreditLimit: "customers.defaultCreditLimit",
};

export type StoreSettingsUpdate = Partial<Record<SettingKey, string>> & {
  adjustmentApprovalThreshold?: string;
  vatRate?: string;
  pricesIncludeVat?: string;
  discountLimitPercent?: string;
  returnWindowDays?: string;
  receiptFooter?: string;
  receiptTin?: string;
  shopName?: string;
  shopAddress?: string;
  shopPhone?: string;
  scannerBeep?: string;
  favourites?: string;
  paymentMethods?: string;
  cashDenominations?: string;
  labelAsTaxInvoice?: string;
  requireOpenShift?: string;
  varianceApprovalThreshold?: string;
  eodEmailEnabled?: string;
  poApproveThreshold?: string;
  pointsPerBirr?: string;
  birrPerRedeemPoint?: string;
  loyaltyEnabled?: string;
  defaultCreditLimit?: string;
};

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
    // Migrate placeholder list that included non-circulating 500/1000 notes.
    if (result["pos.cashDenominations"] === "[50,100,200,500,1000]") {
      result["pos.cashDenominations"] = SETTING_DEFAULTS["pos.cashDenominations"];
    }

    // One-shot ops flip: Phase 5 defaulted require-open-shift on. Single-staff shops
    // leave it off; the owner can turn it back on in Settings → POS after this runs once.
    const optionalShiftResetKey = "shifts._optionalShiftReset_v1";
    if (!rows.some((row) => row.key === optionalShiftResetKey)) {
      await this.prisma.storeSetting.upsert({
        where: { key: "shifts.requireOpenShift" },
        update: { value: "false" },
        create: { key: "shifts.requireOpenShift", value: "false" },
      });
      await this.prisma.storeSetting.upsert({
        where: { key: optionalShiftResetKey },
        update: { value: "1" },
        create: { key: optionalShiftResetKey, value: "1" },
      });
      result["shifts.requireOpenShift"] = "false";
    }

    return result as Record<SettingKey, string>;
  }

  async getAdjustmentThreshold(): Promise<Prisma.Decimal> {
    const all = await this.getAll();
    return new Prisma.Decimal(all["inventory.adjustmentApprovalThreshold"]);
  }

  async getPoApproveThreshold(): Promise<Prisma.Decimal> {
    const all = await this.getAll();
    return new Prisma.Decimal(all["purchasing.poApproveThreshold"] || "10000");
  }

  async getPosNumber(key: SettingKey, fallback: string): Promise<Prisma.Decimal> {
    const all = await this.getAll();
    try {
      return new Prisma.Decimal(all[key] || fallback);
    } catch {
      return new Prisma.Decimal(fallback);
    }
  }

  async update(userId: string, changes: StoreSettingsUpdate) {
    const resolved = new Map<SettingKey, string>();

    for (const [rawKey, rawValue] of Object.entries(changes)) {
      if (rawValue === undefined || rawValue === null) {
        continue;
      }
      if (typeof rawValue !== "string") {
        throw new BadRequestException(`Setting ${rawKey} must be a string`);
      }
      const key =
        (UPDATE_ALIASES[rawKey] as SettingKey | undefined) ??
        (rawKey in SETTING_DEFAULTS ? (rawKey as SettingKey) : undefined);
      if (!key) {
        continue;
      }
      resolved.set(key, rawValue);
    }

    if (resolved.has("inventory.adjustmentApprovalThreshold")) {
      const raw = resolved.get("inventory.adjustmentApprovalThreshold")!;
      let value: Prisma.Decimal;
      try {
        value = new Prisma.Decimal(raw);
      } catch {
        throw new BadRequestException("The approval limit must be a number");
      }
      if (value.lt(0)) {
        throw new BadRequestException("The approval limit cannot be negative");
      }
      resolved.set("inventory.adjustmentApprovalThreshold", value.toString());
    }

    for (const numericKey of [
      "pos.vatRate",
      "pos.discountLimitPercent",
      "pos.returnWindowDays",
      "shifts.varianceApprovalThreshold",
      "purchasing.poApproveThreshold",
      "loyalty.pointsPerBirr",
      "loyalty.birrPerRedeemPoint",
      "customers.defaultCreditLimit",
    ] as SettingKey[]) {
      if (!resolved.has(numericKey)) {
        continue;
      }
      let value: Prisma.Decimal;
      try {
        value = new Prisma.Decimal(resolved.get(numericKey)!);
      } catch {
        throw new BadRequestException(`${numericKey} must be a number`);
      }
      if (value.lt(0)) {
        throw new BadRequestException(`${numericKey} cannot be negative`);
      }
      resolved.set(numericKey, value.toString());
    }

    for (const boolKey of [
      "shifts.requireOpenShift",
      "shifts.eodEmailEnabled",
      "loyalty.enabled",
    ] as SettingKey[]) {
      if (!resolved.has(boolKey)) {
        continue;
      }
      const raw = resolved.get(boolKey)!.trim().toLowerCase();
      if (raw !== "true" && raw !== "false") {
        throw new BadRequestException(`${boolKey} must be "true" or "false"`);
      }
      resolved.set(boolKey, raw);
    }

    for (const jsonKey of ["pos.favourites", "pos.paymentMethods", "pos.cashDenominations"] as SettingKey[]) {
      if (!resolved.has(jsonKey)) {
        continue;
      }
      try {
        JSON.parse(resolved.get(jsonKey)!);
      } catch {
        throw new BadRequestException(`${jsonKey} must be valid JSON`);
      }
    }

    for (const [key, value] of resolved) {
      await this.prisma.storeSetting.upsert({
        where: { key },
        update: { value, updatedByUserId: userId },
        create: { key, value, updatedByUserId: userId },
      });
      await this.audit.log(userId, "UPDATE_SETTING", "StoreSetting", key, { value });
    }

    return this.getAll();
  }
}
