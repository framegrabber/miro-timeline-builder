import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

dayjs.extend(isoWeek);

/**
 * The calendar is a grid of working-day columns.
 *
 *   column 0 = the first working day of the year
 *   one column per Mon-Fri, weekends have no column at all
 *
 * Every row (days, months, weeks, iterations, quarters) must derive its
 * position from `columnOf`. Rows that do their own arithmetic drift apart from
 * each other whenever Jan 1st is not a Monday - that is the bug this module
 * exists to prevent. Nothing here knows about pixels or Miro; `app.js` turns
 * columns into coordinates in exactly one place.
 */

const WORKING_DAYS_PER_WEEK = 5;

export function isWorkingDay(date) {
    return date.isoWeekday() <= WORKING_DAYS_PER_WEEK;
}

export function nextWorkingDay(date) {
    let day = date;
    while (!isWorkingDay(day)) day = day.add(1, 'day');
    return day;
}

export function previousWorkingDay(date) {
    let day = date;
    while (!isWorkingDay(day)) day = day.subtract(1, 'day');
    return day;
}

/** The date that owns column 0. Skips forward when Jan 1st is a weekend. */
export function firstWorkingDayOf(year) {
    return nextWorkingDay(dayjs(`${year}-01-01`));
}

export function lastWorkingDayOf(year) {
    return previousWorkingDay(dayjs(`${year}-12-31`));
}

/**
 * Grid column of a date, as a signed count of working days from column 0.
 * Negative for dates before the year starts - that is what lets a week block
 * whose Monday sits in the previous year be positioned at all, so `clipBlocks`
 * has something to cut back to the first drawn column instead of a block that
 * simply does not exist.
 *
 * Every comparison is to the day, never to the millisecond. Without the 'day'
 * granularity dayjs compares instants: the loop variable sits at midnight, so
 * for a `date` carrying any time of day at all, midnight of that same day
 * counts as "before" it and the day itself gets counted - putting every
 * afternoon one column too far right. The block builders always passed
 * midnight and never noticed; the TODAY indicator passes dayjs() and was a day
 * ahead all day, every day.
 */
export function columnOf(year, date) {
    const first = firstWorkingDayOf(year);
    let column = 0;

    if (date.isBefore(first, 'day')) {
        for (let d = date; d.isBefore(first, 'day'); d = d.add(1, 'day')) {
            if (isWorkingDay(d)) column--;
        }
        return column;
    }

    for (let d = first; d.isBefore(date, 'day'); d = d.add(1, 'day')) {
        if (isWorkingDay(d)) column++;
    }
    return column;
}

const workingDaysCache = new Map();

/** Working days per calendar month, in month order. */
export function workingDaysPerMonth(year) {
    const cached = workingDaysCache.get(year);
    if (cached) return cached;

    const months = [];
    for (let m = 0; m <= 11; m++) {
        const month = dayjs(`${year}-01-01`).month(m);
        let workingDays = 0;
        for (let day = 1; day <= month.daysInMonth(); day++) {
            if (isWorkingDay(month.date(day))) workingDays++;
        }
        months.push({ month: month.format('MMMM'), workingDays });
    }

    workingDaysCache.set(year, months);
    return months;
}

/** Total number of columns in the grid. */
export function totalWorkingDays(year) {
    return workingDaysPerMonth(year).reduce((sum, month) => sum + month.workingDays, 0);
}

function workingDaysBetweenMonths(year, startMonth, endMonth) {
    return workingDaysPerMonth(year).reduce(
        (total, month, index) =>
            index >= startMonth && index < endMonth ? total + month.workingDays : total,
        0
    );
}

// --- rows --------------------------------------------------------------------
// Each builder returns blocks in column space: { colStart, colSpan, ... }.

export function dayBlocks(year) {
    const blocks = [];
    const end = lastWorkingDayOf(year);
    let column = 0;

    for (let d = firstWorkingDayOf(year); !d.isAfter(end); d = d.add(1, 'day')) {
        if (!isWorkingDay(d)) continue;
        blocks.push({
            label: d.format('DD'),
            weekday: d.isoWeekday(),
            colStart: column,
            colSpan: 1,
        });
        column++;
    }
    return blocks;
}

export function monthBlocks(year) {
    let colStart = 0;
    return workingDaysPerMonth(year).map((month, index) => {
        const block = {
            label: month.month,
            index,
            colStart,
            colSpan: month.workingDays,
        };
        colStart += month.workingDays;
        return block;
    });
}

