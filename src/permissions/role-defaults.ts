import { PermissionKey } from "@prisma/client";
import {
  CASHIER_ROLE,
  ONLINE_MANAGER_ROLE,
  OWNER_ROLE,
  STORE_STAFF_ROLE,
} from "../common/role.constants";

export const ALL_PERMISSIONS = Object.values(PermissionKey) as PermissionKey[];

/**
 * Starting permissions for the built-in roles. These are used only to WRITE role rows (the first-run
 * seed, and the Phase 1 backfill migration that did the same for existing databases) and as the
 * starting point of a new custom role. At run time a role has exactly the permissions stored for
 * it: there is no fallback to this file any more. The owner role is the only one that bypasses
 * permission checks.
 *
 * Sensitive permissions (stock adjustments, voids/refunds, cost and profit, user and role
 * administration, ...) are deliberately absent: the owner switches them on per role.
 */
const staffPermissions: PermissionKey[] = [
  PermissionKey.PRODUCTS_VIEW,
  PermissionKey.PRODUCTS_CREATE,
  PermissionKey.PRODUCTS_EDIT,
  PermissionKey.PRODUCTS_RESERVE,
  PermissionKey.PRODUCTS_EXPORT,
  PermissionKey.CATEGORIES_MANAGE,
  PermissionKey.PRODUCT_TYPES_MANAGE,
  PermissionKey.STOCK_VIEW,
  PermissionKey.STOCK_RECEIVE,
  PermissionKey.STOCK_HISTORY_VIEW,
  PermissionKey.SALES_CREATE,
  PermissionKey.SALES_VIEW,
  PermissionKey.SALES_VIEW_ALL,
  PermissionKey.SALES_EXPORT,
  PermissionKey.RESERVATIONS_MANAGE,
  PermissionKey.REPORTING_VIEW,
];

const cashierPermissions: PermissionKey[] = [
  PermissionKey.PRODUCTS_VIEW,
  PermissionKey.PRODUCTS_EDIT,
  PermissionKey.PRODUCTS_RESERVE,
  PermissionKey.PRODUCTS_EXPORT,
  PermissionKey.SALES_CREATE,
  PermissionKey.SALES_VIEW,
  PermissionKey.SALES_VIEW_ALL,
  PermissionKey.SALES_EXPORT,
  PermissionKey.RESERVATIONS_MANAGE,
  PermissionKey.REPORTING_VIEW,
  PermissionKey.SHIFT_MANAGE,
];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  [OWNER_ROLE]: ALL_PERMISSIONS,
  [STORE_STAFF_ROLE]: staffPermissions,
  [CASHIER_ROLE]: cashierPermissions,
  [ONLINE_MANAGER_ROLE]: [PermissionKey.PRODUCTS_VIEW],
};
