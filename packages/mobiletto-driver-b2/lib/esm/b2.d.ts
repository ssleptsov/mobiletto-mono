/// <reference types="node" />
import B2 from "backblaze-b2";
import { MobilettoVisitor, MobilettoMetadata, MobilettoListOptions, MobilettoWriteSource, MobilettoRemoveOptions, MobilettoFeatureFlags, MobilettoOptions, MobilettoDriverInfo, MobilettoDriverScope } from "mobiletto-base";
export type B2Options = MobilettoOptions & {
    bucket?: string;
    partSize?: number;
    prefix?: string;
    delimiter?: string;
};
type B2WithUploadAny = B2 & {
    uploadAny: (opts: any) => any;
};
type B2File = {
    fileId: string;
    fileName: string;
    contentType: string;
    contentLength: number;
    uploadTimestamp: number;
};
type B2Listing = {
    data: {
        files?: B2File[];
    };
};
type B2ListOptions = {
    dir?: boolean;
    max?: number;
};
export type B2Metadata = MobilettoMetadata & {
    b2id: string;
};
export declare const B2Flags: MobilettoFeatureFlags;
export type B2InfoType = {
    driver: string;
    scope: MobilettoDriverScope;
};
export declare const B2Info: B2InfoType;
declare class StorageClient {
    b2: B2WithUploadAny;
    bucket: string;
    prefix: string;
    delimiter: string;
    opts: B2Options;
    lastAuth: number;
    absoluteMinimumPartSize: number | undefined;
    recommendedPartSize: number | undefined;
    configuredPartSize: number | undefined;
    normalizeRegex: RegExp;
    flags: () => MobilettoFeatureFlags;
    info: () => MobilettoDriverInfo;
    driver_metadata?: (path: string) => Promise<B2Metadata>;
    constructor(keyId: string, appKey: string, opts: B2Options);
    auth: () => Promise<void>;
    testConfig: () => Promise<MobilettoMetadata[]>;
    normalizePath: (path: string) => string;
    denormalizePath: (path: string) => string;
    bbError: (err: any, path: string, method: string) => any;
    b2type: (f: B2File) => "dir" | "file";
    file2object(f: B2File): B2Metadata;
    processList: (path: string, response: B2Listing, visitor?: MobilettoVisitor) => Promise<B2Metadata[]>;
    list: (pth?: string, optsOrRecursive?: MobilettoListOptions | boolean, visitor?: MobilettoVisitor) => Promise<MobilettoMetadata[]>;
    b2_list: (pth?: string, optsOrRecursive?: MobilettoListOptions | boolean, visitor?: MobilettoVisitor, b2opts?: B2ListOptions) => Promise<MobilettoMetadata[]>;
    b2_meta: (path: string) => Promise<B2Metadata>;
    metadata(pth: string): Promise<B2Metadata>;
    write(path: string, generatorOrReadable: MobilettoWriteSource): Promise<any>;
    read(path: string, callback: (chunk: Buffer) => void, endCallback?: () => void): Promise<number>;
    deleteVersions(path: string, normPath: string, versions: B2File[], quiet: boolean, errors?: Record<string, string>): Promise<string[]>;
    remove(path: string, optsOrRecursive?: MobilettoRemoveOptions | boolean, quiet?: boolean): Promise<string | string[]>;
}
export declare const storageClient: (key: string, secret: string, opts: B2Options) => StorageClient;
export {};
