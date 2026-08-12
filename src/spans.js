import { columnOf, nextWorkingDay, previousWorkingDay } from './calendar.js';

/**
 * Places one date span on the grid of one drawn calendar.
 *
 * The span is columnOf(end) - columnOf(start) + 1, both from the same tested
 * function that positioned the day cells. There is no second day count that
 * could drift from the first - which is the whole reason this exists as one
 * shared function rather than once per caller. The same arithmetic lived a
 * second time in SAPVac/drawshapes.js and produced the same off-by-one three
 * times.
 *
 * The bounds are the drawn window's, which for a calendar over the whole year
 * are the year's. A span outside them cannot be drawn at all; one reaching over
 * an edge is drawn short and says so through `clipped`.
 *
 * Returns either a placement or a single problem, never both.
 */
export function placeSpan({ year, firstColumn, columns }, start, end) {
    const lastColumn = firstColumn + columns - 1;

    // A period reported as Sat-Sun means the working days inside it.
    const from = nextWorkingDay(start);
    const to = previousWorkingDay(end);

    if (to.isBefore(from, 'day')) return { problem: 'no-working-day' };

    const rawStart = columnOf(year, from);
    const rawEnd = columnOf(year, to);

    if (rawEnd < firstColumn || rawStart > lastColumn) return { problem: 'outside-range' };

    const colStart = Math.max(firstColumn, rawStart);
    const colEnd = Math.min(lastColumn, rawEnd);

    return {
        colStart,
        colSpan: colEnd - colStart + 1,
        // A period running past either edge of the drawn calendar is
        // legitimately shorter on it, and callers that compare against a
        // reported duration need to know not to complain about it.
        clipped: rawStart < colStart || rawEnd > colEnd,
    };
}

/**
 * One row per key, keys ascending, blocks left to right.
 *
 * The rows carry `key` rather than a domain name so vacation rows (per
 * employee) and school holiday rows (per federal state) can share this. The
 * caller renames it if its consumers expect something else.
 */
export function groupIntoRows(placed, { colorOf }) {
    const keys = [...new Set(placed.map((item) => item.key))].sort();

    return keys.map((key, index) => ({
        key,
        index,
        color: colorOf(key),
        // colStart alone is not a total order: two periods pulled onto the
        // same Monday by nextWorkingDay share a colStart, and Array.sort is
        // stable, so ties would fall back to input order - exactly what this
        // sort exists to remove. colSpan and then label break every tie that
        // colStart cannot; once all three agree the blocks are identical in
        // content, so no order is observable.
        // Everything but `key` is carried through, so a caller can attach its
        // own fields to a block - the school holiday bands add a `detail` line
        // for the state code and the dates. `label` stays the sortable plain
        // text every caller has, which is what the tie-break below needs.
        blocks: placed
            .filter((item) => item.key === key)
            .map(({ key: _rowKey, ...block }) => block)
            .sort((a, b) =>
                a.colStart - b.colStart ||
                a.colSpan - b.colSpan ||
                (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    }));
}
