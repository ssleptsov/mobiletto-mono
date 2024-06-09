var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReadStream } from "fs";
import { Readable, Transform } from "stream";
import { logger } from "./logger.js";
import crypto from "crypto";
export const isAsyncGenerator = (func) => func[Symbol.toStringTag] === "AsyncGenerator";
export const isReadable = (thing) => thing instanceof ReadStream || thing instanceof Transform || thing instanceof Readable;
export function readStream(stream, callback, endCallback) {
    return __awaiter(this, void 0, void 0, function* () {
        const counter = { count: 0 };
        const streamHandler = (stream) => new Promise((resolve, reject) => {
            stream.on("data", (data) => {
                counter.count += data && data.length ? data.length : 0;
                callback(data);
            });
            stream.on("error", reject);
            stream.on("end", () => {
                if (endCallback) {
                    endCallback();
                }
                resolve();
            });
        });
        yield streamHandler(stream);
        return counter.count;
    });
}
export function writeStream(stream) {
    return (chunk) => {
        if (chunk) {
            stream.write(chunk, (err) => {
                if (err) {
                    logger.error(`writeStream: error writing: ${err}`);
                    throw err;
                }
            });
        }
    };
}
export function closeStream(stream) {
    return () => stream.close((err) => {
        if (err) {
            logger.error(`closeStream: error closing: ${err}`);
            throw err;
        }
    });
}
export const rand = (len) => crypto.randomBytes(len).toString("hex").substring(0, len);
//# sourceMappingURL=util.js.map