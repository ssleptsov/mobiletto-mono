import B2 from "backblaze-b2";

// this library is a godsend for B2 uploads
import * as b2uploadAny from "./upload.js";
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
const uploadAnyInstaller = b2uploadAny.upload.default.install;
/* eslint-enable @typescript-eslint/ban-ts-comment */
uploadAnyInstaller(B2);

import { Readable } from "stream";

import {
    M_FILE,
    M_DIR,
    logger,
    readStream,
    isReadable,
    MobilettoError,
    MobilettoNotFoundError,
    MobilettoVisitor,
    MobilettoMetadata,
    MobilettoListOptions,
    MobilettoWriteSource,
    MobilettoGenerator,
    MobilettoRemoveOptions,
    MobilettoFeatureFlags,
    MobilettoOptions,
    MobilettoDriverInfo,
    MobilettoDriverScope,
} from "mobiletto-base";

// B2 tokens last 24 hours. Let's refresh ours after 23 hours and 50 minutes
const AUTH_REFRESH = 1000 * 60 * 60 * 24 - 1000 * 60 * 10;

export type B2Options = MobilettoOptions & {
    bucket?: string;
    partSize?: number;
    prefix?: string;
    delimiter?: string;
};

type B2WithUploadAny = B2 & {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    uploadAny: (opts: any) => any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
};

type B2File = {
    fileId: string;
    fileName: string;
    contentType: string;
    contentLength: number;
    uploadTimestamp: number;
};

type B2Listing = {
    data: { files?: B2File[] };
};

type B2ListOptions = {
    dir?: boolean;
    max?: number;
};

export type B2Metadata = MobilettoMetadata & {
    b2id: string;
};

export const B2Flags: MobilettoFeatureFlags = {
    list_tryMetaIfEmpty: true,
};

export type B2InfoType = {
    driver: string;
    scope: MobilettoDriverScope;
};

export const B2Info: B2InfoType = {
    driver: "b2",
    scope: "global",
};

class StorageClient {
    b2;
    bucket;
    prefix;
    delimiter;
    opts;
    lastAuth;
    absoluteMinimumPartSize: number | undefined;
    recommendedPartSize: number | undefined;
    configuredPartSize: number | undefined;
    normalizeRegex: RegExp;
    flags: () => MobilettoFeatureFlags;
    info: () => MobilettoDriverInfo;
    driver_metadata?: (path: string) => Promise<B2Metadata>;
    constructor(keyId: string, appKey: string, opts: B2Options) {
        if (!keyId || !appKey || !opts.bucket)
            throw new MobilettoError(`b2.StorageClient: key, secret and opts.bucket are required`);
        this.b2 = new B2({
            applicationKeyId: keyId,
            applicationKey: appKey,
        }) as B2WithUploadAny;
        this.opts = opts;
        this.configuredPartSize = opts.partSize ? opts.partSize : -1;
        this.bucket = opts.bucket;
        this.delimiter = opts.delimiter || "/";
        this.normalizeRegex = new RegExp(`${this.delimiter}{2,}`, "g");
        this.prefix = opts.prefix
            ? opts.prefix.endsWith(this.delimiter)
                ? opts.prefix
                : opts.prefix + this.delimiter
            : "";
        this.lastAuth = 0;
        this.flags = () => B2Flags;
        this.info = (): MobilettoDriverInfo => ({
            canonicalName: () => `b2:${this.bucket}`,
            ...B2Info,
        });
    }

    auth = async () => {
        if (Date.now() - this.lastAuth > AUTH_REFRESH) {
            try {
                const response = await this.b2.authorize({});
                this.lastAuth = Date.now();
                this.absoluteMinimumPartSize = response.data.absoluteMinimumPartSize;
                this.recommendedPartSize = response.data.recommendedPartSize;
                if (this.configuredPartSize === -1) {
                    logger.info(`partSize was not configured, using recommendedPartSize=${this.recommendedPartSize}`);
                    this.configuredPartSize = this.recommendedPartSize;
                } else if (
                    this.absoluteMinimumPartSize &&
                    this.configuredPartSize &&
                    this.configuredPartSize < this.absoluteMinimumPartSize
                ) {
                    logger.warn(
                        `partSize was too small (${this.configuredPartSize}), using absoluteMinimumPartSize=${this.absoluteMinimumPartSize}`
                    );
                    this.configuredPartSize = this.absoluteMinimumPartSize;
                }
            } catch (e) {
                logger.error(`auth error: ${e}`);
                throw e;
            }
        }
    };

