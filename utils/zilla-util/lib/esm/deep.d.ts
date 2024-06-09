export type ObjectNav = {
    append?: boolean;
    remove?: number;
    next?: string | number;
};
export declare const parseDeep: (fieldPath: string) => ObjectNav[];
export declare const deepGet: (obj: any, fieldPath: string) => unknown;
export declare const deepUpdate: (obj: any, fieldPath: string, value: any) => void;
export declare const stripNonAlphaNumericKeys: <T>(obj: T) => T;
export declare const hasDuplicateProperty: (things: Record<string, unknown>[], prop: string) => boolean;
export declare const hasUniqueProperty: (things: Record<string, unknown>[], prop: string) => boolean;
