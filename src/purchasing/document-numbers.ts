import { Prisma } from "@prisma/client";
import { businessDateString } from "../common/business-time";

/** Allocate the next document number for a scope: PREFIX-YYYYMMDD-NNNN. */
export const nextDocumentNumber = async (
  tx: Prisma.TransactionClient,
  scope: string,
  prefix: string,
): Promise<string> => {
  const date = businessDateString();
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentCounter" ("scope", "date", "value") VALUES (${scope}, ${date}, 1)
    ON CONFLICT ("scope", "date") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
    RETURNING "value"`;
  return `${prefix}-${date.replace(/-/g, "")}-${String(rows[0].value).padStart(4, "0")}`;
};

export const toDecimal = (value: string | number | Prisma.Decimal) => new Prisma.Decimal(value);

export const money2 = (d: Prisma.Decimal) => d.toFixed(2);
export const qty4 = (d: Prisma.Decimal) => d.toFixed(4);
