import { readFile } from "fs/promises";
import { basename, join, resolve, sep } from "path";
import { PrismaClient } from "@prisma/client";
import { sniffImage } from "./storage.service";
import type { StorageDriver } from "./storage.driver";

export type MigrateUploadsResult = {
  moved: number;
  alreadyMigrated: number;
  missingFiles: { table: string; id: string; path: string }[];
  notImages: { table: string; id: string; path: string }[];
};

type Kind = "products" | "proofs";

/**
 * Moves files that were uploaded before the storage layer existed (`/uploads/<uuid>.png`, all in
 * one public folder) into `products/` and `proofs/` of the configured driver, and rewrites the
 * database paths. Safe to run again: rows already under the new folders are skipped, and the old
 * files are never deleted here.
 *
 * With STORAGE_DRIVER=local the files are copied into the new sub-folders (which also makes the
 * proofs private, because /uploads/proofs is no longer served). With STORAGE_DRIVER=s3 they are
 * uploaded to the bucket.
 */
export const migrateUploads = async (
  prisma: PrismaClient,
  driver: StorageDriver,
  options: { legacyDir: string; apply: boolean; log?: (m: string) => void },
): Promise<MigrateUploadsResult> => {
  const log = options.log ?? (() => undefined);
  const result: MigrateUploadsResult = { moved: 0, alreadyMigrated: 0, missingFiles: [], notImages: [] };
  const root = resolve(options.legacyDir);

  const handle = async (
    table: string,
    id: string,
    path: string,
    kind: Kind,
    update: (newPath: string) => Promise<unknown>,
  ) => {
    if (path.startsWith(`/uploads/${kind}/`)) {
      result.alreadyMigrated += 1;
      return;
    }
    const relative = path.replace(/^\/uploads\//, "");
    const source = resolve(root, relative);
    if (!source.startsWith(root + sep)) {
      result.missingFiles.push({ table, id, path });
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(source);
    } catch {
      result.missingFiles.push({ table, id, path });
      return;
    }
    const sniffed = sniffImage(bytes);
    if (!sniffed) {
      result.notImages.push({ table, id, path });
      return;
    }
    const key = `${kind}/${basename(relative)}`;
    log(`${options.apply ? "move" : "would move"} ${path} -> /uploads/${key}`);
    if (options.apply) {
      await driver.put(key, bytes, sniffed.contentType);
      await update(`/uploads/${key}`);
    }
    result.moved += 1;
  };

  for (const p of await prisma.product.findMany({
    where: { imagePath: { not: null } },
    select: { id: true, imagePath: true },
  })) {
    await handle("Product", p.id, p.imagePath!, "products", (newPath) =>
      prisma.product.update({ where: { id: p.id }, data: { imagePath: newPath } }),
    );
  }
  for (const a of await prisma.saleAttachment.findMany({ select: { id: true, imagePath: true } })) {
    await handle("SaleAttachment", a.id, a.imagePath, "proofs", (newPath) =>
      prisma.saleAttachment.update({ where: { id: a.id }, data: { imagePath: newPath } }),
    );
  }
  return result;
};

export const defaultLegacyDir = () => join(process.cwd(), "uploads");
