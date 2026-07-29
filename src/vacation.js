import dayjs from 'dayjs';

import {
    columnOf,
    nextWorkingDay,
    previousWorkingDay,
    totalWorkingDays,
} from './calendar.js';
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
 * The span is columnOf(end) - columnOf(start) + 1, both from the same tested
 * function that positioned the day cells. There is no second day count that
 * could drift from the first - which is the whole reason this moved out of
 * SAPVac/drawshapes.js, where the same off-by-one came back three times.
 */
export function planVacations(entries, year) {
    const columns = totalWorkingDays(year);
    const problems = [];
    const placed = [];

    for (const entry of entries) {
        const where = `${entry.employee} (${entry.label})`;

        // A period reported as Sat-Sun means the working days inside it.
        const start = nextWorkingDay(entry.start);
        const end = previousWorkingDay(entry.end);

        if (end.isBefore(start, 'day')) {
            problems.push(`${where}: contains no working day.`);
            continue;
        }

        const rawStart = columnOf(year, start);
        const rawEnd = columnOf(year, end);

        if (rawEnd < 0 || rawStart > columns - 1) {
            problems.push(`${where}: is not in ${year}.`);
            continue;
        }

        const colStart = Math.max(0, rawStart);
        const colEnd = Math.min(columns - 1, rawEnd);
        const colSpan = colEnd - colStart + 1;

        // Only compare against SAP when nothing was clipped - a period running
        // past New Year is legitimately shorter on this calendar.
        const clipped = rawStart < colStart || rawEnd > colEnd;
        if (!clipped && entry.duration !== null && colSpan !== entry.duration) {
            problems.push(`${where}: SAP reports ${entry.duration}, calculated ${colSpan}.`);
        }

        placed.push({ employee: entry.employee, colStart, colSpan, label: entry.label });
    }

    const employees = [...new Set(placed.map((item) => item.employee))].sort();
    const rows = employees.map((employee, index) => ({
        employee,
        index,
        color: stringToColor(employee),
        // colStart alone is not a total order: two periods pulled onto the
        // same Monday by nextWorkingDay share a colStart, and Array.sort is
        // stable, so ties would fall back to input order - exactly what this
        // sort exists to remove. colSpan and then label break every tie that
        // colStart cannot; once all three agree the blocks are identical in
        // content, so no order is observable.
        blocks: placed
            .filter((item) => item.employee === employee)
            .map(({ colStart, colSpan, label }) => ({ colStart, colSpan, label }))
            .sort((a, b) => a.colStart - b.colStart || a.colSpan - b.colSpan || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    }));

    return { rows, problems };
}
