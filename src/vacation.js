import dayjs from 'dayjs';

import { placeSpan, groupIntoRows } from './spans.js';
import { stringToColor } from './colors.js';

/**
 * Turns the JSON that SAPVac/sapvac.js produces into entries we can plan with.
 *
 * A bad entry never aborts the import. It is dropped and named, so the panel
 * can show what did not make it instead of silently drawing less than expected.
 */
export function parseVacations(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return { entries: [], problems: ['That is not valid JSON.'] };
    }

    if (!Array.isArray(raw)) {
        return { entries: [], problems: ['Expected a list of vacation entries.'] };
    }

    const entries = [];
    const problems = [];

    raw.forEach((item, index) => {
        const employee = item?.employeeName;
        const label = item?.vacationPeriod ?? '';
        const where = `Entry ${index + 1}`;

        if (typeof employee !== 'string' || employee === '') {
            problems.push(`${where}: no employeeName.`);
            return;
        }

        const start = dayjs(item?.vacationStartDate);
        // A missing or empty vacationEndDate is treated as a same-day period,
        // not a problem: the scraper always sends both dates, so this only
        // ever happens with a period that starts and ends on the same day.
        const end = item?.vacationEndDate ? dayjs(item.vacationEndDate) : start;

        if (!start.isValid() || !end.isValid()) {
            problems.push(`${where} (${employee}): unreadable date.`);
            return;
        }
        if (end.isBefore(start, 'day')) {
            problems.push(`${where} (${employee}): end is before the start.`);
            return;
        }

        entries.push({
            employee,
            start,
            end,
            label,
            duration: typeof item?.vacationDuration === 'number' ? item.vacationDuration : null,
        });
    });

    return { entries, problems };
}

/** Every calendar year the data touches, ascending. */
export function yearsIn(entries) {
    const years = new Set();
    for (const entry of entries) {
        years.add(entry.start.year());
        years.add(entry.end.year());
    }
    return [...years].sort((a, b) => a - b);
}

/**
 * Places every entry on the grid of one drawn year.
 *
 * The arithmetic lives in spans.js, shared with the school holiday bands. Only
 * the comparison against the duration SAP reported is specific to this caller.
 */
export function planVacations(entries, year) {
    const problems = [];
    const placed = [];

    for (const entry of entries) {
        const where = `${entry.employee} (${entry.label})`;
        const span = placeSpan(year, entry.start, entry.end);

        if (span.problem === 'no-working-day') {
            problems.push(`${where}: contains no working day.`);
            continue;
        }
        if (span.problem === 'outside-year') {
            problems.push(`${where}: is not in ${year}.`);
            continue;
        }

        // Only compare against SAP when nothing was clipped - a period running
        // past New Year is legitimately shorter on this calendar.
        if (!span.clipped && entry.duration !== null && span.colSpan !== entry.duration) {
            problems.push(`${where}: SAP reports ${entry.duration}, calculated ${span.colSpan}.`);
        }

        placed.push({
            key: entry.employee,
            colStart: span.colStart,
            colSpan: span.colSpan,
            label: entry.label,
        });
    }

    const rows = groupIntoRows(placed, { colorOf: stringToColor })
        .map(({ key, index, color, blocks }) => ({ employee: key, index, color, blocks }));

    return { rows, problems };
}
