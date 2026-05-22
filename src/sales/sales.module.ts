import { Module, forwardRef } from "@nestjs/common";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { LocationsModule } from "../locations/locations.module";
import { ExportModule } from "../export/export.module";

@Module({
  imports: [NotificationsModule, LocationsModule, ExportModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
