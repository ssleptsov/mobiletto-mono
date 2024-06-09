import Sha256 from "./sha256.js";
export * from "./sleep.js";
export * from "./string.js";
export * from "./deep.js";

export const sha256 = (s: unknown) => Sha256.hash(`${s}`);
