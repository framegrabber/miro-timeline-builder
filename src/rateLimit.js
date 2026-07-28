// Miro bills every Web SDK call in credits against a rolling budget: 100,000
// credits per minute and 1,000,000 per hour. The budget is counted per *user
// session* and shared across every app the user has open - not per app, not
// per board. A full calendar is ~360 shapes at 50 credits each, so one draw
// fits comfortably; the fifth redraw inside the same minute does not, which is
// exactly the situation you are in while developing.
//
// This limiter keeps the same books Miro does, so we pace ourselves instead of
// waiting for Miro to reject us. There is no API to read the remaining credits,
// so our count is an estimate - the retry path below is what covers the gap.
//
// https://developers.miro.com/docs/websdk-reference-rate-limiting

// Level 1 in Miro's terms - covers createShape, group, and most item actions.
export const CREDITS_PER_ITEM = 50;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const DEFAULT_WINDOWS = [
    { limit: 100_000, ms: MINUTE },
    { limit: 1_000_000, ms: HOUR },
];

// Miro words both the per-minute and the per-hour breach as
// "The API rate limit was exceeded. Requests can use up to N credits ...".
export function isRateLimitError(error) {
    return /rate limit/i.test(String(error?.message ?? error ?? ''));
}

export function createLimiter({
    // Firing all ~360 calls at once bogs the board down without finishing any
    // sooner; a handful in flight keeps the round trips overlapped.
    concurrency = 8,
    // Plan to use only part of the budget - the rest is headroom for whatever
    // else the user is running against the same session.
    utilisation = 0.8,
    windows = DEFAULT_WINDOWS,
    retries = 3,
    retryBaseMs = 1000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
    const spends = [];
    const longestWindow = Math.max(...windows.map((window) => window.ms));

    let active = 0;
    const waiting = [];

    function acquire() {
        if (active < concurrency) {
            active++;
            return Promise.resolve();
        }
        return new Promise((resolve) => waiting.push(resolve));
    }

    function release() {
        const next = waiting.shift();
        if (next) next();
        else active--;
    }

    function forget(at) {
        while (spends.length && at - spends[0].at >= longestWindow) spends.shift();
    }

    function spentWithin(ms, at) {
        return spends
            .filter((spend) => at - spend.at < ms)
            .reduce((total, spend) => total + spend.cost, 0);
    }

    // How long until `cost` fits in every window. 0 when it fits right now.
    function delayFor(cost, at) {
        let until = at;

        for (const { limit, ms } of windows) {
            const budget = limit * utilisation;
            const live = spends
                .filter((spend) => at - spend.at < ms)
                .sort((a, b) => a.at - b.at);

            let total = live.reduce((sum, spend) => sum + spend.cost, 0);

            // Wait out the oldest spends one by one until there is room again.
            for (const spend of live) {
                if (total + cost <= budget) break;
                total -= spend.cost;
                until = Math.max(until, spend.at + ms);
            }
        }

        return until - at;
    }

    async function run(cost, task) {
        await acquire();
        try {
            for (let attempt = 0; ; attempt++) {
                forget(now());

                const delay = delayFor(cost, now());
                if (delay > 0) await sleep(delay);

                spends.push({ at: now(), cost });

                try {
                    return await task();
                } catch (error) {
                    // Miro's accounting is the one that counts. If it says no
                    // despite our budget, back off and let the window drain.
                    if (attempt >= retries || !isRateLimitError(error)) throw error;
                    await sleep(retryBaseMs * 2 ** attempt);
                }
            }
        } finally {
            release();
        }
    }

    return {
        run,
        // Diagnostics only - handy when you want to know why a draw is crawling.
        spent: (ms = MINUTE) => spentWithin(ms, now()),
    };
}
