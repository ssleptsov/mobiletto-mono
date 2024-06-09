/* eslint-disable @typescript-eslint/no-explicit-any */

export class MobilettoError extends Error {
    readonly err?: any;
    constructor(message: string, err?: any) {
        super(`${message}: ${err ? err : ""}`);
        this.err = err;
        this.stack = err && err.stack ? err.stack : new Error().stack;
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
            Object.setPrototypeOf(this, actualProto);
        } else {
            (this as any).__proto__ = actualProto;
        }
    }
}

export class MobilettoNotFoundError extends Error {
    readonly id: any;
    constructor(id: any) {
        super(`MobilettoNotFoundError: ${id}`);
        this.stack = new Error().stack;
        const actualProto = new.target.prototype;
        if (Object.setPrototypeOf) {
            Object.setPrototypeOf(this, actualProto);
        } else {
            (this as any).__proto__ = actualProto;
        }
    }
}
