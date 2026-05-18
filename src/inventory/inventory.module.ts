import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { StockController } from "./stock.controller";
import { InventoryService } from "./inventory.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { LocationsModule } from "../locations/locations.module";

@Module({
  imports: [NotificationsModule, LocationsModule],
  controllers: [InventoryController, StockController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
