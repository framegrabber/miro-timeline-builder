import dayjs from 'dayjs';

import { placeSpan, groupIntoRows } from './spans.js';
import { columnOf, isWorkingDay } from './calendar.js';
import { stringToColor } from './colors.js';

/**
 * Turns OpenHolidays responses into the column space the calendar is drawn in.
 *
 * Nothing here touches the board or the network. The two shapes it produces:
 *
 *   sticky = { column, name, subtitle, nationwide }   one working day
 *   band   = a row per federal state, blocks inside   a date range
 */

// The API reports North Rhine-Westphalia as "NW", which is the ISO 3166-2
// suffix. Every German reader writes NRW. One override rather than a
// translation table, because this is the only one that differs.
const SHORT_NAME_OVERRIDES = { 'DE-NW': 'NRW' };

const DATE_FORMAT = 'DD.MM.YY';

function textOf(names) {
    return names?.[0]?.text ?? '';
}

function codesOf(raw) {
    return (raw?.subdivisions ?? []).map((subdivision) => subdivision.code).filter(Boolean);
}

/** Every subdivision and every child, by code. Bavaria's child is Augsburg. */
export function parseSubdivisions(raw) {
    const names = new Map();

    const add = (subdivision) => {
        if (!subdivision?.code) return;
        names.set(subdivision.code, {
            name: textOf(subdivision.name),
            shortName: SHORT_NAME_OVERRIDES[subdivision.code] ?? subdivision.shortName ?? subdivision.code,
        });
        for (const child of subdivision.children ?? []) add(child);
    };

    for (const subdivision of raw ?? []) add(subdivision);
    return names;
}

export function parsePublicHolidays(raw) {
    const entries = [];
    const problems = [];

    for (const [index, item] of (raw ?? []).entries()) {
        const name = textOf(item?.name);
        const where = name || `Entry ${index + 1}`;
        const date = dayjs(item?.startDate);

        if (!name) {
            problems.push(`Entry ${index + 1}: no name.`);
            continue;
        }
        if (!date.isValid()) {
            problems.push(`${where}: unreadable date.`);
            continue;
        }

        entries.push({
            date,
            name,
            // nationwide is the field that decides. regionalScope says
            // "Regional" even for New Year; only German Unity Day is
            // "National". Switching on regionalScope paints New Year as a
            // state holiday.
            nationwide: item.nationwide === true,
            // regionalScope is still needed, but for one thing only: "Local"
            // marks a city holiday. Augsburg's Peace Festival comes back with
            // a Bavaria query but applies in DE-BY-AU alone.
            local: item.regionalScope === 'Local',
            codes: codesOf(item),
        });
    }

    return { entries, problems };
}

export function parseSchoolHolidays(raw) {
    const entries = [];
    const problems = [];

    for (const [index, item] of (raw ?? []).entries()) {
        const name = textOf(item?.name);
        const where = name || `Entry ${index + 1}`;
        const start = dayjs(item?.startDate);
        const end = dayjs(item?.endDate);

        if (!name) {
            problems.push(`Entry ${index + 1}: no name.`);
            continue;
        }
        if (!start.isValid() || !end.isValid()) {
            problems.push(`${where}: unreadable date.`);
            continue;
        }

        entries.push({ start, end, name, codes: codesOf(item) });
    }

    return { entries, problems };
}

/**
 * Whether any of `codes` falls inside the selection.
 *
 * A child counts as its parent being hit: selecting Bavaria selects Augsburg
 * too, which is what makes the Peace Festival appear. The separator in the
 * prefix test is deliberate - without it "DE-B" would match "DE-BY".
 */
export function appliesTo(codes, selected) {
    return codes.some((code) =>
        selected.some((pick) => code === pick || code.startsWith(`${pick}-`))
    );
}

