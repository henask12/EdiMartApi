import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { PricesService } from "./prices.service";
import { IsOptional, IsString } from "class-validator";

type Authed = { user: { userId: string } };

class ChangePriceDto {
  @IsString() productId!: string;
  @IsString() newPrice!: string;
  @IsOptional() @IsString() note?: string;
}

@Controller("prices")
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @RequirePermissions(PermissionKey.PRICES_MANAGE)
  @Post("change")
  change(@Req() req: Authed, @Body() body: ChangePriceDto) {
    return this.prices.changePrice(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.PRICES_MANAGE)
  @Get("history")
  history(
    @Query("productId") productId: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.prices.priceHistory(productId, {
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }
}
