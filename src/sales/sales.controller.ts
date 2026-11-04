import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { PaymentMethod } from "@prisma/client";
import type { Response } from "express";
import { Type } from "class-transformer";
import { IsArray, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { SalesService } from "./sales.service";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions, RequireAnyPermission } from "../common/decorators/permissions.decorator";

class CheckoutLineDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;
}

class CheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  proofImagePaths?: string[];

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /** Mobile-money / bank transaction ID. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;
}

type Authed = { user: Actor };

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @RequirePermissions(PermissionKey.SALES_EXPORT)
  @Get("export")
  async export(
    @Req() req: Authed,
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("productId") productId?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    const result = await this.sales.exportSales(
      parseExportFormat(format),
      { from, to, productId, categoryId },
      viewerFor(req.user),
    );
    sendExport(res, result);
  }

  @RequireAnyPermission(PermissionKey.SALES_VIEW, PermissionKey.SALES_VIEW_OWN, PermissionKey.SALES_VIEW_ALL)
  @Get()
  list(
    @Req() req: Authed,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("productId") productId?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    return this.sales.listSales(
      {
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
        from,
        to,
        productId,
        categoryId,
      },
      viewerFor(req.user),
    );
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("today-summary")
  todaySummary(@Req() req: Authed) {
    return this.sales.todaySummary(viewerFor(req.user).includeCost);
  }

  @RequireAnyPermission(PermissionKey.SALES_VIEW, PermissionKey.SALES_VIEW_OWN, PermissionKey.SALES_VIEW_ALL)
  @Get(":id")
  get(@Req() req: Authed, @Param("id") id: string) {
    return this.sales.getSale(id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Post("checkout")
  checkout(
    @Req() req: Authed,
    @Body() body: CheckoutDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (!key || key.length < 8 || key.length > 128) {
      throw new BadRequestException("Idempotency-Key header is required (8-128 characters)");
    }
    return this.sales.checkout(req.user.userId, body, key, viewerFor(req.user));
  }
}
