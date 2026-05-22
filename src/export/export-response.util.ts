import type { Response } from "express";
import type { ExportResult } from "./export.service";

export const sendExport = (res: Response, result: ExportResult) => {
  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  res.send(result.buffer);
};

export const parseExportFormat = (value?: string): "csv" | "xlsx" | "pdf" => {
  if (value === "xlsx" || value === "pdf") {
    return value;
  }
  return "csv";
};
