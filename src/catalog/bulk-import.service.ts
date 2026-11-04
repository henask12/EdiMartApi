import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { LocationsService } from "../locations/locations.service";
import { InventoryService } from "../inventory/inventory.service";

type PreviewRow = {
  row: number;
  name: string;
  category: string;
  sellingPrice: string;
  costPrice?: string;
  barcode?: string;
  brand?: string;
  openingQty?: string;
  errors: string[];
  warnings: string[];
};

const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const normalizeHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

@Injectable()
export class BulkImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationsService,
    private readonly inventory: InventoryService,
  ) {}

  previewCsv(csvText: string): { rows: PreviewRow[]; validCount: number; errorCount: number } {
    const lines = csvText
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException("CSV needs a header row and at least one data row");
    }

    const headers = splitCsvLine(lines[0]).map(normalizeHeader);
    const idx = (aliases: string[]) => {
      for (const a of aliases) {
        const i = headers.indexOf(a);
        if (i >= 0) return i;
      }
      return -1;
    };

    const nameI = idx(["name", "product", "product_name"]);
    const catI = idx(["category", "category_name"]);
    const priceI = idx(["selling_price", "price", "sell_price"]);
    const costI = idx(["cost_price", "cost"]);
    const barcodeI = idx(["barcode", "ean", "upc"]);
    const brandI = idx(["brand"]);
    const qtyI = idx(["opening_qty", "qty", "quantity", "opening_stock"]);

    if (nameI < 0 || catI < 0 || priceI < 0) {
      throw new BadRequestException(
        "CSV must include columns: name, category, selling_price (optional: cost_price, barcode, brand, opening_qty)",
      );
    }

    const rows: PreviewRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const name = cols[nameI] ?? "";
      const category = cols[catI] ?? "";
      const sellingPrice = cols[priceI] ?? "";
      const costPrice = costI >= 0 ? cols[costI] : undefined;
      const barcode = barcodeI >= 0 ? cols[barcodeI] : undefined;
      const brand = brandI >= 0 ? cols[brandI] : undefined;
      const openingQty = qtyI >= 0 ? cols[qtyI] : undefined;
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!name) errors.push("name is required");
      if (!category) errors.push("category is required");
      if (!sellingPrice || Number.isNaN(Number(sellingPrice))) errors.push("selling_price must be a number");
      if (costPrice && Number.isNaN(Number(costPrice))) errors.push("cost_price must be a number");
      if (openingQty && Number.isNaN(Number(openingQty))) errors.push("opening_qty must be a number");
      if (Number(sellingPrice) < 0) errors.push("selling_price cannot be negative");
      rows.push({
        row: i + 1,
        name,
        category,
        sellingPrice,
        costPrice: costPrice || undefined,
        barcode: barcode || undefined,
        brand: brand || undefined,
        openingQty: openingQty || undefined,
        errors,
        warnings,
      });
    }

    return {
      rows,
      validCount: rows.filter((r) => r.errors.length === 0).length,
      errorCount: rows.filter((r) => r.errors.length > 0).length,
    };
  }

  async commitPreview(
    userId: string,
    rows: PreviewRow[],
    includeCost: boolean,
  ): Promise<{ created: number; skipped: number; errors: Array<{ row: number; message: string }> }> {
    const valid = rows.filter((r) => r.errors.length === 0);
    if (valid.length === 0) throw new BadRequestException("No valid rows to import");

    let created = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];
    const defaultLoc = await this.locations.getDefault();

    for (const row of valid) {
      try {
        let category = await this.prisma.category.findFirst({
          where: { name: { equals: row.category, mode: "insensitive" } },
        });
        if (!category) {
          category = await this.prisma.category.create({ data: { name: row.category } });
        }

        const existing = await this.prisma.product.findFirst({
          where: {
            categoryId: category.id,
            name: { equals: row.name, mode: "insensitive" },
          },
        });
        if (existing) {
          skipped += 1;
          errors.push({ row: row.row, message: "Product already exists in this category (skipped)" });
          continue;
        }

        if (row.barcode) {
          const taken = await this.prisma.productBarcode.findUnique({ where: { barcode: row.barcode } });
          if (taken) {
            skipped += 1;
            errors.push({ row: row.row, message: `Barcode ${row.barcode} already in use (skipped)` });
            continue;
          }
        }

        const cost = includeCost && row.costPrice ? new Prisma.Decimal(row.costPrice) : new Prisma.Decimal(0);
        const product = await this.prisma.$transaction(async (tx) => {
          const createdProduct = await tx.product.create({
            data: {
              name: row.name,
              brand: row.brand || null,
              categoryId: category!.id,
              sellingPrice: new Prisma.Decimal(row.sellingPrice),
              costPrice: cost,
              sku: `IMP-${Date.now().toString(36)}-${row.row}`,
            },
          });
          await tx.inventoryItem.create({
            data: {
              productId: createdProduct.id,
              locationId: defaultLoc.id,
              quantityOnHand: new Prisma.Decimal(0),
              averageCost: cost,
            },
          });
          if (row.barcode) {
            await tx.productBarcode.create({
              data: {
                productId: createdProduct.id,
                barcode: row.barcode,
                kind: "INTERNAL",
                isPrimary: true,
              },
            });
          }
          return createdProduct;
        });

        if (row.openingQty && Number(row.openingQty) > 0) {
          await this.inventory.receiveGoods(userId, {
            productId: product.id,
            quantity: row.openingQty,
            unitCost: cost.toString(),
            notes: "CSV opening stock",
          });
        }

        created += 1;
      } catch (e) {
        skipped += 1;
        errors.push({
          row: row.row,
          message: e instanceof Error ? e.message : "Import failed",
        });
      }
    }

    await this.audit.log(userId, "BULK_IMPORT", "Product", undefined, {
      created,
      skipped,
      errorCount: errors.length,
    });

    return { created, skipped, errors };
  }
}
