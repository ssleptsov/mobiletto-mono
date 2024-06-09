import { MobilettoError, MobilettoNotFoundError, MobilettoOptions, MobilettoVisitor, MobilettoMetadata, MobilettoWriteSource, MobilettoListOptions, MobilettoRemoveOptions, MobilettoDriverInfo, MobilettoDriverScope, MobilettoListOutput, MobilettoListPaging } from "mobiletto-base";
export type S3Options = MobilettoOptions & {
    bucket?: string;
    prefix?: string;
    delimiter?: string;
    region?: string;
};
export type S3InfoType = {
    driver: string;
    scope: MobilettoDriverScope;
};
export declare const S3Info: S3InfoType;
/**
 * For extend internal Aws request for delete and etc.
 */
type ListAdditionalParams = Partial<{
    MaxKeys: number;
}>;
declare class StorageClient {
    private client;
    private region;
    private bucket;
    private prefix;
    private delimiter;
    private normalizeRegex;
    constructor(key: string, secret: string, opts: S3Options);
    testConfig: () => Promise<MobilettoListOutput>;
    info: () => MobilettoDriverInfo;
    stripPrefix: (name: string) => string;
    nameToObj: (name: string) => MobilettoMetadata;
    list(path: string | undefined, recursiveOrOpts: MobilettoListOptions | boolean, visitor?: MobilettoVisitor): Promise<MobilettoListOutput | undefined>;
    _list(path: string, recursive?: boolean, visitor?: MobilettoVisitor, params?: ListAdditionalParams, paging?: MobilettoListPaging): Promise<MobilettoListOutput>;
    normalizeKey: (path: string) => string;
    denormalizeKey: (key: string) => string;
    s3error(err: any, key: string, path: string, method: string): MobilettoError | MobilettoNotFoundError;
    metadata(path: string): Promise<MobilettoMetadata>;
    write(path: string, generator: MobilettoWriteSource): Promise<number>;
    read(path: string, callback: (data: any) => void, endCallback?: () => unknown): Promise<number>;
    remove(path: string, optsOrRecursive?: MobilettoRemoveOptions | boolean, quiet?: boolean): Promise<string | string[]>;
}
export declare const storageClient: (key: string, secret: string, opts: S3Options) => StorageClient;
export {};
