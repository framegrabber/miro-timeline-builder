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
    offsetOverlapping,
    layoutBlock,
    fitFontSize,
    TEXT_METRICS,
    STICKY_FACTOR,
    STICKY_GAP_FACTOR,
} from '../src/holidays.js';
import { columnOf, fullYearRange } from '../src/calendar.js';

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
    const { stickies } = planStickies(entries, fullYearRange(2026), { selected: BY_AND_HE, names: NAMES });
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
    const { stickies } = planStickies(entries, fullYearRange(2026), { selected: ['DE-BY'], names: NAMES });

    assert.equal(stickyNamed(stickies, 'Fronleichnam').subtitle, 'BW, BY, HE, NRW, RP und SL');
});

test('a nationwide day has no subtitle', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, fullYearRange(2026), { selected: BY_AND_HE, names: NAMES });

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
    const { stickies } = planStickies(entries, fullYearRange(2026), { selected: ['DE-BY'], names: NAMES });

    assert.equal(stickies.length, 1);
    assert.equal(stickies[0].subtitle, 'Augsburg');
    assert.equal(stickies[0].nationwide, false);
});

test('a holiday on a weekend has no column and is reported', () => {
    // In 2026 Bavaria loses five to weekends: All Saints (Sun), Assumption
    // (Sat), Peace Festival (Sat), German Unity Day (Sat) and Boxing Day (Sat).
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies, problems } = planStickies(entries, fullYearRange(2026), {
        selected: BY_AND_HE,
        names: NAMES,
    });

    assert.equal(stickyNamed(stickies, 'Allerheiligen'), undefined);
    assert.ok(problems.some((problem) => /Allerheiligen/.test(problem)));
    assert.ok(problems.some((problem) => /weekend/i.test(problem)));
});

test('a sticky sits on the column columnOf gives its date', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, fullYearRange(2026), { selected: BY_AND_HE, names: NAMES });

    assert.equal(
        stickyNamed(stickies, 'Karfreitag').column,
        columnOf(2026, dayjs('2026-04-03'))
    );
});

test('stickies come out left to right', () => {
    const { entries } = parsePublicHolidays(PUBLIC);
    const { stickies } = planStickies(entries, fullYearRange(2026), { selected: BY_AND_HE, names: NAMES });
    const columns = stickies.map((sticky) => sticky.column);

    assert.deepEqual(columns, [...columns].sort((a, b) => a - b));
});

test('school holidays make one row per state, alphabetical', () => {
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: BY_AND_HE, names: NAMES });

    assert.deepEqual(rows.map((row) => row.key), ['Bayern', 'Hessen']);
    assert.deepEqual(rows.map((row) => row.index), [0, 1]);
    assert.ok(rows[0].blocks.length >= 5, 'Bavaria has at least five breaks in 2026');
});

test('the band label carries the real dates, not the clipped ones', () => {
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: ['DE-HE'], names: NAMES });
    const christmas = rows[0].blocks[0];

    // Hesse's Christmas break runs 2025-12-22 to 2026-01-10: it starts in the
    // previous year, so the block is clipped to column 0 while the label keeps
    // saying when the break actually is.
    //
    // Name and detail are separate because the band draws them as two lines,
    // the name in bold. The state appears here only as its short code - the
    // row carries the full name once, at its start.
    assert.equal(christmas.colStart, 0);
    assert.equal(christmas.label, 'Weihnachtsferien');
    assert.equal(christmas.detail, 'HE 22.12.25 - 10.01.26');
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
    const { rows, problems } = planBands(entries, fullYearRange(2026), { selected: ['DE-BY'], names: NAMES });

    assert.deepEqual(rows, []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /2026/);
});

test('only the selected states get a band', () => {
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: ['DE-HE'], names: NAMES });

    assert.deepEqual(rows.map((row) => row.key), ['Hessen']);
});

// A calendar with 100 px cells and 2 px padding: pitch 102, sticky 200 wide.
const centerXof = (column) => column * 102 + 50;
const STICKY_SIZE = 200;

