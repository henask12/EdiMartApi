import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { PermissionKey } from "@prisma/client";
import type { Response } from "express";
import { RequireAnyPermission, RequirePermissions } from "../common/decorators/permissions.decorator";
import { isOwnerRoleName } from "../common/role.constants";
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { CatalogService } from "./catalog.service";
import { CreateProductDto, UpdateProductDto } from "./dto/catalog.dto";
import { viewerFor } from "../permissions/access";

type Authed = { user: { userId: string; roleName: string; permissions: PermissionKey[] } };

const can = (user: Authed["user"], permission: PermissionKey) =>
  isOwnerRoleName(user.roleName) || user.permissions.includes(permission);

@Controller("products")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @RequirePermissions(PermissionKey.PRODUCTS_EXPORT)
  @Get("export")
  async exportProducts(
    @Req() req: Authed,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("q") q?: string,
    @Query("categoryId") categoryId?: string,
    @Query("productTypeId") productTypeId?: string,
    @Query("stockStatus") stockStatus?: "in_stock" | "low" | "out",
  ) {
    const result = await this.catalog.exportProducts(
      parseExportFormat(format),
      { q, categoryId, productTypeId, stockStatus },
      viewerFor(req.user).includeCost,
    );
    sendExport(res, result);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_VIEW)
  @Get()
  listProducts(
    @Req() req: Authed,
    @Query("q") q?: string,
    @Query("categoryId") categoryId?: string,
    @Query("productTypeId") productTypeId?: string,
    @Query("stockStatus") stockStatus?: "in_stock" | "low" | "out",
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.catalog.listProducts(
      {
        q,
        categoryId,
        productTypeId,
        stockStatus,
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      },
      viewerFor(req.user).includeCost,
    );
  }

  @RequirePermissions(PermissionKey.PRODUCTS_VIEW)
  @Get(":id")
  getProduct(@Req() req: Authed, @Param("id") id: string) {
    return this.catalog.getProduct(id, viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_CREATE)
  @Post()
  createProduct(@Req() req: Authed, @Body() body: CreateProductDto) {
    const includeCost = viewerFor(req.user).includeCost;
    this.assertMayWriteCost(includeCost, body.costPrice);
    return this.catalog.createProduct(req.user.userId, body, includeCost);
  }

  /**
   * Editing details needs PRODUCTS_EDIT. Switching a product on/off needs PRODUCTS_DEACTIVATE
   * (a request that only toggles `isActive` needs nothing else).
   */
  @RequireAnyPermission(PermissionKey.PRODUCTS_EDIT, PermissionKey.PRODUCTS_DEACTIVATE)
  @Patch(":id")
  updateProduct(
    @Req() req: Authed,
    @Param("id") id: string,
    @Body() body: UpdateProductDto,
  ) {
    const changed = Object.entries(body)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const togglesActive = changed.includes("isActive");
    const editsDetails = changed.some((key) => key !== "isActive");
    if (togglesActive && !can(req.user, PermissionKey.PRODUCTS_DEACTIVATE)) {
      throw new ForbiddenException("Missing required permission");
    }
    if (editsDetails && !can(req.user, PermissionKey.PRODUCTS_EDIT)) {
      throw new ForbiddenException("Missing required permission");
    }
    const includeCost = viewerFor(req.user).includeCost;
    this.assertMayWriteCost(includeCost, body.costPrice);
    return this.catalog.updateProduct(req.user.userId, id, body, includeCost);
  }

  /** Changing what a product costs needs the same permission as seeing it. */
  private assertMayWriteCost(includeCost: boolean, costPrice: unknown) {
    if (costPrice !== undefined && !includeCost) {
      throw new ForbiddenException("Changing the cost price needs permission to see costs and profit");
    }
  }
}
