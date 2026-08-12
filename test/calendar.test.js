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
    clipBlocks,
    rangeFrom,
    fullYearRange,
    describeRange,
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

// --- time of day must not shift a column -------------------------------------

// Every other test in this file hands columnOf a midnight dayjs, which is why
// none of them caught this: dayjs compares instants unless told otherwise, the
// loop variable sits at midnight, and so any date carrying a clock time counted
// its own day and came out one column too far right. The TODAY indicator passes
// dayjs() and sat on tomorrow's column from 00:00:01 onwards.
test('columnOf counts days, not milliseconds', () => {
    for (const year of YEARS) {
        const midnight = dayjs(`${year}-07-15`);

        for (const time of ['00:00:01', '09:30:00', '14:32:11', '23:59:59']) {
            assert.equal(
                columnOf(year, dayjs(`${year}-07-15T${time}`)),
                columnOf(year, midnight),
                `${year} at ${time}`
            );
        }
    }
});

test('the time of day does not shift a column before the year either', () => {
    // The negative branch has its own loop and its own comparison.
    assert.equal(
        columnOf(2026, dayjs('2025-12-30T14:32:11')),
        columnOf(2026, dayjs('2025-12-30'))
    );
    assert.equal(columnOf(2026, dayjs('2025-12-31T23:59:59')), -1, 'the last working day before the year');
});

// --- clipping a full year down to a window ------------------------------------

const WINDOW = { firstColumn: 10, columns: 5 }; // columns 10..14

test('a block fully inside the window is untouched', () => {
    const blocks = [{ label: 'inside', colStart: 11, colSpan: 3, extra: 'kept' }];
    assert.deepEqual(clipBlocks(blocks, WINDOW), [
        { label: 'inside', colStart: 11, colSpan: 3, extra: 'kept' },
    ]);
});

test('a block fully outside the window is dropped', () => {
    const blocks = [
        { label: 'left', colStart: 0, colSpan: 5 },
        { label: 'right', colStart: 15, colSpan: 5 },
    ];
    assert.deepEqual(clipBlocks(blocks, WINDOW), []);
});

test('a block straddling the left edge is cut on the left', () => {
    const blocks = [{ label: 'straddle', colStart: 8, colSpan: 5 }]; // 8..12
    assert.deepEqual(clipBlocks(blocks, WINDOW), [
        { label: 'straddle', colStart: 10, colSpan: 3 }, // 10..12
    ]);
});

test('a block straddling the right edge is cut on the right', () => {
    const blocks = [{ label: 'straddle', colStart: 13, colSpan: 6 }]; // 13..18
    assert.deepEqual(clipBlocks(blocks, WINDOW), [
        { label: 'straddle', colStart: 13, colSpan: 2 }, // 13..14
    ]);
});

test('a block covering the whole window becomes the window', () => {
    const blocks = [{ label: 'over', colStart: 0, colSpan: 100 }];
    assert.deepEqual(clipBlocks(blocks, WINDOW), [
        { label: 'over', colStart: 10, colSpan: 5 },
    ]);
});

test('a block ending exactly on the first column survives with one column', () => {
    const blocks = [{ label: 'touch', colStart: 6, colSpan: 5 }]; // 6..10
    assert.deepEqual(clipBlocks(blocks, WINDOW), [
        { label: 'touch', colStart: 10, colSpan: 1 },
    ]);
});

test('the day row is filtered, since every day block is one column wide', () => {
    const clipped = clipBlocks(dayBlocks(2026), WINDOW);

    assert.equal(clipped.length, 5);
    assert.equal(clipped[0].colStart, 10);
    assert.equal(clipped[4].colStart, 14);
    // The weekday travels with the block: the day row's colours depend on it.
    assert.equal(clipped[0].weekday, dayBlocks(2026)[10].weekday);
});

test('a clipped month row covers every column of the window exactly once', () => {
    const window = { firstColumn: 130, columns: 60 };
    const clipped = clipBlocks(monthBlocks(2026), window);
    const covered = clipped.reduce((sum, block) => sum + block.colSpan, 0);

    assert.equal(covered, window.columns);
    assert.equal(clipped[0].colStart, window.firstColumn);
    const last = clipped[clipped.length - 1];
    assert.equal(last.colStart + last.colSpan - 1, window.firstColumn + window.columns - 1);
});

