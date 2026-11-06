/**
 * Move existing uploads into the products/ and proofs/ layout of the configured storage driver.
 *
 *   npm run uploads:migrate               dry run: lists what would move, changes nothing
 *   npm run uploads:migrate -- --apply    copies the files and rewrites the database paths
 *
 * Reads UPLOAD_DIR (where the old files are), STORAGE_DRIVER and the S3_* variables, like the API.
 * Old files are left in place; delete them yourself once you have checked the result.
 */
import { PrismaClient } from "@prisma/client";
import { join } from "path";
import { migrateUploads } from "../src/storage/migrate-uploads";
import { StorageService } from "../src/storage/storage.service";

const main = async () => {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const result = await migrateUploads(prisma, StorageService.createDriver(), {
      legacyDir: process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads"),
      apply,
      log: (m) => console.log(m),
    });
    console.log(
      `\n${apply ? "Moved" : "Would move"}: ${result.moved}   already migrated: ${result.alreadyMigrated}` +
        `   missing files: ${result.missingFiles.length}   not images: ${result.notImages.length}`,
    );
    for (const m of result.missingFiles) console.log(`  missing  ${m.table} ${m.id} ${m.path}`);
    for (const m of result.notImages) console.log(`  skipped  ${m.table} ${m.id} ${m.path} (not an image)`);
    if (!apply) console.log("Dry run only. Re-run with --apply to make the changes.");
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
