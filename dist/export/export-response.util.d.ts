import type { Response } from "express";
import type { ExportResult } from "./export.service";
export declare const sendExport: (res: Response, result: ExportResult) => void;
export declare const parseExportFormat: (value?: string) => "csv" | "xlsx" | "pdf";
