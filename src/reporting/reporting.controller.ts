import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import type { Response } from "express";
import { MovementType, PermissionKey } from "@prisma/client";
import { ReportingService } from "./reporting.service";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../common/decorators/permissions.decorator";
import { sendExport } from "../export/export-response.util";

class SalesQueryDto {
  @IsIn(["day", "week", "month", "year"])
  period!: "day" | "week" | "month" | "year";

  @IsOptional()
  @IsString()
  date?: string;
}

class DashboardQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

class RangeQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(["csv"])
  format?: string;
}

class SalesByProductQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsIn(["product", "category", "type", "brand"])
  groupBy?: string;
}

class StockOnHandQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(["csv"])
  format?: string;
}

class ValuationQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  asOf?: string;
}

class MovementsQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsIn(Object.values(MovementType))
  type?: MovementType;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;
}

class AbcQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsIn(["revenue", "profit"])
  by?: "revenue" | "profit";
}

class DeadStockQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  days?: number;

  @IsOptional()
  @IsIn(["csv"])
  format?: string;
}

class OverstockQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coverDays?: number;
}

class RebuildBodyDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

type Authed = { user: Actor };

@Controller("reporting")
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("dashboard")
  dashboard(@Req() req: Authed, @Query() query: DashboardQueryDto) {
    return this.reporting.dashboard(viewerFor(req.user).includeCost, query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("inventory-dashboard")
  inventoryDashboard(@Req() req: Authed) {
    return this.reporting.inventoryDashboard(viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales")
  sales(@Req() req: Authed, @Query() query: SalesQueryDto) {
    return this.reporting.salesByPeriod(
      query.period,
      query.date,
      viewerFor(req.user).includeCost,
    );
  }

  @RequireAnyPermission(
    PermissionKey.SETTINGS_MANAGE,
    PermissionKey.REPORTING_VIEW,
  )
  @Post("rebuild-summaries")
  rebuild(@Body() body: RebuildBodyDto) {
    return this.reporting.rebuildRange(body.from, body.to);
  }

  // ─── Sales reports ─────────────────────────────────────────────────────────

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales-by-day")
  async salesByDay(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query() query: RangeQueryDto,
  ) {
    const includeCost = viewerFor(req.user).includeCost;
    if (query.format === "csv") {
      const result = await this.reporting.exportCsv(
        "sales-by-day",
        query as Record<string, string | undefined>,
        includeCost,
      );
      sendExport(res, result);
      return;
    }
    return this.reporting.salesByDay({ ...query, includeCost });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales-by-hour")
  salesByHour(@Query() query: RangeQueryDto) {
    return this.reporting.salesByHour(query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales-by-product")
  async salesByProduct(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query() query: SalesByProductQueryDto,
  ) {
    const includeCost = viewerFor(req.user).includeCost;
    if (query.format === "csv") {
      const result = await this.reporting.exportCsv(
        "sales-by-product",
        query as Record<string, string | undefined>,
        includeCost,
      );
      sendExport(res, result);
      return;
    }
    return this.reporting.salesByProduct({ ...query, includeCost });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales-by-cashier")
  salesByCashier(@Req() req: Authed, @Query() query: RangeQueryDto) {
    return this.reporting.salesByCashier({
      ...query,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales-by-payment")
  salesByPayment(@Query() query: RangeQueryDto) {
    return this.reporting.salesByPayment(query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("discounts-voids-refunds")
  discountsVoidsRefunds(@Query() query: RangeQueryDto) {
    return this.reporting.discountsVoidsRefunds(query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("customers")
  customers(@Query() query: RangeQueryDto) {
    return this.reporting.customersReport(query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("vat-summary")
  vatSummary(@Query() query: RangeQueryDto) {
    return this.reporting.vatSummary(query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("shift-variances")
  shiftVariances(@Query() query: RangeQueryDto) {
    return this.reporting.shiftVariances(query);
  }

  // ─── Inventory reports ─────────────────────────────────────────────────────

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("stock-on-hand")
  async stockOnHand(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query() query: StockOnHandQueryDto,
  ) {
    const includeCost = viewerFor(req.user).includeCost;
    if (query.format === "csv") {
      const result = await this.reporting.exportCsv(
        "stock-on-hand",
        query as Record<string, string | undefined>,
        includeCost,
      );
      sendExport(res, result);
      return;
    }
    return this.reporting.stockOnHand({ ...query, includeCost });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("valuation")
  valuation(@Req() req: Authed, @Query() query: ValuationQueryDto) {
    return this.reporting.valuation({
      ...query,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("movements")
  async movements(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query() query: MovementsQueryDto,
  ) {
    const includeCost = viewerFor(req.user).includeCost;
    if (query.format === "csv") {
      const result = await this.reporting.exportCsv(
        "movements",
        query as Record<string, string | undefined>,
        includeCost,
      );
      sendExport(res, result);
      return;
    }
    return this.reporting.movementsReport({ ...query, includeCost });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("abc")
  abc(@Req() req: Authed, @Query() query: AbcQueryDto) {
    return this.reporting.abcAnalysis({
      ...query,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("turnover")
  turnover(@Req() req: Authed, @Query() query: RangeQueryDto) {
    return this.reporting.turnoverReport({
      ...query,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("dead-stock")
  async deadStock(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query() query: DeadStockQueryDto,
  ) {
    const includeCost = viewerFor(req.user).includeCost;
    if (query.format === "csv") {
      const result = await this.reporting.exportCsv(
        "dead-stock",
        query as Record<string, string | undefined>,
        includeCost,
      );
      sendExport(res, result);
      return;
    }
    return this.reporting.deadStock({ days: query.days, includeCost });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("overstock")
  overstock(@Req() req: Authed, @Query() query: OverstockQueryDto) {
    return this.reporting.overstock({
      coverDays: query.coverDays,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("shrinkage")
  shrinkage(@Req() req: Authed, @Query() query: RangeQueryDto) {
    return this.reporting.shrinkageReport({
      ...query,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("expiry-losses")
  expiryLosses(@Req() req: Authed, @Query() query: RangeQueryDto) {
    return this.reporting.expiryLosses({
      ...query,
      includeCost: viewerFor(req.user).includeCost,
    });
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("margin-alerts")
  marginAlerts(@Req() req: Authed) {
    return this.reporting.marginAlerts(viewerFor(req.user).includeCost);
  }

  // ─── Purchasing reports ────────────────────────────────────────────────────

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("purchases-by-supplier")
  async purchasesBySupplier(
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
    @Query() query: RangeQueryDto,
  ) {
    if (query.format === "csv") {
      const result = await this.reporting.exportCsv(
        "purchases-by-supplier",
        query as Record<string, string | undefined>,
        viewerFor(req.user).includeCost,
      );
      sendExport(res, result);
      return;
    }
    return this.reporting.purchasesBySupplier(query);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("open-pos")
  openPos() {
    return this.reporting.openPurchaseOrders();
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("aged-payables")
  agedPayables() {
    return this.reporting.agedPayables();
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("landed-cost")
  landedCost(@Query() query: RangeQueryDto) {
    return this.reporting.landedCostReport(query);
  }

  /** Alternate path: GET /reporting/export/:reportKey.csv */
  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("export/:reportKey.csv")
  async exportNamed(
    @Req() req: Authed,
    @Res() res: Response,
    @Param("reportKey") reportKey: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const result = await this.reporting.exportCsv(
      reportKey,
      query,
      viewerFor(req.user).includeCost,
    );
    sendExport(res, result);
  }
}