    testConfig = async () => await this.b2_list("", false, undefined, { max: 1 });

    normalizePath = (path: string) => {
        const p = path.startsWith(this.prefix)
            ? path
            : this.prefix + (path.startsWith(this.delimiter) ? path.substring(1) : path);
        return p.replace(this.normalizeRegex, this.delimiter);
    };
    denormalizePath = (path: string) => {
        const norm = path.startsWith(this.prefix) ? path.substring(this.prefix.length) : path;
        return norm.startsWith(this.delimiter) ? norm.substring(1) : norm;
    };
    /* eslint-disable @typescript-eslint/no-explicit-any */
    bbError = (err: any, path: string, method: string) => {
        /* eslint-enable @typescript-eslint/no-explicit-any */
        if (err.response && err.response.status && err.response.status === 404) {
            return new MobilettoNotFoundError(path);
        } else if (err.response && err.response.data && err.response.data.message) {
            return new MobilettoError(`${method} error: ${err.response.data.message}`);
        }
        return err;
    };

    b2type = (f: B2File) => (f.fileName.endsWith(this.delimiter) && f.contentType === null ? M_DIR : M_FILE);

    file2object(f: B2File): B2Metadata {
        return {
            name: this.denormalizePath(f.fileName),
            size: f.contentLength,
            mtime: f.uploadTimestamp,
            type: this.b2type(f),
            b2id: f.fileId,
        };
    }

    processList = async (path: string, response: B2Listing, visitor?: MobilettoVisitor) => {
        const files = response && response.data && response.data.files ? response.data.files : null;
        if (!files) {
            return [];
        }
        const objects = files.map((f) => {
            logger.debug(`processList(${path}) adding file: ${f.fileName}`);
            return this.file2object(f);
        });
        if (visitor) {
            for (const obj of objects) {
                await visitor(obj);
            }
        }
        return objects;
    };

    list = (
        pth?: string,
        optsOrRecursive?: MobilettoListOptions | boolean,
        visitor?: MobilettoVisitor
    ): Promise<MobilettoMetadata[]> => this.b2_list(pth, optsOrRecursive, visitor);

