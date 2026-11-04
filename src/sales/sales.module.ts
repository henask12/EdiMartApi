import { Module } from "@nestjs/common";
import { ApprovalsModule } from "../approvals/approvals.module";
import { ExportModule } from "../export/export.module";
import { LocationsModule } from "../locations/locations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FiscalService } from "./fiscal.service";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";

@Module({
  imports: [NotificationsModule, LocationsModule, ExportModule, ApprovalsModule],
  controllers: [SalesController],
  providers: [SalesService, FiscalService],
  exports: [SalesService, FiscalService],
})
export class SalesModule {}
