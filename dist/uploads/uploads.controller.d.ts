import { UploadsService } from "./uploads.service";
export declare class UploadsController {
    private readonly uploads;
    constructor(uploads: UploadsService);
    uploadProductImage(file: Express.Multer.File): Promise<{
        filename: string;
        path: string;
        url: string;
    }> | {
        message: string;
    };
    uploadSaleProof(file: Express.Multer.File): Promise<{
        filename: string;
        path: string;
        url: string;
    }> | {
        message: string;
    };
}
