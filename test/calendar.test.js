import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import {
    firstWorkingDayOf,
    columnOf,
    totalWorkingDays,
    dayBlocks,
    monthBlocks,
    weekBlocks,
    iterationBlocks,
    quarterBlocks,
    xOfColumn,
    widthOfColumns,
    nextWorkingDay,
    previousWorkingDay,
    gridFrom,
} from '../src/calendar.js';

dayjs.extend(isoWeek);

// Years 2018-2032 cover every weekday Jan 1st can fall on, including the
// Fri/Sat/Sun cases where Jan 1st belongs to the previous ISO year.
const YEARS = Array.from({ length: 15 }, (_, i) => 2018 + i);

// --- independent ground truth, derived by walking the calendar ---------------

function workingDatesOf(year) {
    const dates = [];
    let d = dayjs(`${year}-01-01`);
    const end = dayjs(`${year}-12-31`);
    while (d.isBefore(end) || d.isSame(end, 'day')) {
        if (d.isoWeekday() <= 5) dates.push(d);
        d = d.add(1, 'day');
    }
    return dates;
}

function mondaysOf(year) {
    const days = workingDatesOf(year);
    const first = days[0];
    const last = days[days.length - 1];
    const mondays = [];
    let m = first.subtract(first.isoWeekday() - 1, 'day');
    while (m.isBefore(last) || m.isSame(last, 'day')) {
        mondays.push(m);
        m = m.add(7, 'day');
    }
    return mondays;
}

// Signed working-day distance from the first working day of the year.
function expectedColumn(year, date) {
    const first = firstWorkingDayOf(year);
    let n = 0;
    if (date.isBefore(first)) {
        for (let c = date; c.isBefore(first); c = c.add(1, 'day')) {
            if (c.isoWeekday() <= 5) n--;
        }
        return n;
    }
    for (let c = first; c.isBefore(date); c = c.add(1, 'day')) {
        if (c.isoWeekday() <= 5) n++;
    }
    return n;
}

// --- the grid contract -------------------------------------------------------

test('column 0 is the first working day of the year', () => {
    for (const year of YEARS) {
        const first = workingDatesOf(year)[0];
        assert.equal(
            firstWorkingDayOf(year).format('YYYY-MM-DD'),
            first.format('YYYY-MM-DD'),
            `${year}`
        );
        assert.equal(columnOf(year, first), 0, `${year}`);
    }
});

test('columnOf counts working days and goes negative before the year starts', () => {
    for (const year of YEARS) {
        for (const m of mondaysOf(year).slice(0, 3)) {
            assert.equal(columnOf(year, m), expectedColumn(year, m), `${year} ${m.format('YYYY-MM-DD')}`);
        }
    }
});

test('day blocks fill columns 0..N-1 with no gaps', () => {
    for (const year of YEARS) {
        const days = dayBlocks(year);
        const expected = workingDatesOf(year);
        assert.equal(days.length, expected.length, `${year} day count`);
        assert.equal(totalWorkingDays(year), expected.length, `${year} total`);
        days.forEach((block, i) => {
            assert.equal(block.colStart, i, `${year} day ${i} column`);
            assert.equal(block.colSpan, 1, `${year} day ${i} span`);
        });
    }
});

test('month blocks tile the grid exactly', () => {
    for (const year of YEARS) {
        const months = monthBlocks(year);
        assert.equal(months.length, 12, `${year}`);
        let cursor = 0;
        for (const m of months) {
            assert.equal(m.colStart, cursor, `${year} ${m.label} start`);
            cursor += m.colSpan;
        }
        assert.equal(cursor, totalWorkingDays(year), `${year} months must end where days end`);
    }
});

// --- week row ----------------------------------------------------------------
// Regression: for 2021/2027 (Jan 1 = Fri) the numeric `for (week = firstWeek;
// week <= lastWeek; ...)` loop drew ZERO weeks, and for 2022/2023/2028
// (Jan 1 = Sat/Sun) it drew exactly one.

test('one week block per ISO week that contains a working day of the year', () => {
    for (const year of YEARS) {
        const weeks = weekBlocks(year);
        const mondays = mondaysOf(year);
        assert.equal(weeks.length, mondays.length, `${year} week count`);
        assert.ok(weeks.length >= 52, `${year} drew only ${weeks.length} weeks`);
        weeks.forEach((w, i) => {
            assert.equal(w.week, mondays[i].isoWeek(), `${year} week number at index ${i}`);
        });
    }
});

test('week blocks sit on their own Monday column and span 5 days', () => {
    for (const year of YEARS) {
        const mondays = mondaysOf(year);
        weekBlocks(year).forEach((w, i) => {
            assert.equal(w.colStart, expectedColumn(year, mondays[i]), `${year} week ${w.week} column`);
            assert.equal(w.colSpan, 5, `${year} week ${w.week} span`);
        });
    }
});

test('week row starts at column 0 when Jan 1 falls on a weekend', () => {
    for (const year of YEARS) {
        const jan1 = dayjs(`${year}-01-01`).isoWeekday();
        if (jan1 <= 5) continue;
        assert.equal(weekBlocks(year)[0].colStart, 0, `${year} (Jan 1 is a weekend)`);
    }
});

