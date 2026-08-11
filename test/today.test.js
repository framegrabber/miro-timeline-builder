import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import { columnForToday, indicatorY, shouldMoveIndicatorY } from '../src/indicatorGeometry.js';
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

// The bug this pins down was live on a real board: the updater calls
// columnForToday with dayjs(), and every other test here passes midnight, so
// nothing caught that the underlying comparison was to the instant rather than
// to the day. From one second past midnight the indicator sat on tomorrow.
test('the indicator does not move with the clock', () => {
    const midnight = columnForToday(2026, dayjs('2026-07-29'));

    for (const time of ['00:00:01', '09:30:00', '14:32:11', '23:59:59']) {
        assert.equal(columnForToday(2026, dayjs(`2026-07-29T${time}`)), midnight, `at ${time}`);
    }
});

// --- indicatorY -----------------------------------------------------------

test('with no holidays the circle sits exactly where it always did', () => {
    // top - rowHeight/2 - diameter/2 was the formula before the holiday block
    // existed. A calendar without holidays must not move by a pixel.
    const y = indicatorY({ top: 1000, rowHeight: 100, diameter: 160, reservedRows: 0 });

    assert.equal(y, 1000 - 50 - 80);
});

test('the circle clears the holiday block', () => {
    const withBlock = indicatorY({ top: 1000, rowHeight: 100, diameter: 160, reservedRows: 5.54 });
    const without = indicatorY({ top: 1000, rowHeight: 100, diameter: 160, reservedRows: 0 });

    assert.equal(without - withBlock, 554);
});

test('a missing reservedRows counts as none', () => {
    assert.equal(
        indicatorY({ top: 0, rowHeight: 100, diameter: 160, reservedRows: undefined }),
        indicatorY({ top: 0, rowHeight: 100, diameter: 160, reservedRows: 0 })
    );
});

// --- reconstructing placedY for indicators from before it existed ----------

test('the reconstructed placedY is what the pre-holiday code wrote', () => {
    // createIndicator used top - rowHeight/2 - diameter/2 before reservedRows
    // existed. An indicator from that era has no placedY, and this is the
    // value that must stand in for it - otherwise the first tick after the
    // upgrade overwrites the user's hand-positioned circle.
    const legacy = indicatorY({ top: 1000, rowHeight: 100, diameter: 160, reservedRows: 0 });

    assert.equal(legacy, 1000 - 50 - 80);
});

test('a legacy indicator does not move while there are no holidays', () => {
    const geometry = { top: 1000, rowHeight: 100, diameter: 160 };
    const wanted = indicatorY({ ...geometry, reservedRows: undefined });
    const legacy = indicatorY({ ...geometry, reservedRows: 0 });

    assert.equal(wanted, legacy, 'no difference means moveIndicator leaves y alone');
});

test('a legacy indicator does move once a holiday block exists', () => {
    const geometry = { top: 1000, rowHeight: 100, diameter: 160 };
    const wanted = indicatorY({ ...geometry, reservedRows: 5.54 });
    const legacy = indicatorY({ ...geometry, reservedRows: 0 });

    assert.notEqual(wanted, legacy);
    assert.ok(wanted < legacy, 'the circle rises above the block');
});

// --- shouldMoveIndicatorY: the extracted moveIndicator decision -------------

test('shouldMoveIndicatorY falls back to legacyY when placedY is absent', () => {
    // No holidays: wanted y equals legacyY, so nothing should move.
    assert.equal(shouldMoveIndicatorY(1000, undefined, 1000, 0.5), false);
    // Holidays present: wanted y differs from legacyY, so it should move.
    assert.equal(shouldMoveIndicatorY(900, undefined, 1000, 0.5), true);
});

test('shouldMoveIndicatorY falls back to legacyY when placedY was cleared to null', () => {
    // removeIndicator sets placedY to null, not undefined - `??` must catch both.
    assert.equal(shouldMoveIndicatorY(1000, null, 1000, 0.5), false);
    assert.equal(shouldMoveIndicatorY(900, null, 1000, 0.5), true);
});

test('shouldMoveIndicatorY compares against placedY, not the reconstruction, once it is recorded', () => {
    // A real placedY of 900 means the last write already accounted for holidays.
    // legacyY (the pre-holiday value) must be ignored once placedY exists.
    assert.equal(shouldMoveIndicatorY(900, 900, 1000, 0.5), false);
    assert.equal(shouldMoveIndicatorY(850, 900, 1000, 0.5), true);
});
