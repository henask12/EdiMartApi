/**
 * Stock reconciliation report. READ-ONLY: it never changes data.
 *
 *   npm run reconcile                 prints a summary and the products with findings
 *   npm run reconcile -- --json out.json   also writes the full report as JSON
 *   npm run reconcile -- --csv out.csv     also writes the findings as CSV
 *   npm run reconcile -- --strict          exit code 1 when anything is found (for CI / cron)
 *
 * Point DATABASE_URL at the database to check (use a copy of production for a first look).
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { reconcileStock } from "../src/inventory/reconciliation";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const main = async () => {
  const prisma = new PrismaClient();
  try {
    const report = await reconcileStock(prisma);
    const t = report.totals;
    console.log(`Stock reconciliation - ${report.generatedAt}`);
    console.log(`  inventory rows checked : ${t.inventoryRows}`);
    console.log(`  on-hand != ledger sum  : ${t.withLedgerDrift}`);
    console.log(`  ledger chain breaks    : ${t.withChainBreaks}`);
    console.log(`  batches exceed on-hand : ${t.batchesExceedOnHand}`);
    console.log(`  negative on-hand       : ${t.negativeOnHand}`);
    console.log(`  over-reserved          : ${t.overReserved}`);
    if (report.findings.length > 0) {
      console.log("\nProducts with findings:");
      console.table(
        report.findings.map((r) => ({
          product: r.productName,
          onHand: r.onHand,
          ledger: r.ledgerSum,
          drift: r.drift,
          breaks: r.chainBreaks,
          batches: r.batchRemaining ?? "-",
          reserved: r.reserved,
          flags: [
            r.negativeOnHand && "NEGATIVE",
            r.batchesExceedOnHand && "BATCH>ONHAND",
            r.overReserved && "OVERRESERVED",
          ]
            .filter(Boolean)
            .join(" "),
        })),
      );
    } else {
      console.log("\nNo findings: stored stock agrees with the ledger.");
    }

    const jsonPath = arg("--json");
    if (jsonPath) {
      writeFileSync(jsonPath, JSON.stringify(report, null, 2));
      console.log(`Wrote ${jsonPath}`);
    }
    const csvPath = arg("--csv");
    if (csvPath) {
      const cols = [
        "productName", "sku", "location", "onHand", "ledgerSum", "drift", "movementCount",
        "chainBreaks", "batchRemaining", "untrackedQty", "batchesExceedOnHand", "negativeOnHand",
        "overReserved", "reserved",
      ] as const;
      const lines = [cols.join(",")].concat(
        report.findings.map((r) => cols.map((c) => csvCell(r[c])).join(",")),
      );
      writeFileSync(csvPath, lines.join("\n"));
      console.log(`Wrote ${csvPath}`);
    }

    const dirty =
      t.withLedgerDrift + t.withChainBreaks + t.batchesExceedOnHand + t.negativeOnHand + t.overReserved > 0;
    if (process.argv.includes("--strict") && dirty) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
