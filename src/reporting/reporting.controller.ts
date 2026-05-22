import { Controller, Get, Query } from "@nestjs/common";
import { CASHIER_ROLE, OWNER_ROLE, STORE_STAFF_ROLE } from "../common/role.constants";
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

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Get("dashboard")
  dashboard() {
    return this.reporting.dashboard();
  }

  @Roles(OWNER_ROLE, CASHIER_ROLE, STORE_STAFF_ROLE)
  @Get("sales")
  sales(@Query() query: SalesQueryDto) {
    return this.reporting.salesByPeriod(query.period, query.date);
  }
}
