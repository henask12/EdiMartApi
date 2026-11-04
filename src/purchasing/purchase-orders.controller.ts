import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PermissionKey, PurchaseOrderStatus } from "@prisma/client";
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

class PoLineDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitCost!: string;
}

class CreatePoDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  expectedAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines!: PoLineDto[];
}

class UpdatePoDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  expectedAt?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines?: PoLineDto[];
}

@Controller("purchase-orders")
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get()
  list(
    @Req() req: { user: Actor },
    @Query("status") status?: PurchaseOrderStatus,
    @Query("supplierId") supplierId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.purchaseOrders.list(viewerFor(req.user), {
      status,
      supplierId,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreatePoDto) {
    return this.purchaseOrders.create(req.user, body, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get(":id")
  get(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.purchaseOrders.get(id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Patch(":id")
  update(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: UpdatePoDto) {
    return this.purchaseOrders.updateDraft(req.user, id, body, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/approve")
  approve(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.purchaseOrders.approve(req.user, id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/send")
  send(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.purchaseOrders.send(req.user, id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/cancel")
  cancel(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.purchaseOrders.cancel(req.user, id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/close")
  close(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.purchaseOrders.close(req.user, id, viewerFor(req.user));
  }
}
