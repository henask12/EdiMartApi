import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export type ExportColumn = { header: string; key: string };

export type ExportResult = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

@Injectable()
export class ExportService {
  async build(
    format: ExportFormat,
    filenameBase: string,
    columns: ExportColumn[],
    rows: Record<string, string | number | null | undefined>[],
  ): Promise<ExportResult> {
    switch (format) {
      case "csv":
        return this.csv(filenameBase, columns, rows);
      case "xlsx":
        return await this.xlsx(filenameBase, columns, rows);
      case "pdf":
        return await this.pdf(filenameBase, columns, rows);
      default:
        return this.csv(filenameBase, columns, rows);
    }
  }

  private csv(
    filenameBase: string,
    columns: ExportColumn[],
    rows: Record<string, string | number | null | undefined>[],
  ): ExportResult {
    const escape = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };
    const headerLine = columns.map((c) => escape(c.header)).join(",");
    const dataLines = rows.map((row) =>
      columns.map((c) => escape(String(row[c.key] ?? ""))).join(","),
    );
    const body = [headerLine, ...dataLines].join("\n");
    return {
      buffer: Buffer.from(body, "utf-8"),
      contentType: "text/csv; charset=utf-8",
      filename: `${filenameBase}.csv`,
    };
  }

  private async xlsx(
    filenameBase: string,
    columns: ExportColumn[],
    rows: Record<string, string | number | null | undefined>[],
  ): Promise<ExportResult> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Export");
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 18 }));
    for (const row of rows) {
      const values: Record<string, string | number> = {};
      for (const col of columns) {
        values[col.key] = row[col.key] ?? "";
      }
      sheet.addRow(values);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${filenameBase}.xlsx`,
    };
  }

  private pdf(
    filenameBase: string,
    columns: ExportColumn[],
    rows: Record<string, string | number | null | undefined>[],
  ): Promise<ExportResult> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: "application/pdf",
          filename: `${filenameBase}.pdf`,
        });
      });
      doc.on("error", reject);

      const colWidth = (doc.page.width - 80) / Math.max(columns.length, 1);
      let y = 50;
      doc.fontSize(10).font("Helvetica-Bold");
      columns.forEach((col, i) => {
        doc.text(col.header, 40 + i * colWidth, y, { width: colWidth - 4 });
      });
      y += 18;
      doc.font("Helvetica").fontSize(8);
      for (const row of rows) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 50;
        }
        columns.forEach((col, i) => {
          doc.text(String(row[col.key] ?? ""), 40 + i * colWidth, y, {
            width: colWidth - 4,
            ellipsis: true,
          });
        });
        y += 14;
      }
      doc.end();
    });
  }
}
