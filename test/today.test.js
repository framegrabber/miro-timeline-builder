import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import { columnForToday } from '../src/today.js';
import { totalWorkingDays } from '../src/calendar.js';

dayjs.extend(isoWeek);

test('the first and last working day own the first and last column', () => {
    // 2026-01-01 is a Thursday and 2026-12-31 is a Thursday, so both are
    // working days and the year is not clipped at either end.
    assert.equal(columnForToday(2026, dayjs('2026-01-01')), 0);
    assert.equal(columnForToday(2026, dayjs('2026-12-31')), totalWorkingDays(2026) - 1);
});

test('a weekend points at the coming Monday', () => {
    // 2026-07-24 Fri, 07-25 Sat, 07-26 Sun, 07-27 Mon
    const monday = columnForToday(2026, dayjs('2026-07-27'));

    assert.equal(columnForToday(2026, dayjs('2026-07-25')), monday, 'Saturday');
    assert.equal(columnForToday(2026, dayjs('2026-07-26')), monday, 'Sunday');
    assert.equal(columnForToday(2026, dayjs('2026-07-24')), monday - 1, 'Friday keeps its own column');
});

test('there is no column outside the drawn year', () => {
    assert.equal(columnForToday(2026, dayjs('2025-12-31')), null, 'before');
    assert.equal(columnForToday(2026, dayjs('2027-01-01')), null, 'after');
});

test('a leap day has a column of its own', () => {
    // 2024-02-29 is a Thursday.
    const leapDay = columnForToday(2024, dayjs('2024-02-29'));
    assert.equal(typeof leapDay, 'number');
    assert.equal(columnForToday(2024, dayjs('2024-03-01')), leapDay + 1,
        'the Friday after it is the next column');
});
