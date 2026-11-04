import { Controller, Get, Query, Req } from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import { ReportingService } from "./reporting.service";
import { viewerFor } from "../permissions/access";
import type { Actor } from "../permissions/permissions.service";
import { PermissionKey } from "@prisma/client";
import { RequirePermissions } from "../common/decorators/permissions.decorator";

class SalesQueryDto {
  @IsIn(["day", "week", "month", "year"])
  period!: "day" | "week" | "month" | "year";

  @IsOptional()
  @IsString()
  date?: string;
}

@Controller("reporting")
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("dashboard")
  dashboard(@Req() req: { user: Actor }) {
    return this.reporting.dashboard(viewerFor(req.user).includeCost);
  }

  @RequirePermissions(PermissionKey.REPORTING_VIEW)
  @Get("sales")
  sales(@Req() req: { user: Actor }, @Query() query: SalesQueryDto) {
    return this.reporting.salesByPeriod(query.period, query.date, viewerFor(req.user).includeCost);
  }
}