/**
 * One block per ISO week containing at least one working day of the year,
 * anchored on that week's Monday.
 *
 * Keyed by Monday rather than by week number on purpose: a year can both start
 * and end in an ISO week numbered 1, so week numbers are not unique within a
 * year and cannot drive the loop.
 */
export function weekBlocks(year) {
    const first = firstWorkingDayOf(year);
    const last = lastWorkingDayOf(year);
    const blocks = [];

    let monday = first.subtract(first.isoWeekday() - 1, 'day');
    while (!monday.isAfter(last)) {
        blocks.push({
            week: monday.isoWeek(),
            colStart: columnOf(year, monday),
            colSpan: WORKING_DAYS_PER_WEEK,
        });
        monday = monday.add(7, 'day');
    }
    return blocks;
}

/**
 * Iterations start on the first `weekdayIndex` (0 = Monday .. 4 = Friday) on or
 * after the first working day of the year, shifted by `weekOffset` whole weeks,
 * and run in fixed-length chunks to the end of the year.
 */
export function iterationBlocks(year, { weekdayIndex, weekOffset, daysPerIteration, startNumber }) {
    let start = firstWorkingDayOf(year);
    while (start.isoWeekday() !== weekdayIndex + 1) {
        start = start.add(1, 'day');
    }

    const firstColumn = columnOf(year, start) + weekOffset * WORKING_DAYS_PER_WEEK;
    const columns = totalWorkingDays(year);
    const count = Math.max(0, Math.ceil((columns - firstColumn) / daysPerIteration));

    return Array.from({ length: count }, (_, i) => ({
        number: startNumber + i,
        colStart: firstColumn + i * daysPerIteration,
        colSpan: daysPerIteration,
    }));
}

// --- columns -> pixels -------------------------------------------------------
// The single place where a grid column becomes a coordinate. Every row uses
// these, so no row can invent its own offset again.

export function xOfColumn({ startX, shapeWidth, padding }, colStart) {
    return startX + colStart * (shapeWidth + padding);
}

export function widthOfColumns({ shapeWidth, padding }, colSpan) {
    return shapeWidth * colSpan + (colSpan - 1) * padding;
}

/** The centre-to-centre distance between two neighbouring columns. */
export function pitchOf({ shapeWidth, padding }) {
    return shapeWidth + padding;
}

/**
 * Whether `column` falls inside a drawn window.
 *
 * `range` is anything shaped like `{ firstColumn, columns }` - the drawn
 * window, but also, in `spans.js`, a date span turned into the same shape so
 * the two can be tested against each other with this one function instead of
 * a second bounds check.
 */
export function containsColumn({ firstColumn, columns }, column) {
    return column >= firstColumn && column < firstColumn + columns;
}

/**
 * Cuts a full year's blocks down to the drawn window.
 *
 * The row builders above all compute a whole year and know nothing about
 * windows. That is deliberate: teaching each of them to clip would put the same
 * clamping arithmetic in five places, which is exactly what this project keeps
 * out of its row builders. Computing 261 day blocks and dropping half of them
 * costs nothing measurable.
 *
 * Every other field of a block is carried through, because the rows need them:
 * the day row colours by `weekday`, the month row labels by `label`, the week
 * row by `week`. Only colStart and colSpan are recomputed.
 *
 * A side effect worth naming: because the builders still count from the start of
 * the year, iteration numbers keep counting too - a second-half calendar starts
 * at Sprint 14, not at Sprint 1.
 */
export function clipBlocks(blocks, { firstColumn, columns }) {
    const lastColumn = firstColumn + columns - 1;
    const clipped = [];

    for (const block of blocks) {
        const colStart = Math.max(block.colStart, firstColumn);
        const colEnd = Math.min(block.colStart + block.colSpan - 1, lastColumn);

        if (colEnd < colStart) continue;

        clipped.push({ ...block, colStart, colSpan: colEnd - colStart + 1 });
    }

    return clipped;
}

