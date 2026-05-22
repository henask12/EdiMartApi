export declare class CreateProductDto {
    name: string;
    categoryId: string;
    productTypeId?: string;
    sellingPrice: string;
    costPrice?: string;
    restockAt?: number;
    restockQty?: number;
    imagePath?: string;
    description?: string;
    originCountry?: string;
    initialQuantity?: string;
    initialExpiryDate?: string;
}
export declare class UpdateProductDto {
    name?: string;
    categoryId?: string;
    productTypeId?: string;
    sellingPrice?: string;
    costPrice?: string;
    restockAt?: number;
    restockQty?: number;
    isActive?: boolean;
    imagePath?: string;
    description?: string;
    originCountry?: string;
}
