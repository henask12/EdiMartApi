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
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { isOwnerRoleName } from "../common/role.constants";
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { CatalogService } from "./catalog.service";
import { CreateProductDto, UpdateProductDto } from "./dto/catalog.dto";

type Authed = { user: { userId: string; roleName: string; permissions: PermissionKey[] } };

const can = (user: Authed["user"], permission: PermissionKey) =>
  isOwnerRoleName(user.roleName) || user.permissions.includes(permission);

@Controller("products")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @RequirePermissions(PermissionKey.PRODUCTS_EXPORT)
  @Get("export")
  async exportProducts(
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("q") q?: string,
    @Query("categoryId") categoryId?: string,
    @Query("productTypeId") productTypeId?: string,
    @Query("stockStatus") stockStatus?: "in_stock" | "low" | "out",
  ) {
    const result = await this.catalog.exportProducts(parseExportFormat(format), {
      q,
      categoryId,
      productTypeId,
      stockStatus,
    });
    sendExport(res, result);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_VIEW)
  @Get()
  listProducts(
    @Query("q") q?: string,
    @Query("categoryId") categoryId?: string,
    @Query("productTypeId") productTypeId?: string,
    @Query("stockStatus") stockStatus?: "in_stock" | "low" | "out",
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.catalog.listProducts({
      q,
      categoryId,
      productTypeId,
      stockStatus,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @RequirePermissions(PermissionKey.PRODUCTS_VIEW)
  @Get(":id")
  getProduct(@Param("id") id: string) {
    return this.catalog.getProduct(id);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_CREATE)
  @Post()
  createProduct(@Req() req: Authed, @Body() body: CreateProductDto) {
    return this.catalog.createProduct(req.user.userId, body);
  }

  /**
   * Editing details needs PRODUCTS_EDIT. Switching a product on/off needs PRODUCTS_DEACTIVATE
   * (a request that only toggles `isActive` needs nothing else).
   */
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
    if ((editsDetails || !togglesActive) && !can(req.user, PermissionKey.PRODUCTS_EDIT)) {
      throw new ForbiddenException("Missing required permission");
    }
    return this.catalog.updateProduct(req.user.userId, id, body);
  }
}
