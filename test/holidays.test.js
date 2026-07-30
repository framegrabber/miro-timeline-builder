import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';

import {
    parseSubdivisions,
    parsePublicHolidays,
    parseSchoolHolidays,
    appliesTo,
    planStickies,
    planBands,
} from '../src/holidays.js';
import { columnOf } from '../src/calendar.js';

dayjs.extend(isoWeek);

const fixture = (name) =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

const PUBLIC = fixture('openholidays-public-de-2026');
const SCHOOL = fixture('openholidays-school-de-2026');
const NAMES = parseSubdivisions(fixture('openholidays-subdivisions-de'));

const BY_AND_HE = ['DE-BY', 'DE-HE'];
const byName = (entries, name) => entries.find((entry) => entry.name === name);
const stickyNamed = (stickies, name) => stickies.find((sticky) => sticky.name === name);

test('parseSubdivisions maps the states and their children by code', () => {
    assert.equal(NAMES.get('DE-BY').name, 'Bayern');
    assert.equal(NAMES.get('DE-BY').shortName, 'BY');
    // Augsburg is a child of Bavaria and only reachable through it.
    assert.equal(NAMES.get('DE-BY-AU').name, 'Augsburg');
});

test('nationwide is the field that decides, not regionalScope', () => {
    // New Year comes back with regionalScope "Regional" and nationwide true.
    // Only German Unity Day carries regionalScope "National". Anything that
    // switches on regionalScope paints New Year as a state holiday.
    const { entries } = parsePublicHolidays(PUBLIC);

    assert.equal(byName(entries, 'Neujahr').nationwide, true);
    assert.deepEqual(byName(entries, 'Neujahr').codes, []);
    assert.equal(byName(entries, 'Allerheiligen').nationwide, false);
});

test('a Local scope is kept as its own flag', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const friedensfest = byName(entries, 'Friedensfest');

    assert.equal(friedensfest.local, true);
    assert.deepEqual(friedensfest.codes, ['DE-BY-AU']);
});

test('parsePublicHolidays drops what it cannot read and names it', () => {
    const { entries, problems } = parsePublicHolidays([
        { startDate: '2026-01-01', name: [{ text: 'Fine' }], nationwide: true },
        { startDate: 'the first of January', name: [{ text: 'Broken' }], nationwide: true },
        { startDate: '2026-01-02', name: [], nationwide: true },
    ]);

    assert.equal(entries.length, 1);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /Broken/);
});

test('appliesTo counts a child subdivision as its parent being hit', () => {
    assert.equal(appliesTo(['DE-BY'], BY_AND_HE), true);
    assert.equal(appliesTo(['DE-BY-AU'], BY_AND_HE), true, 'Augsburg is in Bavaria');
    assert.equal(appliesTo(['DE-SN'], BY_AND_HE), false);
    assert.equal(appliesTo(['DE-B'], BY_AND_HE), false, 'no prefix matching on the plain code');
});

test('only holidays that apply somewhere in the selection are drawn', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, 2026, { selected: BY_AND_HE, names: NAMES });
    const names = stickies.map((sticky) => sticky.name);

    assert.ok(names.includes('Heilige Drei Könige'), 'applies in Bavaria');
    assert.ok(names.includes('Fronleichnam'), 'applies in both');
    assert.ok(!names.includes('Buß- und Bettag'), 'Saxony only');
    assert.ok(!names.includes('Weltkindertag'), 'Thuringia only');
});

test('the subtitle names every state the day applies in, not just the selected ones', () => {
    // Otherwise a selection of "Bavaria only" would forever read "BY" and the
    // line would carry no information at all.
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, 2026, { selected: ['DE-BY'], names: NAMES });

    assert.equal(stickyNamed(stickies, 'Fronleichnam').subtitle, 'BW, BY, HE, NRW, RP und SL');
});

test('a nationwide day has no subtitle', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, 2026, { selected: BY_AND_HE, names: NAMES });

    assert.equal(stickyNamed(stickies, 'Neujahr').subtitle, '');
    assert.equal(stickyNamed(stickies, 'Neujahr').nationwide, true);
});

test('a local day names the place instead of the state', () => {
    const { entries } = parsePublicHolidays([
        {
            startDate: '2026-08-10',
            name: [{ text: 'Friedensfest' }],
            nationwide: false,
            regionalScope: 'Local',
            subdivisions: [{ code: 'DE-BY-AU', shortName: 'BY-AU' }],
        },
    ]);
    const { stickies } = planStickies(entries, 2026, { selected: ['DE-BY'], names: NAMES });

    assert.equal(stickies.length, 1);
    assert.equal(stickies[0].subtitle, 'Augsburg');
    assert.equal(stickies[0].nationwide, false);
});

test('a holiday on a weekend has no column and is reported', () => {
    // In 2026 Bavaria loses five to weekends: All Saints (Sun), Assumption
    // (Sat), Peace Festival (Sat), German Unity Day (Sat) and Boxing Day (Sat).
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies, problems } = planStickies(entries, 2026, {
        selected: BY_AND_HE,
        names: NAMES,
    });

    assert.equal(stickyNamed(stickies, 'Allerheiligen'), undefined);
    assert.ok(problems.some((problem) => /Allerheiligen/.test(problem)));
    assert.ok(problems.some((problem) => /weekend/i.test(problem)));
});

test('a sticky sits on the column columnOf gives its date', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, 2026, { selected: BY_AND_HE, names: NAMES });

    assert.equal(
        stickyNamed(stickies, 'Karfreitag').column,
        columnOf(2026, dayjs('2026-04-03'))
    );
});

test('stickies come out left to right', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, 2026, { selected: BY_AND_HE, names: NAMES });
    const columns = stickies.map((sticky) => sticky.column);

    assert.deepEqual(columns, [...columns].sort((a, b) => a - b));
});

test('school holidays make one row per state, alphabetical', () => {
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, 2026, { selected: BY_AND_HE, names: NAMES });

    assert.deepEqual(rows.map((row) => row.key), ['Bayern', 'Hessen']);
    assert.deepEqual(rows.map((row) => row.index), [0, 1]);
    assert.ok(rows[0].blocks.length >= 5, 'Bavaria has at least five breaks in 2026');
});

test('the band label carries the real dates, not the clipped ones', () => {
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, 2026, { selected: ['DE-HE'], names: NAMES });
    const christmas = rows[0].blocks[0];

    // Hesse's Christmas break runs 2025-12-22 to 2026-01-10: it starts in the
    // previous year, so the block is clipped to column 0 while the label keeps
    // saying when the break actually is.
    assert.equal(christmas.colStart, 0);
    assert.equal(christmas.label, 'Weihnachtsferien Hessen 22.12.25 - 10.01.26');
});

test('a break lying entirely outside the year is dropped and named', () => {
    const { entries } = parseSchoolHolidays([
        {
            startDate: '2025-02-03',
            endDate: '2025-02-07',
            name: [{ text: 'Winterferien' }],
            subdivisions: [{ code: 'DE-BY', shortName: 'BY' }],
        },
    ]);
    const { rows, problems } = planBands(entries, 2026, { selected: ['DE-BY'], names: NAMES });

    assert.deepEqual(rows, []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2026/);
});

test('only the selected states get a band', () => {
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, 2026, { selected: ['DE-HE'], names: NAMES });

    assert.deepEqual(rows.map((row) => row.key), ['Hessen']);
});
