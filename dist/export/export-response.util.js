"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseExportFormat = exports.sendExport = void 0;
const sendExport = (res, result) => {
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
};
exports.sendExport = sendExport;
const parseExportFormat = (value) => {
    if (value === "xlsx" || value === "pdf") {
        return value;
    }
    return "csv";
};
exports.parseExportFormat = parseExportFormat;
//# sourceMappingURL=export-response.util.js.map