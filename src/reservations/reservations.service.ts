import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MovementType, Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { productStockSnapshot } from "../common/stock.util";
import { SalesService } from "../sales/sales.service";

const toDecimal = (value: string | number) => new Prisma.Decimal(value);

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
  ) {}

  async list(params: {
    status?: ReservationStatus;
    productId?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 20, 100);
    const skip = params.skip ?? 0;
    const where = {
      status: params.status,
      productId: params.productId,
    };
    const [items, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          product: { include: { category: true } },
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.reservation.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async create(
    userId: string,
    data: { productId: string; quantity: string; customerName?: string; expiresAt?: string },
  ) {
    const qty = toDecimal(data.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException("Quantity must be positive");
    }
    const defaultLoc = await this.locations.getDefault();
    const { inv, onHand, available } = await productStockSnapshot(
      this.prisma,
      data.productId,
      defaultLoc.id,
    );
    if (!inv) {
      throw new NotFoundException("No inventory for product");
    }
    if (available.lt(qty)) {
      throw new BadRequestException("Not enough available stock to reserve");
    }

    const availableAfter = available.sub(qty);
    const reservation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reservation.create({
        data: {
          productId: data.productId,
          quantity: qty,
          customerName: data.customerName?.trim() || null,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          createdByUserId: userId,
        },
        include: { product: true },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: inv.id,
          type: MovementType.RESERVE,
          qtyDelta: qty,
          beforeOnHand: onHand,
          afterOnHand: onHand,
          refType: "RESERVATION",
          refId: created.id,
          createdByUserId: userId,
          metadata: {
            reservationId: created.id,
            reservedQty: qty.toString(),
            availableBefore: available.toString(),
            availableAfter: availableAfter.toString(),
            customerName: created.customerName,
          },
        },
      });
      return created;
    });

    await this.audit.log(userId, "RESERVE", "Reservation", reservation.id, {
      productId: data.productId,
      quantity: data.quantity,
    });
    return reservation;
  }

  async cancel(userId: string, id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { product: true },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }
    if (reservation.status !== ReservationStatus.RESERVED) {
      throw new BadRequestException("Only active reservations can be cancelled");
    }
    const defaultLoc = await this.locations.getDefault();
    const inv = await this.prisma.inventoryItem.findUnique({
      where: {
        productId_locationId: {
          productId: reservation.productId,
          locationId: defaultLoc.id,
        },
      },
    });
    if (!inv) {
      throw new NotFoundException("Inventory not found");
    }

    const { onHand, available } = await productStockSnapshot(
      this.prisma,
      reservation.productId,
      defaultLoc.id,
    );
    const availableAfter = available.add(reservation.quantity);

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.CANCELLED },
        include: { product: true },
      });
      await tx.stockMovement.create({
        data: {
          inventoryItemId: inv.id,
          type: MovementType.RELEASE_RESERVE,
          qtyDelta: reservation.quantity.mul(-1),
          beforeOnHand: onHand,
          afterOnHand: onHand,
          refType: "RESERVATION",
          refId: id,
          createdByUserId: userId,
          metadata: {
            reservationId: id,
            reservedQty: reservation.quantity.neg().toString(),
            availableBefore: available.toString(),
            availableAfter: availableAfter.toString(),
            customerName: reservation.customerName,
          },
        },
      });
      return res;
    });

    await this.audit.log(userId, "CANCEL_RESERVE", "Reservation", id);
    return updated;
  }

  async update(
    userId: string,
    id: string,
    data: { quantity?: string; customerName?: string },
  ) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      include: { product: true },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }
    if (reservation.status !== ReservationStatus.RESERVED) {
      throw new BadRequestException("Only active reservations can be edited");
    }

    const defaultLoc = await this.locations.getDefault();
    const inv = await this.prisma.inventoryItem.findUnique({
      where: {
        productId_locationId: {
          productId: reservation.productId,
          locationId: defaultLoc.id,
        },
      },
    });
    if (!inv) {
      throw new NotFoundException("Inventory not found");
    }

    const oldQty = reservation.quantity;
    const newQty = data.quantity !== undefined ? toDecimal(data.quantity) : oldQty;
    if (newQty.lte(0)) {
      throw new BadRequestException("Quantity must be positive");
    }

    const customerName =
      data.customerName !== undefined
        ? data.customerName.trim() || null
        : reservation.customerName;

    const { onHand } = await productStockSnapshot(
      this.prisma,
      reservation.productId,
      defaultLoc.id,
    );
    if (newQty.gt(onHand)) {
      throw new BadRequestException(`Quantity cannot exceed on hand (${onHand.toString()})`);
    }

    const qtyDelta = newQty.sub(oldQty);
    if (qtyDelta.eq(0) && customerName === reservation.customerName) {
      return reservation;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.update({
        where: { id },
        data: { quantity: newQty, customerName },
        include: { product: true },
      });

      if (!qtyDelta.eq(0)) {
        const { available: availBefore } = await productStockSnapshot(
          tx,
          reservation.productId,
          defaultLoc.id,
        );
        const availAfter = availBefore.sub(qtyDelta);
        if (qtyDelta.gt(0)) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: MovementType.RESERVE,
              qtyDelta,
              beforeOnHand: onHand,
              afterOnHand: onHand,
              refType: "RESERVATION",
              refId: id,
              createdByUserId: userId,
              metadata: {
                reservationId: id,
                reservedQty: qtyDelta.toString(),
                availableBefore: availBefore.toString(),
                availableAfter: availAfter.toString(),
                customerName,
                adjustment: true,
              },
            },
          });
        } else {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: MovementType.RELEASE_RESERVE,
              qtyDelta,
              beforeOnHand: onHand,
              afterOnHand: onHand,
              refType: "RESERVATION",
              refId: id,
              createdByUserId: userId,
              metadata: {
                reservationId: id,
                reservedQty: qtyDelta.toString(),
                availableBefore: availBefore.toString(),
                availableAfter: availAfter.toString(),
                customerName,
                adjustment: true,
              },
            },
          });
        }
      }

      return res;
    });

    await this.audit.log(userId, "UPDATE_RESERVE", "Reservation", id, {
      quantity: newQty.toString(),
      customerName,
    });
    return updated;
  }

  async completeAsSale(userId: string, id: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }
    if (reservation.status !== ReservationStatus.RESERVED) {
      throw new BadRequestException("Reservation is not active");
    }

    const checkout = await this.sales.checkout(userId, {
      lines: [
        {
          productId: reservation.productId,
          quantity: reservation.quantity.toString(),
          reservationId: id,
        },
      ],
      notes: `Reservation ${id}`,
    });

    await this.audit.log(userId, "COMPLETE_RESERVE", "Reservation", id, {
      saleId: checkout.sale.id,
    });

    return {
      reservation: { ...reservation, status: ReservationStatus.COMPLETED },
      ...checkout,
    };
  }
}