    b2_list = async (
        pth?: string,
        optsOrRecursive?: MobilettoListOptions | boolean,
        visitor?: MobilettoVisitor,
        b2opts?: B2ListOptions
    ): Promise<MobilettoMetadata[]> => {
        try {
            const p = pth ? pth : "";
            const recursive = optsOrRecursive === true || (optsOrRecursive && optsOrRecursive.recursive);
            const optsDir = !!(b2opts && b2opts.dir);
            let dirDiscovered = null;
            let firstResult: MobilettoMetadata | null = null;
            const files: MobilettoMetadata[] = [];
            await this.auth();
            const hasMax = !!(b2opts && b2opts.max);
            const maxFileCount = (hasMax ? b2opts && b2opts.max : 10000) as number;
            const pfx =
                (this.prefix.length === 0 || this.prefix.endsWith(this.delimiter)
                    ? this.prefix
                    : this.prefix + this.delimiter) + (p.startsWith(this.delimiter) ? p.substring(0) : pth);

            let response = await this.b2.listFileNames({
                bucketId: this.bucket,
                startFileName: "",
                maxFileCount,
                delimiter: recursive ? "" : this.delimiter,
                prefix: pfx,
            });
            const handleResponse = async (
                files: MobilettoMetadata[],
                pth: string,
                response: B2Listing,
                visitor?: MobilettoVisitor
            ) => {
                const list = await this.processList(pth, response, visitor);
                if (list.length === 0) {
                    return true;
                }
                if (!optsDir && !firstResult && list.length > 0) {
                    firstResult = list[0];
                    const exact = firstResult.name === pth || firstResult.name === pth + this.delimiter;
                    if (exact) {
                        // we found exactly what we were looking for
                        // if the next thing in the list starts with it plus delimiter,
                        // it is a directory, return the contents as long as they match
                        if (list.length > 1 && list[1].name.startsWith(pth + this.delimiter)) {
                            const dirEntries = list.filter((o) => o.name.startsWith(pth));
                            files.push(...dirEntries);
                            return false;
                        } else if (firstResult.name.endsWith(this.delimiter)) {
                            const dirEntries = list.filter((o) => o.name.startsWith(pth));
                            files.push(...dirEntries);
                            dirDiscovered = true;
                            return true;
                        } else {
                            // it's an exact file-match, return it
                            files.push(list[0]);
                            return true;
                        }
                    }
                }
                if (hasMax && files.length + list.length >= maxFileCount) {
                    files.push(...list.slice(0, maxFileCount - files.length + 1));
                    return true;
                } else {
                    files.push(...list);
                    return false;
                }
            };
            while (response.data.nextFileName) {
                if (await handleResponse(files, p, response, visitor)) {
                    return files;
                }
                response = await this.b2.listFileNames({
                    bucketId: this.bucket,
                    startFileName: response.data.nextFileName,
                    maxFileCount,
                    delimiter: recursive ? "" : this.delimiter,
                    prefix: pfx,
                });
            }
            await handleResponse(files, p, response, visitor);
            if (dirDiscovered && !p.endsWith(this.delimiter)) {
                const subdirFiles = await this.b2_list(p + this.delimiter, recursive, undefined, { dir: true });
                files.shift();
                files.push(...subdirFiles);
            }
            return files;
        } catch (err) {
            throw this.bbError(err, pth || "", "list");
        }
    };

    b2_meta = async (path: string): Promise<B2Metadata> =>
        this.driver_metadata ? this.driver_metadata(path) : this.metadata(path);

    async metadata(pth: string): Promise<B2Metadata> {
        await this.auth();
        let files = null;
        const normPath = this.normalizePath(pth);
        try {
            files = (
                await this.b2.listFileNames({
                    bucketId: this.bucket,
                    startFileName: normPath,
                    maxFileCount: 1,
                    delimiter: "",
                    prefix: this.prefix,
                })
            ).data.files;
        } catch (err) {
            throw this.bbError(err, pth, "metadata");
        }
        if (files.length === 0) {
            throw new MobilettoNotFoundError(pth);
        }
        const found = files.filter((f: B2File) => f.fileName === normPath);
        if (!found || found.length === 0) {
            // if this is a directory, we may have returned the first item in it, that's OK
            if (
                files[0].fileName.startsWith(normPath.endsWith(this.delimiter) ? normPath : normPath + this.delimiter)
            ) {
                const obj = this.file2object(files[0]);
                obj.name = pth;
                obj.type = M_DIR;
                return obj;
            }
            throw new MobilettoNotFoundError(pth);
        }
        if (found.length > 1) {
            throw new MobilettoError(`metadata(${pth}) multiple files matched: ${JSON.stringify(found)}`);
        }
        return this.file2object(files[0]);
    }