test('a lone sticky sits over its own column', () => {
    const [only] = offsetOverlapping([{ column: 10 }], { centerXof, stickySize: STICKY_SIZE });

    assert.equal(only.x, centerXof(10));
});

test('stickies far apart are not moved', () => {
    const placed = offsetOverlapping([{ column: 10 }, { column: 60 }], {
        centerXof,
        stickySize: STICKY_SIZE,
    });

    assert.deepEqual(placed.map((sticky) => sticky.x), [centerXof(10), centerXof(60)]);
});

test('neighbouring columns push the later sticky to the right', () => {
    // Good Friday and Easter Monday are adjacent columns - the weekend between
    // them has none. 102 px apart, 250 needed.
    const placed = offsetOverlapping([{ column: 65 }, { column: 66 }], {
        centerXof,
        stickySize: STICKY_SIZE,
    });

    assert.equal(placed[0].x, centerXof(65), 'the first one keeps its column');
    assert.ok(placed[1].x > centerXof(66));
    assert.equal(placed[1].x - placed[0].x, STICKY_SIZE * 1.25);
});

test('three in a row cascade instead of stacking on the second', () => {
    const placed = offsetOverlapping([{ column: 10 }, { column: 11 }, { column: 12 }], {
        centerXof,
        stickySize: STICKY_SIZE,
    });

    assert.equal(placed[2].x - placed[1].x, STICKY_SIZE * 1.25);
    assert.equal(placed[2].x - placed[0].x, STICKY_SIZE * 2.5);
});

test('the placed x never runs backwards', () => {
    const placed = offsetOverlapping(
        [{ column: 1 }, { column: 2 }, { column: 40 }, { column: 41 }],
        { centerXof, stickySize: STICKY_SIZE }
    );
    const xs = placed.map((sticky) => sticky.x);

    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
});

test('nothing drawn reserves nothing', () => {
    const block = layoutBlock({ top: 0, rowHeight: 100, gap: 2, bandCount: 0, stickyCount: 0 });

    assert.equal(block.reservedRows, 0);
    assert.deepEqual(block.bandCenterYs, []);
    assert.equal(block.stickyCenterY, null);
});

test('each band adds exactly one row plus one gap', () => {
    const one = layoutBlock({ top: 0, rowHeight: 100, gap: 2, bandCount: 1, stickyCount: 0 });
    const two = layoutBlock({ top: 0, rowHeight: 100, gap: 2, bandCount: 2, stickyCount: 0 });

    assert.equal(one.reservedRows, 102 / 100);
    assert.equal(two.reservedRows - one.reservedRows, 102 / 100);
});

test('bands stack upward from the calendar, index 0 nearest', () => {
    const { bandCenterYs } = layoutBlock({
        top: 1000,
        rowHeight: 100,
        gap: 2,
        bandCount: 2,
        stickyCount: 0,
    });

    // Band 0: bottom at 1000 - 2, centre half a row above that.
    assert.equal(bandCenterYs[0], 1000 - 2 - 50);
    assert.equal(bandCenterYs[1], 1000 - 4 - 100 - 50);
    assert.ok(bandCenterYs[1] < bandCenterYs[0], 'higher index is further up');
});

test('the sticky row sits above the bands with a visible gap', () => {
    const block = layoutBlock({ top: 1000, rowHeight: 100, gap: 2, bandCount: 2, stickyCount: 3 });
    const bandsTop = 1000 - 2 * (100 + 2);

    assert.equal(block.stickySize, STICKY_FACTOR * 100);
    assert.equal(block.stickyCenterY, bandsTop - STICKY_GAP_FACTOR * 100 - block.stickySize / 2);
    assert.equal(block.reservedRows, (2 * 102 + 1.5 * 100 + 200) / 100);
});

test('with no stickies the block ends at the top band', () => {
    const withStickies = layoutBlock({ top: 0, rowHeight: 100, gap: 2, bandCount: 1, stickyCount: 1 });
    const without = layoutBlock({ top: 0, rowHeight: 100, gap: 2, bandCount: 1, stickyCount: 0 });

    assert.equal(without.reservedRows, 102 / 100);
    assert.ok(withStickies.reservedRows > without.reservedRows);
});

