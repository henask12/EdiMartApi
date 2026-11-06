import { Module } from "@nestjs/common";
import { ReportingService } from "./reporting.service";
import { ReportingController } from "./reporting.controller";
import { SummaryRebuildService } from "./summary-rebuild.service";
import { LocationsModule } from "../locations/locations.module";
import { SalesModule } from "../sales/sales.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { ExportModule } from "../export/export.module";

@Module({
  imports: [
    LocationsModule,
    SalesModule,
    InventoryModule,
    PurchasingModule,
    ExportModule,
  ],
  controllers: [ReportingController],
  providers: [ReportingService, SummaryRebuildService],
  exports: [ReportingService, SummaryRebuildService],
})
export class ReportingModule {}
