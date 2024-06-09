export type ZillaClock = {
    now: () => number;
};
export declare const DEFAULT_CLOCK: ZillaClock;
export declare const sleep: (ms: number) => Promise<unknown>;
export declare const DEFAULT_NAP_CHECK = 1000;
export type NapAlarm = {
    wake?: boolean;
};
export declare const nap: (clock: ZillaClock, alarm: NapAlarm, ms: number, check?: number) => Promise<unknown>;