test('stickies with no bands beneath them still reserve their own height', () => {
    // A year past the end of the school-holiday data - public holidays are
    // computed and go on forever, school breaks do not - so this is the shape
    // a 2031 calendar takes, not a hypothetical one.
    const block = layoutBlock({ top: 1000, rowHeight: 100, gap: 2, bandCount: 0, stickyCount: 4 });

    assert.deepEqual(block.bandCenterYs, []);
    assert.equal(block.stickyCenterY, 1000 - STICKY_GAP_FACTOR * 100 - block.stickySize / 2);
    assert.equal(block.reservedRows, (STICKY_GAP_FACTOR * 100 + block.stickySize) / 100);
});

// --- fitFontSize -------------------------------------------------------------

test('a short label in a wide band gets the largest size offered', () => {
    const size = fitFontSize({ width: 3000, height: 100, lines: ['Sommerferien'], max: 33, min: 8 });

    assert.equal(size, 33);
});

test('a long label shrinks rather than overflowing', () => {
    const wide = fitFontSize({ width: 3000, height: 100, lines: ['Sommerferien', 'BY 27.07.26 - 07.09.26'], max: 33, min: 8 });
    const narrow = fitFontSize({ width: 100, height: 100, lines: ['Sommerferien', 'BY 27.07.26 - 07.09.26'], max: 33, min: 8 });

    assert.ok(narrow < wide, `${narrow} should be smaller than ${wide}`);
});

test('whatever comes back actually fits, at every width a band can have', () => {
    // This is the property the whole function exists for. Overflow on a Miro
    // board is silent - the text is cut at the shape's edge with no sign that
    // anything is missing - so a size that does not fit is worse than a size
    // that is too small.
    //
    // The wrap is re-derived here rather than reusing the module's, and it
    // wraps between words: a renderer does not split a word, so a word wider
    // than the line hangs out of the shape. The first version of this test
    // counted characters instead, passed, and a browser then showed four of
    // six one-column bands overflowing anyway.
    const { CHAR_ADVANCE, LINE_HEIGHT, TEXT_INSET } = TEXT_METRICS;

    const rowsNeeded = (line, perLine) => {
        let rows = 1;
        let used = 0;
        for (const word of line.split(' ')) {
            const needed = used === 0 ? word.length : used + 1 + word.length;
            if (needed <= perLine) used = needed;
            else { rows++; used = word.length; }
        }
        return rows;
    };

    for (const lines of [
        ['Zusätzlicher Ferientag', 'MV 15.05.26 - 15.05.26'],
        ['Unterrichtsfreier Tag', 'BE 15.05.26 - 15.05.26'],
        ['Sommerferien', 'BW 30.07.26 - 12.09.26'],
    ]) {
        for (const columns of [1, 2, 3, 5, 10, 20, 40]) {
            const width = columns * 102;
            const size = fitFontSize({ width, height: 100, lines, max: 33, min: 8 });

            const usableWidth = width * (1 - 2 * TEXT_INSET);
            const perLine = Math.floor(usableWidth / (size * CHAR_ADVANCE));
            const longestWord = Math.max(...lines.flatMap((l) => l.split(' ')).map((w) => w.length));

            // The minimum is a floor we accept clipping below, so only sizes
            // above it are held to the promise.
            if (size <= 8) continue;

            assert.ok(
                longestWord <= perLine,
                `${lines[0]} @ ${columns} col: "${longestWord} chars" does not fit ${perLine} per line at ${size}px`
            );

            const rows = lines.reduce((n, line) => n + rowsNeeded(line, perLine), 0);
            assert.ok(
                rows * size * LINE_HEIGHT <= 100 * (1 - 2 * TEXT_INSET),
                `${lines[0]} @ ${columns} col: ${size}px wraps to ${rows} lines and overflows`
            );
        }
    }
});

test('an impossible label gets the minimum rather than nothing', () => {
    const size = fitFontSize({ width: 20, height: 20, lines: ['x'.repeat(400)], max: 33, min: 8 });

    assert.equal(size, 8);
});

