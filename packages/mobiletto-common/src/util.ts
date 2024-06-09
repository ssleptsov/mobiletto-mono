/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReadStream } from "fs";
import { Readable, Transform } from "stream";
import { logger } from "./logger.js";
import crypto from "crypto";

export const isAsyncGenerator = (func: any) => func[Symbol.toStringTag] === "AsyncGenerator";
export const isReadable = (thing: any) =>
    thing instanceof ReadStream || thing instanceof Transform || thing instanceof Readable;

export async function readStream(stream: any, callback: (data: any) => void, endCallback?: () => void) {
    const counter = { count: 0 };
    const streamHandler = (stream: any) =>
        new Promise<void>((resolve, reject) => {
            stream.on("data", (data: any) => {
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
    await streamHandler(stream);
    return counter.count;
}

export function writeStream(stream: any) {
    return (chunk: any) => {
        if (chunk) {
            stream.write(chunk, (err: Error | null | undefined) => {
                if (err) {
                    logger.error(`writeStream: error writing: ${err}`);
                    throw err;
                }
            });
        }
    };
}

export function closeStream(stream: any) {
    return () =>
        stream.close((err: Error | null | undefined) => {
            if (err) {
                logger.error(`closeStream: error closing: ${err}`);
                throw err;
            }
        });
}

export const rand = (len: number) => crypto.randomBytes(len).toString("hex").substring(0, len);
