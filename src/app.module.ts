import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { AuditModule } from "./audit/audit.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CategoriesModule } from "./categories/categories.module";
import { ProductTypesModule } from "./product-types/product-types.module";
import { ExportModule } from "./export/export.module";
import { InventoryModule } from "./inventory/inventory.module";
import { SalesModule } from "./sales/sales.module";
import { ShiftsModule } from "./shifts/shifts.module";
import { PurchasingModule } from "./purchasing/purchasing.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { ReportingModule } from "./reporting/reporting.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ExpensesModule } from "./expenses/expenses.module";
import { UploadsModule } from "./uploads/uploads.module";
import { LocationsModule } from "./locations/locations.module";
import { HealthModule } from "./health/health.module";
import { AppController } from "./app.controller";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { MustChangePasswordGuard } from "./common/guards/must-change-password.guard";
import { StorageModule } from "./storage/storage.module";
import { ApprovalsModule } from "./approvals/approvals.module";
import { StoreSettingsModule } from "./settings/store-settings.module";
import { SetupModule } from "./setup/setup.module";
import { isSetupEnabled } from "./setup/setup.config";
import { PermissionsModule } from "./permissions/permissions.module";
import { CustomersModule } from "./customers/customers.module";
import { PromotionsModule } from "./promotions/promotions.module";
import { MessagingModule } from "./messaging/messaging.module";
import { SyncModule } from "./sync/sync.module";

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    PrismaModule,
    StorageModule,
    PermissionsModule,
    ApprovalsModule,
    StoreSettingsModule,
    AuditModule,
    UsersModule,
    AuthModule,
    LocationsModule,
    CategoriesModule,
    ProductTypesModule,
    ExportModule,
    CatalogModule,
    UploadsModule,
    InventoryModule,
    ShiftsModule,
    PurchasingModule,
    CustomersModule,
    PromotionsModule,
    MessagingModule,
    SalesModule,
    ExpensesModule,
    ReservationsModule,
    ReportingModule,
    NotificationsModule,
    HealthModule,
    SyncModule,
    // First-run seeding endpoints; absent (404) unless SETUP_ENABLED is on.
    ...(isSetupEnabled() ? [SetupModule] : []),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
