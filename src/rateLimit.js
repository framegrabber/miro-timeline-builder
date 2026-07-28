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
// It also records what every call actually cost in wall clock time. There is
// no batch create in the Web SDK, so a calendar is N separate round trips and
// the only real lever is how many of them are in flight at once - which is
// worth measuring rather than guessing.
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

function percentile(sorted, fraction) {
    if (!sorted.length) return 0;
    const index = Math.ceil(fraction * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

export function createLimiter({
    // Miro limits credits per minute, not calls in flight, so this is a
    // throughput knob rather than a safety one. Higher means fewer waves of
    // round trips; too high and the board's own renderer starts to struggle.
    // 24 is what measuring on a real board settled on.
    concurrency = 24,
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
    const samples = [];
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

        for (const { limit: budgetLimit, ms } of windows) {
            const budget = budgetLimit * utilisation;
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

        const queuedAt = now();
        let waited = 0;
        let attempts = 0;

        try {
            for (let attempt = 0; ; attempt++) {
                forget(now());

                const delay = delayFor(cost, now());
                if (delay > 0) {
                    waited += delay;
                    await sleep(delay);
                }

                spends.push({ at: now(), cost });
                attempts++;

                const startedAt = now();
                try {
                    const result = await task();
                    samples.push({
                        cost,
                        queuedAt,
                        startedAt,
                        endedAt: now(),
                        latencyMs: now() - startedAt,
                        waitedMs: waited,
                        retries: attempts - 1,
                    });
                    return result;
                } catch (error) {
                    // Miro's accounting is the one that counts. If it says no
                    // despite our budget, back off and let the window drain.
                    if (attempt >= retries || !isRateLimitError(error)) throw error;
                    const backoff = retryBaseMs * 2 ** attempt;
                    waited += backoff;
                    await sleep(backoff);
                }
            }
        } finally {
            release();
        }
    }

    // Returns the stats for everything run since the last call, then clears
    // them, so each draw reports on itself and nothing else.
    function takeStats() {
        if (!samples.length) return null;

        const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
        const startedAt = Math.min(...samples.map((sample) => sample.queuedAt));
        const endedAt = Math.max(...samples.map((sample) => sample.endedAt));
        const wallClockMs = endedAt - startedAt;

        const stats = {
            calls: samples.length,
            concurrency,
            wallClockMs,
            throttledMs: samples.reduce((sum, sample) => sum + sample.waitedMs, 0),
            retries: samples.reduce((sum, sample) => sum + sample.retries, 0),
            credits: samples.reduce((sum, sample) => sum + sample.cost, 0),
            creditsLastMinute: spentWithin(MINUTE, now()),
            fastestMs: latencies[0],
            medianMs: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
            slowestMs: latencies[latencies.length - 1],
            callsPerSecond: wallClockMs > 0 ? (samples.length / wallClockMs) * 1000 : Infinity,
        };

        samples.length = 0;
        return stats;
    }

    return {
        run,
        takeStats,

        // Diagnostics only - handy when you want to know why a draw is crawling.
        spent: (ms = MINUTE) => spentWithin(ms, now()),
    };
}
