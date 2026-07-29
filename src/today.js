import { columnOf, totalWorkingDays } from './calendar.js';

/**
 * The grid column today belongs in, or null when the year does not contain it.
 *
 * Saturdays and Sundays have no column of their own. columnOf counts working
 * days, so a weekend already resolves to the coming Monday - the agreed
 * behaviour needs no special case here, only the test that pins it down.
 */
export function columnForToday(year, today) {
    const column = columnOf(year, today);
    if (column < 0 || column >= totalWorkingDays(year)) return null;
    return column;
}
