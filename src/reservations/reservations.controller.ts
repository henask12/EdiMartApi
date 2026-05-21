import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ReservationStatus } from ".prisma/client";
import { CASHIER_ROLE, OWNER_ROLE, STORE_STAFF_ROLE } from "../common/role.constants";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { ReservationsService } from "./reservations.service";

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
  expiresAt?: string;
}

class UpdateReservationDto {
  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  customerName?: string;
}

type Authed = { user: { userId: string } };

@Controller("reservations")
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  list(
    @Query("status") status?: ReservationStatus,
    @Query("productId") productId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.reservations.list({
      status,
      productId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateReservationDto) {
    return this.reservations.create(req.user.userId, body);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Patch(":id")
  update(@Req() req: Authed, @Param("id") id: string, @Body() body: UpdateReservationDto) {
    return this.reservations.update(req.user.userId, id, body);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Post(":id/cancel")
  cancel(@Req() req: Authed, @Param("id") id: string) {
    return this.reservations.cancel(req.user.userId, id);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE)
  @Post(":id/complete")
  complete(@Req() req: Authed, @Param("id") id: string) {
    return this.reservations.completeAsSale(req.user.userId, id);
  }
}
