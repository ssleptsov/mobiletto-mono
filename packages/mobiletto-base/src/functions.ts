import {
    MobilettoFunctions,
    MobilettoConflictFunction,
    MobilettoListOptions,
    MobilettoMetadata,
    MobilettoMinimalClient,
    MobilettoMirrorResults,
    MobilettoPatchable,
    MobilettoRemoveOptions,
    MobilettoVisitor,
    MobilettoWriteSource,
    MobilettoFeatureFlags,
    MobilettoFeatureFlagName,
    MobilettoListOutput,
} from "mobiletto-common";
import { MobilettoClient, MobilettoConnection } from "./types.js";
import { logger, M_DIR, M_FILE, MobilettoError, MobilettoNotFoundError, rand } from "mobiletto-common";
import { sha256 } from "zilla-util";
import fs from "fs";
import { Worker } from "bullmq";
import { AwaitableLRU, CacheLike, DISABLED_CACHE } from "./cache.js";
import { getRedis, MobilettoCache, REDIS_HOST, REDIS_PORT, REDIS_PREFIX } from "./redis.js";
import { MOBILETTO_TMP, reader } from "./util.js";
import { ALL_MQ } from "./mobiletto.js";

async function mirrorDir(source: MobilettoConnection, sourcePath: string, visitor: MobilettoVisitor) {
    if (logger.isTraceEnabled()) logger.trace(`mirrorDir: mirroring dir: ${sourcePath}`);
    const {objects} = await source.list(sourcePath, { recursive: false, visitor });
    for (const obj of objects) {
        if (obj.type === M_DIR) {
            const dir = obj.name.startsWith(sourcePath) ? obj.name : sourcePath + obj.name;
            await mirrorDir(source, dir, visitor);
        }
    }
}

export const isFlagEnabled = (
    client: MobilettoMinimalClient,
    flag: MobilettoFeatureFlagName,
    defaultValue?: boolean
): boolean => {
    if (client && typeof client.flags === "function") {
        const flags: MobilettoFeatureFlags = client.flags();
        return (flags && flags[flag] === true) || defaultValue || false;
    }
    return false;
};

const READ_FILE_CACHE_SIZE_THRESHOLD = 128 * 1024; // we can cache files of this size

const EMPTY_BUFFER = Buffer.from([]);

