import { board, run, isRateLimitError } from './board.js';
import { totalWorkingDays } from './calendar.js';

/**
 * The day cells of one calendar, indexed by grid column.
 *
 * Miro's Shape carries a readonly `groupId`, and anchors.js already fetches the
 * firstDay anchor to measure the grid - so the group is reachable for free. Two
 * calls resolve it, and the day row is picked out by the one thing that
 * distinguishes it: every day cell shares the firstDay anchor's y. Sorted by x,
 * the position in the array is the column.
 *
 * Deriving the mapping from the geometry rather than from a stored list of ids
 * is the same choice gridFrom makes: measured off the board, so moving or
 * scaling the calendar cannot invalidate it, and nothing has to be kept in sync.
 *
 * `board.get()` would work without a group and survive an ungrouping, but it is
 * a Level 3 call (500 credits against getById's 50) and returns every shape on
 * the board - including the other year's calendar sitting next to this one.
 */

// Cells are created at an exact computed y, so this only absorbs float noise.
// The next row is a full rowHeight away, so there is no ambiguity to resolve.
const SAME_ROW = 1;

export async function dayCellsOf(calendar) {
    if (!calendar.groupId) return { cells: null, reason: 'ungrouped' };

    let items;
    try {
        const group = await run(() => board.getById(calendar.groupId));
        items = await run(() => group.getItems());
    } catch (error) {
        // A rate limit that outlasted run()'s retries means the call never
        // completed, not that the group is gone. Saying 'ungrouped' here would
        // send the caller down a path that refuses to draw permanently over a
        // failure that is temporary.
        if (isRateLimitError(error)) return { cells: null, reason: 'rate-limited' };
        return { cells: null, reason: 'ungrouped' };
    }

    const dayRowY = calendar.bottom - calendar.rowHeight / 2;
    const cells = items
        .filter((item) => Math.abs(item.y - dayRowY) < SAME_ROW)
        .sort((a, b) => a.x - b.x);

    // If the count is off, some cell was dragged out or something foreign was
    // dropped onto the row, and every index past that point means a different
    // day than it should. Refuse rather than mark the wrong date - the same
    // choice gridFrom makes when the measurement stops describing a grid.
    if (cells.length !== totalWorkingDays(calendar.year)) {
        return { cells: null, reason: 'incomplete' };
    }

    return { cells, reason: null };
}
