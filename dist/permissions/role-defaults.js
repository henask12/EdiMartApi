"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ROLE_PERMISSIONS = exports.ALL_PERMISSIONS = void 0;
const client_1 = require(".prisma/client");
const role_constants_1 = require("../common/role.constants");
exports.ALL_PERMISSIONS = Object.values(client_1.PermissionKey);
const staffPermissions = [
    client_1.PermissionKey.PRODUCTS_VIEW,
    client_1.PermissionKey.PRODUCTS_CREATE,
    client_1.PermissionKey.PRODUCTS_EDIT,
    client_1.PermissionKey.PRODUCTS_SELL,
    client_1.PermissionKey.PRODUCTS_RESERVE,
    client_1.PermissionKey.PRODUCTS_RESTOCK,
    client_1.PermissionKey.PRODUCTS_EXPORT,
    client_1.PermissionKey.CATEGORIES_MANAGE,
    client_1.PermissionKey.PRODUCT_TYPES_MANAGE,
    client_1.PermissionKey.STOCK_RECEIVE,
    client_1.PermissionKey.STOCK_HISTORY_VIEW,
    client_1.PermissionKey.SALES_CREATE,
    client_1.PermissionKey.SALES_VIEW,
    client_1.PermissionKey.SALES_EXPORT,
    client_1.PermissionKey.RESERVATIONS_MANAGE,
    client_1.PermissionKey.REPORTING_VIEW,
];
const cashierPermissions = [
    client_1.PermissionKey.PRODUCTS_VIEW,
    client_1.PermissionKey.PRODUCTS_EDIT,
    client_1.PermissionKey.PRODUCTS_SELL,
    client_1.PermissionKey.PRODUCTS_RESERVE,
    client_1.PermissionKey.PRODUCTS_EXPORT,
    client_1.PermissionKey.SALES_CREATE,
    client_1.PermissionKey.SALES_VIEW,
    client_1.PermissionKey.SALES_EXPORT,
    client_1.PermissionKey.RESERVATIONS_MANAGE,
    client_1.PermissionKey.REPORTING_VIEW,
];
exports.DEFAULT_ROLE_PERMISSIONS = {
    [role_constants_1.OWNER_ROLE]: exports.ALL_PERMISSIONS,
    [role_constants_1.STORE_STAFF_ROLE]: staffPermissions,
    [role_constants_1.CASHIER_ROLE]: cashierPermissions,
    [role_constants_1.ONLINE_MANAGER_ROLE]: [client_1.PermissionKey.PRODUCTS_VIEW],
};
//# sourceMappingURL=role-defaults.js.map