export declare class UploadsService {
    private readonly uploadDir;
    getPublicUrl(filename: string): string;
    saveImage(file: Express.Multer.File): Promise<{
        filename: string;
        path: string;
        url: string;
    }>;
    saveProductImage(file: Express.Multer.File): Promise<{
        filename: string;
        path: string;
        url: string;
    }>;
    saveSaleProof(file: Express.Multer.File): Promise<{
        filename: string;
        path: string;
        url: string;
    }>;
}
