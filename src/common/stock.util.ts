import { Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Units held by active reservations. A reservation past its `expiresAt` stops counting
 * immediately, even before the sweep job has marked it EXPIRED.
 */
export const getReservedQty = async (
  prisma: Db,
  productId: string,
  options?: { excludeReservationId?: string },
) => {
  const agg = await prisma.reservation.aggregate({
    where: {
      productId,
      status: ReservationStatus.RESERVED,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      ...(options?.excludeReservationId ? { id: { not: options.excludeReservationId } } : {}),
    },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? new Prisma.Decimal(0);
};

export const productStockSnapshot = async (
  prisma: Db,
  productId: string,
  locationId: string,
  options?: { excludeReservationId?: string },
) => {
  const inv = await prisma.inventoryItem.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  const onHand = inv?.quantityOnHand ?? new Prisma.Decimal(0);
  const reserved = await getReservedQty(prisma, productId, options);
  const available = onHand.sub(reserved);
  return { inv, onHand, reserved, available };
};

/**
 * Lock the inventory rows (one per product) for the rest of the transaction, in a stable
 * order so two carts containing the same products can never deadlock each other.
 */
export const lockInventoryRows = async (
  tx: Prisma.TransactionClient,
  productIds: string[],
  locationId: string,
) => {
  const ids = [...new Set(productIds)].sort();
  for (const productId of ids) {
    await tx.$queryRaw`
      SELECT "id" FROM "InventoryItem"
      WHERE "productId" = ${productId} AND "locationId" = ${locationId}
      FOR UPDATE`;
  }
};

export type BatchAllocation = { batchId: string | null; quantity: Prisma.Decimal };

/**
 * First-expired-first-out allocation of `quantity` units to stock batches, decrementing
 * `qtyRemaining`. Units that no batch covers (stock that predates batch tracking, e.g. seeded
 * or migrated opening stock) come back as a single allocation with `batchId: null`.
 */
export const allocateFromBatches = async (
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: Prisma.Decimal,
): Promise<BatchAllocation[]> => {
  const batches = await tx.stockBatch.findMany({
    where: { productId, qtyRemaining: { gt: 0 } },
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
  });
  const allocations: BatchAllocation[] = [];
  let left = quantity;
  for (const batch of batches) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(batch.qtyRemaining, left);
    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { qtyRemaining: batch.qtyRemaining.sub(take) },
    });
    allocations.push({ batchId: batch.id, quantity: take });
    left = left.sub(take);
  }
  if (left.gt(0)) {
    allocations.push({ batchId: null, quantity: left });
  }
  return allocations;
};