    async write(path: string, generatorOrReadable: MobilettoWriteSource) {
        await this.auth();
        logger.debug(`write: writing path ${path}`);
        let stream: MobilettoWriteSource | Readable = generatorOrReadable;
        if (!isReadable(generatorOrReadable)) {
            stream = new Readable({
                /* eslint-disable @typescript-eslint/no-unused-vars */
                async read(size) {
                    /* eslint-enable @typescript-eslint/no-unused-vars */
                    const chunk = (await (generatorOrReadable as MobilettoGenerator).next()).value;
                    this.push(typeof chunk !== "undefined" ? chunk : null);
                },
            });
        }
        let response = null;
        try {
            response = await this.b2.uploadAny({
                bucketId: this.bucket,
                fileName: this.normalizePath(path),
                partSize: this.configuredPartSize,
                data: stream,
            });
            // response is from either b2_upload_file or b2_finish_large_file
            // It depends on how large the file was, see: https://github.com/gideo-llc/backblaze-b2-upload-any/blob/master/README.md#uploadanyoptions
            if (response.contentLength) {
                return response.contentLength;
            }
        } catch (e) {
            logger.error(`write error: ${e}`);
            throw this.bbError(e, path, "write");
        }
        if (response) {
            throw new MobilettoError(
                `write error: response status ${response.status} with data ${JSON.stringify(response.data)}`
            );
        }
    }

    async read(path: string, callback: (chunk: Buffer) => void, endCallback?: () => void): Promise<number> {
        await this.auth();
        const file = this.normalizePath(path);
        logger.debug(`read: reading path: ${path}`);
        let meta = null;
        try {
            meta = await this.b2_meta(file);
        } catch (e) {
            if (e instanceof MobilettoError || e instanceof MobilettoNotFoundError) {
                throw e;
            }
            throw new MobilettoError(`read: error reading metadata for path ${path}`, e);
        }
        if (meta.type === M_DIR) {
            throw new MobilettoError(`read: cannot read directory: ${path}`);
        }
        try {
            const stream = await this.b2.downloadFileById({
                fileId: meta.b2id,
                responseType: "stream",
            });
            return await readStream(stream.data, callback, endCallback);
        } catch (err) {
            throw this.bbError(err, path, "read");
        }
    }

    async deleteVersions(
        path: string,
        normPath: string,
        versions: B2File[],
        quiet: boolean,
        errors: Record<string, string> = {}
    ) {
        const removed = [];
        for (const version of versions) {
            logger.debug(
                `deleteVersions(${path}, ${versions.length} versions) pushing version to delete: fileName=${version.fileName} fileId=${version.fileId}`
            );
            await this.auth();
            try {
                if (!version.fileName.startsWith(normPath)) {
                    logger.debug(
                        `deleteVersions(${path}, ${versions.length} versions) ending iteration on mismatched file: ${version.fileName}`
                    );
                    return removed;
                }
                const delResponse = await this.b2.deleteFileVersion({
                    fileName: version.fileName,
                    fileId: version.fileId,
                });
                if (delResponse && delResponse.status && ( typeof delResponse.status == 'string' && parseInt(delResponse.status) !== 200 || delResponse.status != 200) ) {
                    const message = `deleteVersions(${path}) received HTTP status ${
                        delResponse.status
                    } trying to delete file version: ${JSON.stringify(version)}`;
                    logger.error(message);
                    if (errors) {
                        errors[path] = message;
                    }
                } else if (removed) {
                    logger.debug(
                        `deleteVersions(${path}, ${versions.length} versions) REMOVED: fileName=${version.fileName} fileId=${version.fileId}`
                    );
                    removed.push(this.denormalizePath(version.fileName));
                }
            } catch (err) {
                const message = `deleteVersions(${path}) error deleting version ${version.fileId}: ${err}`;
                logger.error(message);
                if (errors) {
                    errors[path] = message;
                }
                if (!quiet) throw new MobilettoError(message, err);
            }
        }
        const errPaths = Object.keys(errors);
        if (errPaths.length > 0) {
            if (quiet) {
                logger.info(
                    `deleteVersions(${path}) had ${errPaths.length} errors but quiet=true, returning ${removed.length} removed paths`
                );
                return removed;
            }
            throw new MobilettoError(`deleteVersions(${path}) had errors: ${JSON.stringify(errors)}`);
        }
        return removed;
    }

