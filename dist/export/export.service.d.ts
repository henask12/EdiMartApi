export type ExportFormat = "csv" | "xlsx" | "pdf";
export type ExportColumn = {
    header: string;
    key: string;
};
export type ExportResult = {
    buffer: Buffer;
    contentType: string;
    filename: string;
};
export declare class ExportService {
    build(format: ExportFormat, filenameBase: string, columns: ExportColumn[], rows: Record<string, string | number | null | undefined>[]): Promise<ExportResult>;
    private csv;
    private xlsx;
    private pdf;
}
