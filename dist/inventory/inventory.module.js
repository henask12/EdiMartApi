"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryModule = void 0;
const common_1 = require("@nestjs/common");
const inventory_controller_1 = require("./inventory.controller");
const stock_controller_1 = require("./stock.controller");
const inventory_service_1 = require("./inventory.service");
const notifications_module_1 = require("../notifications/notifications.module");
const locations_module_1 = require("../locations/locations.module");
const export_module_1 = require("../export/export.module");
const audit_module_1 = require("../audit/audit.module");
let InventoryModule = class InventoryModule {
};
exports.InventoryModule = InventoryModule;
exports.InventoryModule = InventoryModule = __decorate([
    (0, common_1.Module)({
        imports: [notifications_module_1.NotificationsModule, locations_module_1.LocationsModule, export_module_1.ExportModule, audit_module_1.AuditModule],
        controllers: [inventory_controller_1.InventoryController, stock_controller_1.StockController],
        providers: [inventory_service_1.InventoryService],
        exports: [inventory_service_1.InventoryService],
    })
], InventoryModule);
//# sourceMappingURL=inventory.module.js.map