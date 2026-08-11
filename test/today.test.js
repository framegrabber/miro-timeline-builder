import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import {
    columnForToday,
    indicatorY,
    shouldMoveIndicatorY,
    shouldPass,
    anchorY,
    legacyAnchorY,
    MIN_ANCHOR_ROWS,
    connectorState,
    endpointItemId,
} from '../src/indicatorGeometry.js';
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

// --- the anchor's height ------------------------------------------------------

test('with no vacation rows the anchor sits exactly where it always did', () => {
    const bottom = 1000;
    const rowHeight = 100;

    assert.equal(
        anchorY({ bottom, rowHeight, padding: 2, contentRows: 0 }),
        bottom + MIN_ANCHOR_ROWS * rowHeight
    );
    assert.equal(
        anchorY({ bottom, rowHeight, padding: 2, contentRows: 0 }),
        legacyAnchorY({ bottom, rowHeight })
    );
});

test('a missing contentRows counts as none', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const floor = legacyAnchorY({ bottom, rowHeight });

    assert.equal(anchorY({ bottom, rowHeight, padding: 2 }), floor);
    assert.equal(anchorY({ bottom, rowHeight, padding: 2, contentRows: null }), floor);
});

test('content past the floor wins and clears the last row by one row height', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const padding = 2;
    const contentRows = 6;

    // One padding past the lowest bar's bottom edge: anchorY counts padding
    // contentRows + 1 times, while drawRows (src/import.js) puts the last bar's
    // bottom edge one padding higher. The gap is intended - the line is meant
    // to end visibly past the content, not flush with it.
    const contentBottom = bottom + padding + contentRows * (rowHeight + padding);

    assert.equal(
        anchorY({ bottom, rowHeight, padding, contentRows }),
        contentBottom + rowHeight
    );
    assert.ok(anchorY({ bottom, rowHeight, padding, contentRows }) > legacyAnchorY({ bottom, rowHeight }));
});

test('padding is counted once per row, not once in total', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const contentRows = 4;

    const tight = anchorY({ bottom, rowHeight, padding: 0, contentRows });
    const loose = anchorY({ bottom, rowHeight, padding: 10, contentRows });

    // padding appears contentRows + 1 times: once before the first bar and
    // once inside every row's pitch.
    assert.equal(loose - tight, 10 * (contentRows + 1));
});

test('the anchor returns to the floor when the vacation data goes away', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const padding = 2;

    const withData = anchorY({ bottom, rowHeight, padding, contentRows: 12 });
    const afterRemoval = anchorY({ bottom, rowHeight, padding, contentRows: 0 });

    assert.ok(withData > afterRemoval);
    assert.equal(afterRemoval, legacyAnchorY({ bottom, rowHeight }));
});

test('one content row still cannot pull the anchor above the floor', () => {
    // A single row of bars ends well inside the three-row minimum, so the
    // floor has to win - otherwise every existing board with one row would
    // shorten its line.
    const bottom = 1000;
    const rowHeight = 100;

    assert.equal(
        anchorY({ bottom, rowHeight, padding: 2, contentRows: 1 }),
        legacyAnchorY({ bottom, rowHeight })
    );
});

test('the anchor scales with the calendar, like the circle does', () => {
    const small = anchorY({ bottom: 0, rowHeight: 50, padding: 1, contentRows: 5 });
    const large = anchorY({ bottom: 0, rowHeight: 100, padding: 2, contentRows: 5 });

    assert.equal(large, small * 2);
});

// --- the anchor's guard, reusing shouldMoveIndicatorY -------------------------

test('a legacy anchor does not move while there is no vacation data', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const target = anchorY({ bottom, rowHeight, padding: 2, contentRows: 0 });

    // placedAnchorY absent: an indicator drawn before this field existed.
    assert.equal(
        shouldMoveIndicatorY(target, undefined, legacyAnchorY({ bottom, rowHeight }), 0.5),
        false
    );
});

