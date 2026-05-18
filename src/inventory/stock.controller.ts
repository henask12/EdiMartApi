import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { RoleName } from "@prisma/client";
import { IsOptional, IsString } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { InventoryService } from "./inventory.service";

class ReceiveStockDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitCost!: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

type Authed = { user: { userId: string } };

@Controller("stock")
export class StockController {
  constructor(private readonly inventory: InventoryService) {}

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Post("receive")
  receive(@Req() req: Authed, @Body() body: ReceiveStockDto) {
    return this.inventory.receiveGoods(req.user.userId, body);
  }

  @Get("history")
  history(
    @Query("productId") productId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.inventory.listMovements({
      productId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get("batches")
  batches(@Query("productId") productId: string) {
    return this.inventory.listBatches(productId);
  }
}
