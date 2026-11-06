import { PermissionKey } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PASSWORD, TestApp, login } from "./helpers";

let counter = 0;

/** A user whose role holds exactly these permissions. Returns the user and a ready token. */
export const userWithPermissions = async (
  t: TestApp,
  permissions: PermissionKey[],
  label = "custom",
) => {
  counter += 1;
  const roleName = `${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${counter}_${Date.now().toString(36).toUpperCase()}`;
  const role = await t.prisma.role.create({
    data: {
      name: roleName,
      permissions: { create: permissions.map((permission) => ({ permission })) },
    },
  });
  const email = `${roleName.toLowerCase()}@test.local`;
  const user = await t.prisma.user.create({
    data: {
      email,
      displayName: `User ${roleName}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      roleId: role.id,
    },
  });
  const token = await login(t, email);
  return { user, role, token, email };
};

/** Replace what a role is allowed to do (as the owner would on the Roles screen). */
export const setRolePermissions = async (t: TestApp, roleId: string, permissions: PermissionKey[]) => {
  await t.prisma.rolePermission.deleteMany({ where: { roleId } });
  await t.prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId, permission })),
  });
};

/** Every object key found anywhere in a JSON value. */
export const collectKeys = (value: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, found));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      found.add(k);
      collectKeys(v, found);
    }
  }
  return found;
};