test('a legacy anchor does move once vacation rows exist', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const target = anchorY({ bottom, rowHeight, padding: 2, contentRows: 8 });

    assert.equal(
        shouldMoveIndicatorY(target, undefined, legacyAnchorY({ bottom, rowHeight }), 0.5),
        true
    );
});

test('an anchor dragged by hand is not clawed back while the target is unchanged', () => {
    const bottom = 1000;
    const rowHeight = 100;
    const padding = 2;
    const target = anchorY({ bottom, rowHeight, padding, contentRows: 8 });

    // placedAnchorY is what we wrote; the user has since dragged the anchor
    // 400px further down, which the guard never sees and must not undo.
    assert.equal(shouldMoveIndicatorY(target, target, legacyAnchorY({ bottom, rowHeight }), 0.5), false);
});

// --- the tick's day guard -----------------------------------------------------

test('a pass on a date we have already covered is skipped', () => {
    assert.equal(shouldPass('2026-08-11', '2026-08-11'), false);
});

test('a new date lets the pass through', () => {
    assert.equal(shouldPass('2026-08-12', '2026-08-11'), true);
});

test('the first pass after the board opened always runs', () => {
    assert.equal(shouldPass('2026-08-11', null), true);
    assert.equal(shouldPass('2026-08-11', undefined), true);
});

// --- the connector's endpoints ------------------------------------------------

test('a connector on the circle and the anchor reads as attached', () => {
    const connector = { start: { item: 'circle-1' }, end: { item: 'anchor-1' } };
    assert.equal(connectorState(connector, 'circle-1', 'anchor-1'), 'attached');
});

test('an endpoint handed back as a resolved item still reads as attached', () => {
    // The SDK reference does not pin the endpoint's shape down; an object with
    // an id must not be mistaken for a detached line, or every writing pass
    // would redraw a perfectly healthy connector.
    const connector = { start: { item: { id: 'circle-1' } }, end: { item: { id: 'anchor-1' } } };
    assert.equal(connectorState(connector, 'circle-1', 'anchor-1'), 'attached');
});

test('endpoints pointing elsewhere read as detached', () => {
    assert.equal(
        connectorState({ start: { item: 'circle-1' }, end: { item: 'someone-else' } }, 'circle-1', 'anchor-1'),
        'detached'
    );
    assert.equal(
        connectorState({ start: { item: 'someone-else' }, end: { item: 'anchor-1' } }, 'circle-1', 'anchor-1'),
        'detached'
    );
});

test('one missing endpoint is enough to be unreadable, not detached', () => {
    // The regression this pins: while the check required BOTH ends to be
    // absent, a connector with one readable end was called detached and
    // redrawn, and a hand-detached one with neither end readable was accepted.
    assert.equal(connectorState({ start: { item: 'circle-1' } }, 'circle-1', 'anchor-1'), 'unreadable');
    assert.equal(connectorState({ end: { item: 'anchor-1' } }, 'circle-1', 'anchor-1'), 'unreadable');
    assert.equal(connectorState({}, 'circle-1', 'anchor-1'), 'unreadable');
});

test('an endpoint in no known shape is unreadable', () => {
    assert.equal(connectorState({ start: {}, end: {} }, 'circle-1', 'anchor-1'), 'unreadable');
    assert.equal(
        connectorState({ start: { item: {} }, end: { item: { id: 'anchor-1' } } }, 'circle-1', 'anchor-1'),
        'unreadable'
    );
});

test('no connector at all is gone, which is the one case worth redrawing blind', () => {
    assert.equal(connectorState(null, 'circle-1', 'anchor-1'), 'gone');
    assert.equal(connectorState(undefined, 'circle-1', 'anchor-1'), 'gone');
});

test('endpointItemId reads both shapes and refuses to guess at anything else', () => {
    assert.equal(endpointItemId({ item: 'circle-1' }), 'circle-1');
    assert.equal(endpointItemId({ item: { id: 'circle-1' } }), 'circle-1');
    assert.equal(endpointItemId({ item: null }), null);
    assert.equal(endpointItemId({}), null);
    assert.equal(endpointItemId(undefined), null);
});
