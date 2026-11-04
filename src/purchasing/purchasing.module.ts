import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { LocationsModule } from "../locations/locations.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { StoreSettingsModule } from "../settings/store-settings.module";
import { SuppliersController } from "./suppliers.controller";
import { SuppliersService } from "./suppliers.service";
import { PurchaseOrdersController } from "./purchase-orders.controller";
import { PurchaseOrdersService } from "./purchase-orders.service";
import { GoodsReceiptsController } from "./goods-receipts.controller";
import { GoodsReceiptsService } from "./goods-receipts.service";
import { BillsController } from "./bills.controller";
import { BillsService } from "./bills.service";
import { SupplierReturnsController } from "./supplier-returns.controller";
import { SupplierReturnsService } from "./supplier-returns.service";
import { PurchasingController } from "./purchasing.controller";
import { ReorderService } from "./reorder.service";

@Module({
  imports: [AuditModule, LocationsModule, NotificationsModule, StoreSettingsModule],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    BillsController,
    SupplierReturnsController,
    PurchasingController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    BillsService,
    SupplierReturnsService,
    ReorderService,
  ],
  exports: [PurchaseOrdersService, SuppliersService, ReorderService],
})
export class PurchasingModule {}
