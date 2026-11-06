import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { PermissionKey, ReservationStatus } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { ReservationsService } from "./reservations.service";
import type { Actor } from "../permissions/permissions.service";

class CreateReservationDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  totalPrice?: string;

  @IsOptional()
  @IsString()
  depositPaid?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

class UpdateReservationDto {
  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  totalPrice?: string | null;

  @IsOptional()
  @IsString()
  depositPaid?: string;
}

type Authed = { user: Actor };

@Controller("reservations")
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @RequirePermissions(PermissionKey.RESERVATIONS_MANAGE)
  @Get()
  list(
    @Query("status") status?: ReservationStatus,
    @Query("productId") productId?: string,
    @Query("customerId") customerId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.reservations.list({
      status,
      productId,
      customerId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.PRODUCTS_RESERVE)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateReservationDto) {
    return this.reservations.create(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.RESERVATIONS_MANAGE)
  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateReservationDto) {
    return this.reservations.update(req.user.userId, id, body);
  }

  @RequirePermissions(PermissionKey.RESERVATIONS_MANAGE)
  @Post(":id/update")
  updatePost(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateReservationDto) {
    return this.reservations.update(req.user.userId, id, body);
  }

  @RequirePermissions(PermissionKey.RESERVATIONS_MANAGE)
  @Post(":id/cancel")
  cancel(@Req() req: Authed, @Param("id") id: string) {
    return this.reservations.cancel(req.user.userId, id);
  }

  @RequirePermissions(PermissionKey.RESERVATIONS_MANAGE, PermissionKey.SALES_CREATE)
  @Post(":id/complete")
  complete(@Req() req: Authed, @Param("id") id: string) {
    return this.reservations.completeAsSale(req.user, id);
  }
}
