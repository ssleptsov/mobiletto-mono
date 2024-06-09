export declare const isAsyncGenerator: (func: any) => boolean;
export declare const isReadable: (thing: any) => boolean;
export declare function readStream(stream: any, callback: (data: any) => void, endCallback?: () => void): Promise<number>;
export declare function writeStream(stream: any): (chunk: any) => void;
export declare function closeStream(stream: any): () => any;
export declare const rand: (len: number) => string;
