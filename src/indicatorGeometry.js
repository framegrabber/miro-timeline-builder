import { columnOf, totalWorkingDays } from './calendar.js';

/**
 * The grid column today belongs in, or null when the year does not contain it.
 *
 * Saturdays and Sundays have no column of their own. columnOf counts working
 * days, so a weekend already resolves to the coming Monday - the agreed
 * behaviour needs no special case here, only the test that pins it down.
 *
 * This module is the indicator's arithmetic, and nothing else. It imports
 * nothing but calendar.js: today.js also pulls
 * in board.js, which evaluates window.miro.board at module scope. Under
 * `node --test` there is no window, so a test importing this pure function
 * through today.js would fail on import alone, before any assertion runs.
 */
export function columnForToday(year, today) {
    const column = columnOf(year, today);
    if (column < 0 || column >= totalWorkingDays(year)) return null;
    return column;
}

/**
 * The centre y of the TODAY circle.
 *
 * `reservedRows` is what the holiday import wrote into the calendar entry: how
 * many rowHeights the bands and stickies occupy above the calendar. At zero
 * this is literally the formula the circle used before holidays existed, which
 * is why a calendar without them does not move.
 */
export function indicatorY({ top, rowHeight, diameter, reservedRows }) {
    return top - (reservedRows ?? 0) * rowHeight - rowHeight / 2 - diameter / 2;
}

/**
 * Whether moveIndicator should write the circle's y.
 *
 * `placedY` is the y *we* last wrote - absent (never recorded) or explicitly
 * null (cleared by removeIndicator) for any indicator predating that field.
 * For those, `legacyY` stands in: createIndicator was the only writer of the
 * circle's y before reservedRows existed, and it always used the no-holidays
 * formula, so that value IS what was last written, not a guess. Falling back
 * to it - rather than to "write it anyway" - is what lets a hand-drag from
 * before this change survive the first tick, while still letting a holiday
 * block that appeared since push the circle up.
 */
export function shouldMoveIndicatorY(y, placedY, legacyY, nudge) {
    const lastWritten = placedY ?? legacyY;
    return Math.abs(y - lastWritten) >= nudge;
}

/**
 * The minimum length of the dotted line, in row heights below the calendar.
 *
 * This is also the whole history of the anchor's y: before the length was
 * derived from anything, createIndicator wrote exactly this and nothing ever
 * wrote it again. legacyAnchorY below is that formula, which is why an anchor
 * with no placedAnchorY on record can be compared against a fact rather than
 * against a guess - see shouldMoveIndicatorY.
 */
export const MIN_ANCHOR_ROWS = 3;

/**
 * The centre y of the invisible shape the dotted line ends on.
 *
 * `contentRows` is what the vacation import wrote into the calendar entry: how
 * many rows of bars sit below the calendar. The bars start at `bottom +
 * padding` and step by `rowHeight + padding` (drawRows in import.js), so
 * padding is counted per row rather than once - a line that stops half a bar
 * short looks like a bug, and on a full-size board those two pixels per row
 * add up.
 *
 * The extra `rowHeight` is deliberate slack: the line should visibly end past
 * the content instead of flush with it. The floor keeps a calendar without any
 * vacation data at the exact position it has had all along, so nothing on an
 * existing board moves.
 */
export function anchorY({ bottom, rowHeight, padding, contentRows, minRows = MIN_ANCHOR_ROWS }) {
    const rows = contentRows ?? 0;
    const contentBottom = bottom + padding + rows * (rowHeight + padding);
    return Math.max(bottom + minRows * rowHeight, contentBottom + rowHeight);
}

/** What createIndicator wrote before the length was derived from anything. */
export function legacyAnchorY({ bottom, rowHeight }) {
    return bottom + MIN_ANCHOR_ROWS * rowHeight;
}

/**
 * Whether the updater's periodic pass has anything to do.
 *
 * The indicator moves once a day, but the tick fires every ten minutes in the
 * headless iframe of every open board session. A pass whose date key matches
 * the last one would compute the same target as the last one did, so it can be
 * skipped before a single board call is made - which is the whole point: an
 * unchanged board should cost nothing.
 *
 * `lastDateKey` is absent on the first pass after the board opened, and that
 * pass must always run: it is what heals an indicator somebody else damaged
 * while nobody had the board open.
 */
export function shouldPass(dateKey, lastDateKey) {
    return dateKey !== lastDateKey;
}

/**
 * The item id a connector endpoint points at, or null when it cannot be read.
 *
 * The Web SDK reference does not spell out the shape of `start`/`end`, and the
 * two plausible shapes have to be told apart from a genuinely broken endpoint:
 * `{ item: 'id' }` is what the code has always assumed, `{ item: { id } }` is
 * what an SDK that hands back the resolved item would look like. Reading both
 * costs one line; guessing wrong the other way would mean an endpoint that
 * never matches, so a healthy connector would be redrawn on every writing pass.
 */
export function endpointItemId(endpoint) {
    const item = endpoint?.item;
    if (item === null || item === undefined) return null;
    if (typeof item === 'string') return item;
    return item.id ?? null;
}

/**
 * What a fetched connector says about itself: 'gone', 'unreadable', 'attached'
 * or 'detached'.
 *
 * 'unreadable' and 'detached' are deliberately different answers. Unreadable
 * means this code cannot see where the line ends - an endpoint object that is
 * missing or whose item is in neither known shape - and the only safe response
 * is to warn and change nothing. Detached means the endpoints were read fine
 * and point somewhere other than our circle and anchor, which is the failure
 * from issue #7 and the one case that earns a repair.
 *
 * Note that a missing `start` or `end` alone is enough to be unreadable:
 * requiring both to be absent - as this check first did - meant a connector
 * that presented with one readable end was classified as detached and redrawn,
 * while a hand-detached one with neither end readable was silently accepted.
 */
export function connectorState(connector, circleId, anchorId) {
    if (!connector) return 'gone';
    if (!connector.start || !connector.end) return 'unreadable';

    const startId = endpointItemId(connector.start);
    const endId = endpointItemId(connector.end);
    if (startId === null || endId === null) return 'unreadable';

    return startId === circleId && endId === anchorId ? 'attached' : 'detached';
}
