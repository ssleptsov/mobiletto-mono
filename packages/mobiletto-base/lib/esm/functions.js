var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger, M_DIR, M_FILE, MobilettoError, MobilettoNotFoundError, rand } from "mobiletto-common";
import { sha256 } from "zilla-util";
import fs from "fs";
import { AwaitableLRU, DISABLED_CACHE } from "./cache.js";
import { getRedis, MobilettoCache, REDIS_HOST, REDIS_PORT, REDIS_PREFIX } from "./redis.js";
import { MOBILETTO_TMP, reader } from "./util.js";
import { ALL_MQ } from "./mobiletto.js";
function mirrorDir(source, sourcePath, visitor) {
    return __awaiter(this, void 0, void 0, function* () {
        if (logger.isTraceEnabled())
            logger.trace(`mirrorDir: mirroring dir: ${sourcePath}`);
        const { objects } = yield source.list(sourcePath, { recursive: false, visitor });
        for (const obj of objects) {
            if (obj.type === M_DIR) {
                const dir = obj.name.startsWith(sourcePath) ? obj.name : sourcePath + obj.name;
                yield mirrorDir(source, dir, visitor);
            }
        }
    });
}
export const isFlagEnabled = (client, flag, defaultValue) => {
    if (client && typeof client.flags === "function") {
        const flags = client.flags();
        return (flags && flags[flag] === true) || defaultValue || false;
    }
    return false;
};
const READ_FILE_CACHE_SIZE_THRESHOLD = 128 * 1024; // we can cache files of this size
const EMPTY_BUFFER = Buffer.from([]);
// noinspection JSUnusedGlobalSymbols,JSUnresolvedFunction
const UTILITY_FUNCTIONS = {
    list: (client) => (path, opts, visitor) => __awaiter(void 0, void 0, void 0, function* () {
        path || (path = "");
        const cache = client.scopedCache("list");
        const cached = cache ? yield cache.get(path) : null;
        if (cached) {
            if (typeof cached === 'object' && cached.objects) {
                return cached;
            }
            else if (cached instanceof Error) {
                throw cached;
            }
            else {
                if (logger.isWarningEnabled())
                    logger.warn(`list(${path}): unrecognized cached value (${cached})`);
            }
        }
        const recursive = opts && (opts === true || (opts.recursive ? opts.recursive : false));
        visitor = visitor ? visitor : typeof opts === "object" && opts.visitor ? opts.visitor : undefined;
        const paging = typeof opts === "object" && opts.paging;
        const options = paging ? { paging, recursive } : recursive;
        if (visitor && typeof visitor !== "function") {
            throw new MobilettoError(`list: visitor is not a function: ${typeof visitor}`);
        }
        try {
            // noinspection JSUnresolvedFunction
            let output = yield client.driver_list(path, options, visitor);
            // const results: MobilettoMetadata[] = output && output.objects ? output : { objects: []};
            if (output && output.objects) {
                if (output.objects.length === 0 && isFlagEnabled(client, "list_tryMetaIfEmpty")) {
                    // try single meta, is this a file?
                    try {
                        const singleFileMeta = yield client.driver_metadata(path);
                        if (singleFileMeta) {
                            // results.push(singleFileMeta);
                            output = { objects: [singleFileMeta] };
                        }
                    }
                    catch (sfmErrIgnored) {
                        // ignore error, we tried
                    }
                }
                if (cache) {
                    cache.set(path, output).then(() => {
                        if (logger.isDebugEnabled())
                            logger.debug(`list(${path}) cached ${output ? output.objects.length : `unknown? ${JSON.stringify(output)}`} results`);
                    }, (err) => {
                        if (logger.isErrorEnabled())
                            logger.error(`list(${path}) error: ${err}`);
                    });
                }
            }
            return output;
        }
        catch (e) {
            if (cache && e instanceof MobilettoNotFoundError) {
                cache.set(path, e).then(() => {
                    if (logger.isDebugEnabled())
                        logger.debug(`list(${path}) cached error ${e}`);
                }, (err) => {
                    if (logger.isErrorEnabled())
                        logger.error(`list(${path}) error ${err} caching MobilettoNotFoundError`);
                });
            }
            throw e;
        }
    }),
    safeList: (client) => (path, opts, visitor) => __awaiter(void 0, void 0, void 0, function* () {
        const recursive = (opts && opts === true) || (typeof opts === "object" && opts.recursive ? opts.recursive : false);
        visitor = visitor ? visitor : typeof opts === "object" && opts.visitor ? opts.visitor : undefined;
        try {
            // noinspection JSUnresolvedFunction
            return yield client.driver_list(path, recursive, visitor);
        }
        catch (e) {
            if (e instanceof MobilettoNotFoundError) {
                return [];
            }
            throw e;
        }
    }),
    metadata: (client) => (path) => __awaiter(void 0, void 0, void 0, function* () {
        const cache = client.scopedCache("metadata");
        const cached = cache ? yield cache.get(path) : null;
        if (cached) {
            return cached;
        }
        // noinspection JSUnresolvedFunction
        const meta = yield client.driver_metadata(path);
        if (cache) {
            cache.set(path, meta).then(() => {
                if (logger.isDebugEnabled())
                    logger.debug(`metadata(${path}) cached meta = ${JSON.stringify(meta)}`);
            }, (err) => {
                if (logger.isErrorEnabled())
                    logger.error(`metadata(${path}) error: ${err}`);
            });
        }
        return meta;
    }),
    safeMetadata: (client) => (path) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            return yield client.metadata(path);
        }
        catch (e) {
            if (e instanceof MobilettoNotFoundError) {
                return null;
            }
            throw e;
        }
    }),
    remove: (client) => (path, opts) => __awaiter(void 0, void 0, void 0, function* () {
        const recursive = opts && opts.recursive ? opts.recursive : false;
        // noinspection JSUnresolvedVariable
        const quiet = opts && opts.quiet ? opts.quiet : false;
        // noinspection JSUnresolvedFunction
        const result = yield client.driver_remove(path, recursive, quiet);
        yield client.flush();
        return result;
    }),
    readFile: (client) => (path) => __awaiter(void 0, void 0, void 0, function* () {
        const cache = client.scopedCache("readFile");
        const cached = cache ? yield cache.get(path) : null;
        if (cached) {
            return Buffer.from(cached, "base64");
        }
        const chunks = [];
        yield client.read(path, reader(chunks));
        const data = Buffer.concat(chunks);
        if (cache && data.length < READ_FILE_CACHE_SIZE_THRESHOLD) {
            yield cache.set(path, data.toString("base64"));
        }
        return data;
    }),
    safeReadFile: (client) => (path) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            return yield client.readFile(path);
        }
        catch (e) {
            if (logger.isInfoEnabled())
                logger.info(`safeReadFile(${path}) ${e}`);
            return Buffer.from("");
        }
    }),
    write: (client) => (path, data) => __awaiter(void 0, void 0, void 0, function* () {
        if (logger.isDebugEnabled())
            logger.debug(`util.write(${path}) starting ...`);
        const p = path.startsWith("/") ? path.substring(1) : path;
        if (p !== path) {
            if (logger.isDebugEnabled())
                logger.debug(`util.write(${path}) removed leading /`);
        }
        // noinspection JSUnresolvedFunction
        const bytesWritten = yield client.driver_write(p, data);
        yield client.flush();
        if (logger.isDebugEnabled())
            logger.debug(`util.write(${p}) wrote ${bytesWritten} bytes`);
        return bytesWritten;
    }),
    writeFile: (client) => (path, data) => __awaiter(void 0, void 0, void 0, function* () {
        const readFunc = function* () {
            yield data;
        };
        return yield client.write(path, readFunc());
    }),
    copyFile: (client) => (sourcePath, destPath, source) => __awaiter(void 0, void 0, void 0, function* () {
        // The data buffer
        const dataBuffer = [];
        let done = false;
        const readData = (connection, path) => {
            return connection.read(path, (chunk) => {
                dataBuffer.push(chunk);
            }, () => {
                done = true;
                dataBuffer.push(undefined);
            });
        };
        const createReadStream = function* () {
            while (!done) {
                if (dataBuffer.length > 0) {
                    const chunk = dataBuffer.shift();
                    if (chunk) {
                        yield chunk;
                    }
                    else {
                        // the underlying driver "write" expects null or undefined to be yielded
                        // when the end of stream is reached, so this is ok
                        yield null;
                    }
                }
                else {
                    yield EMPTY_BUFFER;
                }
            }
        };
        const readStream = createReadStream();
        // Reading and writing data
        const copyData = () => __awaiter(void 0, void 0, void 0, function* () {
            const readPromise = readData(source || client, sourcePath);
            const writePromise = client.write(destPath, readStream);
            const resolved = yield Promise.all([readPromise, writePromise]);
            const bytesRead = resolved[0];
            const bytesWritten = resolved[1];
            if (bytesRead !== bytesWritten) {
                throw new MobilettoError(`copyFile(${sourcePath}, ${destPath}): bytes read ${bytesRead} !== ${bytesWritten} bytes written`);
            }
            console.log(`copied ${bytesRead} bytes from ${sourcePath} to ${destPath}`);
            return bytesRead;
        });
        return yield copyData();
    }),
    mirror: (client) => (source_1, ...args_1) => __awaiter(void 0, [source_1, ...args_1], void 0, function* (source, clientPath = "", sourcePath = "") {
        if (logger.isInfoEnabled())
            logger.info(`mirror: starting, sourcePath=${sourcePath} -> clientPath=${clientPath}`);
        const results = {
            success: 0,
            errors: 0,
        };
        const visitor = (obj) => __awaiter(void 0, void 0, void 0, function* () {
            if (obj.type && obj.type === M_FILE) {
                if (logger.isTraceEnabled())
                    logger.trace(`mirror: mirroring file: ${obj.name}`);
                const tempPath = `${MOBILETTO_TMP}/mobiletto_${sha256(JSON.stringify(obj))}.${rand(10)}`;
                if (logger.isDebugEnabled())
                    logger.debug(`mirror: writing ${obj.name} to temp file ${tempPath} ...`);
                const destName = obj.name.startsWith(sourcePath) ? obj.name.substring(sourcePath.length) : obj.name;
                const destFullPath = (clientPath.endsWith("/") ? clientPath : clientPath + "/") +
                    (destName.startsWith("/") ? destName.substring(1) : destName);
                try {
                    // if dest already exists and is the same size, don't copy it again
                    let srcSize = null;
                    if (obj.size) {
                        srcSize = obj.size;
                    }
                    else {
                        const srcMeta = yield source.safeMetadata(obj.name);
                        if (srcMeta && srcMeta.size) {
                            srcSize = srcMeta.size;
                        }
                    }
                    // only continue if we could determine the source size
                    if (srcSize) {
                        const destMeta = yield client.safeMetadata(destFullPath);
                        if (destMeta && destMeta.size && destMeta.size && destMeta.size === srcSize) {
                            if (logger.isInfoEnabled())
                                logger.info(`mirror: dest object (${destFullPath}) has same size (${srcSize}) as src object ${sourcePath}, not copying`);
                            return;
                        }
                    }
                    // write from source -> write to temp file
                    const fd = fs.openSync(tempPath, "wx", 0o0600);
                    const writer = fs.createWriteStream(tempPath, { fd, flags: "wx" });
                    yield new Promise((resolve, reject) => {
                        source
                            .read(obj.name, (chunk) => __awaiter(void 0, void 0, void 0, function* () {
                            if (chunk) {
                                writer.write(chunk);
                            }
                        }), () => {
                            writer.close((err) => {
                                if (err) {
                                    throw new MobilettoError(`mirror: error closing temp file: ${err}`);
                                }
                                if (logger.isDebugEnabled())
                                    logger.debug(`mirror: finished writing ${obj.name} to temp file ${tempPath}`);
                            });
                        })
                            .then(() => __awaiter(void 0, void 0, void 0, function* () {
                            // read from temp file -> write to mirror
                            const fd = fs.openSync(tempPath, "r");
                            const reader = fs.createReadStream(tempPath, { fd });
                            if (logger.isDebugEnabled())
                                logger.debug(`mirror: writing temp file ${tempPath} to destination: ${destFullPath}`);
                            yield client.write(destFullPath, reader);
                            if (logger.isDebugEnabled())
                                logger.debug(`mirror: finished writing temp file ${tempPath} to destination: ${destFullPath}`);
                            results.success++;
                            resolve(destFullPath);
                        }))
                            .catch((e) => {
                            if (logger.isWarningEnabled())
                                logger.warn(`mirror: error copying file: ${e}`);
                            results.errors++;
                            reject(e);
                        });
                    });
                }
                catch (e) {
                    if (logger.isWarningEnabled())
                        logger.warn(`mirror: error copying file: ${e}`);
                    results.errors++;
                }
                finally {
                    if (logger.isTraceEnabled())
                        logger.trace(`mirror: file mirrored successfully: ${obj.name}`);
                    fs.rmSync(tempPath, { force: true });
                }
            }
        });
        yield mirrorDir(source, sourcePath, visitor);
        return results;
    }),
    destroy: (client) => () => __awaiter(void 0, void 0, void 0, function* () {
        if (client.mq) {
            const workerClosePromises = [];
            client.mq.workers.forEach((w) => workerClosePromises.push(w.close(true)));
            yield Promise.all(workerClosePromises);
            yield client.mq.events.close();
            yield client.mq.queue.close();
            delete ALL_MQ[client.id];
        }
        const cache = client.getCache();
        if (cache) {
            cache.disconnect();
        }
    }),
};
const CACHE_FUNCTIONS = {
    getCache: (client) => () => {
        if (typeof client.cache !== "undefined")
            return client.cache;
        const redisConfig = client.redisConfig || {};
        const enabled = redisConfig.enabled !== false;
        if (!enabled) {
            if (logger.isInfoEnabled())
                logger.info(`getCache: client.redisConfig.enabled === false, disabling cache`);
            client.cache = DISABLED_CACHE;
            return client.cache;
        }
        const host = redisConfig.host || REDIS_HOST;
        const port = redisConfig.port || parseInt(`${REDIS_PORT}`);
        const prefix = redisConfig.prefix || REDIS_PREFIX;
        if (!client.id) {
            if (logger.isWarningEnabled())
                logger.warn(`getCache: client.id not set; all nameless connections will share one cache`);
            client.cache = getRedis("~nameless~", host, port, prefix);
        }
        else {
            client.cache = getRedis(client.id, host, port, prefix);
        }
        return client.cache;
    },
    scopedCache: (client) => (cacheName, size = 100) => {
        const cache = client.getCache();
        return cache instanceof MobilettoCache ? cache.scopedCache(cacheName, size) : new AwaitableLRU(size);
    },
    flush: (client) => () => __awaiter(void 0, void 0, void 0, function* () {
        yield client.getCache().flush();
    }),
};
function utilityFunctionConflict(client, func) {
    if (typeof client[func] === "function") {
        if (typeof client[`driver_${func}`] !== "undefined") {
            if (logger.isWarningEnabled())
                logger.warn(`utilityFunctionConflict: driver_${func} has already been added`);
            return false;
        }
        else {
            client[`driver_${func}`] = client[func]; // save original driver function
            return true;
        }
    }
    else if (typeof client[func] !== "undefined") {
        throw new MobilettoError(`utilityFunctionConflict: client defines a property ${func}, mobiletto function would overwrite`);
    }
    else {
        return false;
    }
}
export const addUtilityFunctions = (client, readOnly = false) => {
    addClientFunctions(client, UTILITY_FUNCTIONS, utilityFunctionConflict);
    if (readOnly) {
        for (const writeFunc of ["write", "remove", "writeFile"]) {
            client[writeFunc] = () => __awaiter(void 0, void 0, void 0, function* () {
                if (logger.isWarningEnabled())
                    logger.warn(`${writeFunc} not supported in readOnly mode`);
                return false;
            });
        }
    }
    return client;
};
export const addCacheFunctions = (client) => addClientFunctions(client, CACHE_FUNCTIONS, (client, func) => {
    if (logger.isWarningEnabled())
        logger.warn(`addCacheFunctions: ${func} already exists on client${client.id ? `(client.id=${client.id})` : ""}, not re-adding`);
    return false;
});
const addClientFunctions = (client, functions, conflictFunc) => {
    for (const func of Object.keys(functions)) {
        let add = true;
        if (client[func]) {
            add = conflictFunc ? conflictFunc(client, func) : false;
        }
        if (add) {
            client[func] = functions[func](client);
        }
    }
    return client;
};
//# sourceMappingURL=functions.js.map