// noinspection JSUnusedGlobalSymbols,JSUnresolvedFunction
const UTILITY_FUNCTIONS: MobilettoFunctions = {
    list:
        (client: MobilettoMinimalClient) =>
        async (
            path?: string,
            opts?: MobilettoListOptions | boolean,
            visitor?: MobilettoVisitor
        ): Promise<MobilettoListOutput> => {
            path ||= "";
            const cache = client.scopedCache("list");
            const cached = cache ? await cache.get(path) : null;
            if (cached) {
                if (typeof  cached ==='object' && cached.objects) {
                    return cached;
                } else if (cached instanceof Error) {
                    throw cached;
                } else {
                    if (logger.isWarningEnabled()) logger.warn(`list(${path}): unrecognized cached value (${cached})`);
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
                let output: MobilettoListOutput = await client.driver_list(path, options, visitor);
                // const results: MobilettoMetadata[] = output && output.objects ? output : { objects: []};
                if (output && output.objects) {
                    if (output.objects.length === 0 && isFlagEnabled(client, "list_tryMetaIfEmpty")) {
                        // try single meta, is this a file?
                        try {
                            const singleFileMeta = await client.driver_metadata(path);
                            if (singleFileMeta) {
                                // results.push(singleFileMeta);
                                output = { objects: [singleFileMeta]}
                            }
                        } catch (sfmErrIgnored) {
                            // ignore error, we tried
                        }
                    }
                    if (cache) {
                        cache.set(path, output).then(
                            () => {
                                if (logger.isDebugEnabled())
                                    logger.debug(
                                        `list(${path}) cached ${
                                            output ? output.objects.length : `unknown? ${JSON.stringify(output)}`
                                        } results`
                                    );
                            },
                            (err: Error) => {
                                if (logger.isErrorEnabled()) logger.error(`list(${path}) error: ${err}`);
                            }
                        );
                    }
                }
                return output;
            } catch (e) {
                if (cache && e instanceof MobilettoNotFoundError) {
                    cache.set(path, e).then(
                        () => {
                            if (logger.isDebugEnabled()) logger.debug(`list(${path}) cached error ${e}`);
                        },
                        (err: Error) => {
                            if (logger.isErrorEnabled())
                                logger.error(`list(${path}) error ${err} caching MobilettoNotFoundError`);
                        }
                    );
                }
                throw e;
            }
        },

    safeList:
        (client: MobilettoMinimalClient) =>
        async (
            path?: string,
            opts?: MobilettoListOptions | boolean,
            visitor?: MobilettoVisitor
        ): Promise<MobilettoMetadata[]> => {
            const recursive =
                (opts && opts === true) || (typeof opts === "object" && opts.recursive ? opts.recursive : false);
            visitor = visitor ? visitor : typeof opts === "object" && opts.visitor ? opts.visitor : undefined;
            try {
                // noinspection JSUnresolvedFunction
                return await client.driver_list(path, recursive, visitor);
            } catch (e) {
                if (e instanceof MobilettoNotFoundError) {
                    return [];
                }
                throw e;
            }
        },

    metadata:
        (client: MobilettoMinimalClient) =>
        async (path: string): Promise<MobilettoMetadata> => {
            const cache = client.scopedCache("metadata");
            const cached: MobilettoMetadata | null | undefined = cache ? await cache.get(path) : null;
            if (cached) {
                return cached;
            }
            // noinspection JSUnresolvedFunction
            const meta = await client.driver_metadata(path);
            if (cache) {
                cache.set(path, meta).then(
                    () => {
                        if (logger.isDebugEnabled())
                            logger.debug(`metadata(${path}) cached meta = ${JSON.stringify(meta)}`);
                    },
                    (err: Error) => {
                        if (logger.isErrorEnabled()) logger.error(`metadata(${path}) error: ${err}`);
                    }
                );
            }
            return meta;
        },

    safeMetadata:
        (client: MobilettoMinimalClient) =>
        async (path: string): Promise<MobilettoMetadata | null> => {
            try {
                return await client.metadata(path);
            } catch (e) {
                if (e instanceof MobilettoNotFoundError) {
                    return null;
                }
                throw e;
            }
        },

    remove:
        (client: MobilettoMinimalClient) =>
        async (path: string, opts: MobilettoRemoveOptions): Promise<string | string[]> => {
            const recursive = opts && opts.recursive ? opts.recursive : false;
            // noinspection JSUnresolvedVariable
            const quiet = opts && opts.quiet ? opts.quiet : false;
            // noinspection JSUnresolvedFunction
            const result = await client.driver_remove(path, recursive, quiet);
            await client.flush();
            return result;
        },

    readFile:
        (client: MobilettoMinimalClient) =>
        async (path: string): Promise<Buffer> => {
            const cache = client.scopedCache("readFile");
            const cached: string | null | undefined = cache ? await cache.get(path) : null;
            if (cached) {
                return Buffer.from(cached, "base64");
            }
            const chunks: Buffer[] = [];
            await client.read(path, reader(chunks));
            const data = Buffer.concat(chunks);
            if (cache && data.length < READ_FILE_CACHE_SIZE_THRESHOLD) {
                await cache.set(path, data.toString("base64"));
            }
            return data;
        },

    safeReadFile:
        (client: MobilettoMinimalClient) =>
        async (path: string): Promise<Buffer> => {
            try {
                return await client.readFile(path);
            } catch (e) {
                if (logger.isInfoEnabled()) logger.info(`safeReadFile(${path}) ${e}`);
                return Buffer.from("");
            }
        },

    write:
        (client: MobilettoMinimalClient) =>
        async (path: string, data: MobilettoWriteSource): Promise<number> => {
            if (logger.isDebugEnabled()) logger.debug(`util.write(${path}) starting ...`);
            const p = path.startsWith("/") ? path.substring(1) : path;
            if (p !== path) {
                if (logger.isDebugEnabled()) logger.debug(`util.write(${path}) removed leading /`);
            }
            // noinspection JSUnresolvedFunction
            const bytesWritten = await client.driver_write(p, data);
            await client.flush();
            if (logger.isDebugEnabled()) logger.debug(`util.write(${p}) wrote ${bytesWritten} bytes`);
            return bytesWritten;
        },

    writeFile:
        (client: MobilettoMinimalClient) =>
        async (path: string, data: Buffer | string): Promise<number> => {
            const readFunc = function* () {
                yield data;
            };
            return await client.write(path, readFunc());
        },

    copyFile:
        (client: MobilettoMinimalClient) =>
        async (sourcePath: string, destPath: string, source?: MobilettoMinimalClient) => {
            // The data buffer
            const dataBuffer: (Buffer | undefined)[] = [];
            let done = false;

            const readData = (connection: MobilettoMinimalClient, path: string) => {
                return connection.read(
                    path,
                    (chunk: Buffer) => {
                        dataBuffer.push(chunk);
                    },
                    () => {
                        done = true;
                        dataBuffer.push(undefined);
                    }
                );
            };

            const createReadStream = function* (): Generator<Buffer, void, unknown> {
                while (!done) {
                    if (dataBuffer.length > 0) {
                        const chunk = dataBuffer.shift();
                        if (chunk) {
                            yield chunk;
                        } else {
                            // the underlying driver "write" expects null or undefined to be yielded
                            // when the end of stream is reached, so this is ok
                            yield null as unknown as Buffer;
                        }
                    } else {
                        yield EMPTY_BUFFER;
                    }
                }
            };

            const readStream = createReadStream();

            // Reading and writing data
            const copyData = async () => {
                const readPromise = readData(source || client, sourcePath);
                const writePromise = client.write(destPath, readStream);
                const resolved = await Promise.all([readPromise, writePromise]);

                const bytesRead = resolved[0];
                const bytesWritten = resolved[1];
                if (bytesRead !== bytesWritten) {
                    throw new MobilettoError(
                        `copyFile(${sourcePath}, ${destPath}): bytes read ${bytesRead} !== ${bytesWritten} bytes written`
                    );
                }
                console.log(`copied ${bytesRead} bytes from ${sourcePath} to ${destPath}`);
                return bytesRead;
            };

            return await copyData();
        },

    mirror:
        (client: MobilettoMinimalClient) =>
        async (source: MobilettoConnection, clientPath = "", sourcePath = ""): Promise<MobilettoMirrorResults> => {
            if (logger.isInfoEnabled())
                logger.info(`mirror: starting, sourcePath=${sourcePath} -> clientPath=${clientPath}`);
            const results: MobilettoMirrorResults = {
                success: 0,
                errors: 0,
            };
            const visitor = async (obj: MobilettoMetadata) => {
                if (obj.type && obj.type === M_FILE) {
                    if (logger.isTraceEnabled()) logger.trace(`mirror: mirroring file: ${obj.name}`);
                    const tempPath = `${MOBILETTO_TMP}/mobiletto_${sha256(JSON.stringify(obj))}.${rand(10)}`;
                    if (logger.isDebugEnabled())
                        logger.debug(`mirror: writing ${obj.name} to temp file ${tempPath} ...`);
                    const destName = obj.name.startsWith(sourcePath) ? obj.name.substring(sourcePath.length) : obj.name;
                    const destFullPath =
                        (clientPath.endsWith("/") ? clientPath : clientPath + "/") +
                        (destName.startsWith("/") ? destName.substring(1) : destName);
                    try {
                        // if dest already exists and is the same size, don't copy it again
                        let srcSize = null;
                        if (obj.size) {
                            srcSize = obj.size;
                        } else {
                            const srcMeta = await source.safeMetadata(obj.name);
                            if (srcMeta && srcMeta.size) {
                                srcSize = srcMeta.size;
                            }
                        }
                        // only continue if we could determine the source size
                        if (srcSize) {
                            const destMeta = await client.safeMetadata(destFullPath);
                            if (destMeta && destMeta.size && destMeta.size && destMeta.size === srcSize) {
                                if (logger.isInfoEnabled())
                                    logger.info(
                                        `mirror: dest object (${destFullPath}) has same size (${srcSize}) as src object ${sourcePath}, not copying`
                                    );
                                return;
                            }
                        }

                        // write from source -> write to temp file
                        const fd = fs.openSync(tempPath, "wx", 0o0600);
                        const writer = fs.createWriteStream(tempPath, { fd, flags: "wx" });
                        await new Promise((resolve, reject) => {
                            source
                                .read(
                                    obj.name,
                                    async (chunk: Buffer) => {
                                        if (chunk) {
                                            writer.write(chunk);
                                        }
                                    },
                                    () => {
                                        writer.close((err) => {
                                            if (err) {
                                                throw new MobilettoError(`mirror: error closing temp file: ${err}`);
                                            }
                                            if (logger.isDebugEnabled())
                                                logger.debug(
                                                    `mirror: finished writing ${obj.name} to temp file ${tempPath}`
                                                );
                                        });
                                    }
                                )
                                .then(async () => {
                                    // read from temp file -> write to mirror
                                    const fd = fs.openSync(tempPath, "r");
                                    const reader = fs.createReadStream(tempPath, { fd });
                                    if (logger.isDebugEnabled())
                                        logger.debug(
                                            `mirror: writing temp file ${tempPath} to destination: ${destFullPath}`
                                        );
                                    await client.write(destFullPath, reader);
                                    if (logger.isDebugEnabled())
                                        logger.debug(
                                            `mirror: finished writing temp file ${tempPath} to destination: ${destFullPath}`
                                        );
                                    results.success++;
                                    resolve(destFullPath);
                                })
                                .catch((e: Error) => {
                                    if (logger.isWarningEnabled()) logger.warn(`mirror: error copying file: ${e}`);
                                    results.errors++;
                                    reject(e);
                                });
                        });
                    } catch (e) {
                        if (logger.isWarningEnabled()) logger.warn(`mirror: error copying file: ${e}`);
                        results.errors++;
                    } finally {
                        if (logger.isTraceEnabled()) logger.trace(`mirror: file mirrored successfully: ${obj.name}`);
                        fs.rmSync(tempPath, { force: true });
                    }
                }
            };
            await mirrorDir(source, sourcePath, visitor);
            return results;
        },

    destroy: (client: MobilettoMinimalClient) => async () => {
        if (client.mq) {
            const workerClosePromises: Promise<void>[] = [];
            client.mq.workers.forEach((w: Worker) => workerClosePromises.push(w.close(true)));
            await Promise.all(workerClosePromises);
            await client.mq.events.close();
            await client.mq.queue.close();
            delete ALL_MQ[client.id];
        }
        const cache = client.getCache();
        if (cache) {
            cache.disconnect();
        }
    },
};

const CACHE_FUNCTIONS = {
    getCache: (client: MobilettoMinimalClient) => (): CacheLike => {
        if (typeof client.cache !== "undefined") return client.cache;
        const redisConfig = client.redisConfig || {};
        const enabled = redisConfig.enabled !== false;
        if (!enabled) {
            if (logger.isInfoEnabled()) logger.info(`getCache: client.redisConfig.enabled === false, disabling cache`);
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
        } else {
            client.cache = getRedis(client.id, host, port, prefix);
        }
        return client.cache;
    },
    scopedCache:
        (client: MobilettoMinimalClient) =>
        (cacheName: string, size = 100): CacheLike => {
            const cache = client.getCache();
            return cache instanceof MobilettoCache ? cache.scopedCache(cacheName, size) : new AwaitableLRU(size);
        },
    flush: (client: MobilettoMinimalClient) => async (): Promise<void> => {
        await client.getCache().flush();
    },
};

function utilityFunctionConflict(client: MobilettoPatchable, func: string): boolean {
    if (typeof client[func] === "function") {
        if (typeof client[`driver_${func}`] !== "undefined") {
            if (logger.isWarningEnabled())
                logger.warn(`utilityFunctionConflict: driver_${func} has already been added`);
            return false;
        } else {
            client[`driver_${func}`] = client[func]; // save original driver function
            return true;
        }
    } else if (typeof client[func] !== "undefined") {
        throw new MobilettoError(
            `utilityFunctionConflict: client defines a property ${func}, mobiletto function would overwrite`
        );
    } else {
        return false;
    }
}

export const addUtilityFunctions = (client: MobilettoMinimalClient, readOnly = false): MobilettoClient => {
    addClientFunctions(client, UTILITY_FUNCTIONS, utilityFunctionConflict);
    if (readOnly) {
        for (const writeFunc of ["write", "remove", "writeFile"]) {
            client[writeFunc] = async () => {
                if (logger.isWarningEnabled()) logger.warn(`${writeFunc} not supported in readOnly mode`);
                return false;
            };
        }
    }
    return client as MobilettoClient;
};

export const addCacheFunctions = (client: MobilettoMinimalClient) =>
    addClientFunctions(client, CACHE_FUNCTIONS, (client: MobilettoPatchable, func: string): boolean => {
        if (logger.isWarningEnabled())
            logger.warn(
                `addCacheFunctions: ${func} already exists on client${
                    client.id ? `(client.id=${client.id})` : ""
                }, not re-adding`
            );
        return false;
    });

const addClientFunctions = (
    client: MobilettoMinimalClient,
    functions: MobilettoFunctions,
    conflictFunc: MobilettoConflictFunction
) => {
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
