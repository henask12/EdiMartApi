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
    const { inv, available } = await productStockSnapshot(
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
          refType: "RESERVATION",
          refId: created.id,
          createdByUserId: userId,
          metadata: { reservationId: created.id },
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
          refType: "RESERVATION",
          refId: id,
          createdByUserId: userId,
          metadata: { reservationId: id },
        },
      });
      return res;
    });

    await this.audit.log(userId, "CANCEL_RESERVE", "Reservation", id);
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
