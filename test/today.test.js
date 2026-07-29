import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import { columnForToday } from '../src/todayColumn.js';
import { totalWorkingDays, firstWorkingDayOf, lastWorkingDayOf } from '../src/calendar.js';

dayjs.extend(isoWeek);

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

// --- the column contract -------------------------------------------------------

test('the first and last working day own the first and last column', () => {
    // 2026-01-01 is a Thursday and 2026-12-31 is a Thursday, so both are
    // working days and the year is not clipped at either end.
    assert.equal(columnForToday(2026, dayjs('2026-01-01')), 0);
    assert.equal(columnForToday(2026, dayjs('2026-12-31')), totalWorkingDays(2026) - 1);
});

test('a weekend points at the coming Monday', () => {
    // 2026-07-24 Fri, 07-25 Sat, 07-26 Sun, 07-27 Mon
    // Compute the expected column independently by walking the year.
    const monday = dayjs('2026-07-27');
    const expectedMondayColumn = expectedColumn(2026, monday);
    const saturday = dayjs('2026-07-25');
    const expectedSaturdayColumn = expectedColumn(2026, saturday);
    const sunday = dayjs('2026-07-26');
    const expectedSundayColumn = expectedColumn(2026, sunday);
    const friday = dayjs('2026-07-24');
    const expectedFridayColumn = expectedColumn(2026, friday);

    assert.equal(columnForToday(2026, saturday), expectedMondayColumn, 'Saturday');
    assert.equal(columnForToday(2026, sunday), expectedMondayColumn, 'Sunday');
    assert.equal(columnForToday(2026, monday), expectedMondayColumn, 'Monday');
    assert.equal(columnForToday(2026, friday), expectedFridayColumn, 'Friday keeps its own column');
});

test('there is no column outside the drawn year', () => {
    assert.equal(columnForToday(2026, dayjs('2025-12-31')), null, 'before');
    assert.equal(columnForToday(2026, dayjs('2027-01-01')), null, 'after');
});

test('a leap day has a column of its own', () => {
    // 2024-02-29 is a Thursday.
    const leapDay = dayjs('2024-02-29');
    const expectedLeapDayColumn = expectedColumn(2024, leapDay);

    assert.equal(columnForToday(2024, leapDay), expectedLeapDayColumn);
    assert.equal(columnForToday(2024, dayjs('2024-03-01')), expectedLeapDayColumn + 1,
        'the Friday after it is the next column');
});

test('a weekend inside the year after the last working day returns null', () => {
    // 2022-12-31 is a Saturday; last working day is 2022-12-30 (Friday).
    // The coming Monday (2023-01-02) is outside the year, so the answer is null.
    const expectedFridayColumn = expectedColumn(2022, dayjs('2022-12-30'));
    assert.equal(columnForToday(2022, dayjs('2022-12-30')), expectedFridayColumn);
    assert.equal(columnForToday(2022, dayjs('2022-12-31')), null, 'Saturday after year end');
});

test('a Sunday inside the year after the last working day returns null', () => {
    // 2023-12-31 is a Sunday; 2023-12-30 is Saturday (not a working day);
    // last working day is 2023-12-29 (Friday).
    // The coming Monday (2024-01-01) is outside the year, so the answer is null.
    const expectedFridayColumn = expectedColumn(2023, dayjs('2023-12-29'));
    assert.equal(columnForToday(2023, dayjs('2023-12-29')), expectedFridayColumn);
    assert.equal(columnForToday(2023, dayjs('2023-12-31')), null, 'Sunday after year end');
});

test('a Sunday trailing 2028 returns null while Friday returns the last column', () => {
    // 2028-12-31 is a Sunday; 2028-12-30 is Saturday (not a working day);
    // last working day is 2028-12-29 (Friday).
    // The coming Monday (2029-01-01) is outside the year, so the answer is null.
    const expectedFridayColumn = expectedColumn(2028, dayjs('2028-12-29'));
    assert.equal(columnForToday(2028, dayjs('2028-12-29')), expectedFridayColumn);
    assert.equal(columnForToday(2028, dayjs('2028-12-31')), null, 'Sunday after year end');
});
