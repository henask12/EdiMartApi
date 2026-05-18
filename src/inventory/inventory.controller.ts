import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { RoleName } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { InventoryService } from "./inventory.service";
import { IsOptional, IsString, MinLength } from "class-validator";

class ReceiveDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitCost!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class AdjustDto {
  @IsString()
  productId!: string;

  @IsString()
  quantityDelta!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ReturnDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  refSaleId?: string;
}

type Authed = { user: { userId: string } };

@Controller("inventory")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get("movements")
  listMovements(
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

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Post("receive")
  receive(@Req() req: Authed, @Body() body: ReceiveDto) {
    return this.inventory.receiveGoods(req.user.userId, body);
  }

  @Roles(RoleName.OWNER, RoleName.STORE_STAFF)
  @Post("adjust")
  adjust(@Req() req: Authed, @Body() body: AdjustDto) {
    return this.inventory.adjustStock(req.user.userId, body);
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Post("return")
  returnToStock(@Req() req: Authed, @Body() body: ReturnDto) {
    return this.inventory.returnToStock(req.user.userId, body);
  }
}
