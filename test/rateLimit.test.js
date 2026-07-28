import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CREDITS_PER_ITEM,
    DEFAULT_WINDOWS,
    createLimiter,
    isRateLimitError,
} from '../src/rateLimit.js';

// A clock that only moves when someone sleeps. With concurrency 1 this makes
// the schedule fully deterministic, so we can assert on exact timings.
function virtualClock() {
    let t = 0;
    return {
        now: () => t,
        sleep: async (ms) => { t += ms; },
        set: (ms) => { t = ms; },
    };
}

// The real calendar: 261 days + 53 weeks + 26 iterations + 12 months + 5 quarters.
const SHAPES_PER_CALENDAR = 357;

test('runs every task and returns its result', async () => {
    const limiter = createLimiter({ ...virtualClock() });
    const results = await Promise.all(
        [1, 2, 3].map((n) => limiter.run(CREDITS_PER_ITEM, async () => n * 2))
    );
    assert.deepEqual(results, [2, 4, 6]);
});

test('never has more than `concurrency` tasks in flight', async () => {
    const limiter = createLimiter({ concurrency: 4, ...virtualClock() });

    let inFlight = 0;
    let peak = 0;

    await Promise.all(
        Array.from({ length: 50 }, () =>
            limiter.run(CREDITS_PER_ITEM, async () => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                await Promise.resolve();
                inFlight--;
            })
        )
    );

    assert.equal(peak, 4);
    assert.equal(inFlight, 0);
});

test('spreads spending so no window ever goes over budget', async () => {
    const clock = virtualClock();
    // 500 credits per second, 50 per task => 10 tasks per second.
    const limiter = createLimiter({
        concurrency: 1,
        utilisation: 1,
        windows: [{ limit: 500, ms: 1000 }],
        ...clock,
    });

    const startedAt = [];
    for (let i = 0; i < 25; i++) {
        await limiter.run(CREDITS_PER_ITEM, async () => startedAt.push(clock.now()));
    }

    for (const start of startedAt) {
        const inWindow = startedAt.filter((t) => t >= start && t < start + 1000);
        assert.ok(
            inWindow.length * CREDITS_PER_ITEM <= 500,
            `${inWindow.length} tasks within the window starting at ${start}`
        );
    }
    assert.deepEqual(startedAt.slice(0, 11), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1000]);
});

test('one calendar never has to wait under the real Miro limits', async () => {
    const clock = virtualClock();
    const limiter = createLimiter({ ...clock });

    for (let i = 0; i < SHAPES_PER_CALENDAR; i++) {
        await limiter.run(CREDITS_PER_ITEM, async () => {});
    }

    assert.equal(clock.now(), 0, 'a single calendar should draw without throttling');
    assert.equal(limiter.spent(), SHAPES_PER_CALENDAR * CREDITS_PER_ITEM);
});

test('redrawing the calendar over and over does get throttled', async () => {
    const clock = virtualClock();
    const limiter = createLimiter({ ...clock });

    // 80,000 usable credits per minute / 50 = 1600 shapes, i.e. the 5th
    // calendar in a row is the one that runs into the wall.
    for (let i = 0; i < SHAPES_PER_CALENDAR * 5; i++) {
        await limiter.run(CREDITS_PER_ITEM, async () => {});
    }

    assert.ok(clock.now() > 0, 'five calendars in a minute must be paced');
    assert.ok(limiter.spent(DEFAULT_WINDOWS[0].ms) <= DEFAULT_WINDOWS[0].limit);
});

test('retries a rate limit error and succeeds', async () => {
    const limiter = createLimiter({ ...virtualClock() });

    let attempts = 0;
    const result = await limiter.run(CREDITS_PER_ITEM, async () => {
        attempts++;
        if (attempts < 3) {
            throw new Error(
                'The API rate limit was exceeded. Requests can use up to 100000 credits in total per minute.'
            );
        }
        return 'drawn';
    });

    assert.equal(result, 'drawn');
    assert.equal(attempts, 3);
});

test('gives up after the configured number of retries', async () => {
    const limiter = createLimiter({ retries: 2, ...virtualClock() });

    let attempts = 0;
    await assert.rejects(
        limiter.run(CREDITS_PER_ITEM, async () => {
            attempts++;
            throw new Error('The API rate limit was exceeded.');
        }),
        /rate limit/
    );
    assert.equal(attempts, 3, 'the first try plus two retries');
});

test('backs off exponentially between retries', async () => {
    const clock = virtualClock();
    const limiter = createLimiter({ retryBaseMs: 100, ...clock });

    await assert.rejects(
        limiter.run(CREDITS_PER_ITEM, async () => {
            throw new Error('The API rate limit was exceeded.');
        })
    );

    assert.equal(clock.now(), 100 + 200 + 400);
});

test('does not retry errors that are not about the rate limit', async () => {
    const limiter = createLimiter({ ...virtualClock() });

    let attempts = 0;
    await assert.rejects(
        limiter.run(CREDITS_PER_ITEM, async () => {
            attempts++;
            throw new Error('Groups can only be created with at least two items');
        }),
        /at least two items/
    );
    assert.equal(attempts, 1);
});

test('releases its slot when a task throws', async () => {
    const limiter = createLimiter({ concurrency: 1, retries: 0, ...virtualClock() });

    await assert.rejects(limiter.run(CREDITS_PER_ITEM, async () => {
        throw new Error('boom');
    }));

    assert.equal(await limiter.run(CREDITS_PER_ITEM, async () => 'still works'), 'still works');
});

test('recognises the rate limit errors Miro actually throws', () => {
    assert.ok(isRateLimitError(new Error(
        'The API rate limit was exceeded. Requests can use up to 100000 credits in total per minute.'
    )));
    assert.ok(isRateLimitError(new Error(
        'The API rate limit was exceeded. Requests can use up to 1000000 credits in total per hour.'
    )));
    assert.ok(!isRateLimitError(new Error('Groups can only be created with at least two items')));
    assert.ok(!isRateLimitError(undefined));
});
