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
            // Exact match only, unlike appliesTo above: a school holiday is
            // always state-level, so a child-coded entry (there is no such
            // thing today - see the module comment) would have no sensible
            // band row to live in. Resolving it would need a parent lookup
            // and would produce an "Augsburg" row for a state-wide break,
            // which is worse than the alternative. This deliberately
            // disagrees with appliesTo's rule above, in the same file;
            // written down here so the disagreement is a choice, not a bug.
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
                // Split in two, because the band draws them differently: the
                // name in bold on its own line, the rest normal below it.
                //
                // The state is named by its short code here, not spelled out,
                // and the row carries the full name once at its start. Twenty
                // of the 120 bands a full selection produces are one or two
                // columns wide, and "Zusätzlicher Ferientag
                // Mecklenburg-Vorpommern 15.05.26 - 15.05.26" is 65 characters
                // in a box the width of one day - no font size makes that
                // readable. The code still appears on every band so a band is
                // attributable when the row's own label has scrolled out of
                // sight, which on a year-wide calendar is most of the time.
                label: entry.name,
                // The real dates, not the clipped ones: a break that starts in
                // December of the previous year still says so on the board.
                detail: `${names.get(code)?.shortName ?? code} ${entry.start.format(DATE_FORMAT)} - ${entry.end.format(DATE_FORMAT)}`,
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

// How far a character advances, as a fraction of the font size. Measured in a
// browser against the real labels in Open Sans:
//
//   0.458  normal weight, letters      ("Unterrichtsfreier")
//   0.495  normal weight, digits       ("26.05.26")
//   0.497  bold                        ("Pfingstferien")
//
// The name line is bold and the detail line is mostly digits, so the worst
// case is right at 0.5. Set to 0.55 for a tenth of headroom, because Miro's
// own inset and line spacing are not knowable from here and overflow on a
// board is silent - the text is cut at the shape's edge with nothing to show
// that anything is missing. The error has to fall on the side of text that is
// smaller than it needed to be.
const CHAR_ADVANCE = 0.55;

// Miro's own line spacing, near enough.
const LINE_HEIGHT = 1.3;

// Miro insets text from the shape's edges. Reserving a tenth on each side
// keeps the last line off the border.
const TEXT_INSET = 0.1;

/**
 * Exported so the test can check that a returned size really fits without
 * copying these numbers, and so the one place to correct them if a board shows
 * otherwise is here.
 */
export const TEXT_METRICS = { CHAR_ADVANCE, LINE_HEIGHT, TEXT_INSET };

/**
 * The largest font size at which `lines` still fit inside `width` x `height`.
 *
 * Miro shapes have one `fontSize` for the whole shape and no auto-fit, so a
 * size that is right for a six-week summer break is wrong for a one-day one -
 * and the band for a one-day break is one column wide. The old fixed
 * `rowHeight / 2.5` showed nine characters of a sixty-five character label and
 * clipped the rest, which is what this exists to stop.
 *
 * Overflow is invisible on a Miro board: the text is simply cut off at the
 * shape's edge with no indication that anything is missing. So this errs
 * downwards, and when even `min` does not fit it returns `min` anyway - small
 * and complete beats large and truncated.
 */
export function fitFontSize({ width, height, lines, max, min }) {
    const usableWidth = width * (1 - 2 * TEXT_INSET);
    const usableHeight = height * (1 - 2 * TEXT_INSET);
    const words = lines.flatMap((line) => line.split(/\s+/).filter(Boolean));
    const longestWord = Math.max(0, ...words.map((word) => word.length));

    for (let size = Math.floor(max); size > min; size--) {
        const perLine = Math.max(1, Math.floor(usableWidth / (size * CHAR_ADVANCE)));

        // A word wider than the line does not wrap, it hangs out of the shape.
        // "Unterrichtsfreier" is seventeen characters, and in a one-column band
        // it is what decides the size - not the label's total length. Getting
        // this wrong is how the first attempt still overflowed four of the six
        // narrowest bands while its own arithmetic said they fit.
        if (longestWord > perLine) continue;

        const wrapped = lines.reduce((rows, line) => rows + wrapCount(line, perLine), 0);

        if (wrapped * size * LINE_HEIGHT <= usableHeight) return size;
    }

    return Math.round(min);
}

/** Greedy word wrap, the way a renderer does it - not length / perLine. */
function wrapCount(line, perLine) {
    let rows = 1;
    let used = 0;

    for (const word of line.split(/\s+/).filter(Boolean)) {
        const needed = used === 0 ? word.length : used + 1 + word.length;

        if (needed <= perLine) {
            used = needed;
        } else {
            rows++;
            used = word.length;
        }
    }

    return rows;
}
