"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportingController = void 0;
const common_1 = require("@nestjs/common");
const role_constants_1 = require("../common/role.constants");
const class_validator_1 = require("class-validator");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const reporting_service_1 = require("./reporting.service");
class SalesQueryDto {
    period;
    date;
}
__decorate([
    (0, class_validator_1.IsIn)(["day", "week", "month", "year"]),
    __metadata("design:type", String)
], SalesQueryDto.prototype, "period", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SalesQueryDto.prototype, "date", void 0);
let ReportingController = class ReportingController {
    reporting;
    constructor(reporting) {
        this.reporting = reporting;
    }
    dashboard() {
        return this.reporting.dashboard();
    }
    sales(query) {
        return this.reporting.salesByPeriod(query.period, query.date);
    }
};
exports.ReportingController = ReportingController;
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Get)("dashboard"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReportingController.prototype, "dashboard", null);
__decorate([
    (0, roles_decorator_1.Roles)(role_constants_1.OWNER_ROLE, role_constants_1.CASHIER_ROLE, role_constants_1.STORE_STAFF_ROLE),
    (0, common_1.Get)("sales"),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [SalesQueryDto]),
    __metadata("design:returntype", void 0)
], ReportingController.prototype, "sales", null);
exports.ReportingController = ReportingController = __decorate([
    (0, common_1.Controller)("reporting"),
    __metadata("design:paramtypes", [reporting_service_1.ReportingService])
], ReportingController);
//# sourceMappingURL=reporting.controller.js.map