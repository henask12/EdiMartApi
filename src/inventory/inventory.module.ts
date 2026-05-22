import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { StockController } from "./stock.controller";
import { InventoryService } from "./inventory.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { LocationsModule } from "../locations/locations.module";
import { ExportModule } from "../export/export.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [NotificationsModule, LocationsModule, ExportModule, AuditModule],
  controllers: [InventoryController, StockController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
