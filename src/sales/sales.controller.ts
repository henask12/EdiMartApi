import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { CreditCondition, PaymentMethod, PermissionKey } from "@prisma/client";
import type { Response } from "express";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Public } from "../common/decorators/public.decorator";
import { RequireAnyPermission, RequirePermissions } from "../common/decorators/permissions.decorator";
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { SalesService } from "./sales.service";

class CheckoutLineDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsString()
  reservationId?: string;

  @IsOptional()
  @IsString()
  unitPrice?: string;

  @IsOptional()
  @IsString()
  lineDiscount?: string;

  @IsOptional()
  @IsString()
  discountPercent?: string;

  @IsOptional()
  @IsString()
  discountReason?: string;
}

class CheckoutPaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  proofImagePath?: string;

  @IsOptional()
  @IsString()
  tenderedAmount?: string;
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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutPaymentDto)
  payments?: CheckoutPaymentDto[];

  @IsOptional()
  @IsString()
  cartDiscount?: string;

  @IsOptional()
  @IsString()
  cartDiscountPercent?: string;

  @IsOptional()
  @IsString()
  discountReason?: string;

  @IsOptional()
  @IsBoolean()
  allowExpiredSale?: boolean;
}

class ParkCartDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

class VoidSaleDto {
  @IsString()
  reason!: string;
}

class ReturnLineDto {
  @IsString()
  saleLineId!: string;

  @IsString()
  quantity!: string;
}

class ReturnSaleDto {
  @IsString()
  reason!: string;

  @IsEnum(CreditCondition)
  condition!: CreditCondition;

  @IsEnum(PaymentMethod)
  refundMethod!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  refundReference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
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

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("today-summary")
  todaySummary(@Req() req: Authed) {
    return this.sales.todaySummary(viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Get("parked")
  listParked(@Req() req: Authed) {
    return this.sales.listParked(viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Post("park")
  park(@Req() req: Authed, @Body() body: ParkCartDto) {
    return this.sales.parkCart(req.user.userId, body);
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Delete("parked/:id")
  deleteParked(@Req() req: Authed, @Param("id") id: string) {
    return this.sales.deleteParked(id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Post("parked/:id/resume")
  resumeParked(@Req() req: Authed, @Param("id") id: string) {
    return this.sales.resumeParked(id, viewerFor(req.user));
  }

  @Public()
  @Get("receipt/:token")
  publicReceipt(@Param("token") token: string) {
    return this.sales.getPublicReceipt(token);
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
    @Query("cashierUserId") cashierUserId?: string,
    @Query("paymentMethod") paymentMethod?: PaymentMethod,
    @Query("status") status?: string,
  ) {
    return this.sales.listSales(
      {
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
        from,
        to,
        productId,
        categoryId,
        cashierUserId,
        paymentMethod,
        status,
      },
      viewerFor(req.user),
    );
  }

  @RequirePermissions(PermissionKey.SALES_CREATE)
  @Post("checkout")
  checkout(
    @Req() req: Authed,
    @Body() body: CheckoutDto,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-approval-token") approvalToken?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (!key || key.length < 8 || key.length > 128) {
      throw new BadRequestException("Idempotency-Key header is required (8-128 characters)");
    }
    return this.sales.checkout(req.user, body, key, viewerFor(req.user), approvalToken?.trim());
  }

  @RequireAnyPermission(PermissionKey.SALES_VIEW, PermissionKey.SALES_VIEW_OWN, PermissionKey.SALES_VIEW_ALL)
  @Get(":id/receipt")
  receipt(@Req() req: Authed, @Param("id") id: string) {
    return this.sales.getReceipt(id, viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.SALES_VOID)
  @Post(":id/void")
  voidSale(
    @Req() req: Authed,
    @Param("id") id: string,
    @Body() body: VoidSaleDto,
    @Headers("x-approval-token") approvalToken?: string,
  ) {
    return this.sales.voidSale(req.user, id, body, approvalToken?.trim(), viewerFor(req.user));
  }

  @RequirePermissions(PermissionKey.SALES_REFUND)
  @Post(":id/return")
  returnSale(
    @Req() req: Authed,
    @Param("id") id: string,
    @Body() body: ReturnSaleDto,
    @Headers("x-approval-token") approvalToken?: string,
  ) {
    return this.sales.returnSale(req.user, id, body, approvalToken?.trim(), viewerFor(req.user));
  }

  @RequireAnyPermission(PermissionKey.SALES_VIEW, PermissionKey.SALES_VIEW_OWN, PermissionKey.SALES_VIEW_ALL)
  @Get(":id")
  get(@Req() req: Authed, @Param("id") id: string) {
    return this.sales.getSale(id, viewerFor(req.user));
  }
}
