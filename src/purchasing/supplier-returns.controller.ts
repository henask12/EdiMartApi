import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { PermissionKey, SupplierReturnStatus } from "@prisma/client";
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
import { SupplierReturnsService } from "./supplier-returns.service";

class ReturnLineDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  unitCost?: string;

  @IsString()
  locationId!: string;

  @IsOptional()
  @IsString()
  stockBatchId?: string;
}

class CreateReturnDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

@Controller("supplier-returns")
export class SupplierReturnsController {
  constructor(private readonly returns: SupplierReturnsService) {}

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get()
  list(
    @Req() req: { user: Actor },
    @Query("supplierId") supplierId?: string,
    @Query("status") status?: SupplierReturnStatus,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.returns.list(
      {
        supplierId,
        status,
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      viewerFor(req.user).includeCost,
    );
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreateReturnDto) {
    return this.returns.create(req.user.userId, body, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Get(":id")
  get(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.returns.get(id, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/complete")
  complete(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.returns.complete(req.user.userId, id, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PURCHASING_MANAGE)
  @Post(":id/cancel")
  cancel(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.returns.cancel(req.user.userId, id, viewerFor(req.user).includeCost);
  }
}
