export declare const OWNER_ROLE = "OWNER";
export declare const CASHIER_ROLE = "CASHIER";
export declare const STORE_STAFF_ROLE = "STORE_STAFF";
export declare const ONLINE_MANAGER_ROLE = "ONLINE_MANAGER";
export declare const BUILTIN_ROLES: readonly ["OWNER", "CASHIER", "STORE_STAFF", "ONLINE_MANAGER"];
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];
export declare const isOwnerRoleName: (name: string) => name is "OWNER";