test('the size scales with the calendar, not with fixed pixels', () => {
    const lines = ['Pfingstferien', 'BY 26.05.26 - 05.06.26'];
    const small = fitFontSize({ width: 500, height: 100, lines, max: 33, min: 8 });
    const large = fitFontSize({ width: 1000, height: 200, lines, max: 66, min: 16 });

    assert.ok(large > small, `${large} should exceed ${small} on a calendar drawn twice the size`);
});

test('a word wider than the band decides the size, not the total length', () => {
    // "Unterrichtsfreier" is seventeen characters and does not wrap - a
    // renderer breaks lines between words, not inside them, so a word that
    // does not fit hangs out of the shape. Two labels of the same total
    // length must therefore get different sizes when one of them has a long
    // word in it.
    const short = fitFontSize({ width: 100, height: 100, lines: ['ab cd ef gh ij kl'], max: 33, min: 8 });
    const long = fitFontSize({ width: 100, height: 100, lines: ['Unterrichtsfreier'], max: 33, min: 8 });

    assert.ok(long < short, `${long} should be smaller than ${short}`);
});

test('wrapping happens between words, so a line is never split mid-word', () => {
    // Character-count wrapping would fit 'Pfingstferien' (13) into a 14-wide
    // line together with the next word's first character. Word wrapping does
    // not, and the extra row it needs is what the height check has to see.
    const size = fitFontSize({
        width: 100,
        height: 100,
        lines: ['Pfingstferien', 'BE 26.05.26 - 26.05.26'],
        max: 33,
        min: 8,
    });
    const perLine = Math.floor((100 * 0.8) / (size * 0.5));

    assert.ok(perLine >= 'Pfingstferien'.length, `at ${size}px only ${perLine} chars fit per line`);
});

test('a one-day break says its date once, not twice', () => {
    const { entries } = parseSchoolHolidays([{
        startDate: '2026-05-15', endDate: '2026-05-15',
        name: [{ text: 'Variabler Ferientag' }],
        subdivisions: [{ code: 'DE-BB', shortName: 'BB' }],
    }]);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: ['DE-BB'], names: NAMES });

    assert.equal(rows[0].blocks[0].detail, 'BB 15.05.');
});

test('the year is dropped for a break inside one year', () => {
    const { entries } = parseSchoolHolidays([{
        startDate: '2026-05-26', endDate: '2026-06-05',
        name: [{ text: 'Pfingstferien' }],
        subdivisions: [{ code: 'DE-BY', shortName: 'BY' }],
    }]);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: ['DE-BY'], names: NAMES });

    // The calendar is a single year, so the year on a band repeats what the
    // drawing already is.
    assert.equal(rows[0].blocks[0].detail, 'BY 26.05. - 05.06.');
});

test('the year survives on a break that crosses New Year', () => {
    // 22.12. - 10.01. would not say which end is which. These are the
    // Christmas breaks, eleven to twenty-one days, so the band has the room.
    const { entries } = parseSchoolHolidays(SCHOOL);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: ['DE-HE'], names: NAMES });

    assert.equal(rows[0].blocks[0].detail, 'HE 22.12.25 - 10.01.26');
});

test('the separator keeps its spaces so no unbreakable token forms', () => {
    // "15.05.-29.05." would be one thirteen-character word, and a word wider
    // than the line hangs out of the shape instead of wrapping - worse on a
    // one-column band than the longer string it replaced.
    const { entries } = parseSchoolHolidays([{
        startDate: '2026-05-15', endDate: '2026-05-29',
        name: [{ text: 'Pfingstferien' }],
        subdivisions: [{ code: 'DE-BY', shortName: 'BY' }],
    }]);
    const { rows } = planBands(entries, fullYearRange(2026), { selected: ['DE-BY'], names: NAMES });
    const longestWord = Math.max(...rows[0].blocks[0].detail.split(' ').map((w) => w.length));

    assert.ok(longestWord <= 6, `longest word is "${longestWord}" characters`);
});
