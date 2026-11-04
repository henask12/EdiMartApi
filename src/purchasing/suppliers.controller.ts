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
import { PermissionKey } from "@prisma/client";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../common/decorators/permissions.decorator";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { SuppliersService } from "./suppliers.service";

class CreateSupplierDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  telegram?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  tin?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  minimumOrder?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  contactName?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  telegram?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  tin?: string | null;

  @IsOptional()
  @IsString()
  paymentTerms?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsString()
  minimumOrder?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class LinkProductDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  supplierSku?: string;

  @IsOptional()
  @IsString()
  lastCost?: string;

  @IsOptional()
  @IsBoolean()
  isPreferred?: boolean;
}

@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @RequireAnyPermission(PermissionKey.PRODUCTS_VIEW, PermissionKey.SUPPLIERS_MANAGE)
  @Get()
  list(
    @Query("q") q?: string,
    @Query("activeOnly") activeOnly?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.suppliers.list({
      q,
      activeOnly: activeOnly === "false" ? false : true,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequireAnyPermission(PermissionKey.PRODUCTS_VIEW, PermissionKey.SUPPLIERS_MANAGE)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.suppliers.get(id);
  }

  @RequirePermissions(PermissionKey.SUPPLIERS_MANAGE)
  @Post()
  create(@Req() req: { user: Actor }, @Body() body: CreateSupplierDto) {
    return this.suppliers.create(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.SUPPLIERS_MANAGE)
  @Patch(":id")
  update(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: UpdateSupplierDto) {
    return this.suppliers.update(req.user.userId, id, body);
  }

  @RequireAnyPermission(PermissionKey.PRODUCTS_VIEW, PermissionKey.SUPPLIERS_MANAGE)
  @Get(":id/products")
  listProducts(@Req() req: { user: Actor }, @Param("id") id: string) {
    return this.suppliers.listProducts(id, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.SUPPLIERS_MANAGE)
  @Post(":id/products")
  linkProduct(@Req() req: { user: Actor }, @Param("id") id: string, @Body() body: LinkProductDto) {
    return this.suppliers.linkProduct(req.user.userId, id, body, viewerFor(req.user).includeCost);
  }

  @RequireAnyPermission(PermissionKey.PRODUCTS_VIEW, PermissionKey.SUPPLIERS_MANAGE)
  @Get(":id/products/:productId/cost-history")
  costHistory(
    @Req() req: { user: Actor },
    @Param("id") id: string,
    @Param("productId") productId: string,
  ) {
    return this.suppliers.costHistory(id, productId, viewerFor(req.user).includeCost);
  }
}