/** German list: "A, B und C". */
function joinGerman(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

function subtitleFor(entry, names) {
    if (entry.nationwide) return '';

    const labels = entry.codes
        .map((code) => {
            const known = names.get(code);
            if (!known) return code;
            // A city holiday says where it is; a state holiday says which
            // states, and does so for all of them, including ones the user did
            // not select - otherwise a "Bavaria only" selection would forever
            // read "BY" and the line would carry no information.
            return entry.local ? known.name : known.shortName;
        })
        .sort();

    return joinGerman(labels);
}

export function planStickies(entries, year, { selected, names }) {
    const stickies = [];
    const problems = [];

    for (const entry of entries) {
        if (!entry.nationwide && !appliesTo(entry.codes, selected)) continue;

        if (!isWorkingDay(entry.date)) {
            problems.push(
                `${entry.name} (${entry.date.format(DATE_FORMAT)}): falls on a weekend, no column to mark.`
            );
            continue;
        }

        // The request is already bounded by the year, so this only guards
        // against the API widening a range - but columnOf would happily return
        // a column for a date in another year, and that column belongs to a
        // different day.
        if (entry.date.year() !== year) {
            problems.push(`${entry.name}: is not in ${year}.`);
            continue;
        }

        stickies.push({
            column: columnOf(year, entry.date),
            name: entry.name,
            subtitle: subtitleFor(entry, names),
            nationwide: entry.nationwide,
        });
    }

    stickies.sort((a, b) => a.column - b.column || (a.name < b.name ? -1 : 1));
    return { stickies, problems };
}

export function planBands(entries, year, { selected, names }) {
    const problems = [];
    const placed = [];

    for (const entry of entries) {
        for (const code of entry.codes) {
            if (!selected.includes(code)) continue;

            const state = names.get(code)?.name ?? code;
            const where = `${entry.name} ${state}`;
            const span = placeSpan(year, entry.start, entry.end);

            if (span.problem === 'no-working-day') {
                problems.push(`${where}: contains no working day.`);
                continue;
            }
            if (span.problem === 'outside-year') {
                problems.push(`${where}: is not in ${year}.`);
                continue;
            }

            placed.push({
                key: state,
                colStart: span.colStart,
                colSpan: span.colSpan,
                // The real dates, not the clipped ones: a break that starts in
                // December of the previous year still says so on the board.
                label: `${where} ${entry.start.format(DATE_FORMAT)} - ${entry.end.format(DATE_FORMAT)}`,
            });
        }
    }

    return { rows: groupIntoRows(placed, { colorOf: stringToColor }), problems };
}

// --- layout -----------------------------------------------------------------
// Everything is derived from the calendar's own measured rowHeight and padding.
// No fixed pixel value appears here, for the same reason the TODAY circle
// derives its diameter from rowHeight: the calendar can be drawn at any scale.

/** Sticky edge length, in rowHeights. Miro keeps the square aspect itself. */
export const STICKY_FACTOR = 2;

/** Clear space between the sticky row and the bands - where the line shows. */
export const STICKY_GAP_FACTOR = 1.5;

/** Minimum space between two stickies, as a fraction of their own size. */
export const STICKY_MIN_GAP_FACTOR = 0.25;

/**
 * Slides stickies right until they stop overlapping.
 *
 * Good Friday and Easter Monday sit in neighbouring columns - the weekend
 * between them has none - and a sticky is wider than a column, so a collision
 * happens every single year. The greedy pass keeps the leftmost sticky on its
 * own column and pushes each later one just far enough clear; three in a row
 * cascade. At the end of the year the last sticky can end up past the right
 * edge of the calendar, which is the correct consequence of the rule.
 *
 * The connector then runs diagonally to the day cell, which is what anyone
 * would draw by hand.
 */
export function offsetOverlapping(stickies, { centerXof, stickySize }) {
    const minimumStep = stickySize * (1 + STICKY_MIN_GAP_FACTOR);
    let previousX = -Infinity;

    return stickies.map((sticky) => {
        const x = Math.max(centerXof(sticky.column), previousX + minimumStep);
        previousX = x;
        return { ...sticky, x };
    });
}

/**
 * The vertical block above the calendar.
 *
 * `bandCenterYs` is indexed from the calendar upwards: index 0 is the band
 * touching it. The alphabetically first state goes on top, so a row with
 * `index` i belongs at `bandCenterYs[bandCount - 1 - i]`.
 *
 * `reservedRows` is what today.js reads to put the TODAY circle above all of
 * this. At zero it is the formula the circle already used, so a calendar
 * without holidays does not move by a pixel.
 */
export function layoutBlock({ top, rowHeight, gap, bandCount, stickyCount }) {
    const stickySize = STICKY_FACTOR * rowHeight;

    const bandCenterYs = Array.from(
        { length: bandCount },
        (_, k) => top - (k + 1) * gap - k * rowHeight - rowHeight / 2
    );

    const bandsTop = top - bandCount * (rowHeight + gap);
    const hasStickies = stickyCount > 0;
    const stickyGap = STICKY_GAP_FACTOR * rowHeight;

    const stickyCenterY = hasStickies ? bandsTop - stickyGap - stickySize / 2 : null;
    const blockTop = hasStickies ? bandsTop - stickyGap - stickySize : bandsTop;

    return {
        stickySize,
        bandCenterYs,
        stickyCenterY,
        reservedRows: (top - blockTop) / rowHeight,
    };
}
