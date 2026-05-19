import {
  Body,
  Controller,
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
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { CatalogService } from "./catalog.service";
import { CreateProductDto, UpdateProductDto } from "./dto/catalog.dto";

type Authed = { user: { userId: string } };

@Controller("products")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

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

  @Get(":id")
  getProduct(@Param("id") id: string) {
    return this.catalog.getProduct(id);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_CREATE)
  @Post()
  createProduct(@Req() req: Authed, @Body() body: CreateProductDto) {
    return this.catalog.createProduct(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.PRODUCTS_EDIT)
  @Patch(":id")
  updateProduct(
    @Req() req: Authed,
    @Param("id") id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(req.user.userId, id, body);
  }
}
