"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const audit_module_1 = require("./audit/audit.module");
const catalog_module_1 = require("./catalog/catalog.module");
const categories_module_1 = require("./categories/categories.module");
const product_types_module_1 = require("./product-types/product-types.module");
const export_module_1 = require("./export/export.module");
const inventory_module_1 = require("./inventory/inventory.module");
const sales_module_1 = require("./sales/sales.module");
const reservations_module_1 = require("./reservations/reservations.module");
const reporting_module_1 = require("./reporting/reporting.module");
const notifications_module_1 = require("./notifications/notifications.module");
const uploads_module_1 = require("./uploads/uploads.module");
const locations_module_1 = require("./locations/locations.module");
const health_module_1 = require("./health/health.module");
const app_controller_1 = require("./app.controller");
const jwt_auth_guard_1 = require("./common/guards/jwt-auth.guard");
const roles_guard_1 = require("./common/guards/roles.guard");
const permissions_guard_1 = require("./common/guards/permissions.guard");
const permissions_module_1 = require("./permissions/permissions.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        controllers: [app_controller_1.AppController],
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env"],
            }),
            prisma_module_1.PrismaModule,
            permissions_module_1.PermissionsModule,
            audit_module_1.AuditModule,
            users_module_1.UsersModule,
            auth_module_1.AuthModule,
            locations_module_1.LocationsModule,
            categories_module_1.CategoriesModule,
            product_types_module_1.ProductTypesModule,
            export_module_1.ExportModule,
            catalog_module_1.CatalogModule,
            uploads_module_1.UploadsModule,
            inventory_module_1.InventoryModule,
            sales_module_1.SalesModule,
            reservations_module_1.ReservationsModule,
            reporting_module_1.ReportingModule,
            notifications_module_1.NotificationsModule,
            health_module_1.HealthModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: jwt_auth_guard_1.JwtAuthGuard },
            { provide: core_1.APP_GUARD, useClass: roles_guard_1.RolesGuard },
            { provide: core_1.APP_GUARD, useClass: permissions_guard_1.PermissionsGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map