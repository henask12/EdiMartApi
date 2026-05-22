/** Built-in role names (OWNER is protected in DB). */
export const OWNER_ROLE = "OWNER";
export const CASHIER_ROLE = "CASHIER";
export const STORE_STAFF_ROLE = "STORE_STAFF";
export const ONLINE_MANAGER_ROLE = "ONLINE_MANAGER";

export const BUILTIN_ROLES = [
  OWNER_ROLE,
  CASHIER_ROLE,
  STORE_STAFF_ROLE,
  ONLINE_MANAGER_ROLE,
] as const;

export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

export const isOwnerRoleName = (name: string) => name === OWNER_ROLE;
