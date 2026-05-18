import { Controller, Get, Query } from "@nestjs/common";
import { RoleName } from "@prisma/client";
import { IsIn, IsOptional, IsString } from "class-validator";
import { Roles } from "../common/decorators/roles.decorator";
import { ReportingService } from "./reporting.service";

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

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Get("dashboard")
  dashboard() {
    return this.reporting.dashboard();
  }

  @Roles(RoleName.OWNER, RoleName.CASHIER, RoleName.STORE_STAFF)
  @Get("sales")
  sales(@Query() query: SalesQueryDto) {
    return this.reporting.salesByPeriod(query.period, query.date);
  }
}
