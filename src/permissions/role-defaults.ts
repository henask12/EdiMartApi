import { PermissionKey } from "@prisma/client";
import {
  CASHIER_ROLE,
  ONLINE_MANAGER_ROLE,
  OWNER_ROLE,
  STORE_STAFF_ROLE,
} from "../common/role.constants";

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

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  [OWNER_ROLE]: ALL_PERMISSIONS,
  [STORE_STAFF_ROLE]: staffPermissions,
  [CASHIER_ROLE]: cashierPermissions,
  [ONLINE_MANAGER_ROLE]: [PermissionKey.PRODUCTS_VIEW],
};