test('a window spanning the whole year changes nothing', () => {
    const whole = { firstColumn: 0, columns: totalWorkingDays(2026) };

    assert.deepEqual(clipBlocks(monthBlocks(2026), whole), monthBlocks(2026));
    assert.deepEqual(clipBlocks(dayBlocks(2026), whole), dayBlocks(2026));
});

// --- the drawn range ----------------------------------------------------------

test('January to December is the whole year', () => {
    const range = rangeFrom({ year: 2026, from: '2026-01-01', to: '2026-12-31' });

    assert.equal(range.year, 2026);
    assert.equal(range.firstColumn, 0);
    assert.equal(range.columns, totalWorkingDays(2026));
});

test('fullYearRange is that range', () => {
    assert.deepEqual(fullYearRange(2026), rangeFrom({
        year: 2026,
        from: '2026-01-01',
        to: '2026-12-31',
    }));
});

test('the second half of 2026 counted independently', () => {
    const range = rangeFrom({ year: 2026, from: '2026-07-01', to: '2026-12-31' });

    // Walk the year by hand rather than reusing the implementation's maths.
    let before = 0;
    let inside = 0;
    for (let d = dayjs('2026-01-01'); d.year() === 2026; d = d.add(1, 'day')) {
        if (d.isoWeekday() > 5) continue;
        if (d.isBefore(dayjs('2026-07-01'), 'day')) before++;
        else inside++;
    }

    assert.equal(range.firstColumn, before);
    assert.equal(range.columns, inside);
    assert.equal(range.firstColumn + range.columns, totalWorkingDays(2026));
});

test('a range starting on a weekend moves forward to the Monday', () => {
    // 2026-08-01 is a Saturday, 2026-08-03 the Monday after it.
    const range = rangeFrom({ year: 2026, from: '2026-08-01', to: '2026-08-31' });

    assert.equal(range.from, '2026-08-03');
    assert.equal(range.firstColumn, columnOf(2026, dayjs('2026-08-03')));
});

test('a range ending on a weekend moves back to the Friday', () => {
    // 2026-05-31 is a Sunday, 2026-05-29 the Friday before it.
    const range = rangeFrom({ year: 2026, from: '2026-05-01', to: '2026-05-31' });

    assert.equal(range.to, '2026-05-29');
});

test('rangeFrom is idempotent, so a stored range resolves to itself', () => {
    const once = rangeFrom({ year: 2026, from: '2026-08-01', to: '2026-10-31' });
    const twice = rangeFrom({ year: 2026, from: once.from, to: once.to });

    assert.deepEqual(twice, once);
});

test('dates outside the year are clamped to it', () => {
    const range = rangeFrom({ year: 2026, from: '2025-06-01', to: '2027-06-30' });

    assert.deepEqual(range, fullYearRange(2026));
});

test('a range that cannot be a grid is refused', () => {
    assert.equal(rangeFrom({ year: 2026, from: '2026-09-01', to: '2026-03-31' }), null, 'to before from');
    assert.equal(rangeFrom({ year: 2026, from: '2026-03-02', to: '2026-03-02' }), null, 'a single column has no pitch');
    assert.equal(rangeFrom({ year: 2026, from: '2026-07-25', to: '2026-07-26' }), null, 'a weekend holds no working day');
    assert.equal(rangeFrom({ year: 2026, from: 'not a date', to: '2026-12-31' }), null, 'unreadable from');
    assert.equal(rangeFrom({ year: 2026, from: '2026-01-01', to: '' }), null, 'missing to');
});

test('describeRange names a whole year by its year alone', () => {
    assert.equal(describeRange(fullYearRange(2026)), '2026');
});

test('describeRange names a window by its months', () => {
    assert.equal(
        describeRange(rangeFrom({ year: 2026, from: '2026-07-01', to: '2026-12-31' })),
        '2026 (Jul-Dec)'
    );
    assert.equal(
        describeRange(rangeFrom({ year: 2026, from: '2026-04-01', to: '2026-06-30' })),
        '2026 (Apr-Jun)'
    );
});
