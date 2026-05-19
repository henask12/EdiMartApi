import { PermissionKey, RoleName } from "@prisma/client";

export const ALL_PERMISSIONS = Object.values(PermissionKey) as PermissionKey[];

const staffPermissions: PermissionKey[] = [
  PermissionKey.PRODUCTS_VIEW,
  PermissionKey.PRODUCTS_CREATE,
  PermissionKey.PRODUCTS_EDIT,
  PermissionKey.PRODUCTS_SELL,
  PermissionKey.PRODUCTS_RESERVE,
  PermissionKey.PRODUCTS_RESTOCK,
  PermissionKey.PRODUCTS_EXPORT,
  PermissionKey.CATEGORIES_MANAGE,
  PermissionKey.PRODUCT_TYPES_MANAGE,
  PermissionKey.STOCK_RECEIVE,
  PermissionKey.STOCK_HISTORY_VIEW,
  PermissionKey.SALES_CREATE,
  PermissionKey.SALES_VIEW,
  PermissionKey.SALES_EXPORT,
  PermissionKey.RESERVATIONS_MANAGE,
  PermissionKey.REPORTING_VIEW,
];

const cashierPermissions: PermissionKey[] = [
  PermissionKey.PRODUCTS_VIEW,
  PermissionKey.PRODUCTS_EDIT,
  PermissionKey.PRODUCTS_SELL,
  PermissionKey.PRODUCTS_RESERVE,
  PermissionKey.PRODUCTS_EXPORT,
  PermissionKey.SALES_CREATE,
  PermissionKey.SALES_VIEW,
  PermissionKey.SALES_EXPORT,
  PermissionKey.RESERVATIONS_MANAGE,
  PermissionKey.REPORTING_VIEW,
];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [RoleName.OWNER]: ALL_PERMISSIONS,
  [RoleName.STORE_STAFF]: staffPermissions,
  [RoleName.CASHIER]: cashierPermissions,
  [RoleName.ONLINE_MANAGER]: [PermissionKey.PRODUCTS_VIEW],
};