// --- iteration row -----------------------------------------------------------
// Agreed semantics: iteration 1 begins on the first matching weekday on or
// after the first working day of the year, shifted by weekOffset whole weeks.
// It never starts left of column 0.

const ITERATION_DEFAULTS = { weekdayIndex: 2, weekOffset: 0, daysPerIteration: 10, startNumber: 1 };

test('iteration 1 starts on the first matching weekday of the year', () => {
    for (const year of YEARS) {
        for (let weekdayIndex = 0; weekdayIndex <= 4; weekdayIndex++) {
            let d = firstWorkingDayOf(year);
            while (d.isoWeekday() !== weekdayIndex + 1) d = d.add(1, 'day');

            const first = iterationBlocks(year, { ...ITERATION_DEFAULTS, weekdayIndex })[0];
            assert.equal(
                first.colStart,
                expectedColumn(year, d),
                `${year} weekday ${weekdayIndex}: expected ${d.format('ddd DD MMM')}`
            );
        }
    }
});

test('iterations never start before the calendar does', () => {
    for (const year of YEARS) {
        for (let weekdayIndex = 0; weekdayIndex <= 4; weekdayIndex++) {
            const blocks = iterationBlocks(year, { ...ITERATION_DEFAULTS, weekdayIndex });
            assert.ok(blocks[0].colStart >= 0, `${year} weekday ${weekdayIndex} starts at ${blocks[0].colStart}`);
            assert.ok(blocks[0].colStart <= 4, `${year} weekday ${weekdayIndex} starts a full week late`);
        }
    }
});

test('weekOffset shifts the first iteration by whole weeks', () => {
    for (const year of YEARS) {
        const base = iterationBlocks(year, ITERATION_DEFAULTS)[0].colStart;
        for (const weekOffset of [1, 3]) {
            const shifted = iterationBlocks(year, { ...ITERATION_DEFAULTS, weekOffset })[0].colStart;
            assert.equal(shifted, base + weekOffset * 5, `${year} offset ${weekOffset}`);
        }
    }
});

test('iterations are contiguous and cover the rest of the year', () => {
    for (const year of YEARS) {
        const blocks = iterationBlocks(year, ITERATION_DEFAULTS);
        blocks.forEach((b, i) => {
            assert.equal(b.colSpan, ITERATION_DEFAULTS.daysPerIteration, `${year} iteration ${i} span`);
            if (i > 0) {
                assert.equal(b.colStart, blocks[i - 1].colStart + blocks[i - 1].colSpan, `${year} gap before ${i}`);
            }
        });

        const last = blocks[blocks.length - 1];
        const end = totalWorkingDays(year);
        assert.ok(last.colStart + last.colSpan >= end, `${year} iterations stop short of the year end`);
        assert.ok(last.colStart < end, `${year} an entire iteration sits past the year end`);
    }
});

test('iteration labels start at the configured number', () => {
    const blocks = iterationBlocks(2023, { ...ITERATION_DEFAULTS, startNumber: 7 });
    assert.equal(blocks[0].number, 7);
    assert.equal(blocks[1].number, 8);
});

// --- columns -> pixels -------------------------------------------------------

const GEOMETRY = { startX: 1500.5, shapeWidth: 24, padding: 3 };

test('adjacent blocks touch with exactly one padding between them', () => {
    for (const span of [1, 5, 10]) {
        const left = xOfColumn(GEOMETRY, 0);
        const right = xOfColumn(GEOMETRY, span);
        assert.equal(right - (left + widthOfColumns(GEOMETRY, span)), GEOMETRY.padding, `span ${span}`);
    }
});

test('a block of N columns is as wide as N single-day blocks', () => {
    const single = widthOfColumns(GEOMETRY, 1);
    assert.equal(single, GEOMETRY.shapeWidth);
    assert.equal(widthOfColumns(GEOMETRY, 5), 5 * single + 4 * GEOMETRY.padding);
});

test('every row lands on a real day column across all years', () => {
    for (const year of YEARS) {
        const dayXs = new Set(dayBlocks(year).map((d) => xOfColumn(GEOMETRY, d.colStart)));
        const gridLeft = xOfColumn(GEOMETRY, 0);

        const rows = [
            ['month', monthBlocks(year)],
            ['week', weekBlocks(year)],
            ['iteration', iterationBlocks(year, ITERATION_DEFAULTS)],
            ['quarter', quarterBlocks(year, 1)],
        ];

        for (const [name, blocks] of rows) {
            for (const block of blocks) {
                const x = xOfColumn(GEOMETRY, block.colStart);
                if (x < gridLeft) continue; // week blocks may overhang into the previous year
                assert.ok(dayXs.has(x), `${year} ${name} block at x=${x} is off-column`);
            }
        }
    }
});

