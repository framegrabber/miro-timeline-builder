import test from 'node:test';
import assert from 'node:assert/strict';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import { parseVacations, planVacations, yearsIn } from '../src/vacation.js';
import { columnOf, totalWorkingDays } from '../src/calendar.js';

dayjs.extend(isoWeek);

// The shape SAPVac/sapvac.js produces.
function entry(employeeName, vacationStartDate, vacationEndDate, extra = {}) {
    return { employeeName, vacationStartDate, vacationEndDate, vacationPeriod: `${vacationStartDate} - ${vacationEndDate}`, ...extra };
}

test('parseVacations rejects input that is not a list of entries', () => {
    assert.deepEqual(parseVacations('not json').entries, []);
    assert.match(parseVacations('not json').problems[0], /JSON/);
    assert.match(parseVacations('{"a":1}').problems[0], /list/);
});

test('parseVacations reports the entries it cannot use, and keeps the rest', () => {
    const text = JSON.stringify([
        entry('Meyer, Anna', '2026-03-02', '2026-03-06'),
        entry('', '2026-03-02', '2026-03-06'),
        entry('Schmidt, Clara', 'the second of March', '2026-03-06'),
        entry('Ali, Dilan', '2026-03-10', '2026-03-02'),
    ]);

    const { entries, problems } = parseVacations(text);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].employee, 'Meyer, Anna');
    assert.equal(problems.length, 3);
    assert.match(problems[1], /unreadable date/);
    assert.match(problems[2], /end is before the start/);
});

test('a span is counted with the same function that drew the day cells', () => {
    // 2026-03-02 Mon to 2026-03-06 Fri is one full working week.
    const { entries } = parseVacations(JSON.stringify([entry('Meyer, Anna', '2026-03-02', '2026-03-06')]));
    const { rows } = planVacations(entries, 2026);

    assert.equal(rows[0].blocks[0].colStart, columnOf(2026, dayjs('2026-03-02')));
    assert.equal(rows[0].blocks[0].colSpan, 5);
});

test('a span that crosses a weekend does not count the weekend', () => {
    // 2026-03-05 Thu to 2026-03-10 Tue: Thu Fri Mon Tue.
    const { entries } = parseVacations(JSON.stringify([entry('Meyer, Anna', '2026-03-05', '2026-03-10')]));
    assert.equal(planVacations(entries, 2026).rows[0].blocks[0].colSpan, 4);
});

test('a period that starts or ends on a weekend is pulled onto working days', () => {
    // 2026-07-25 Sat to 2026-08-02 Sun really means Mon 07-27 to Fri 07-31.
    const { entries } = parseVacations(JSON.stringify([entry('Meyer, Anna', '2026-07-25', '2026-08-02')]));
    const block = planVacations(entries, 2026).rows[0].blocks[0];

    assert.equal(block.colStart, columnOf(2026, dayjs('2026-07-27')));
    assert.equal(block.colSpan, 5);
});

test('a period lying entirely on a weekend is reported, not drawn', () => {
    const { entries } = parseVacations(JSON.stringify([entry('Meyer, Anna', '2026-07-25', '2026-07-26')]));
    const { rows, problems } = planVacations(entries, 2026);

    assert.equal(rows.length, 0);
    assert.match(problems[0], /no working day/);
});

test('a mismatch against the duration SAP reported is flagged', () => {
    const text = JSON.stringify([entry('Meyer, Anna', '2026-03-02', '2026-03-06', { vacationDuration: 4 })]);
    const { problems } = planVacations(parseVacations(text).entries, 2026);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /SAP reports 4, calculated 5/);
});

test('entries outside the drawn year are skipped and listed', () => {
    const text = JSON.stringify([
        entry('Meyer, Anna', '2026-03-02', '2026-03-06'),
        entry('Meyer, Anna', '2027-03-01', '2027-03-05'),
    ]);
    const { rows, problems } = planVacations(parseVacations(text).entries, 2026);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].blocks.length, 1);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2026/);
});

test('a period crossing the end of the year is clipped, without a duration warning', () => {
    const text = JSON.stringify([entry('Meyer, Anna', '2026-12-28', '2027-01-08', { vacationDuration: 10 })]);
    const { rows, problems } = planVacations(parseVacations(text).entries, 2026);

    const block = rows[0].blocks[0];
    assert.equal(block.colStart + block.colSpan, totalWorkingDays(2026), 'runs to the last column');
    assert.deepEqual(problems, [], 'clipping is not a data error');
});

test('rows are alphabetical and independent of the input order', () => {
    const forwards = [
        entry('Ali, Dilan', '2026-03-02', '2026-03-06'),
        entry('Meyer, Anna', '2026-04-06', '2026-04-10'),
        entry('Ali, Dilan', '2026-05-04', '2026-05-08'),
    ];
    const shuffled = [forwards[2], forwards[0], forwards[1]];

    const plan = (list) => planVacations(parseVacations(JSON.stringify(list)).entries, 2026);

    assert.deepEqual(
        plan(forwards).rows.map((row) => [row.employee, row.index, row.blocks.map((b) => b.colStart)]),
        plan(shuffled).rows.map((row) => [row.employee, row.index, row.blocks.map((b) => b.colStart)])
    );
    assert.deepEqual(plan(forwards).rows.map((row) => row.employee), ['Ali, Dilan', 'Meyer, Anna']);
});

test('blocks tied on colStart still come out in the same order regardless of input order', () => {
    // 2026-07-25 Sat and 2026-07-26 Sun both pull forward to Mon 2026-07-27
    // (nextWorkingDay), so these two periods for the same employee land on the
    // same colStart. Array.sort is stable, so a comparator that only looks at
    // colStart would leave the tie in whatever order the blocks arrived in -
    // silently letting the input order back in through the one place it was
    // supposed to be impossible. colSpan (3 vs 5) must break the tie instead.
    const text = (list) => JSON.stringify(list);
    const shortFirst = [
        entry('Meyer, Anna', '2026-07-25', '2026-07-29'),
        entry('Meyer, Anna', '2026-07-26', '2026-07-31'),
    ];
    const longFirst = [shortFirst[1], shortFirst[0]];

    const plan = (list) => planVacations(parseVacations(text(list)).entries, 2026);

    const blocksOf = (list) => plan(list).rows[0].blocks.map(({ colStart, colSpan }) => ({ colStart, colSpan }));

    assert.deepEqual(blocksOf(shortFirst), [
        { colStart: columnOf(2026, dayjs('2026-07-27')), colSpan: 3 },
        { colStart: columnOf(2026, dayjs('2026-07-27')), colSpan: 5 },
    ]);
    assert.deepEqual(blocksOf(shortFirst), blocksOf(longFirst));
});

test('yearsIn lists the years the data touches', () => {
    const text = JSON.stringify([
        entry('Meyer, Anna', '2026-12-28', '2027-01-08'),
        entry('Ali, Dilan', '2026-03-02', '2026-03-06'),
    ]);
    assert.deepEqual(yearsIn(parseVacations(text).entries), [2026, 2027]);
});
