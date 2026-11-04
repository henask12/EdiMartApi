import { Module } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { BulkImportService } from "./bulk-import.service";
import { BulkImportController } from "./bulk-import.controller";
import { LocationsModule } from "../locations/locations.module";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ExportModule } from "../export/export.module";

@Module({
  imports: [LocationsModule, AuditModule, InventoryModule, ExportModule],
  controllers: [CatalogController, BulkImportController],
  providers: [CatalogService, BulkImportService],
  exports: [CatalogService],
})
export class CatalogModule {}
