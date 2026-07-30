import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import { placeSpan, groupIntoRows } from '../src/spans.js';
import { columnOf, totalWorkingDays } from '../src/calendar.js';

dayjs.extend(isoWeek);

const day = (iso) => dayjs(iso);

test('a span inside the year is placed on the columns columnOf gives it', () => {
    // 2026-03-02 Mon to 2026-03-06 Fri is one full working week.
    const placed = placeSpan(2026, day('2026-03-02'), day('2026-03-06'));

    assert.equal(placed.colStart, columnOf(2026, day('2026-03-02')));
    assert.equal(placed.colSpan, 5);
    assert.equal(placed.clipped, false);
});

test('a span starting or ending on a weekend is pulled onto working days', () => {
    // 2026-07-25 Sat to 2026-08-02 Sun really means Mon 07-27 to Fri 07-31.
    const placed = placeSpan(2026, day('2026-07-25'), day('2026-08-02'));

    assert.equal(placed.colStart, columnOf(2026, day('2026-07-27')));
    assert.equal(placed.colSpan, 5);
});

test('a span lying entirely on a weekend has no working day', () => {
    assert.deepEqual(placeSpan(2026, day('2026-07-25'), day('2026-07-26')), {
        problem: 'no-working-day',
    });
});

test('a span in another year is outside, not clipped to nothing', () => {
    assert.deepEqual(placeSpan(2026, day('2027-03-01'), day('2027-03-05')), {
        problem: 'outside-year',
    });
    assert.deepEqual(placeSpan(2026, day('2025-03-03'), day('2025-03-07')), {
        problem: 'outside-year',
    });
});

test('a span crossing into the next year is clipped to the last column', () => {
    const placed = placeSpan(2026, day('2026-12-28'), day('2027-01-08'));

    assert.equal(placed.colStart + placed.colSpan, totalWorkingDays(2026));
    assert.equal(placed.clipped, true);
});

test('a span crossing into the year from the previous one is clipped to column 0', () => {
    // The Christmas school break: 2025-12-22 to 2026-01-10.
    const placed = placeSpan(2026, day('2025-12-22'), day('2026-01-10'));

    assert.equal(placed.colStart, 0);
    assert.equal(placed.clipped, true);
});

test('groupIntoRows makes one row per key, sorted, numbered from zero', () => {
    const rows = groupIntoRows(
        [
            { key: 'Meyer', colStart: 40, colSpan: 5, label: 'b' },
            { key: 'Ali', colStart: 10, colSpan: 5, label: 'a' },
            { key: 'Meyer', colStart: 5, colSpan: 5, label: 'c' },
        ],
        { colorOf: () => '#ffffff' }
    );

    assert.deepEqual(rows.map((row) => [row.key, row.index]), [['Ali', 0], ['Meyer', 1]]);
    assert.deepEqual(rows[1].blocks.map((block) => block.colStart), [5, 40]);
});

test('groupIntoRows breaks colStart ties so the input order cannot leak through', () => {
    // Two blocks pulled onto the same column share a colStart. Array.sort is
    // stable, so a comparator that only looks at colStart would leave the tie
    // in arrival order - exactly what this sort exists to remove.
    const blocks = [
        { key: 'A', colStart: 7, colSpan: 5, label: 'long' },
        { key: 'A', colStart: 7, colSpan: 3, label: 'short' },
    ];
    const forwards = groupIntoRows(blocks, { colorOf: () => '#fff' })[0].blocks;
    const reversed = groupIntoRows([blocks[1], blocks[0]], { colorOf: () => '#fff' })[0].blocks;

    assert.deepEqual(forwards.map((b) => b.colSpan), [3, 5]);
    assert.deepEqual(forwards, reversed);
});

test('groupIntoRows asks colorOf for the key, not for the position', () => {
    const rows = groupIntoRows([{ key: 'Zoe', colStart: 1, colSpan: 1, label: '' }], {
        colorOf: (key) => `#${key}`,
    });

    assert.equal(rows[0].color, '#Zoe');
});
