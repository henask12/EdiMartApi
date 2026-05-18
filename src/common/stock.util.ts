import { Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const getReservedQty = async (
  prisma: PrismaService | Prisma.TransactionClient,
  productId: string,
) => {
  const agg = await prisma.reservation.aggregate({
    where: { productId, status: ReservationStatus.RESERVED },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? new Prisma.Decimal(0);
};

export const productStockSnapshot = async (
  prisma: PrismaService | Prisma.TransactionClient,
  productId: string,
  locationId: string,
) => {
  const inv = await prisma.inventoryItem.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  const onHand = inv?.quantityOnHand ?? new Prisma.Decimal(0);
  const reserved = await getReservedQty(prisma, productId);
  const available = onHand.sub(reserved);
  return { inv, onHand, reserved, available };
};
