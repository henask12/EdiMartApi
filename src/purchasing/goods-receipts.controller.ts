import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { GoodsReceiptsService } from "./goods-receipts.service";

class ReceiptLineDto {
  @IsOptional()
  @IsString()
  purchaseOrderLineId?: string;

  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitCost!: string;

  @IsString()
  locationId!: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  lotNumber?: string;
}

class CreateReceiptDto {
  @IsString()
  purchaseOrderId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

class LandedCostDto {
  @IsString()
  kind!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsIn(["VALUE", "QUANTITY"])
  allocateBy?: "VALUE" | "QUANTITY";
}

@Controller("goods-receipts")
export class GoodsReceiptsController {
  constructor(private readonly goodsReceipts: GoodsReceiptsService) {}

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get()
  list(
    @Req() req: { user: Actor },
    @Query("purchaseOrderId") purchaseOrderId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.goodsReceipts.list(
      {
        purchaseOrderId,
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      viewerFor(req.user).includeCost,
    );
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreateReceiptDto) {
    return this.goodsReceipts.create(req.user.userId, body, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get(":id")
  get(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.goodsReceipts.get(id, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/landed-costs")
  landedCosts(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: LandedCostDto) {
    return this.goodsReceipts.addLandedCost(req.user.userId, id, body, viewerFor(req.user).includeCost);
  }
}
