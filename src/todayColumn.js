import { columnOf, totalWorkingDays } from './calendar.js';

/**
 * The grid column today belongs in, or null when the year does not contain it.
 *
 * Saturdays and Sundays have no column of their own. columnOf counts working
 * days, so a weekend already resolves to the coming Monday - the agreed
 * behaviour needs no special case here, only the test that pins it down.
 *
 * Kept in its own file, importing nothing but calendar.js: today.js also pulls
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
