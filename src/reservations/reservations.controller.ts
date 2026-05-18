import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ReservationStatus, RoleName } from "@prisma/client";
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

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Post()
  create(@Req() req: Authed, @Body() body: CreateReservationDto) {
    return this.reservations.create(req.user.userId, body);
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Post(":id/cancel")
  cancel(@Req() req: Authed, @Param("id") id: string) {
    return this.reservations.cancel(req.user.userId, id);
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER)
  @Post(":id/complete")
  complete(@Req() req: Authed, @Param("id") id: string) {
    return this.reservations.completeAsSale(req.user.userId, id);
  }
}
