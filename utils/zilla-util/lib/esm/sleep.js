export const DEFAULT_CLOCK = {
    now: () => Date.now(),
};
// adapted from https://stackoverflow.com/a/39914235
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const DEFAULT_NAP_CHECK = 1000;
const _nap = (resolve, clock, alarm, ms, check) => async () => {
    try {
        alarm.wake = false;
        const start = clock.now();
        while (!alarm.wake && clock.now() - start < ms) {
            await sleep(check);
        }
    }
    finally {
        resolve();
    }
};
export const nap = (clock, alarm, ms, check) => new Promise((r) => _nap(r, clock, alarm, ms, check || DEFAULT_NAP_CHECK)());
//# sourceMappingURL=sleep.js.map