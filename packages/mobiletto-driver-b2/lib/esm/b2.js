var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import B2 from "backblaze-b2";
// this library is a godsend for B2 uploads
import * as b2uploadAny from "./upload.js";
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
const uploadAnyInstaller = b2uploadAny.upload.default.install;
/* eslint-enable @typescript-eslint/ban-ts-comment */
uploadAnyInstaller(B2);
import { Readable } from "stream";
import { M_FILE, M_DIR, logger, readStream, isReadable, MobilettoError, MobilettoNotFoundError, } from "mobiletto-base";
// B2 tokens last 24 hours. Let's refresh ours after 23 hours and 50 minutes
const AUTH_REFRESH = 1000 * 60 * 60 * 24 - 1000 * 60 * 10;
export const B2Flags = {
    list_tryMetaIfEmpty: true,
};
export const B2Info = {
    driver: "b2",
    scope: "global",
};
class StorageClient {
    constructor(keyId, appKey, opts) {
        this.auth = () => __awaiter(this, void 0, void 0, function* () {
            if (Date.now() - this.lastAuth > AUTH_REFRESH) {
                try {
                    const response = yield this.b2.authorize({});
                    this.lastAuth = Date.now();
                    this.absoluteMinimumPartSize = response.data.absoluteMinimumPartSize;
                    this.recommendedPartSize = response.data.recommendedPartSize;
                    if (this.configuredPartSize === -1) {
                        logger.info(`partSize was not configured, using recommendedPartSize=${this.recommendedPartSize}`);
                        this.configuredPartSize = this.recommendedPartSize;
                    }
                    else if (this.absoluteMinimumPartSize &&
                        this.configuredPartSize &&
                        this.configuredPartSize < this.absoluteMinimumPartSize) {
                        logger.warn(`partSize was too small (${this.configuredPartSize}), using absoluteMinimumPartSize=${this.absoluteMinimumPartSize}`);
                        this.configuredPartSize = this.absoluteMinimumPartSize;
                    }
                }
                catch (e) {
                    logger.error(`auth error: ${e}`);
                    throw e;
                }
            }
        });
        this.testConfig = () => __awaiter(this, void 0, void 0, function* () { return yield this.b2_list("", false, undefined, { max: 1 }); });
        this.normalizePath = (path) => {
            const p = path.startsWith(this.prefix)
                ? path
                : this.prefix + (path.startsWith(this.delimiter) ? path.substring(1) : path);
            return p.replace(this.normalizeRegex, this.delimiter);
        };
        this.denormalizePath = (path) => {
            const norm = path.startsWith(this.prefix) ? path.substring(this.prefix.length) : path;
            return norm.startsWith(this.delimiter) ? norm.substring(1) : norm;
        };
        /* eslint-disable @typescript-eslint/no-explicit-any */
        this.bbError = (err, path, method) => {
            /* eslint-enable @typescript-eslint/no-explicit-any */
            if (err.response && err.response.status && err.response.status === 404) {
                return new MobilettoNotFoundError(path);
            }
            else if (err.response && err.response.data && err.response.data.message) {
                return new MobilettoError(`${method} error: ${err.response.data.message}`);
            }
            return err;
        };
        this.b2type = (f) => (f.fileName.endsWith(this.delimiter) && f.contentType === null ? M_DIR : M_FILE);
        this.processList = (path, response, visitor) => __awaiter(this, void 0, void 0, function* () {
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
                    yield visitor(obj);
                }
            }
            return objects;
        });
        this.list = (pth, optsOrRecursive, visitor) => this.b2_list(pth, optsOrRecursive, visitor);
        this.b2_list = (pth, optsOrRecursive, visitor, b2opts) => __awaiter(this, void 0, void 0, function* () {
            try {
                const p = pth ? pth : "";
                const recursive = optsOrRecursive === true || (optsOrRecursive && optsOrRecursive.recursive);
                const optsDir = !!(b2opts && b2opts.dir);
                let dirDiscovered = null;
                let firstResult = null;
                const files = [];
                yield this.auth();
                const hasMax = !!(b2opts && b2opts.max);
                const maxFileCount = (hasMax ? b2opts && b2opts.max : 10000);
                const pfx = (this.prefix.length === 0 || this.prefix.endsWith(this.delimiter)
                    ? this.prefix
                    : this.prefix + this.delimiter) + (p.startsWith(this.delimiter) ? p.substring(0) : pth);
                let response = yield this.b2.listFileNames({
                    bucketId: this.bucket,
                    startFileName: "",
                    maxFileCount,
                    delimiter: recursive ? "" : this.delimiter,
                    prefix: pfx,
                });
                const handleResponse = (files, pth, response, visitor) => __awaiter(this, void 0, void 0, function* () {
                    const list = yield this.processList(pth, response, visitor);
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
                            }
                            else if (firstResult.name.endsWith(this.delimiter)) {
                                const dirEntries = list.filter((o) => o.name.startsWith(pth));
                                files.push(...dirEntries);
                                dirDiscovered = true;
                                return true;
                            }
                            else {
                                // it's an exact file-match, return it
                                files.push(list[0]);
                                return true;
                            }
                        }
                    }
                    if (hasMax && files.length + list.length >= maxFileCount) {
                        files.push(...list.slice(0, maxFileCount - files.length + 1));
                        return true;
                    }
                    else {
                        files.push(...list);
                        return false;
                    }
                });
                while (response.data.nextFileName) {
                    if (yield handleResponse(files, p, response, visitor)) {
                        return files;
                    }
                    response = yield this.b2.listFileNames({
                        bucketId: this.bucket,
                        startFileName: response.data.nextFileName,
                        maxFileCount,
                        delimiter: recursive ? "" : this.delimiter,
                        prefix: pfx,
                    });
                }
                yield handleResponse(files, p, response, visitor);
                if (dirDiscovered && !p.endsWith(this.delimiter)) {
                    const subdirFiles = yield this.b2_list(p + this.delimiter, recursive, undefined, { dir: true });
                    files.shift();
                    files.push(...subdirFiles);
                }
                return files;
            }
            catch (err) {
                throw this.bbError(err, pth || "", "list");
            }
        });
        this.b2_meta = (path) => __awaiter(this, void 0, void 0, function* () { return this.driver_metadata ? this.driver_metadata(path) : this.metadata(path); });
        if (!keyId || !appKey || !opts.bucket)
            throw new MobilettoError(`b2.StorageClient: key, secret and opts.bucket are required`);
        this.b2 = new B2({
            applicationKeyId: keyId,
            applicationKey: appKey,
        });
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
        this.info = () => (Object.assign({ canonicalName: () => `b2:${this.bucket}` }, B2Info));
    }
    file2object(f) {
        return {
            name: this.denormalizePath(f.fileName),
            size: f.contentLength,
            mtime: f.uploadTimestamp,
            type: this.b2type(f),
            b2id: f.fileId,
        };
    }
    metadata(pth) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.auth();
            let files = null;
            const normPath = this.normalizePath(pth);
            try {
                files = (yield this.b2.listFileNames({
                    bucketId: this.bucket,
                    startFileName: normPath,
                    maxFileCount: 1,
                    delimiter: "",
                    prefix: this.prefix,
                })).data.files;
            }
            catch (err) {
                throw this.bbError(err, pth, "metadata");
            }
            if (files.length === 0) {
                throw new MobilettoNotFoundError(pth);
            }
            const found = files.filter((f) => f.fileName === normPath);
            if (!found || found.length === 0) {
                // if this is a directory, we may have returned the first item in it, that's OK
                if (files[0].fileName.startsWith(normPath.endsWith(this.delimiter) ? normPath : normPath + this.delimiter)) {
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
        });
    }
    write(path, generatorOrReadable) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.auth();
            logger.debug(`write: writing path ${path}`);
            let stream = generatorOrReadable;
            if (!isReadable(generatorOrReadable)) {
                stream = new Readable({
                    /* eslint-disable @typescript-eslint/no-unused-vars */
                    read(size) {
                        return __awaiter(this, void 0, void 0, function* () {
                            /* eslint-enable @typescript-eslint/no-unused-vars */
                            const chunk = (yield generatorOrReadable.next()).value;
                            this.push(typeof chunk !== "undefined" ? chunk : null);
                        });
                    },
                });
            }
            let response = null;
            try {
                response = yield this.b2.uploadAny({
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
            }
            catch (e) {
                logger.error(`write error: ${e}`);
                throw this.bbError(e, path, "write");
            }
            if (response) {
                throw new MobilettoError(`write error: response status ${response.status} with data ${JSON.stringify(response.data)}`);
            }
        });
    }
    read(path, callback, endCallback) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.auth();
            const file = this.normalizePath(path);
            logger.debug(`read: reading path: ${path}`);
            let meta = null;
            try {
                meta = yield this.b2_meta(file);
            }
            catch (e) {
                if (e instanceof MobilettoError || e instanceof MobilettoNotFoundError) {
                    throw e;
                }
                throw new MobilettoError(`read: error reading metadata for path ${path}`, e);
            }
            if (meta.type === M_DIR) {
                throw new MobilettoError(`read: cannot read directory: ${path}`);
            }
            try {
                const stream = yield this.b2.downloadFileById({
                    fileId: meta.b2id,
                    responseType: "stream",
                });
                return yield readStream(stream.data, callback, endCallback);
            }
            catch (err) {
                throw this.bbError(err, path, "read");
            }
        });
    }
    deleteVersions(path_1, normPath_1, versions_1, quiet_1) {
        return __awaiter(this, arguments, void 0, function* (path, normPath, versions, quiet, errors = {}) {
            const removed = [];
            for (const version of versions) {
                logger.debug(`deleteVersions(${path}, ${versions.length} versions) pushing version to delete: fileName=${version.fileName} fileId=${version.fileId}`);
                yield this.auth();
                try {
                    if (!version.fileName.startsWith(normPath)) {
                        logger.debug(`deleteVersions(${path}, ${versions.length} versions) ending iteration on mismatched file: ${version.fileName}`);
                        return removed;
                    }
                    const delResponse = yield this.b2.deleteFileVersion({
                        fileName: version.fileName,
                        fileId: version.fileId,
                    });
                    if (delResponse && delResponse.status && (typeof delResponse.status == 'string' && parseInt(delResponse.status) !== 200 || delResponse.status != 200)) {
                        const message = `deleteVersions(${path}) received HTTP status ${delResponse.status} trying to delete file version: ${JSON.stringify(version)}`;
                        logger.error(message);
                        if (errors) {
                            errors[path] = message;
                        }
                    }
                    else if (removed) {
                        logger.debug(`deleteVersions(${path}, ${versions.length} versions) REMOVED: fileName=${version.fileName} fileId=${version.fileId}`);
                        removed.push(this.denormalizePath(version.fileName));
                    }
                }
                catch (err) {
                    const message = `deleteVersions(${path}) error deleting version ${version.fileId}: ${err}`;
                    logger.error(message);
                    if (errors) {
                        errors[path] = message;
                    }
                    if (!quiet)
                        throw new MobilettoError(message, err);
                }
            }
            const errPaths = Object.keys(errors);
            if (errPaths.length > 0) {
                if (quiet) {
                    logger.info(`deleteVersions(${path}) had ${errPaths.length} errors but quiet=true, returning ${removed.length} removed paths`);
                    return removed;
                }
                throw new MobilettoError(`deleteVersions(${path}) had errors: ${JSON.stringify(errors)}`);
            }
            return removed;
        });
    }
    remove(path, optsOrRecursive, quiet) {
        return __awaiter(this, void 0, void 0, function* () {
            const recursive = optsOrRecursive === true || (optsOrRecursive && optsOrRecursive.recursive) || false;
            quiet || (quiet = false);
            logger.debug(`b2.remove(${path}, recursive=${recursive}) starting...`);
            yield this.auth();
            let meta = null;
            const errors = {};
            const normPath = this.normalizePath(path);
            try {
                logger.debug(`b2.remove(${path}) fetching metadata to determine file/directory`);
                meta = yield this.b2_meta(path);
            }
            catch (e) {
                if (quiet) {
                    logger.debug(`b2.remove(${path}) quietly returning, not reporting error fetching metadata for ${path}: ${e}`);
                    return path;
                }
                if (e instanceof MobilettoError || e instanceof MobilettoNotFoundError) {
                    throw e;
                }
                throw new MobilettoError(`b2.remove(${path}) error reading metadata for path ${path}`, e);
            }
            if (meta.type === M_FILE) {
                try {
                    yield this.auth();
                    const response = yield this.b2.listFileVersions({
                        bucketId: this.bucket,
                        startFileName: normPath,
                        startFileId: meta.b2id,
                        maxFileCount: 1000,
                    });
                    const versions = response.data.files.filter((f) => f.fileName === normPath);
                    yield this.deleteVersions(path, normPath, versions, quiet, errors);
                }
                catch (err) {
                    if (err instanceof MobilettoError) {
                        throw err;
                    }
                    throw new MobilettoError(`b2.remove(${path}) error: ${err}`, err);
                }
                return path;
            }
            else if (meta.type === M_DIR) {
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
                    yield this.auth();
                    versionsResponse = yield this.b2.listFileVersions({
                        bucketId: this.bucket,
                        startFileId: meta.b2id,
                        startFileName: normPath,
                        maxFileCount: 1000,
                    });
                    while (versionsResponse.data.nextFileName &&
                        versionsResponse.data.nextFileId &&
                        versionsResponse.data.nextFileName.startsWith(normPath)) {
                        logger.debug(`b2.remove(${path}) removing a batch of files then asking for more`);
                        removed.push(...(yield this.deleteVersions(path, normPath, versionsResponse.data.files, quiet, errors)));
                        logger.debug(`b2.remove(${path})`);
                        yield this.auth();
                        versionsResponse = yield this.b2.listFileVersions({
                            bucketId: this.bucket,
                            startFileName: versionsResponse.data.nextFileName,
                            startFileId: versionsResponse.data.nextFileId,
                            maxFileCount: 1000,
                        });
                    }
                    logger.debug(`b2.remove(${path}) removing last batch of files`);
                    removed.push(...(yield this.deleteVersions(path, normPath, versionsResponse.data.files, quiet, errors)));
                }
                catch (e) {
                    const message = `b2.remove(${path}) error listing/deleting: ${e}`;
                    if (quiet) {
                        logger.warn(message);
                    }
                    else {
                        throw new MobilettoError(message);
                    }
                }
                if (Object.keys(errors).length > 0) {
                    if (quiet) {
                        logger.warn(`b2.remove(${path}) errors removing some paths: ${JSON.stringify(errors)}`);
                    }
                    else {
                        throw new MobilettoError(`b2.remove(${path}) errors removing some paths: ${JSON.stringify(errors)}`);
                    }
                }
                return removed;
            }
            else {
                throw new MobilettoError(`b2.remove(${path}) cannot remove file of type: ${meta.type}`);
            }
        });
    }
}
export const storageClient = (key, secret, opts) => {
    if (!key || !secret || !opts || !opts.bucket) {
        throw new MobilettoError("b2.storageClient: key, secret, and opts.bucket are required");
    }
    return new StorageClient(key, secret, opts);
};
//# sourceMappingURL=b2.js.map