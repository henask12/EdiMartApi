"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportService = void 0;
const common_1 = require("@nestjs/common");
const exceljs_1 = __importDefault(require("exceljs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
let ExportService = class ExportService {
    async build(format, filenameBase, columns, rows) {
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
    csv(filenameBase, columns, rows) {
        const escape = (v) => {
            if (v.includes(",") || v.includes('"') || v.includes("\n")) {
                return `"${v.replace(/"/g, '""')}"`;
            }
            return v;
        };
        const headerLine = columns.map((c) => escape(c.header)).join(",");
        const dataLines = rows.map((row) => columns.map((c) => escape(String(row[c.key] ?? ""))).join(","));
        const body = [headerLine, ...dataLines].join("\n");
        return {
            buffer: Buffer.from(body, "utf-8"),
            contentType: "text/csv; charset=utf-8",
            filename: `${filenameBase}.csv`,
        };
    }
    async xlsx(filenameBase, columns, rows) {
        const workbook = new exceljs_1.default.Workbook();
        const sheet = workbook.addWorksheet("Export");
        sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 18 }));
        for (const row of rows) {
            const values = {};
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
    pdf(filenameBase, columns, rows) {
        return new Promise((resolve, reject) => {
            const doc = new pdfkit_1.default({ margin: 40, size: "A4", layout: "landscape" });
            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
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
};
exports.ExportService = ExportService;
exports.ExportService = ExportService = __decorate([
    (0, common_1.Injectable)()
], ExportService);
//# sourceMappingURL=export.service.js.map