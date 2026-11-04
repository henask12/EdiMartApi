import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { StockController } from "./stock.controller";
import { TransfersController } from "./transfers.controller";
import { StockCountsController } from "./stock-counts.controller";
import { PricesController } from "./prices.controller";
import { LabelsController } from "./labels.controller";
import { InventoryService } from "./inventory.service";
import { TransfersService } from "./transfers.service";
import { StockCountsService } from "./stock-counts.service";
import { PricesService } from "./prices.service";
import { LabelsService } from "./labels.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { LocationsModule } from "../locations/locations.module";
import { ExportModule } from "../export/export.module";
import { AuditModule } from "../audit/audit.module";
import { ApprovalsModule } from "../approvals/approvals.module";
import { StoreSettingsModule } from "../settings/store-settings.module";

@Module({
  imports: [
    NotificationsModule,
    LocationsModule,
    ExportModule,
    AuditModule,
    ApprovalsModule,
    StoreSettingsModule,
  ],
  controllers: [
    InventoryController,
    StockController,
    TransfersController,
    StockCountsController,
    PricesController,
    LabelsController,
  ],
  providers: [
    InventoryService,
    TransfersService,
    StockCountsService,
    PricesService,
    LabelsService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