test('months and quarters end exactly where the day row ends', () => {
    for (const year of YEARS) {
        const days = dayBlocks(year);
        const last = days[days.length - 1];
        const gridRight = xOfColumn(GEOMETRY, last.colStart) + widthOfColumns(GEOMETRY, last.colSpan);

        for (const [name, blocks] of [['months', monthBlocks(year)], ['quarters', quarterBlocks(year, 1)]]) {
            const end = blocks[blocks.length - 1];
            assert.equal(
                xOfColumn(GEOMETRY, end.colStart) + widthOfColumns(GEOMETRY, end.colSpan),
                gridRight,
                `${year} ${name}`
            );
        }
    }
});

// --- working day stepping ----------------------------------------------------

test('nextWorkingDay and previousWorkingDay step off weekends', () => {
    // 2026-07-24 Fri, 07-25 Sat, 07-26 Sun, 07-27 Mon
    const saturday = dayjs('2026-07-25');
    assert.equal(nextWorkingDay(saturday).format('YYYY-MM-DD'), '2026-07-27');
    assert.equal(previousWorkingDay(saturday).format('YYYY-MM-DD'), '2026-07-24');

    const sunday = dayjs('2026-07-26');
    assert.equal(nextWorkingDay(sunday).format('YYYY-MM-DD'), '2026-07-27');
    assert.equal(previousWorkingDay(sunday).format('YYYY-MM-DD'), '2026-07-24');

    const monday = dayjs('2026-07-27');
    assert.equal(nextWorkingDay(monday).format('YYYY-MM-DD'), '2026-07-27',
        'a working day is its own next working day');
    assert.equal(previousWorkingDay(monday).format('YYYY-MM-DD'), '2026-07-27');
});

// --- rebuilding the grid from the board --------------------------------------

// What the board reports back. Shapes are created centred - app.js passes
// `x + width / 2` to createShape - so a measured x is the centre of the cell,
// not the left edge that xOfColumn works with.
function measure(settings, columns) {
    return {
        firstCenterX: xOfColumn(settings, 0) + settings.shapeWidth / 2,
        lastCenterX: xOfColumn(settings, columns - 1) + settings.shapeWidth / 2,
        cellWidth: settings.shapeWidth,
        columns,
    };
}

const DRAW_SETTINGS = [
    { startX: 0, shapeWidth: 100, padding: 2 },
    { startX: -1234.5, shapeWidth: 40, padding: 0 },
    { startX: 980, shapeWidth: 250, padding: 12 },
];

test('gridFrom rebuilds the settings the calendar was drawn with', () => {
    for (const year of YEARS) {
        const columns = totalWorkingDays(year);

        for (const settings of DRAW_SETTINGS) {
            const grid = gridFrom(measure(settings, columns));
            assert.ok(grid, `${year} / width ${settings.shapeWidth}`);

            for (let column = 0; column < columns; column++) {
                assert.ok(
                    Math.abs(xOfColumn(grid, column) - xOfColumn(settings, column)) < 1e-6,
                    `${year} column ${column}: ${xOfColumn(grid, column)} != ${xOfColumn(settings, column)}`
                );
                assert.ok(
                    Math.abs(widthOfColumns(grid, 5) - widthOfColumns(settings, 5)) < 1e-6,
                    `${year} span width`
                );
            }
        }
    }
});

test('gridFrom survives a calendar that was moved and scaled', () => {
    const drawn = { startX: 100, shapeWidth: 100, padding: 2 };
    const columns = totalWorkingDays(2026);
    const measured = measure(drawn, columns);

    // Dragging the group shifts every coordinate; scaling multiplies them.
    const moved = { ...measured, firstCenterX: measured.firstCenterX + 5000, lastCenterX: measured.lastCenterX + 5000 };
    assert.equal(gridFrom(moved).shapeWidth, 100);
    assert.ok(Math.abs(gridFrom(moved).padding - 2) < 1e-6);

    const scaled = {
        firstCenterX: measured.firstCenterX * 2,
        lastCenterX: measured.lastCenterX * 2,
        cellWidth: measured.cellWidth * 2,
        columns,
    };
    assert.equal(gridFrom(scaled).shapeWidth, 200);
    assert.ok(Math.abs(gridFrom(scaled).padding - 4) < 1e-6);
});

test('gridFrom refuses measurements that cannot describe a grid', () => {
    const sane = measure({ startX: 0, shapeWidth: 100, padding: 2 }, 261);

    assert.equal(gridFrom({ ...sane, cellWidth: 0 }), null, 'no cell width');
    assert.equal(gridFrom({ ...sane, columns: 1 }), null, 'a single column has no pitch');
    assert.equal(gridFrom({ ...sane, lastCenterX: sane.firstCenterX }), null, 'both anchors in one spot');
    assert.equal(gridFrom({ ...sane, lastCenterX: sane.firstCenterX - 1000 }), null, 'anchors swapped');

    // Someone dragged the last day cell far out of the calendar: the derived
    // pitch then describes nothing real, and a plausible-looking wrong answer
    // is worse than no answer.
    assert.equal(gridFrom({ ...sane, lastCenterX: sane.firstCenterX + 261 * 500 }), null, 'pitch far beyond one cell');
});
