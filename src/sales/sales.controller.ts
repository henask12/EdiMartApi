import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { CASHIER_ROLE, OWNER_ROLE, STORE_STAFF_ROLE } from "../common/role.constants";
import type { Response } from "express";
import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { parseExportFormat, sendExport } from "../export/export-response.util";
import { SalesService } from "./sales.service";

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
}

type Authed = { user: { userId: string } };

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Get("export")
  async export(
    @Res() res: Response,
    @Query("format") format?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("productId") productId?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    const result = await this.sales.exportSales(parseExportFormat(format), {
      from,
      to,
      productId,
      categoryId,
    });
    sendExport(res, result);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Get()
  list(
    @Query("skip") skip?: string,
    @Query("take") take?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("productId") productId?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    return this.sales.listSales({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      from,
      to,
      productId,
      categoryId,
    });
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Get("today-summary")
  todaySummary() {
    return this.sales.todaySummary();
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Get(":id")
  get(@Param("id") id: string) {
    return this.sales.getSale(id);
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Post("checkout")
  checkout(@Req() req: Authed, @Body() body: CheckoutDto) {
    return this.sales.checkout(req.user.userId, body);
  }
}
