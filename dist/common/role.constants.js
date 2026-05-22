"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOwnerRoleName = exports.BUILTIN_ROLES = exports.ONLINE_MANAGER_ROLE = exports.STORE_STAFF_ROLE = exports.CASHIER_ROLE = exports.OWNER_ROLE = void 0;
exports.OWNER_ROLE = "OWNER";
exports.CASHIER_ROLE = "CASHIER";
exports.STORE_STAFF_ROLE = "STORE_STAFF";
exports.ONLINE_MANAGER_ROLE = "ONLINE_MANAGER";
exports.BUILTIN_ROLES = [
    exports.OWNER_ROLE,
    exports.CASHIER_ROLE,
    exports.STORE_STAFF_ROLE,
    exports.ONLINE_MANAGER_ROLE,
];
const isOwnerRoleName = (name) => name === exports.OWNER_ROLE;
exports.isOwnerRoleName = isOwnerRoleName;
//# sourceMappingURL=role.constants.js.map