import { Module } from "@nestjs/common";
import { ReportingService } from "./reporting.service";
import { ReportingController } from "./reporting.controller";
import { LocationsModule } from "../locations/locations.module";
import { SalesModule } from "../sales/sales.module";

@Module({
  imports: [LocationsModule, SalesModule],
  controllers: [ReportingController],
  providers: [ReportingService],
})
export class ReportingModule {}
