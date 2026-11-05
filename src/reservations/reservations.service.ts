import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MovementType, Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LocationsService } from "../locations/locations.service";
import { AuditService } from "../audit/audit.service";
import { lockInventoryRows, productStockSnapshot } from "../common/stock.util";
import { BUSINESS_TZ } from "../common/business-time";
import { SalesService } from "../sales/sales.service";
import { omit, viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";

/** Reservations embed their product; cost price is never part of that (it is not needed here). */
const noProductCost = <T extends { product: { costPrice: unknown } }>(r: T) => {
  const totalPrice = (r as { totalPrice?: Prisma.Decimal | null }).totalPrice ?? null;
  const depositPaid = (r as { depositPaid?: Prisma.Decimal }).depositPaid;
  const balanceDue =
    totalPrice != null && depositPaid != null
      ? totalPrice.sub(depositPaid).toFixed(2)
      : null;
  return {
    ...r,
    totalPrice: totalPrice != null ? totalPrice.toFixed(2) : null,
    depositPaid: depositPaid != null ? depositPaid.toFixed(2) : "0.00",
    balanceDue,
    product: omit(r.product, "costPrice"),
  };
};

const toDecimal = (value: string | number) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
  ) {}

  async list(params: {
    status?: ReservationStatus;
    productId?: string;
    customerId?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 20, 100);
    const skip = params.skip ?? 0;
    const where = {
      status: params.status,
      productId: params.productId,
      customerId: params.customerId,
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
    return { items: items.map(noProductCost), total, skip, take };
  }

  async create(
    userId: string,
    data: {
      productId: string;
      quantity: string;
      customerName?: string;
      customerId?: string;
      totalPrice?: string;
      depositPaid?: string;
      expiresAt?: string;
    },
  ) {
    const qty = toDecimal(data.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException("Quantity must be positive");
    }
    const defaultLoc = await this.locations.getDefault();
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException("Invalid expiry date");
    }
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Reservation expiry must be in the future");
    }

    let totalPrice: Prisma.Decimal | null = null;
    if (data.totalPrice !== undefined && data.totalPrice !== null && data.totalPrice !== "") {
      totalPrice = money(toDecimal(data.totalPrice));
      if (totalPrice.lt(0)) {
        throw new BadRequestException("totalPrice cannot be negative");
      }
    }
    let depositPaid = new Prisma.Decimal(0);
    if (data.depositPaid !== undefined && data.depositPaid !== null && data.depositPaid !== "") {
      depositPaid = money(toDecimal(data.depositPaid));
      if (depositPaid.lt(0)) {
        throw new BadRequestException("depositPaid cannot be negative");
      }
    }
    if (totalPrice != null && depositPaid.gt(totalPrice)) {
      throw new BadRequestException("depositPaid cannot exceed totalPrice");
    }
    if (data.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customer || !customer.isActive) {
        throw new BadRequestException("Customer not found or inactive");
      }
    }

    const reservation = await this.prisma.$transaction(async (tx) => {
      // Check and reserve under the same row lock so two reservations cannot both claim the last unit.
      await lockInventoryRows(tx, [data.productId], defaultLoc.id);
      const { inv, onHand, available } = await productStockSnapshot(
        tx,
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
      const created = await tx.reservation.create({
        data: {
          productId: data.productId,
          quantity: qty,
          customerName: data.customerName?.trim() || null,
          customerId: data.customerId || null,
          totalPrice,
          depositPaid,
          expiresAt,
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
    return noProductCost(reservation);
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
    return noProductCost(updated);
  }

  async update(
    userId: string,
    id: string,
    data: {
      quantity?: string;
      customerName?: string;
      customerId?: string | null;
      totalPrice?: string | null;
      depositPaid?: string;
    },
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

    let customerId = reservation.customerId;
    if (data.customerId !== undefined) {
      customerId = data.customerId?.trim() || null;
      if (customerId) {
        const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer || !customer.isActive) {
          throw new BadRequestException("Customer not found or inactive");
        }
      }
    }

    let totalPrice = reservation.totalPrice;
    if (data.totalPrice === null) {
      totalPrice = null;
    } else if (data.totalPrice !== undefined) {
      totalPrice = money(toDecimal(data.totalPrice));
      if (totalPrice.lt(0)) {
        throw new BadRequestException("totalPrice cannot be negative");
      }
    }

    let depositPaid = reservation.depositPaid;
    const previousDeposit = reservation.depositPaid;
    if (data.depositPaid !== undefined) {
      depositPaid = money(toDecimal(data.depositPaid));
      if (depositPaid.lt(0)) {
        throw new BadRequestException("depositPaid cannot be negative");
      }
    }
    if (totalPrice != null && depositPaid.gt(totalPrice)) {
      throw new BadRequestException("depositPaid cannot exceed totalPrice");
    }

    const { onHand } = await productStockSnapshot(
      this.prisma,
      reservation.productId,
      defaultLoc.id,
    );
    if (newQty.gt(onHand)) {
      throw new BadRequestException(`Quantity cannot exceed on hand (${onHand.toString()})`);
    }

    const qtyDelta = newQty.sub(oldQty);
    const depositIncreased = depositPaid.gt(previousDeposit);
    if (
      qtyDelta.eq(0) &&
      customerName === reservation.customerName &&
      customerId === reservation.customerId &&
      ((totalPrice == null && reservation.totalPrice == null) ||
        (totalPrice != null && reservation.totalPrice != null && totalPrice.eq(reservation.totalPrice))) &&
      depositPaid.eq(previousDeposit)
    ) {
      return noProductCost(reservation);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.update({
        where: { id },
        data: { quantity: newQty, customerName, customerId, totalPrice, depositPaid },
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
      customerId,
      totalPrice: totalPrice?.toFixed(2) ?? null,
      depositPaid: depositPaid.toFixed(2),
      ...(depositIncreased
        ? {
            depositIncrease: money(depositPaid.sub(previousDeposit)).toFixed(2),
          }
        : {}),
    });
    return noProductCost(updated);
  }

  async completeAsSale(actor: Actor, id: string) {
    const userId = actor.userId;
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
    });
    if (!reservation) {
      throw new NotFoundException("Reservation not found");
    }
    if (reservation.status !== ReservationStatus.RESERVED) {
      throw new BadRequestException("Reservation is not active");
    }

    const checkout = await this.sales.checkout(
      actor,
      {
        lines: [
          {
            productId: reservation.productId,
            quantity: reservation.quantity.toString(),
            reservationId: id,
          },
        ],
        notes: `Reservation ${id}`,
      },
      `reservation-complete:${id}`,
      viewerFor(actor),
    );

    await this.audit.log(userId, "COMPLETE_RESERVE", "Reservation", id, {
      saleId: checkout.sale.id,
    });

    return {
      reservation: { ...reservation, status: ReservationStatus.COMPLETED },
      ...checkout,
    };
  }

  /** Every 15 minutes: expire reservations whose time is up and release their stock. */
  @Cron("*/15 * * * *", { timeZone: BUSINESS_TZ })
  async sweepExpired() {
    try {
      const count = await this.expireDue();
      if (count > 0) {
        this.logger.log(`Expired ${count} reservation(s)`);
      }
    } catch (err) {
      this.logger.error(`Reservation expiry sweep failed: ${String(err)}`);
    }
  }

  /**
   * Mark reservations past their `expiresAt` as EXPIRED and write a RELEASE_RESERVE movement for
   * each. Stock availability already ignores expired reservations; this keeps the status and the
   * ledger in step. Returns how many were expired.
   */
  async expireDue(now: Date = new Date()) {
    const due = await this.prisma.reservation.findMany({
      where: { status: ReservationStatus.RESERVED, expiresAt: { lte: now } },
      select: { id: true },
    });
    if (due.length === 0) {
      return 0;
    }
    const defaultLoc = await this.locations.getDefault();
    let expired = 0;
    for (const { id } of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({ where: { id } });
        if (!reservation || reservation.status !== ReservationStatus.RESERVED) {
          return false;
        }
        await lockInventoryRows(tx, [reservation.productId], defaultLoc.id);
        const { inv, onHand, available } = await productStockSnapshot(
          tx,
          reservation.productId,
          defaultLoc.id,
        );
        await tx.reservation.update({
          where: { id },
          data: { status: ReservationStatus.EXPIRED },
        });
        if (inv) {
          await tx.stockMovement.create({
            data: {
              inventoryItemId: inv.id,
              type: MovementType.RELEASE_RESERVE,
              qtyDelta: reservation.quantity.neg(),
              beforeOnHand: onHand,
              afterOnHand: onHand,
              refType: "RESERVATION",
              refId: id,
              notes: "Reservation expired",
              metadata: {
                reservationId: id,
                reservedQty: reservation.quantity.neg().toString(),
                availableBefore: available.sub(reservation.quantity).toString(),
                availableAfter: available.toString(),
                customerName: reservation.customerName,
                expired: true,
              },
            },
          });
        }
        await tx.auditLog.create({
          data: { action: "EXPIRE_RESERVE", entity: "Reservation", entityId: id },
        });
        return true;
      });
      if (done) {
        expired += 1;
      }
    }
    return expired;
  }
}