    async remove(
        path: string,
        optsOrRecursive?: MobilettoRemoveOptions | boolean,
        quiet?: boolean
    ): Promise<string | string[]> {
        const recursive = optsOrRecursive === true || (optsOrRecursive && optsOrRecursive.recursive) || false;
        quiet ||= false;
        logger.debug(`b2.remove(${path}, recursive=${recursive}) starting...`);
        await this.auth();
        let meta = null;
        const errors = {};
        const normPath = this.normalizePath(path);
        try {
            logger.debug(`b2.remove(${path}) fetching metadata to determine file/directory`);
            meta = await this.b2_meta(path);
        } catch (e) {
            if (quiet) {
                logger.debug(
                    `b2.remove(${path}) quietly returning, not reporting error fetching metadata for ${path}: ${e}`
                );
                return path;
            }
            if (e instanceof MobilettoError || e instanceof MobilettoNotFoundError) {
                throw e;
            }
            throw new MobilettoError(`b2.remove(${path}) error reading metadata for path ${path}`, e);
        }
        if (meta.type === M_FILE) {
            try {
                await this.auth();
                const response = await this.b2.listFileVersions({
                    bucketId: this.bucket,
                    startFileName: normPath,
                    startFileId: meta.b2id,
                    maxFileCount: 1000,
                });
                const versions = response.data.files.filter((f: B2File) => f.fileName === normPath);
                await this.deleteVersions(path, normPath, versions, quiet, errors);
            } catch (err) {
                if (err instanceof MobilettoError) {
                    throw err;
                }
                throw new MobilettoError(`b2.remove(${path}) error: ${err}`, err);
            }
            return path;
        } else if (meta.type === M_DIR) {
            if (!recursive) {
                if (quiet) {
                    logger.debug(`b2.remove(${path}) quietly returning, not deleting directory when recursive=false`);
                    return path;
                }
                throw new MobilettoError(`b2.remove(${path}) cannot remove directory (set recursive=true to remove)`);
            }
            const removed = [];
            const errors = {};
            let versionsResponse;
            try {
                logger.debug(`b2.remove(${path})`);
                const normPath = this.normalizePath(path);
                await this.auth();
                versionsResponse = await this.b2.listFileVersions({
                    bucketId: this.bucket,
                    startFileId: meta.b2id,
                    startFileName: normPath,
                    maxFileCount: 1000,
                });
                while (
                    versionsResponse.data.nextFileName &&
                    versionsResponse.data.nextFileId &&
                    versionsResponse.data.nextFileName.startsWith(normPath)
                ) {
                    logger.debug(`b2.remove(${path}) removing a batch of files then asking for more`);
                    removed.push(
                        ...(await this.deleteVersions(path, normPath, versionsResponse.data.files, quiet, errors))
                    );
                    logger.debug(`b2.remove(${path})`);
                    await this.auth();
                    versionsResponse = await this.b2.listFileVersions({
                        bucketId: this.bucket,
                        startFileName: versionsResponse.data.nextFileName,
                        startFileId: versionsResponse.data.nextFileId,
                        maxFileCount: 1000,
                    });
                }
                logger.debug(`b2.remove(${path}) removing last batch of files`);
                removed.push(
                    ...(await this.deleteVersions(path, normPath, versionsResponse.data.files, quiet, errors))
                );
            } catch (e) {
                const message = `b2.remove(${path}) error listing/deleting: ${e}`;
                if (quiet) {
                    logger.warn(message);
                } else {
                    throw new MobilettoError(message);
                }
            }
            if (Object.keys(errors).length > 0) {
                if (quiet) {
                    logger.warn(`b2.remove(${path}) errors removing some paths: ${JSON.stringify(errors)}`);
                } else {
                    throw new MobilettoError(
                        `b2.remove(${path}) errors removing some paths: ${JSON.stringify(errors)}`
                    );
                }
            }
            return removed;
        } else {
            throw new MobilettoError(`b2.remove(${path}) cannot remove file of type: ${meta.type}`);
        }
    }
}

export const storageClient = (key: string, secret: string, opts: B2Options) => {
    if (!key || !secret || !opts || !opts.bucket) {
        throw new MobilettoError("b2.storageClient: key, secret, and opts.bucket are required");
    }
    return new StorageClient(key, secret, opts);
};
