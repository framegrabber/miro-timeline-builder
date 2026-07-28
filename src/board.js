import { CREDITS_PER_ITEM, createLimiter, isRateLimitError } from './rateLimit.js';

// One limiter for the whole app. Miro counts credits per user session, not per
// module or per board, so a second limiter would quietly assume it had the
// full budget to itself - see rateLimit.js.
const limiter = createLimiter();

export const board = window.miro.board;

/** A single Miro call, paced against the credit budget. */
export const run = (task) => limiter.run(CREDITS_PER_ITEM, task);

export const takeStats = () => limiter.takeStats();

export { isRateLimitError };
