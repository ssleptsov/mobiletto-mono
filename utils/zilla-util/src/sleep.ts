export type ZillaClock = {
    now: () => number;
};

export const DEFAULT_CLOCK: ZillaClock = {
    now: () => Date.now(),
};

// adapted from https://stackoverflow.com/a/39914235
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const DEFAULT_NAP_CHECK = 1000;

const _nap =
    (resolve: (v?: unknown) => void, clock: ZillaClock, alarm: NapAlarm, ms: number, check: number) => async () => {
        try {
            alarm.wake = false;
            const start = clock.now();
            while (!alarm.wake && clock.now() - start < ms) {
                await sleep(check);
            }
        } finally {
            resolve();
        }
    };

export type NapAlarm = {
    wake?: boolean;
};

export const nap = (clock: ZillaClock, alarm: NapAlarm, ms: number, check?: number) =>
    new Promise((r) => _nap(r, clock, alarm, ms, check || DEFAULT_NAP_CHECK)());
