import { board, run, isRateLimitError } from './board.js';

/**
 * The day cells of one calendar, indexed by grid column.
 *
 * Miro's Shape carries a readonly `groupId`, and anchors.js already fetches the
 * firstDay anchor to measure the grid - so the group is reachable for free. Two
 * calls resolve it, and the day row is picked out by the one thing that
 * distinguishes it: every day cell shares the firstDay anchor's y. Sorted by x,
 * the position plus the range's firstColumn is the column - and that is the key
 * the result is indexed by, so callers never do the addition themselves.
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
    const sorted = items
        .filter((item) => Math.abs(item.y - dayRowY) < SAME_ROW)
        .sort((a, b) => a.x - b.x);

    // If the count is off, some cell was dragged out or something foreign was
    // dropped onto the row, and every index past that point means a different
    // day than it should. Refuse rather than mark the wrong date - the same
    // choice gridFrom makes when the measurement stops describing a grid.
    if (sorted.length !== calendar.range.columns) {
        return { cells: null, reason: 'incomplete' };
    }

    // Keyed by absolute column, not by position: a calendar drawn for part of a
    // year starts at firstColumn, and every caller addresses a cell by the
    // column a date resolves to. Handing back an array would make each of them
    // subtract firstColumn, which is three chances to forget.
    const cells = {};
    sorted.forEach((cell, index) => {
        cells[calendar.range.firstColumn + index] = cell;
    });

    return { cells, reason: null };
}
