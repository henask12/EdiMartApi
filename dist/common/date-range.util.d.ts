export declare const parseDateStart: (value: string) => Date;
export declare const parseDateEnd: (value: string) => Date;
export declare const buildCreatedAtRange: (from?: string, to?: string) => {
    gte?: Date;
    lte?: Date;
} | undefined;
