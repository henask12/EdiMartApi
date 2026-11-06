import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { ReorderService } from "./reorder.service";
import { qty4 } from "./document-numbers";

class ReorderLineDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  unitCost?: string;
}

class CreatePosFromReorderDto {
  @IsString()
  supplierId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderLineDto)
  lines!: ReorderLineDto[];
}

@Controller("purchasing")
export class PurchasingController {
  constructor(
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly reorder: ReorderService,
  ) {}

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get("incoming")
  async incoming(@Query("productId") productId?: string) {
    if (!productId?.trim()) {
      return { productId: null, incoming: "0.0000" };
    }
    const incoming = await this.purchaseOrders.incomingForProduct(productId.trim());
    return { productId: productId.trim(), incoming: qty4(incoming) };
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get("reorder-suggestions")
  suggestions(@Req() req: { user: Actor }) {
    return this.reorder.suggestions(viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post("reorder-suggestions/create-pos")
  createPos(@Req() req: { user: Actor }, @Body() body: CreatePosFromReorderDto) {
    return this.reorder.createDraftPos(req.user, body, viewerFor(req.user));
  }
}
