import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Read-only comparison of stored stock against the movement ledger. Nothing here writes data;
 * differences are reported for a person to investigate, never auto-corrected.
 *
 * Rules the ledger follows (see stock movements in inventory.service / sales.service):
 *  - RECEIPT, SALE, RETURN, ADJUSTMENT, TRANSFER and DAMAGE rows change on-hand by `qtyDelta`.
 *  - RESERVE and RELEASE_RESERVE rows only move reservations; on-hand is unchanged, so they are
 *    excluded from the sum.
 */
export const ON_HAND_NEUTRAL_TYPES = ["RESERVE", "RELEASE_RESERVE"] as const;

export type StockDriftRow = {
  inventoryItemId: string;
  productId: string;
  productName: string;
  sku: string | null;
  location: string;
  onHand: string;
  ledgerSum: string;
  /** onHand - ledgerSum. Non-zero means the stored quantity cannot be explained by the ledger. */
  drift: string;
  movementCount: number;
  /** Times a movement's "before" quantity did not match the previous movement's "after". */
  chainBreaks: number;
  /** Sum of qtyRemaining over this product's batches (null when it has none). */
  batchRemaining: string | null;
  /** Stock not covered by any batch (opening/legacy stock). Informational. */
  untrackedQty: string | null;
  /** Batches claim more units than are on hand: always an error. */
  batchesExceedOnHand: boolean;
  negativeOnHand: boolean;
  /** Active reservations hold more than is on hand. */
  overReserved: boolean;
  reserved: string;
};

export type ReconciliationReport = {
  generatedAt: string;
  totals: {
    inventoryRows: number;
    withLedgerDrift: number;
    withChainBreaks: number;
    batchesExceedOnHand: number;
    negativeOnHand: number;
    overReserved: number;
  };
  /** Only rows with at least one finding. */
  findings: StockDriftRow[];
};

type Row = {
  inventoryItemId: string;
  productId: string;
  productName: string;
  sku: string | null;
  location: string;
  onHand: string;
  ledgerSum: string;
  movementCount: bigint;
  chainBreaks: bigint;
  batchRemaining: string | null;
  reserved: string;
};

export const reconcileStock = async (prisma: PrismaClient): Promise<ReconciliationReport> => {
  const rows = await prisma.$queryRaw<Row[]>`
    WITH ledger AS (
      SELECT "inventoryItemId",
             COALESCE(SUM("qtyDelta") FILTER (WHERE "type"::text NOT IN ('RESERVE', 'RELEASE_RESERVE')), 0) AS "ledgerSum",
             COUNT(*) AS "movementCount"
        FROM "StockMovement"
       GROUP BY "inventoryItemId"
    ),
    chain AS (
      SELECT "inventoryItemId", COUNT(*) AS "chainBreaks"
        FROM (
          SELECT "inventoryItemId", "beforeOnHand",
                 LAG("afterOnHand") OVER (PARTITION BY "inventoryItemId" ORDER BY "createdAt", "id") AS prev_after
            FROM "StockMovement"
        ) t
       WHERE prev_after IS NOT NULL AND "beforeOnHand" IS NOT NULL AND "beforeOnHand" <> prev_after
       GROUP BY "inventoryItemId"
    ),
    batches AS (
      SELECT "productId", SUM("qtyRemaining") AS "batchRemaining"
        FROM "StockBatch" GROUP BY "productId"
    ),
    reserved AS (
      SELECT "productId", SUM("quantity") AS "reserved"
        FROM "Reservation"
       WHERE "status"::text = 'RESERVED' AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
       GROUP BY "productId"
    )
    SELECT ii."id" AS "inventoryItemId",
           ii."productId",
           p."name" AS "productName",
           p."sku",
           l."code" AS "location",
           ii."quantityOnHand"::text AS "onHand",
           COALESCE(ledger."ledgerSum", 0)::text AS "ledgerSum",
           COALESCE(ledger."movementCount", 0) AS "movementCount",
           COALESCE(chain."chainBreaks", 0) AS "chainBreaks",
           batches."batchRemaining"::text AS "batchRemaining",
           COALESCE(reserved."reserved", 0)::text AS "reserved"
      FROM "InventoryItem" ii
      JOIN "Product" p ON p."id" = ii."productId"
      JOIN "Location" l ON l."id" = ii."locationId"
      LEFT JOIN ledger ON ledger."inventoryItemId" = ii."id"
      LEFT JOIN chain ON chain."inventoryItemId" = ii."id"
      LEFT JOIN batches ON batches."productId" = ii."productId"
      LEFT JOIN reserved ON reserved."productId" = ii."productId"
     ORDER BY p."name"`;

  // Exact decimal arithmetic: quantities are stored with 4 decimals, never as floats.
  const dec = (v: string) => new Prisma.Decimal(v);
  const all: StockDriftRow[] = rows.map((r) => {
    const onHand = dec(r.onHand);
    const ledger = dec(r.ledgerSum);
    const batch = r.batchRemaining === null ? null : dec(r.batchRemaining);
    return {
      inventoryItemId: r.inventoryItemId,
      productId: r.productId,
      productName: r.productName,
      sku: r.sku,
      location: r.location,
      onHand: onHand.toString(),
      ledgerSum: ledger.toString(),
      drift: onHand.sub(ledger).toString(),
      movementCount: Number(r.movementCount),
      chainBreaks: Number(r.chainBreaks),
      batchRemaining: batch === null ? null : batch.toString(),
      untrackedQty: batch === null ? null : Prisma.Decimal.max(onHand.sub(batch), 0).toString(),
      batchesExceedOnHand: batch !== null && batch.gt(onHand),
      negativeOnHand: onHand.lt(0),
      overReserved: dec(r.reserved).gt(onHand),
      reserved: dec(r.reserved).toString(),
    };
  });

  const hasFinding = (r: StockDriftRow) =>
    !dec(r.drift).isZero() || r.chainBreaks > 0 || r.batchesExceedOnHand || r.negativeOnHand || r.overReserved;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      inventoryRows: all.length,
      withLedgerDrift: all.filter((r) => !dec(r.drift).isZero()).length,
      withChainBreaks: all.filter((r) => r.chainBreaks > 0).length,
      batchesExceedOnHand: all.filter((r) => r.batchesExceedOnHand).length,
      negativeOnHand: all.filter((r) => r.negativeOnHand).length,
      overReserved: all.filter((r) => r.overReserved).length,
    },
    findings: all.filter(hasFinding),
  };
};
