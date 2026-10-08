import { CREDITS_LEVEL_3, CREDITS_PER_ITEM, createLimiter, isRateLimitError } from './rateLimit.js';

// One limiter for the whole app. Miro counts credits per user session, not per
// module or per board, so a second limiter would quietly assume it had the
// full budget to itself - see rateLimit.js.
const limiter = createLimiter();

export const board = window.miro.board;

/** A single Miro call, paced against the credit budget. */
export const run = (task) => limiter.run(CREDITS_PER_ITEM, task);

/**
 * A single Miro call that Miro bills at Level 3 (see rateLimit.js). Same
 * limiter as run(), so both kinds of call are paced against the one shared
 * budget - only the cost booked per call differs.
 */
export const runLevel3 = (task) => limiter.run(CREDITS_LEVEL_3, task);

export const takeStats = () => limiter.takeStats();

export { isRateLimitError };
