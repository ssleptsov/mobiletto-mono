export declare class MobilettoError extends Error {
    readonly err?: any;
    constructor(message: string, err?: any);
}
export declare class MobilettoNotFoundError extends Error {
    readonly id: any;
    constructor(id: any);
}
