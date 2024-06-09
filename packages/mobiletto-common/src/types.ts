import { ReadStream } from "fs";
import { Readable, Transform } from "stream";

export const M_FILE = "file";
export const M_DIR = "dir";
export const M_LINK = "link";
export const M_SPECIAL = "special";

export type MobilettoEntryType = "file" | "dir" | "link" | "special";

export type MobilettoMetadata = {
    name: string;
    type: MobilettoEntryType;
    size?: number;
    ctime?: number;
    mtime?: number;
};

export type MobilettoVisitor = (meta: MobilettoMetadata) => Promise<unknown>;

export type MobilettoListOptions = {
    recursive?: boolean;
    visitor?: MobilettoVisitor;
    paging?: MobilettoListPaging;
};

export type MobilettoListPaging = {
    maxItems: number;
    continuationToken?: string;
};

export type MobilettoListOutput = {
    objects: MobilettoMetadata[];
    nextPageToken?: string;
    previousPageToken?: string;
}

export type MobilettoSyncReadFunc = { next: () => { value: Buffer } };
export type MobilettoAsyncReadFunc = { next: () => Promise<{ value: Buffer }> };
export type MobilettoReadFunc = MobilettoSyncReadFunc | MobilettoAsyncReadFunc;
export type MobilettoByteCounter = { count: number };

export type MobilettoReadable = ReadStream | Transform | Readable;
export type MobilettoGenerator = Generator<Buffer | string, void> | Iterator<Buffer | string>;

export type MobilettoWriteSource = Buffer | string | MobilettoGenerator | ReadStream;

export type MobilettoRemoveOptions = {
    recursive?: boolean;
    quiet?: boolean;
};

export type MobilettoMirrorResults = {
    success: number;
    errors: number;
};

export type MobilettoRedisConfig = {
    host?: string;
    port?: number;
    prefix?: string;
    enabled?: boolean;
};

export type MobilettoOptions = {
    readOnly?: boolean;
    redisConfig: MobilettoRedisConfig;
    [prop: string]: unknown;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export type MobilettoPatchable = {
    [func: string]: any;
};
export type MobilettoFunctions = Record<string, (client: MobilettoMinimalClient) => (...params: any[]) => any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type MobilettoConflictFunction = (m: MobilettoMinimalClient, s: string) => boolean;

export type MobilettoFeatureFlagName = "list_tryMetaIfEmpty";

export type MobilettoFeatureFlags = {
    list_tryMetaIfEmpty?: boolean;
    [func: string]: boolean | undefined;
};

export type MobilettoDriverScope = "local" | "global";

export type MobilettoDriverInfo = {
    driver: string;
    scope: MobilettoDriverScope;
    canonicalName: () => string;
};

export type MobilettoMinimalClient = MobilettoPatchable & {
    testConfig: () => unknown;
    info: () => MobilettoDriverInfo;
    flags?: () => MobilettoFeatureFlags;
    list: (
        pth?: string,
        optsOrRecursive?: MobilettoListOptions | boolean,
        visitor?: MobilettoVisitor
    ) => Promise<MobilettoListOutput>;
    metadata: (path: string) => Promise<MobilettoMetadata>;
    read: (path: string, callback: (chunk: Buffer) => void, endCallback?: () => void) => Promise<number>;
    write: (path: string, data: MobilettoWriteSource) => Promise<number>;
    remove: (
        path: string,
        optsOrRecursive?: MobilettoRemoveOptions | boolean,
        quiet?: boolean
    ) => Promise<string | string[]>;
};