/**
 * Rebuilds the drawing settings from two measured day cells, so a calendar
 * that is already on the board can be addressed by date again.
 *
 * The measured x of a cell is its centre, because app.js creates shapes
 * centred - hence the half-width shift back to the left edge.
 *
 * `startX` is the x that column 0 would have, not the x of the first drawn
 * cell. For a calendar drawn over the whole year those are the same thing,
 * which is why this argument defaults to 0 and nothing else had to change. For
 * a window they are not, and anchoring column 0 is what lets every caller keep
 * asking for an absolute column - holidays, vacation bars and the TODAY
 * indicator all position themselves through xOfColumn and need no idea that a
 * window exists.
 *
 * Returns null when the measurement cannot describe a grid. That is the case
 * once a single cell has been dragged out of the calendar: the derived pitch
 * then describes nothing real, and putting something plausible-looking in the
 * wrong place is worse than putting nothing anywhere.
 */
export function gridFrom({ firstCenterX, lastCenterX, cellWidth, columns, firstColumn = 0 }) {
    if (!(cellWidth > 0) || !(columns > 1)) return null;

    const pitch = (lastCenterX - firstCenterX) / (columns - 1);
    const padding = pitch - cellWidth;

    if (!(pitch > 0) || padding < 0 || padding > cellWidth) return null;

    return {
        startX: firstCenterX - cellWidth / 2 - firstColumn * pitch,
        shapeWidth: cellWidth,
        padding,
    };
}

export function quarterBlocks(year, qOneStartMonth) {
    const startMonths = [qOneStartMonth];
    for (let q = 1; q <= 3; q++) {
        startMonths.push(q * 3 + qOneStartMonth);
    }

    const quarters = [];
    if (qOneStartMonth > 0) {
        quarters.push({
            label: `Q4/${year - 1}`,
            workingDays: workingDaysBetweenMonths(year, 0, qOneStartMonth),
        });
    }

    startMonths.forEach((startMonth, index) => {
        const nextStartMonth = index + 1 < startMonths.length ? startMonths[index + 1] : 12;
        quarters.push({
            label: `Q${index + 1}/${year}`,
            workingDays: workingDaysBetweenMonths(year, startMonth, nextStartMonth),
        });
    });

    let colStart = 0;
    return quarters.map((quarter, index) => {
        const block = { label: quarter.label, index, colStart, colSpan: quarter.workingDays };
        colStart += quarter.workingDays;
        return block;
    });
}

// --- the drawn range ----------------------------------------------------------

/**
 * The one place a drawn range is made, and the only shape of range there is.
 *
 * `year` travels inside the object because every consumer needs it for
 * columnOf, and a year passed separately from its bounds is a pair that can
 * drift. `from` and `to` come back moved onto working days, which makes the
 * result idempotent: feeding a stored range back in yields the same object, so
 * measure() can resolve what tagCalendar wrote without a second rule.
 *
 * Returns null rather than something plausible when the input cannot describe a
 * grid - fewer than two columns has no pitch for gridFrom to measure, and a
 * one-day calendar is not a calendar. Same choice gridFrom itself makes.
 */
export function rangeFrom({ year, from, to }) {
    const yearStart = dayjs(`${year}-01-01`);
    const yearEnd = dayjs(`${year}-12-31`);

    let start = dayjs(from);
    let end = dayjs(to);

    if (!start.isValid() || !end.isValid()) return null;

    // Clamped, not refused: a stored range predating a year change, or a
    // half-open input, still describes a drawable window once cut to the year.
    if (start.isBefore(yearStart, 'day')) start = yearStart;
    if (end.isAfter(yearEnd, 'day')) end = yearEnd;

    start = nextWorkingDay(start);
    end = previousWorkingDay(end);

    if (end.isBefore(start, 'day')) return null;

    const firstColumn = columnOf(year, start);
    const columns = columnOf(year, end) - firstColumn + 1;

    if (columns < 2) return null;

    return {
        year,
        from: start.format('YYYY-MM-DD'),
        to: end.format('YYYY-MM-DD'),
        firstColumn,
        columns,
    };
}

/** What a calendar entry without a stored range means. */
export function fullYearRange(year) {
    return rangeFrom({
        year,
        from: firstWorkingDayOf(year).format('YYYY-MM-DD'),
        to: lastWorkingDayOf(year).format('YYYY-MM-DD'),
    });
}

/**
 * How a range is named to the user - in calendar dropdowns and in the note an
 * import leaves for an entry it could not place.
 */
export function describeRange({ year, from, to }) {
    const wholeYear = dayjs(from).isSame(firstWorkingDayOf(year), 'day')
        && dayjs(to).isSame(lastWorkingDayOf(year), 'day');

    if (wholeYear) return String(year);

    return `${year} (${dayjs(from).format('MMM')}-${dayjs(to).format('MMM')})`;
}
