var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { basename, dirname } from "path";
import { sha256 } from "zilla-util";
import { Transform } from "stream";
import { Queue, QueueEvents, Worker } from "bullmq";
import { M_FILE, M_DIR, isReadable, logger, MobilettoError, MobilettoNotFoundError, rand } from "mobiletto-common";
import { DEFAULT_CRYPT_ALGO, normalizeKey, normalizeIV, decrypt, getCipher, getDecipher, DEFAULT_DIR_LEVELS, DEFAULT_META_WORKERS, } from "./crypt.js";
import { ALL_DRIVERS } from "./register.js";
import { newCryptGenerator, reader, stringGenerator } from "./util.js";
import { addCacheFunctions, addUtilityFunctions } from "./functions.js";
import { REDIS_HOST, REDIS_PORT, REDIS_PREFIX } from "./redis.js";
const DIR_ENT_DIR_SUFFIX = "__.dirent";
const DIR_ENT_FILE_PREFIX = "dirent__";
const ENC_PAD_SEP = " ~ ";
export const ALL_MQ = {};
export function mobiletto(driverPath, key, secret, opts, encryption) {
    return __awaiter(this, void 0, void 0, function* () {
        if (logger.isInfoEnabled())
            logger.info(`mobiletto: connecting with driver ${driverPath}`);
        let driver;
        if (typeof driverPath === "string") {
            if (ALL_DRIVERS[driverPath]) {
                driver = ALL_DRIVERS[driverPath];
            }
            else if (require) {
                driver = require(driverPath.includes("/") ? driverPath : `./drivers/${driverPath}/index.js`);
            }
            else {
                throw new MobilettoError(`mobiletto: error resolving driver (require not supported): ${driverPath} (try an ES import of the driver package)`);
            }
        }
        else if (typeof driverPath === "function") {
            driver = { storageClient: driverPath };
        }
        else if (typeof driverPath === "object" && typeof driverPath.storageClient === "function") {
            driver = driverPath;
        }
        else {
            throw new MobilettoError(`mobiletto: expected registered driver name or a MobilettoDriverParameter, received a ${typeof driverPath} with value ${driverPath}`);
        }
        let client;
        try {
            client = driver.storageClient(key, secret || undefined, opts || undefined);
        }
        catch (e) {
            const message = `mobiletto(${driverPath}) error initializing driver: ${e}`;
            if (logger.isErrorEnabled())
                logger.error(message);
            throw new MobilettoError(message);
        }
        let configValue = null;
        try {
            configValue = yield client.testConfig();
        }
        catch (e) {
            const message = `mobiletto(${driverPath}) error testing connection: ${e}`;
            if (logger.isErrorEnabled())
                logger.error(message);
            throw new MobilettoError(message);
        }
        if (!configValue) {
            const message = `mobiletto(${driverPath}) error: test API call failed`;
            if (logger.isErrorEnabled())
                logger.error(message);
            throw new MobilettoError(message);
        }
        const readOnly = opts ? !!opts.readOnly : false;
        client.redisConfig = opts && opts.redisConfig ? opts.redisConfig : {};
        if (!client.redisConfig.prefix) {
            client.redisConfig.prefix = REDIS_PREFIX;
        }
        const internalIdForDriver = () => driverPath + "_" + sha256(`${key}\n${JSON.stringify(opts)}\n${encryption ? JSON.stringify(encryption) : ""}`);
        // If the driver didn't give the client a name, generate a unique internal name
        if (!client.id) {
            client.id = internalIdForDriver();
        }
        client.queueWorkers = [];
        if (!encryption) {
            if (logger.isInfoEnabled())
                logger.info(`mobiletto: successfully connected using driver ${driverPath}, returning client (encryption not enabled)`);
            return addUtilityFunctions(addCacheFunctions(client), readOnly);
        }
        // Encryption is enabled
        // Wrap the client, override various methods to enable transparent encryption
        const encKey = normalizeKey(encryption.key);
        if (!encKey) {
            const message = `mobiletto(${driverPath}) invalid encryption key`;
            if (logger.isErrorEnabled())
                logger.error(message);
            throw new MobilettoError(message);
        }
        const iv = normalizeIV(encryption.iv, encKey);
        if (!iv) {
            const message = `mobiletto(${driverPath}) invalid encryption IV`;
            if (logger.isErrorEnabled())
                logger.error(message);
            throw new MobilettoError(message);
        }
        const dirLevels = encryption.dirLevels || DEFAULT_DIR_LEVELS;
        const algo = encryption.algo || DEFAULT_CRYPT_ALGO;
        const metaWorkers = encryption.metaWorkers || DEFAULT_META_WORKERS;
        const enc = {
            key: encKey,
            iv,
            algo,
            dirLevels,
            encPathPadding: () => ENC_PAD_SEP + rand(1 + Math.floor(2 * Math.random())),
            metaWorkers,
        };
        function encryptPath(path) {
            const encrypted = sha256(enc.key + " " + path);
            let newPath = "";
            for (let i = 0; i <= dirLevels; i++) {
                if (newPath.length > 0)
                    newPath += "/";
                newPath += encrypted.substring(i * 2, i * 2 + 2);
            }
            return newPath + encrypted;
        }
        const metaPath = (path) => encryptPath(path + " ~ META");
        const direntDir = (dir) => encryptPath(dir + DIR_ENT_DIR_SUFFIX);
        const direntFile = (dirent, path) => dirent + "/" + sha256(DIR_ENT_FILE_PREFIX + " " + path);
        const outerClient = addCacheFunctions(client);
        const _metadata = (client) => (path) => __awaiter(this, void 0, void 0, function* () {
            const cache = outerClient.scopedCache("metadata");
            const cached = cache ? yield cache.get(path) : null;
            if (cached) {
                return cached;
            }
            let metaObj;
            try {
                const chunks = [];
                yield client.read(metaPath(path), reader(chunks));
                metaObj = JSON.parse(decrypt(Buffer.concat(chunks).toString(), enc));
            }
            catch (e) {
                metaObj = {};
            }
            let meta;
            try {
                meta = yield client.metadata(encryptPath(path));
            }
            catch (e) {
                if (e instanceof MobilettoNotFoundError) {
                    const dd = direntDir(path);
                    try {
                        meta = yield client.metadata(dd);
                    }
                    catch (err) {
                        if (err instanceof MobilettoNotFoundError) {
                            const { objects: contents } = yield client.list(dd);
                            if (Array.isArray(contents) && contents.length > 0) {
                                return { name: path, type: M_DIR };
                            }
                            else {
                                throw err;
                            }
                        }
                        else {
                            throw err;
                        }
                    }
                }
                else {
                    throw e;
                }
            }
            meta.type || (meta.type = M_FILE);
            meta.name = path; // rewrite name back to plaintext name
            const finalMeta = Object.assign({}, meta, metaObj);
            if (cache) {
                cache.set(path, finalMeta).then(() => {
                    if (logger.isDebugEnabled())
                        logger.debug(`_metadata(${path}) cached meta = ${JSON.stringify(finalMeta)}`);
                }, (err) => {
                    if (logger.isErrorEnabled())
                        logger.error(`_metadata(${path}) error: ${err}`);
                });
            }
            return finalMeta;
        });
        const _singleMeta = (job) => __awaiter(this, void 0, void 0, function* () {
            const dirent = job.data.dirent;
            const entry = job.data.entry;
            const logPrefix = `_singleMeta(${dirent}/${basename(entry.name)})`;
            return new Promise((resolve, reject) => {
                const cipherText = [];
                client
                    .read(dirent + "/" + basename(entry.name), reader(cipherText))
                    .then((bytesRead) => {
                    if (!bytesRead) {
                        if (logger.isWarningEnabled())
                            logger.warn(`${logPrefix} returned no data`);
                        resolve("null");
                    }
                    else {
                        const plain = decrypt(cipherText.toString(), enc);
                        const realPath = plain.split(ENC_PAD_SEP)[0];
                        _metadata(client)(realPath)
                            .then((meta) => {
                            if (job.data.mobilettoJobID &&
                                typeof META_HANDLERS[job.data.mobilettoJobID] === "function") {
                                META_HANDLERS[job.data.mobilettoJobID](meta);
                            }
                            resolve(JSON.stringify(meta));
                        })
                            .catch((err) => {
                            const message = `${logPrefix} error fetching _metadata: ${err}`;
                            if (logger.isWarningEnabled())
                                logger.warn(message);
                            if (job.data.mobilettoJobID &&
                                typeof META_ERR_HANDLERS[job.data.mobilettoJobID] === "function") {
                                META_ERR_HANDLERS[job.data.mobilettoJobID](message);
                            }
                            reject(message);
                        });
                    }
                })
                    .catch((err) => {
                    const message = `${logPrefix} error reading file: ${err}`;
                    if (logger.isWarningEnabled())
                        logger.warn(message);
                    reject(message);
                });
            });
        });
        const queueName = `metaQ_${client.id}`;
        const jobName = `metaJ_${client.id}`;
        const META_HANDLERS = {};
        const META_ERR_HANDLERS = {};
        const metaLoadQueue = () => {
            if (!client.mq) {
                if (!client.redisConfig) {
                    const message = "metaLoadQueue: redis is required but not enabled";
                    if (logger.isErrorEnabled())
                        logger.error(message);
                    throw new MobilettoError(message);
                }
                const port = client.redisConfig.port || parseInt(`${REDIS_PORT}`);
                const queueOptions = {
                    connection: {
                        host: client.redisConfig.host || REDIS_HOST,
                        port,
                    },
                    prefix: client.redisConfig.prefix + "_" + queueName,
                };
                const queue = new Queue(queueName, queueOptions);
                const workers = [];
                const numWorkers = enc.metaWorkers || DEFAULT_META_WORKERS;
                for (let i = 0; i < numWorkers; i++) {
                    const worker = new Worker(queueName, (job) => __awaiter(this, void 0, void 0, function* () { return yield _singleMeta(job); }), queueOptions);
                    workers.push(worker);
                }
                const events = new QueueEvents(queueName, queueOptions);
                events.on("completed", ({ jobId, returnvalue }) => {
                    if (logger.isInfoEnabled())
                        logger.info(`${jobName} completed job ${jobId} with result: ${returnvalue}`);
                    if (META_HANDLERS[jobId]) {
                        META_HANDLERS[jobId](JSON.parse(returnvalue));
                    }
                });
                events.on("failed", ({ jobId, failedReason }) => {
                    if (logger.isInfoEnabled())
                        logger.info(`${jobName} failed job ${jobId} with result: ${failedReason}`);
                    if (META_ERR_HANDLERS[jobId]) {
                        META_ERR_HANDLERS[jobId](failedReason);
                    }
                });
                client.mq = { queue, workers, events };
                ALL_MQ[client.id] = client.mq;
            }
            return client.mq.queue;
        };
        const _loadMeta = (dirent, entries) => __awaiter(this, void 0, void 0, function* () {
            const files = [];
            const waitForFiles = (resolve) => {
                if (files.length === entries.length) {
                    resolve(files);
                }
                else {
                    setTimeout(() => waitForFiles(resolve), 1000);
                }
            };
            const mobilettoJobID = rand(10);
            const mq = metaLoadQueue();
            META_HANDLERS[mobilettoJobID] = (meta) => files.push(meta);
            META_ERR_HANDLERS[mobilettoJobID] = (failedReason) => {
                if (logger.isErrorEnabled())
                    logger.error(`_loadMeta(${dirent}): error: ${failedReason}`);
            };
            for (const entry of entries) {
                const job = { mobilettoJobID, dirent, entry };
                yield mq.add(jobName, job);
            }
            yield new Promise((resolve) => waitForFiles(resolve));
            delete META_HANDLERS[mobilettoJobID];
            delete META_ERR_HANDLERS[mobilettoJobID];
            return files;
        });
        function removeDirentFile(path) {
            return __awaiter(this, void 0, void 0, function* () {
                const df = direntFile(direntDir(dirname(path)), path);
                const recursive = false;
                const quiet = true;
                if (logger.isDebugEnabled())
                    logger.debug(`removeDirentFile(${path}) removing df=${df}`);
                yield client.remove(df, recursive, quiet);
                if (logger.isDebugEnabled())
                    logger.debug(`removeDirentFile(${path}) removing encryptPath(path)=${encryptPath(path)}`);
                yield client.remove(encryptPath(path), recursive, quiet);
                if (logger.isDebugEnabled())
                    logger.debug(`removeDirentFile(${path}) removing metaPath(path)=${metaPath(path)}`);
                yield client.remove(metaPath(path), recursive, quiet);
            });
        }
        // noinspection JSUnusedGlobalSymbols
        const encClient = {
            id: internalIdForDriver(),
            redisConfig: client.redisConfig,
            testConfig: client.testConfig,
            info: client.info,
            flags: client.flags ? client.flags : undefined,
            list: (...args_1) => __awaiter(this, [...args_1], void 0, function* (pth = "", optsOrRecursive, visitor) {
                const p = pth === "" ? "." : pth.endsWith("/") ? pth.substring(0, pth.length - 1) : pth;
                const dirent = direntDir(p);
                let entries;
                const recursive = optsOrRecursive === true || (optsOrRecursive && optsOrRecursive.recursive) || false;
                visitor = visitor
                    ? visitor
                    : typeof optsOrRecursive === "object" && optsOrRecursive.visitor
                        ? optsOrRecursive.visitor
                        : undefined;
                const cacheKey = `${p} ~ ${recursive}`;
                const cache = visitor ? null : client.scopedCache("enc_list");
                const cached = cache && (yield cache.get(cacheKey));
                function cacheAndReturn(thing) {
                    if (cache) {
                        cache.set(cacheKey, thing).then(() => {
                            if (logger.isDebugEnabled())
                                logger.debug(`enc_list: cached ${p} r=${recursive}`);
                        }, (err) => {
                            if (logger.isErrorEnabled())
                                logger.error(`enc_list(${p}) error: ${err}`);
                        });
                    }
                    return thing;
                }
                function tryParentDirForSingleFile(p, visitor, e) {
                    return __awaiter(this, void 0, void 0, function* () {
                        // it might be a single file, try listing the parent dir
                        const parentDirent = direntDir(dirname(p));
                        const output = yield client.list(parentDirent);
                        entries = output.objects;
                        const objects = yield _loadMeta(parentDirent, output.objects);
                        const found = objects.find((o) => o.name === p);
                        if (found) {
                            if (visitor) {
                                yield visitor(found);
                            }
                            if (logger.isDebugEnabled())
                                logger.debug(`tryParentDirForSingleFile(${p}) found ${found.name}`);
                            return cacheAndReturn({ objects: [found] });
                        }
                        if (logger.isDebugEnabled())
                            logger.debug(`tryParentDirForSingleFile(${p}) nothing found! e=${e}`);
                        throw e ? new MobilettoNotFoundError(p) : e;
                    });
                }
                if (cached) {
                    entries = cached;
                }
                else {
                    try {
                        entries = yield _loadMeta(dirent, ((yield client.list(dirent)).objects));
                    }
                    catch (e) {
                        if (e instanceof MobilettoNotFoundError) {
                            if (p.includes("/")) {
                                return yield tryParentDirForSingleFile(p, visitor, e);
                            }
                            throw e;
                        }
                        else {
                            throw new MobilettoError(`encClient.list(${p}) ${e}`, e instanceof Error ? e : new Error(`${e}`));
                        }
                    }
                    if (recursive) {
                        const dirs = entries.filter((obj) => obj.type === M_DIR);
                        while (dirs.length > 0) {
                            const dir = dirs.shift();
                            if (!dir)
                                continue;
                            const subdir = direntDir(dir.name);
                            const { objects: subdirListing } = yield client.list(subdir);
                            if (subdirListing && subdirListing.length > 0) {
                                const subdirEntries = yield _loadMeta(subdir, subdirListing);
                                if (visitor) {
                                    for (const obj of subdirEntries) {
                                        yield visitor(obj);
                                    }
                                }
                                entries.push(...subdirEntries);
                                const moreDirs = subdirEntries.filter((obj) => obj.type === M_DIR);
                                dirs.unshift(...moreDirs);
                            }
                        }
                        if (cache) {
                            cache.set(cacheKey, entries).then(() => {
                                if (logger.isDebugEnabled())
                                    logger.debug(`enc_list: cached ${p} r=${recursive}`);
                            }, (err) => {
                                if (logger.isErrorEnabled())
                                    logger.error(`enc_list(${p}) error: ${err}`);
                            });
                        }
                        if (!entries || entries.length === 0) {
                            return { objects: [] };
                        }
                    }
                }
                if (entries.length === 0 && p.includes("/")) {
                    return yield tryParentDirForSingleFile(p, visitor, null);
                }
                if (cache) {
                    cache.set(cacheKey, entries).then(() => {
                        if (logger.isDebugEnabled())
                            logger.debug(`enc_list: cached ${p} r=${recursive}`);
                    }, (err) => {
                        if (logger.isErrorEnabled())
                            logger.error(`enc_list(${p}) error: ${err}`);
                    });
                }
                if (!entries || entries.length === 0) {
                    return { objects: [] };
                }
                if (visitor) {
                    for (const obj of entries) {
                        yield visitor(obj);
                    }
                }
                return { objects: entries };
            }),
            metadata: _metadata(client),
            read: (path, callback, endCallback) => __awaiter(this, void 0, void 0, function* () {
                const realPath = encryptPath(path);
                const cipher = getDecipher(enc);
                return yield client.read(realPath, (chunk) => {
                    return callback(cipher.update(chunk));
                }, () => {
                    callback(cipher.final());
                    if (endCallback)
                        endCallback();
                });
            }),
            write: (path, readFunc) => __awaiter(this, void 0, void 0, function* () {
                // if encrypting paths, write dirent file(s) for all parent directories
                let p = path;
                /* eslint-disable no-constant-condition */
                while (true) {
                    /* eslint-enable no-constant-condition */
                    const direntGenerator = stringGenerator(p + enc.encPathPadding(), enc);
                    const dir = direntDir(dirname(p));
                    const df = direntFile(dir, p);
                    if (!(yield client.write(df, direntGenerator()))) {
                        throw new MobilettoError("write: error writing dirent file");
                    }
                    p = dirname(p);
                    if (p === "." || p === "") {
                        break;
                    }
                }
                const cipher = getCipher(enc);
                const realPath = encryptPath(path);
                const generatorBytes = { count: 0 };
                const createEncryptStream = (input) => input.pipe(new Transform({
                    transform(chunk, encoding, callback) {
                        generatorBytes.count += chunk.length;
                        this.push(cipher.update(chunk));
                        callback();
                    },
                    flush(callback) {
                        this.push(cipher.final());
                        callback();
                    },
                }));
                // If we were passed a Readable, call write with a transform method
                if (isReadable(readFunc)) {
                    // @ts-ignore
                    yield client.write(realPath, createEncryptStream(readFunc));
                }
                else {
                    // If we were passed a generator, wrap it with another generator that encrypts
                    yield client.write(realPath, newCryptGenerator(readFunc, generatorBytes, cipher));
                }
                // write metadata
                const meta = { name: path, size: generatorBytes.count, type: M_FILE };
                yield client.write(metaPath(path), stringGenerator(JSON.stringify(meta), enc)());
                return generatorBytes.count;
            }),
            remove: (path, options, quiet) => __awaiter(this, void 0, void 0, function* () {
                if (logger.isDebugEnabled())
                    logger.debug(`enc.remove(${path}) starting`);
                const recursive = options === true || (options && options.recursive) || false;
                quiet || (quiet = (options && typeof options !== "boolean" && options.quiet) || false);
                if (recursive) {
                    // ugh. we have to iterate over all dirent files, and remove each file/subdir one by one
                    const removed = [];
                    // @ts-ignore
                    const recRm = (path) => __awaiter(this, void 0, void 0, function* () {
                        const dirent = direntDir(path);
                        let entries;
                        try {
                            entries = (yield client.list(dirent)).objects;
                        }
                        catch (e) {
                            if (quiet) {
                                if (logger.isWarningEnabled())
                                    logger.warn(`list(${path}): error listing files for recursive deletion: ${e}`);
                            }
                            else {
                                if (!(e instanceof MobilettoNotFoundError)) {
                                    throw e instanceof MobilettoError
                                        ? e
                                        : new MobilettoError(`list(${path}): error listing files for recursive deletion`, e instanceof Error ? e : new Error(`${e}`));
                                }
                            }
                        }
                        if (entries && entries.length > 0) {
                            const files = yield _loadMeta(dirent, entries);
                            for (const f of files) {
                                yield recRm(f.name);
                            }
                        }
                        yield removeDirentFile(path);
                        removed.push(path);
                    });
                    yield recRm(path);
                    return removed;
                }
                // remove the single file/dir
                yield removeDirentFile(path);
                // if we were the last dirent file, then also remove dirent directory, and recursively upwards
                let parent = path;
                let dirent = direntDir(parent);
                const df = direntFile(dirent, path);
                yield client.remove(df, false, true);
                /* eslint-disable no-constant-condition */
                while (true) {
                    /* eslint-enable no-constant-condition */
                    try {
                        const { objects } = yield client.list(dirent);
                        if (objects.length === 0) {
                            yield removeDirentFile(parent);
                        }
                    }
                    catch (e) {
                        if (!(e instanceof MobilettoNotFoundError)) {
                            throw e;
                        }
                    }
                    if (parent === "." || parent === "/") {
                        // do not remove dirent for root dir
                        break;
                    }
                    parent = dirname(parent);
                    dirent = direntDir(parent);
                }
                return path;
            }),
        };
        if (logger.isInfoEnabled())
            logger.info(`mobiletto: successfully connected using driver ${driverPath}, returning client (encryption enabled)`);
        return addUtilityFunctions(addCacheFunctions(encClient), readOnly);
    });
}
export function connect(driverPath, key, secret, opts, encryption) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield mobiletto(driverPath, key, secret, opts, encryption);
    });
}
//# sourceMappingURL=mobiletto.js.map