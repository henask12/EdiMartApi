import { PermissionKey } from "@prisma/client";
import { isOwnerRoleName } from "../common/role.constants";

type UserLike = { userId: string; roleName: string; permissions: PermissionKey[] };

export const hasPermission = (user: Pick<UserLike, "roleName" | "permissions">, permission: PermissionKey) =>
  isOwnerRoleName(user.roleName) || user.permissions.includes(permission);

/** What a signed-in person may see of the numbers behind a response. */
export type Viewer = {
  userId: string;
  /** May see what products cost and how much profit sales make (REPORTS_VIEW_COST_PROFIT). */
  includeCost: boolean;
  /** May see every sale, not just their own (SALES_VIEW_ALL). */
  viewAllSales: boolean;
};

export const viewerFor = (user: UserLike): Viewer => ({
  userId: user.userId,
  includeCost: hasPermission(user, PermissionKey.REPORTS_VIEW_COST_PROFIT),
  viewAllSales: hasPermission(user, PermissionKey.SALES_VIEW_ALL),
});

/** `obj` without the listed keys (a new object; the original is untouched). */
export const omit = <T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> => {
  const copy = { ...obj } as T;
  for (const key of keys) {
    delete copy[key];
  }
  return copy as Omit<T, K>;
};
