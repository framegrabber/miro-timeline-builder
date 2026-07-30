# Feiertage und Schulferien pro Bundesland — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deutsche Feiertage und Schulferien für beliebig viele Bundesländer landen mit einem Klick lagerichtig auf einem gezeichneten Kalender.

**Architecture:** Reine Module rechnen Rohdaten der OpenHolidays API in Spalten und Koordinaten um und sind unter `node --test` vollständig abgedeckt. Board-I/O liegt in eigenen Modulen. Die Tageszelle eines Feiertags wird umgefärbt statt überlagert; adressierbar wird sie über `Shape.groupId` der bereits vorhandenen `firstDay`-Ankerzelle, also ohne neues AppData-Feld und ohne Migration bestehender Kalender.

**Tech Stack:** Vanilla ES modules, Vite 3, dayjs 1.11, Mirotone 5, Miro Web SDK v2, `node:test` + `node:assert/strict`.

**Spec:** [docs/superpowers/specs/2026-07-30-feiertage-und-schulferien-design.md](../specs/2026-07-30-feiertage-und-schulferien-design.md)

## Global Constraints

- **Sprache im Panel: Englisch, durchgehend.** Alle für den Nutzer sichtbaren Strings (Labels, Buttons, Statusmeldungen, Hinweislisten) sind englisch. Code-Kommentare sind englisch. Diese Planungsdokumente sind deutsch.
- **Feiertage nehmen keine Spalte aus dem Raster.** `calendar.js` bleibt unverändert; `columnOf`, `isWorkingDay` und `totalWorkingDays` kennen keine Feiertage.
- **Genau eine Spaltenrechnung.** Jede Umrechnung Datum → Spalte geht durch `columnOf` in `src/calendar.js`. Kein Modul zählt selbst Tage.
- **Jeder Board-Call geht durch `run()`** aus `src/board.js` — auch `getAppData`/`setAppData`, auch `getMetadata`/`setMetadata`. Kein Modul außer `src/board.js` liest `window.miro`.
- **Ratenlimit-Fehler sind kein „ist weg".** Wo ein `getById` oder `remove` fehlschlägt, wird mit `isRateLimitError(error)` unterschieden: bei Ratenlimit bleibt der gespeicherte Zustand stehen und der Durchlauf wird übersprungen; nur ein anderer Fehler bedeutet, dass das Item wirklich fort ist.
- **Reine Module importieren `board.js` nicht.** `src/board.js` liest `window` beim Laden des Moduls; ein Test-Import würde unter Node abstürzen. Alles, was getestet wird, bleibt frei davon.
- **Tests laufen ohne Netz.** Aufgezeichnete API-Antworten liegen als Fixture im Repo.
- **Deutsche Datumsformatierung in Board-Beschriftungen:** `DD.MM.YY`.
- Commit-Nachrichten englisch, ohne Präfix-Zwang, im Stil der vorhandenen Historie (`counts columns by day rather than by instant`).

## Dateien

**Neu, rein:**

| Datei | Verantwortung |
|---|---|
| `src/spans.js` | Datumsspanne → `{colStart, colSpan, clipped}`; Blöcke → Zeilen |
| `src/openHolidays.js` | Der einzige `fetch` im Projekt |
| `src/holidays.js` | Rohantwort → Stickies, Bänder, Layout |

**Neu, mit Board-Zugriff:**

| Datei | Verantwortung |
|---|---|
| `src/dayCells.js` | Kalender-Group auflösen, Tageszeile nach Spalte indizieren |
| `src/holidayDraw.js` | Zeichnen und Zurücknehmen auf dem Board |
| `src/holidayView.js` | Der dritte Tab |

**Neue Tests:** `test/spans.test.js`, `test/holidays.test.js`, `test/openHolidays.test.js`

**Neue Fixtures:** `test/fixtures/openholidays-public-de-2026.json`, `test/fixtures/openholidays-school-de-2026.json`, `test/fixtures/openholidays-subdivisions-de.json`

**Geändert:** `src/vacation.js`, `src/colors.js`, `src/app.js`, `src/anchors.js`, `src/today.js`, `app.html`

---

## Phase 1 — Datenschicht (Tasks 1–4)

Nichts davon berührt das Board. Nach Phase 1 ist die App unverändert benutzbar und kann bedenkenlos deployt werden.

---

### Task 1: `spans.js` — die geteilte Spannen-Rechnung

`planVacations` und die Ferienbänder machen bis auf die SAP-Dauerprüfung dasselbe. Diese Rechnung lag in `SAPVac/drawshapes.js` dreimal daneben; sie darf kein zweites Mal existieren. Die 16 vorhandenen `vacation`-Tests sind das Netz und müssen **unverändert** grün bleiben.

**Files:**
- Create: `src/spans.js`
- Create: `test/spans.test.js`
- Modify: `src/vacation.js` (Zeilen 79–144, `planVacations`)
- Unverändert lassen: `test/vacation.test.js`

**Interfaces:**
- Consumes: `columnOf`, `nextWorkingDay`, `previousWorkingDay`, `totalWorkingDays` aus `src/calendar.js`; `stringToColor` aus `src/colors.js`
- Produces:
  - `placeSpan(year: number, start: Dayjs, end: Dayjs) → {colStart: number, colSpan: number, clipped: boolean} | {problem: 'no-working-day' | 'outside-year'}`
  - `groupIntoRows(placed: Array<{key: string, colStart: number, colSpan: number, label: string}>, options: {colorOf: (key: string) => string}) → Array<{key: string, index: number, color: string, blocks: Array<{colStart, colSpan, label}>}>`

- [x] **Step 1: Write the failing tests**

Create `test/spans.test.js`:

```js
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/spans.js'`

- [x] **Step 3: Write `src/spans.js`**

```js
import { columnOf, nextWorkingDay, previousWorkingDay, totalWorkingDays } from './calendar.js';

/**
 * Places one date span on the grid of one drawn year.
 *
 * The span is columnOf(end) - columnOf(start) + 1, both from the same tested
 * function that positioned the day cells. There is no second day count that
 * could drift from the first - which is the whole reason this exists as one
 * shared function rather than once per caller. The same arithmetic lived a
 * second time in SAPVac/drawshapes.js and produced the same off-by-one three
 * times.
 *
 * Returns either a placement or a single problem, never both.
 */
export function placeSpan(year, start, end) {
    const columns = totalWorkingDays(year);

    // A period reported as Sat-Sun means the working days inside it.
    const from = nextWorkingDay(start);
    const to = previousWorkingDay(end);

    if (to.isBefore(from, 'day')) return { problem: 'no-working-day' };

    const rawStart = columnOf(year, from);
    const rawEnd = columnOf(year, to);

    if (rawEnd < 0 || rawStart > columns - 1) return { problem: 'outside-year' };

    const colStart = Math.max(0, rawStart);
    const colEnd = Math.min(columns - 1, rawEnd);

    return {
        colStart,
        colSpan: colEnd - colStart + 1,
        // A period running past New Year is legitimately shorter on this
        // calendar, and callers that compare against a reported duration need
        // to know not to complain about it.
        clipped: rawStart < colStart || rawEnd > colEnd,
    };
}

/**
 * One row per key, keys ascending, blocks left to right.
 *
 * The rows carry `key` rather than a domain name so vacation rows (per
 * employee) and school holiday rows (per federal state) can share this. The
 * caller renames it if its consumers expect something else.
 */
export function groupIntoRows(placed, { colorOf }) {
    const keys = [...new Set(placed.map((item) => item.key))].sort();

    return keys.map((key, index) => ({
        key,
        index,
        color: colorOf(key),
        // colStart alone is not a total order: two periods pulled onto the
        // same Monday by nextWorkingDay share a colStart, and Array.sort is
        // stable, so ties would fall back to input order - exactly what this
        // sort exists to remove. colSpan and then label break every tie that
        // colStart cannot; once all three agree the blocks are identical in
        // content, so no order is observable.
        blocks: placed
            .filter((item) => item.key === key)
            .map(({ colStart, colSpan, label }) => ({ colStart, colSpan, label }))
            .sort((a, b) =>
                a.colStart - b.colStart ||
                a.colSpan - b.colSpan ||
                (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    }));
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, alle neuen `spans`-Tests grün, alle vorhandenen weiterhin grün.

- [x] **Step 5: Rewire `planVacations` onto the shared functions**

Replace `planVacations` in `src/vacation.js` (currently lines 79–144) with:

```js
/**
 * Places every entry on the grid of one drawn year.
 *
 * The arithmetic lives in spans.js, shared with the school holiday bands. Only
 * the comparison against the duration SAP reported is specific to this caller.
 */
export function planVacations(entries, year) {
    const problems = [];
    const placed = [];

    for (const entry of entries) {
        const where = `${entry.employee} (${entry.label})`;
        const span = placeSpan(year, entry.start, entry.end);

        if (span.problem === 'no-working-day') {
            problems.push(`${where}: contains no working day.`);
            continue;
        }
        if (span.problem === 'outside-year') {
            problems.push(`${where}: is not in ${year}.`);
            continue;
        }

        // Only compare against SAP when nothing was clipped - a period running
        // past New Year is legitimately shorter on this calendar.
        if (!span.clipped && entry.duration !== null && span.colSpan !== entry.duration) {
            problems.push(`${where}: SAP reports ${entry.duration}, calculated ${span.colSpan}.`);
        }

        placed.push({
            key: entry.employee,
            colStart: span.colStart,
            colSpan: span.colSpan,
            label: entry.label,
        });
    }

    const rows = groupIntoRows(placed, { colorOf: stringToColor })
        .map(({ key, index, color, blocks }) => ({ employee: key, index, color, blocks }));

    return { rows, problems };
}
```

Adjust the imports at the top of `src/vacation.js` — `columnOf`, `nextWorkingDay`, `previousWorkingDay` and `totalWorkingDays` are no longer used there:

```js
import dayjs from 'dayjs';

import { placeSpan, groupIntoRows } from './spans.js';
import { stringToColor } from './colors.js';
```

- [x] **Step 6: Run the tests — `test/vacation.test.js` must be untouched and green**

Run: `npm test`
Expected: PASS. Insbesondere alle 12 Tests aus `test/vacation.test.js`, ohne dass eine Zeile darin geändert wurde. `row.employee` bleibt der Feldname, den `src/import.js` liest.

Run: `git diff --stat test/vacation.test.js`
Expected: leere Ausgabe.

- [x] **Step 7: Commit**

```bash
git add src/spans.js test/spans.test.js src/vacation.js
git commit -m "moves the span arithmetic into one shared place"
```

---

### Task 2: `openHolidays.js` — die einzige Netzwerkstelle, plus Fixtures

**Files:**
- Create: `src/openHolidays.js`
- Create: `test/openHolidays.test.js`
- Create: `test/fixtures/openholidays-public-de-2026.json`
- Create: `test/fixtures/openholidays-school-de-2026.json`
- Create: `test/fixtures/openholidays-subdivisions-de.json`

**Interfaces:**
- Consumes: nichts aus früheren Tasks
- Produces:
  - `fetchHolidays(year: number, options?: {fetchFn?: typeof fetch}) → Promise<{publicHolidays: Array<object>, schoolHolidays: Array<object>}>`
  - `fetchSubdivisions(options?: {fetchFn?: typeof fetch}) → Promise<Array<object>>`
  - `BASE_URL: string`

Ein einziger Aufruf **ohne** `subdivisionCode` liefert alle Bundesländer auf einmal; gefiltert wird in `holidays.js`. Das hält die Zahl der Netzwerkaufrufe konstant, egal wie viele Länder ausgewählt sind, und ein Wechsel der Auswahl braucht keinen neuen Abruf.

- [x] **Step 1: Record the fixtures**

```bash
mkdir -p test/fixtures
curl -s -o test/fixtures/openholidays-public-de-2026.json \
  "https://openholidaysapi.org/PublicHolidays?countryIsoCode=DE&languageIsoCode=DE&validFrom=2026-01-01&validTo=2026-12-31"
curl -s -o test/fixtures/openholidays-school-de-2026.json \
  "https://openholidaysapi.org/SchoolHolidays?countryIsoCode=DE&languageIsoCode=DE&validFrom=2026-01-01&validTo=2026-12-31"
curl -s -o test/fixtures/openholidays-subdivisions-de.json \
  "https://openholidaysapi.org/Subdivisions?countryIsoCode=DE&languageIsoCode=DE"
```

Verify:

```bash
node -e "const f=(p)=>JSON.parse(require('fs').readFileSync(p)); \
  console.log('public', f('test/fixtures/openholidays-public-de-2026.json').length); \
  console.log('school', f('test/fixtures/openholidays-school-de-2026.json').length); \
  console.log('subdivisions', f('test/fixtures/openholidays-subdivisions-de.json').length);"
```

Expected: `public 20`, `school 121`, `subdivisions 16`.

Weicht die Zahl ab, ist der Datensatz nachträglich korrigiert worden — genau der Fall, für den die API live abgefragt wird. Die Fixtures dann so übernehmen, wie sie kommen, und in Task 3 die Erwartungen nachziehen; die Tests dort prüfen benannte Einträge, keine Gesamtzahlen.

- [x] **Step 2: Write the failing test**

Create `test/openHolidays.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchHolidays, fetchSubdivisions, BASE_URL } from '../src/openHolidays.js';

function recordingFetch(response) {
    const urls = [];
    const fetchFn = async (url) => {
        urls.push(url);
        return response;
    };
    return { urls, fetchFn };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('one call per kind, for the whole country, bounded by the year', async () => {
    const { urls, fetchFn } = recordingFetch(ok([]));

    await fetchHolidays(2026, { fetchFn });

    assert.equal(urls.length, 2);
    for (const url of urls) {
        assert.ok(url.startsWith(BASE_URL), url);
        assert.match(url, /countryIsoCode=DE/);
        assert.match(url, /languageIsoCode=DE/);
        assert.match(url, /validFrom=2026-01-01/);
        assert.match(url, /validTo=2026-12-31/);
        // Filtering by state happens locally, so the request must not narrow
        // the answer - otherwise changing the selection would need a refetch.
        assert.doesNotMatch(url, /subdivisionCode/);
    }
    assert.match(urls[0], /PublicHolidays/);
    assert.match(urls[1], /SchoolHolidays/);
});

test('both kinds come back under their own name', async () => {
    const fetchFn = async (url) =>
        ok(url.includes('School') ? [{ kind: 'school' }] : [{ kind: 'public' }]);

    const result = await fetchHolidays(2026, { fetchFn });

    assert.deepEqual(result.publicHolidays, [{ kind: 'public' }]);
    assert.deepEqual(result.schoolHolidays, [{ kind: 'school' }]);
});

test('a non-2xx response names the service and the status', async () => {
    const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays.*503/);
});

test('a network failure is passed on as a readable error', async () => {
    const fetchFn = async () => {
        throw new TypeError('Load failed');
    };

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays/);
});

test('a body that is not a list is refused rather than half-used', async () => {
    const fetchFn = async () => ok({ message: 'nope' });

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays/);
});

test('a body that cannot be parsed names the service too', async () => {
    const fetchFn = async () => ({
        ok: true,
        status: 200,
        json: async () => {
            throw new SyntaxError('Unexpected end of JSON input');
        },
    });

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays/);
});

test('subdivisions are fetched without a date range', async () => {
    const { urls, fetchFn } = recordingFetch(ok([]));

    await fetchSubdivisions({ fetchFn });

    assert.equal(urls.length, 1);
    assert.match(urls[0], /Subdivisions\?countryIsoCode=DE/);
    assert.doesNotMatch(urls[0], /validFrom/);
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/openHolidays.js'`

- [x] **Step 4: Write `src/openHolidays.js`**

```js
/**
 * The only place in this project that talks to the network.
 *
 * https://www.openholidaysapi.org/ - no key, CORS open to any origin, so the
 * panel iframe can call it directly. Public holidays are computed and reach
 * arbitrarily far into the future; school holidays are maintained and reached
 * to 2030 when this was written.
 *
 * Every request asks for the whole country and leaves the filtering to
 * holidays.js. That keeps the number of round trips at two no matter how many
 * federal states are selected, and changing the selection needs no refetch.
 */
export const BASE_URL = 'https://openholidaysapi.org';

const COUNTRY = 'DE';
const LANGUAGE = 'DE';

function url(path, params) {
    const query = new URLSearchParams({
        countryIsoCode: COUNTRY,
        languageIsoCode: LANGUAGE,
        ...params,
    });
    return `${BASE_URL}/${path}?${query}`;
}

/**
 * `fetchFn` is injected so the tests never touch the network. Everything that
 * can go wrong here - offline, DNS, a 5xx, a body that is not a list - comes
 * out as one Error whose message names the service, because that message is
 * what the panel shows the user.
 */
async function getList(target, fetchFn) {
    let response;
    try {
        response = await fetchFn(target);
    } catch (error) {
        throw new Error(`OpenHolidays is not reachable: ${error?.message ?? error}`);
    }

    if (!response.ok) {
        throw new Error(`OpenHolidays answered ${response.status}.`);
    }

    let body;
    try {
        body = await response.json();
    } catch (error) {
        throw new Error(`OpenHolidays sent a response that could not be read: ${error?.message ?? error}`);
    }

    if (!Array.isArray(body)) {
        throw new Error('OpenHolidays sent something that is not a list of entries.');
    }
    return body;
}

export async function fetchHolidays(year, { fetchFn = fetch } = {}) {
    const range = { validFrom: `${year}-01-01`, validTo: `${year}-12-31` };

    // Sequential, not parallel: two calls are not worth the concurrency, and a
    // failing first one should not leave a second request in flight against a
    // service that is evidently unwell.
    const publicHolidays = await getList(url('PublicHolidays', range), fetchFn);
    const schoolHolidays = await getList(url('SchoolHolidays', range), fetchFn);

    return { publicHolidays, schoolHolidays };
}

export async function fetchSubdivisions({ fetchFn = fetch } = {}) {
    return getList(url('Subdivisions', {}), fetchFn);
}
```

Das `try` um `response.json()` gehört zum Vertrag aus dem Modul-Kommentar: *jeder* Fehlerpfad kommt als eine benannte `Error` heraus. Ohne es entkäme eine 2xx-Antwort mit kaputtem JSON als roher `SyntaxError` — direkt ins Panel, ungefiltert. Ein Review hat genau das an dieser Stelle gefunden; der Block oben ist bereits die korrigierte Fassung.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/openHolidays.js test/openHolidays.test.js test/fixtures
git commit -m "adds the OpenHolidays client and recorded fixtures"
```

Der Fix für das fehlende `try` um `response.json()` kam als eigener Commit (`0ab97cb names the service when a response body cannot be parsed`), nachdem ein Review die Lücke gefunden hatte.

---

### Task 3: `holidays.js` — parsen, auswählen, planen

**Files:**
- Create: `src/holidays.js`
- Create: `test/holidays.test.js`

**Interfaces:**
- Consumes: `placeSpan`, `groupIntoRows` aus `src/spans.js`; `columnOf`, `isWorkingDay` aus `src/calendar.js`; `stringToColor` aus `src/colors.js`
- Produces:
  - `parseSubdivisions(raw) → Map<string, {name: string, shortName: string}>` — enthält auch Kinder wie `DE-BY-AU`
  - `parsePublicHolidays(raw) → {entries: Array<{date: Dayjs, name: string, nationwide: boolean, local: boolean, codes: string[]}>, problems: string[]}`
  - `parseSchoolHolidays(raw) → {entries: Array<{start: Dayjs, end: Dayjs, name: string, codes: string[]}>, problems: string[]}`
  - `appliesTo(codes: string[], selected: string[]) → boolean`
  - `planStickies(entries, year, {selected, names}) → {stickies: Array<{column: number, name: string, subtitle: string, nationwide: boolean}>, problems: string[]}`
  - `planBands(entries, year, {selected, names}) → {rows: Array<{key, index, color, blocks}>, problems: string[]}`

- [x] **Step 1: Write the failing tests**

Create `test/holidays.test.js`:

```js
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../src/holidays.js'`

- [x] **Step 3: Write `src/holidays.js`**

```js
import dayjs from 'dayjs';

import { placeSpan, groupIntoRows } from './spans.js';
import { columnOf, isWorkingDay } from './calendar.js';
import { stringToColor } from './colors.js';

/**
 * Turns OpenHolidays responses into the column space the calendar is drawn in.
 *
 * Nothing here touches the board or the network. The two shapes it produces:
 *
 *   sticky = { column, name, subtitle, nationwide }   one working day
 *   band   = a row per federal state, blocks inside   a date range
 */

// The API reports North Rhine-Westphalia as "NW", which is the ISO 3166-2
// suffix. Every German reader writes NRW. One override rather than a
// translation table, because this is the only one that differs.
const SHORT_NAME_OVERRIDES = { 'DE-NW': 'NRW' };

const DATE_FORMAT = 'DD.MM.YY';

function textOf(names) {
    return names?.[0]?.text ?? '';
}

function codesOf(raw) {
    return (raw?.subdivisions ?? []).map((subdivision) => subdivision.code).filter(Boolean);
}

/** Every subdivision and every child, by code. Bavaria's child is Augsburg. */
export function parseSubdivisions(raw) {
    const names = new Map();

    const add = (subdivision) => {
        if (!subdivision?.code) return;
        names.set(subdivision.code, {
            name: textOf(subdivision.name),
            shortName: SHORT_NAME_OVERRIDES[subdivision.code] ?? subdivision.shortName ?? subdivision.code,
        });
        for (const child of subdivision.children ?? []) add(child);
    };

    for (const subdivision of raw ?? []) add(subdivision);
    return names;
}

export function parsePublicHolidays(raw) {
    const entries = [];
    const problems = [];

    for (const [index, item] of (raw ?? []).entries()) {
        const name = textOf(item?.name);
        const where = name || `Entry ${index + 1}`;
        const date = dayjs(item?.startDate);

        if (!name) {
            problems.push(`Entry ${index + 1}: no name.`);
            continue;
        }
        if (!date.isValid()) {
            problems.push(`${where}: unreadable date.`);
            continue;
        }

        entries.push({
            date,
            name,
            // nationwide is the field that decides. regionalScope says
            // "Regional" even for New Year; only German Unity Day is
            // "National". Switching on regionalScope paints New Year as a
            // state holiday.
            nationwide: item.nationwide === true,
            // regionalScope is still needed, but for one thing only: "Local"
            // marks a city holiday. Augsburg's Peace Festival comes back with
            // a Bavaria query but applies in DE-BY-AU alone.
            local: item.regionalScope === 'Local',
            codes: codesOf(item),
        });
    }

    return { entries, problems };
}

export function parseSchoolHolidays(raw) {
    const entries = [];
    const problems = [];

    for (const [index, item] of (raw ?? []).entries()) {
        const name = textOf(item?.name);
        const where = name || `Entry ${index + 1}`;
        const start = dayjs(item?.startDate);
        const end = dayjs(item?.endDate);

        if (!name) {
            problems.push(`Entry ${index + 1}: no name.`);
            continue;
        }
        if (!start.isValid() || !end.isValid()) {
            problems.push(`${where}: unreadable date.`);
            continue;
        }

        entries.push({ start, end, name, codes: codesOf(item) });
    }

    return { entries, problems };
}

/**
 * Whether any of `codes` falls inside the selection.
 *
 * A child counts as its parent being hit: selecting Bavaria selects Augsburg
 * too, which is what makes the Peace Festival appear. The separator in the
 * prefix test is deliberate - without it "DE-B" would match "DE-BY".
 */
export function appliesTo(codes, selected) {
    return codes.some((code) =>
        selected.some((pick) => code === pick || code.startsWith(`${pick}-`))
    );
}

/** German list: "A, B und C". */
function joinGerman(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

function subtitleFor(entry, names) {
    if (entry.nationwide) return '';

    const labels = entry.codes
        .map((code) => {
            const known = names.get(code);
            if (!known) return code;
            // A city holiday says where it is; a state holiday says which
            // states, and does so for all of them, including ones the user did
            // not select - otherwise a "Bavaria only" selection would forever
            // read "BY" and the line would carry no information.
            return entry.local ? known.name : known.shortName;
        })
        .sort();

    return joinGerman(labels);
}

export function planStickies(entries, year, { selected, names }) {
    const stickies = [];
    const problems = [];

    for (const entry of entries) {
        if (!entry.nationwide && !appliesTo(entry.codes, selected)) continue;

        if (!isWorkingDay(entry.date)) {
            problems.push(
                `${entry.name} (${entry.date.format(DATE_FORMAT)}): falls on a weekend, no column to mark.`
            );
            continue;
        }

        // The request is already bounded by the year, so this only guards
        // against the API widening a range - but columnOf would happily return
        // a column for a date in another year, and that column belongs to a
        // different day.
        if (entry.date.year() !== year) {
            problems.push(`${entry.name}: is not in ${year}.`);
            continue;
        }

        stickies.push({
            column: columnOf(year, entry.date),
            name: entry.name,
            subtitle: subtitleFor(entry, names),
            nationwide: entry.nationwide,
        });
    }

    stickies.sort((a, b) => a.column - b.column || (a.name < b.name ? -1 : 1));
    return { stickies, problems };
}

export function planBands(entries, year, { selected, names }) {
    const problems = [];
    const placed = [];

    for (const entry of entries) {
        for (const code of entry.codes) {
            if (!selected.includes(code)) continue;

            const state = names.get(code)?.name ?? code;
            const where = `${entry.name} ${state}`;
            const span = placeSpan(year, entry.start, entry.end);

            if (span.problem === 'no-working-day') {
                problems.push(`${where}: contains no working day.`);
                continue;
            }
            if (span.problem === 'outside-year') {
                problems.push(`${where}: is not in ${year}.`);
                continue;
            }

            placed.push({
                key: state,
                colStart: span.colStart,
                colSpan: span.colSpan,
                // The real dates, not the clipped ones: a break that starts in
                // December of the previous year still says so on the board.
                label: `${where} ${entry.start.format(DATE_FORMAT)} - ${entry.end.format(DATE_FORMAT)}`,
            });
        }
    }

    return { rows: groupIntoRows(placed, { colorOf: stringToColor }), problems };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

Schlägt `the subtitle names every state the day applies in` fehl, ist die erwartete Zeichenkette an der Fixture zu prüfen — die API liefert die Kürzel unsortiert (`SL,NW,BW,RP,BY`), der Code sortiert sie. Nach dem NRW-Override und der Sortierung ist Fronleichnam `BW, BY, HE, NRW, RP und SL`.

- [x] **Step 5: Commit**

```bash
git add src/holidays.js test/holidays.test.js
git commit -m "turns holiday data into stickies and bands"
```

---

### Task 4: Layout — Ausweichen und Blockhöhe

**Files:**
- Modify: `src/holidays.js` (anhängen)
- Modify: `test/holidays.test.js` (anhängen)

**Interfaces:**
- Consumes: nichts Neues
- Produces:
  - `STICKY_FACTOR = 2`, `STICKY_GAP_FACTOR = 1.5`, `STICKY_MIN_GAP_FACTOR = 0.25`
  - `offsetOverlapping(stickies, {centerXof, stickySize}) → Array<{...sticky, x: number}>`
  - `layoutBlock({top, rowHeight, gap, bandCount, stickyCount}) → {stickySize: number, bandCenterYs: number[], stickyCenterY: number | null, reservedRows: number}`

`bandCenterYs` ist von unten indiziert: Index 0 ist das Band direkt am Kalender. Alphabetisch erstes Bundesland kommt nach oben, also auf `bandCenterYs[bandCount - 1 - rowIndex]`.

- [x] **Step 1: Write the failing tests**

Append to `test/holidays.test.js`:

```js
import {
    offsetOverlapping,
    layoutBlock,
    STICKY_FACTOR,
    STICKY_GAP_FACTOR,
} from '../src/holidays.js';

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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `The requested module '../src/holidays.js' does not provide an export named 'offsetOverlapping'`

- [x] **Step 3: Append the layout code to `src/holidays.js`**

```js
// --- layout -----------------------------------------------------------------
// Everything is derived from the calendar's own measured rowHeight and padding.
// No fixed pixel value appears here, for the same reason the TODAY circle
// derives its diameter from rowHeight: the calendar can be drawn at any scale.

/** Sticky edge length, in rowHeights. Miro keeps the square aspect itself. */
export const STICKY_FACTOR = 2;

/** Clear space between the sticky row and the bands - where the line shows. */
export const STICKY_GAP_FACTOR = 1.5;

/** Minimum space between two stickies, as a fraction of their own size. */
export const STICKY_MIN_GAP_FACTOR = 0.25;

/**
 * Slides stickies right until they stop overlapping.
 *
 * Good Friday and Easter Monday sit in neighbouring columns - the weekend
 * between them has none - and a sticky is wider than a column, so a collision
 * happens every single year. The greedy pass keeps the leftmost sticky on its
 * own column and pushes each later one just far enough clear; three in a row
 * cascade. At the end of the year the last sticky can end up past the right
 * edge of the calendar, which is the correct consequence of the rule.
 *
 * The connector then runs diagonally to the day cell, which is what anyone
 * would draw by hand.
 */
export function offsetOverlapping(stickies, { centerXof, stickySize }) {
    const minimumStep = stickySize * (1 + STICKY_MIN_GAP_FACTOR);
    let previousX = -Infinity;

    return stickies.map((sticky) => {
        const x = Math.max(centerXof(sticky.column), previousX + minimumStep);
        previousX = x;
        return { ...sticky, x };
    });
}

/**
 * The vertical block above the calendar.
 *
 * `bandCenterYs` is indexed from the calendar upwards: index 0 is the band
 * touching it. The alphabetically first state goes on top, so a row with
 * `index` i belongs at `bandCenterYs[bandCount - 1 - i]`.
 *
 * `reservedRows` is what today.js reads to put the TODAY circle above all of
 * this. At zero it is the formula the circle already used, so a calendar
 * without holidays does not move by a pixel.
 */
export function layoutBlock({ top, rowHeight, gap, bandCount, stickyCount }) {
    const stickySize = STICKY_FACTOR * rowHeight;

    const bandCenterYs = Array.from(
        { length: bandCount },
        (_, k) => top - (k + 1) * gap - k * rowHeight - rowHeight / 2
    );

    const bandsTop = top - bandCount * (rowHeight + gap);
    const hasStickies = stickyCount > 0;
    const stickyGap = STICKY_GAP_FACTOR * rowHeight;

    const stickyCenterY = hasStickies ? bandsTop - stickyGap - stickySize / 2 : null;
    const blockTop = hasStickies ? bandsTop - stickyGap - stickySize : bandsTop;

    return {
        stickySize,
        bandCenterYs,
        stickyCenterY,
        reservedRows: (top - blockTop) / rowHeight,
    };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [x] **Step 5: Prove the tests bite**

Change `Math.max(centerXof(sticky.column), previousX + minimumStep)` to `centerXof(sticky.column)` and run `npm test`.
Expected: FAIL in `neighbouring columns push the later sticky to the right`, `three in a row cascade` — dann rückgängig machen und `npm test` erneut laufen lassen.

- [x] **Step 6: Commit**

```bash
git add src/holidays.js test/holidays.test.js
git commit -m "lays out the holiday block above the calendar"
```

---

## Phase 2 — Adressierbare Tageszellen (Task 5)

Ab hier wird das Board angefasst. Nach Phase 2 ist noch nichts sichtbar, aber die Zellen sind erreichbar.

---

### Task 5: `dayColor` teilen und `dayCells.js`

**Files:**
- Modify: `src/colors.js` (anhängen)
- Modify: `src/app.js` (Zeilen 112–128, `colorMaps` und `getColor`)
- Modify: `src/anchors.js` (Zeilen 180–190, das zurückgegebene Calendar-Objekt)
- Create: `src/dayCells.js`
- Modify: `test/colors.test.js` (anhängen)

**Interfaces:**
- Consumes: `board`, `run`, `isRateLimitError` aus `src/board.js`; `totalWorkingDays` aus `src/calendar.js`
- Produces:
  - `DAY_COLORS: string[]` und `dayColor(weekday: number) → string` aus `src/colors.js`
  - `calendar.groupId: string | undefined` — neu im Rückgabewert von `findCalendars()`
  - `dayCellsOf(calendar) → Promise<{cells: Item[] | null, reason: null | 'ungrouped' | 'rate-limited' | 'incomplete'}>`

- [x] **Step 1: Write the failing test for the shared day colours**

Append to `test/colors.test.js`:

```js
import { DAY_COLORS, dayColor } from '../src/colors.js';

test('dayColor maps the ISO weekday onto the Mon-Fri gradient', () => {
    assert.equal(DAY_COLORS.length, 5);
    assert.equal(dayColor(1), DAY_COLORS[0], 'Monday');
    assert.equal(dayColor(5), DAY_COLORS[4], 'Friday');
});

test('dayColor is what a repainted cell is restored to', () => {
    // The holiday import recomputes the original fill instead of storing it,
    // so this mapping is the only record that a cell's colour ever had.
    for (let weekday = 1; weekday <= 5; weekday++) {
        assert.match(dayColor(weekday), /^#[0-9A-Fa-f]{6}$/);
    }
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `does not provide an export named 'DAY_COLORS'`

- [x] **Step 3: Move the day palette into `src/colors.js`**

Append to `src/colors.js`:

```js
/**
 * The Mon-Fri gradient of the day row, indexed by ISO weekday.
 *
 * It lives here rather than in app.js because it has two readers now: the draw
 * that paints a cell in the first place, and the holiday import, which repaints
 * a cell and later has to put it back. The original colour is recomputed from
 * this table rather than stored anywhere, so this is the only record of what a
 * day cell is supposed to look like.
 */
export const DAY_COLORS = ['#FFE5CC', '#FFD1A3', '#FFBD7A', '#FFA952', '#FF9529'];

export function dayColor(weekday) {
    return DAY_COLORS[weekday - 1];
}
```

`src/app.js` imports nothing from `./colors.js` today. Add the line next to the other imports at the top:

```js
import { dayColor } from './colors.js';
```

Replace lines 112–128 of `src/app.js` with:

```js
const colorMaps = {
  week: ["#8e8be1", "#7e7cc8"],
  month: ["#8ddebd", "#9df7d2"],
  iteration: ["#d37b97", "#ea88a8"],
  quarter: ["#82adc2", "#a0d5ef"]
};

function getColor(number, type) {
    // The day row is keyed by weekday, not by alternating pairs, and it is
    // shared with the holiday import - see colors.js.
    if (type === "day") return dayColor(number);

    const colors = colorMaps[type];
    return number % 2 === 0 ? colors[0] : colors[1];
}
```

`DAY_COLORS` wird in `app.js` nicht gebraucht — nur `dayColor` importieren. Die fünf Hex-Werte stehen danach genau einmal im Projekt, in `colors.js`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [x] **Step 5: Expose `groupId` on the resolved calendar**

In `src/anchors.js`, inside `measure()`, extend the returned calendar object (currently lines 180–190):

```js
    return {
        calendar: {
            entry,
            year: entry.year,
            grid,
            rowHeight: firstDay.height,
            top: topLeft.y - topLeft.height / 2,
            bottom: firstDay.y + firstDay.height / 2,
            // Shape.groupId is readonly and already on the anchor we just
            // fetched, so the whole calendar becomes addressable without a
            // single byte having been written at draw time - and without a
            // migration for calendars drawn before this existed.
            groupId: firstDay.groupId,
        },
        reason: null,
    };
```

Also extend the doc comment of `findCalendars()` — after the `getById itself failed` bullet, add:

```
 * The resolved calendar also carries `groupId`, taken off the firstDay anchor.
 * It is undefined for a calendar whose group was dissolved by hand; callers
 * that need the day cells must handle that (see dayCells.js).
```

- [x] **Step 6: Write `src/dayCells.js`**

```js
import { board, run, isRateLimitError } from './board.js';
import { totalWorkingDays } from './calendar.js';

/**
 * The day cells of one calendar, indexed by grid column.
 *
 * Miro's Shape carries a readonly `groupId`, and anchors.js already fetches the
 * firstDay anchor to measure the grid - so the group is reachable for free. Two
 * calls resolve it, and the day row is picked out by the one thing that
 * distinguishes it: every day cell shares the firstDay anchor's y. Sorted by x,
 * the position in the array is the column.
 *
 * Deriving the mapping from the geometry rather than from a stored list of ids
 * is the same choice gridFrom makes: measured off the board, so moving or
 * scaling the calendar cannot invalidate it, and nothing has to be kept in sync.
 *
 * `board.get()` would work without a group and survive an ungrouping, but it is
 * a Level 3 call (500 credits against getById's 50) and returns every shape on
 * the board - including the other year's calendar sitting next to this one.
 */

// Cells are created at an exact computed y, so this only absorbs float noise.
// The next row is a full rowHeight away, so there is no ambiguity to resolve.
const SAME_ROW = 1;

export async function dayCellsOf(calendar) {
    if (!calendar.groupId) return { cells: null, reason: 'ungrouped' };

    let items;
    try {
        const group = await run(() => board.getById(calendar.groupId));
        items = await run(() => group.getItems());
    } catch (error) {
        // A rate limit that outlasted run()'s retries means the call never
        // completed, not that the group is gone. Saying 'ungrouped' here would
        // send the caller down a path that refuses to draw permanently over a
        // failure that is temporary.
        if (isRateLimitError(error)) return { cells: null, reason: 'rate-limited' };
        return { cells: null, reason: 'ungrouped' };
    }

    const dayRowY = calendar.bottom - calendar.rowHeight / 2;
    const cells = items
        .filter((item) => Math.abs(item.y - dayRowY) < SAME_ROW)
        .sort((a, b) => a.x - b.x);

    // If the count is off, some cell was dragged out or something foreign was
    // dropped onto the row, and every index past that point means a different
    // day than it should. Refuse rather than mark the wrong date - the same
    // choice gridFrom makes when the measurement stops describing a grid.
    if (cells.length !== totalWorkingDays(calendar.year)) {
        return { cells: null, reason: 'incomplete' };
    }

    return { cells, reason: null };
}
```

- [x] **Step 7: Verify the build still compiles**

Run: `npm run build`
Expected: erfolgreicher Vite-Build ohne Warnungen zu unaufgelösten Importen.

Run: `npm test`
Expected: PASS

- [x] **Step 8: Commit**

```bash
git add src/colors.js src/app.js src/anchors.js src/dayCells.js test/colors.test.js
git commit -m "makes every day cell reachable through the calendar group"
```

---

## Phase 3 — Zeichnen (Tasks 6–8)

---

### Task 6: Die zwei offenen Board-Fragen vorläufig beantworten

Der Spec wollte beide am Board messen. Der Auftraggeber hat entschieden, stattdessen mit belegten Annahmen weiterzubauen und beim ersten echten Zeichnen zu korrigieren. Diese Task hält fest, worauf die Annahmen beruhen und woran man merkt, dass sie falsch waren.

**Files:**
- Create: `src/stickyColors.js`
- Create: `docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md`

**Interfaces:**
- Produces: `HOLIDAY_COLORS` aus `src/stickyColors.js`:
  ```js
  {
    nationwide: { sticky: 'dark_green', cell: '#93D275' },
    regional:   { sticky: 'light_green', cell: '#D5F692' },
  }
  ```

- [x] **Step 1: Write `src/stickyColors.js`**

```js
/**
 * The two greens a holiday is drawn in, and the hex that goes with each.
 *
 * Sticky notes take only Miro's named palette, shapes take any hex - so the
 * day cell has to be told, in hex, what Miro renders the sticky as. The Web
 * SDK reports only the name back, never the colour, so these hex values cannot
 * be read out of the SDK at all.
 *
 * UNVERIFIED. They come from Miro's community colour table rather than from a
 * real board (see docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md).
 * `dark_green` is the true green of the design mock-up; `green` in Miro's
 * naming is an olive that does not match it. If the cell and its sticky look
 * like two different colours on the board, this file is the only place to fix,
 * and nothing else has to change.
 */
export const HOLIDAY_COLORS = {
    // Applies in every federal state - the stronger of the two.
    nationwide: { sticky: 'dark_green', cell: '#93D275' },
    // Applies in some states only, or in one city.
    regional: { sticky: 'light_green', cell: '#D5F692' },
};
```

- [x] **Step 2: Write the note that says what is unverified and how to fix it**

Create `docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md`:

```markdown
# Offen: Sticky-Grün und Connector in eine Group

**Datum:** 2026-07-30
**Status:** bewusst ungeprüft, wird beim ersten echten Zeichnen korrigiert

Der Spec sah vor, beides auf einem Board zu messen. Entschieden wurde, mit
belegten Annahmen weiterzubauen.

## Sticky-Grün

Sticky-Notes nehmen nur Miros benannte Palette, Shapes nehmen Hex. Damit
Tagesmarke und Sticky als Paar wirken, muss das Hex zu dem passen, was Miro
für den Namen rendert — und das gibt das SDK nicht heraus.

Angenommen, aus Miros Community-Farbtabelle:

| SDK-Name | angenommenes Hex | Ton |
|---|---|---|
| `dark_green` | `#93D275` | echtes Grün, entspricht dem Mockup |
| `light_green` | `#D5F692` | blasses Gelbgrün |
| `green` | ~`#D0E17A` | Olive — **nicht** benutzt, passt nicht zum Mockup |

**Woran man merkt, dass es falsch war:** Tagesmarke und zugehöriges Sticky
sehen auf dem Board unterschiedlich aus. **Wo es zu reparieren ist:**
ausschließlich `src/stickyColors.js`.

## Connector auf ein Item innerhalb einer Group

Die Referenz sagt nicht, ob das erlaubt ist. Statt zu messen, beantwortet
`holidayDraw.js` die Frage zur Laufzeit: es versucht zuerst die Tageszelle und
weicht bei einer Ablehnung auf eine unsichtbare Ankershape an derselben Stelle
aus — dasselbe Mittel, mit dem `today.js` seine gepunktete Linie enden lässt.
Welcher Weg genommen wurde, steht danach in der Konsole.

**Woran man merkt, welcher Fall eintrat:** die Meldung
`Timeline Builder: connectors cannot end inside a group, using anchors instead`
erscheint genau dann, wenn Miro abgelehnt hat.
```

- [x] **Step 3: Verify the build**

Run: `npm run build && npm test`
Expected: beides erfolgreich; `stickyColors.js` wird noch von niemandem importiert, das ist in Ordnung.

- [x] **Step 4: Commit**

```bash
git add src/stickyColors.js docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md
git commit -m "pins the two holiday greens in one place, marked unverified"
```

---

### Task 7: `holidayDraw.js` — zeichnen und zurücknehmen

**Files:**
- Create: `src/holidayDraw.js`

**Interfaces:**
- Consumes: `board`, `run`, `isRateLimitError` aus `src/board.js`; `updateCalendar`, `readCalendars` aus `src/anchors.js`; `xOfColumn`, `widthOfColumns`, `dayBlocks` aus `src/calendar.js`; `dayColor` aus `src/colors.js`; `layoutBlock`, `offsetOverlapping` aus `src/holidays.js`; `HOLIDAY_COLORS` aus `src/stickyColors.js`
- Produces:
  - `drawHolidays(calendar, cells, {stickies, rows}) → Promise<{itemIds: string[], markedColumns: number[], reservedRows: number}>` — schreibt diese drei Felder selbst in AppData, auf dem Erfolgs- **und** dem Fehlerpfad (siehe unten); der Aufrufer ergänzt nur noch die Bundesländer-Auswahl, über `recordHolidays`
  - `removeHolidays(calendar, cells) → Promise<void>`
  - `recordHolidays(calendarId, changes) → Promise<void>` — liest den aktuellen `holidays`-Eintrag frisch und mergt `changes` hinein, statt ihn zu ersetzen

Die Farben kommen aus `src/stickyColors.js` (Task 6). Ob ein Connector auf ein Item innerhalb einer Group zeigen darf, sagt die Referenz nicht — statt es vorher zu messen, beantwortet der Code die Frage zur Laufzeit: erst die Zelle versuchen, bei Ablehnung einmalig auf unsichtbare Ankershapes umschalten und das melden.

**Nachträge aus dem Review** (die ursprüngliche Fassung dieses Blocks — Commit `c8a3d0b` — hatte hier drei Lücken, geschlossen in `e7aadaf fixes six holiday-draw failure paths so nothing on the board goes unrecorded`; der Block unten ist bereits die korrigierte Fassung):

1. **`updateCalendar` mergt nur auf oberster Ebene.** Ein `holidays`-Objekt zu schreiben ersetzt das ganze Unterobjekt — das hätte IDs gelöscht, die `removeHolidays` bewusst stehen ließ, weil ein Rate-Limit nicht bestätigen konnte, dass das Item wirklich weg ist. Deshalb liest `recordHolidays` den aktuellen Stand zuerst und mergt.
2. **`drawHolidays` schreibt seine eigene Buchführung selbst**, nicht mehr der Aufrufer nach dem `await`. Ein fehlschlagender Schreibversuch beim Aufrufer hätte sonst alles gerade Gezeichnete verwaist zurückgelassen.
3. **Ein Tag kann zwei Feiertage tragen** (z. B. Tag der Arbeit und Christi Himmelfahrt auf denselben Tag). Die Zelle wird pro Spalte nur einmal eingefärbt, bundesweit gewinnt gegen regional — beide Stickies werden trotzdem gezeichnet, das seitliche Ausweichen trennt sie ohnehin schon.
4. **HTML-Escaping für Feiertagsnamen**, weil sie von einer Drittanbieter-API übers Netz kommen, anders als der SAP-Export in `import.js` (siehe Spec, Abschnitt „Darstellung").
5. Die Fallback-Ankershapes werden **nicht** mitgruppiert — würde die Group verschoben, risse sie die Ankershape von der Tageszelle weg, und der Connector zeigte danach auf das falsche Datum.

- [x] **Step 1: Write `src/holidayDraw.js`**

```js
import { board, run, isRateLimitError } from './board.js';
import { updateCalendar, readCalendars } from './anchors.js';
import { xOfColumn, widthOfColumns, dayBlocks } from './calendar.js';
import { dayColor } from './colors.js';
import { layoutBlock, offsetOverlapping } from './holidays.js';
import { HOLIDAY_COLORS } from './stickyColors.js';

const LINE_COLOR = '#000000';
const LINE_WIDTH = 1;

// Anchor for the fallback path below: present, invisible, draggable - the same
// trick today.js uses to give its dotted line something to end on.
const ANCHOR_SIZE = 8;

function colorsFor(sticky) {
    return sticky.nationwide ? HOLIDAY_COLORS.nationwide : HOLIDAY_COLORS.regional;
}

function connect(fromId, toId) {
    return run(() => board.createConnector({
        shape: 'straight',
        start: { item: fromId, snapTo: 'bottom' },
        end: { item: toId, snapTo: 'top' },
        style: {
            strokeStyle: 'normal',
            strokeWidth: LINE_WIDTH,
            strokeColor: LINE_COLOR,
            startStrokeCap: 'none',
            endStrokeCap: 'arrow',
        },
    }));
}

/**
 * Escapes the handful of characters that are significant in HTML.
 *
 * This is about rendering correctly in Miro's rich-text renderer - an
 * unescaped "&" or "<" in a holiday name breaks the markup the sticky or band
 * is built from - not about XSS in this app's own DOM. Unlike the SAP export
 * import.js accepts unescaped from the user themselves, holiday names come
 * from a third-party API over the network, so they get escaped here.
 */
function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/** The stored holiday bookkeeping for one calendar, read fresh, never from the resolved entry's snapshot. */
async function currentHolidays(calendarId) {
    const entries = await readCalendars();
    return entries.find((entry) => entry.calendarId === calendarId)?.holidays ?? {};
}

/**
 * Merges into the stored holiday bookkeeping instead of replacing it.
 *
 * updateCalendar merges at the top level only, so handing it a `holidays`
 * object replaces the whole thing. Reading first and spreading here is what
 * keeps one writer from erasing another's keys - the Bundesland selection the
 * panel stores, or ids that removeHolidays kept because it could not confirm
 * they were gone.
 */
export async function recordHolidays(calendarId, changes) {
    const current = await currentHolidays(calendarId);
    await updateCalendar(calendarId, { holidays: { ...current, ...changes } });
}

/**
 * Paints the holiday block onto one calendar.
 *
 * Order matters. The day cells are repainted first, because they are the
 * connector targets and because they are the one part that cannot be recovered
 * from an id list if this throws halfway - so the columns are recorded before
 * anything else is created. Everything after that is a new item whose id goes
 * into `created`; this function itself writes that list to AppData, on both
 * the success and the failure path, merging it on top of whatever bookkeeping
 * this calendar already had - a caller that wants to add its own key (the
 * Bundesland selection, say) does so afterwards with recordHolidays, not by
 * replacing what was just written.
 */
export async function drawHolidays(calendar, cells, { stickies, rows }) {
    const previous = await currentHolidays(calendar.entry.calendarId);
    const carriedIds = previous.itemIds ?? [];

    const { grid, rowHeight, top } = calendar;
    const created = [];
    const anchors = [];
    const markedColumns = [];

    const layout = layoutBlock({
        top,
        rowHeight,
        gap: grid.padding,
        bandCount: rows.length,
        stickyCount: stickies.length,
    });

    const centerXof = (column) => xOfColumn(grid, column) + grid.shapeWidth / 2;
    const placed = offsetOverlapping(stickies, { centerXof, stickySize: layout.stickySize });

    // Assigned once the creation loops below finish and their own bookkeeping
    // write succeeds; grouping (after the try/catch) reads it back to return.
    let bookkeeping;

    try {
        // 1. The day cells. Two holidays can share a working day - 1 May 2008
        //    was both Tag der Arbeit and Christi Himmelfahrt - so this dedupes
        //    by column first and lets nationwide win over regional when both
        //    land on the same day, painting and recording each column once.
        //    Both stickies are still drawn in step 3; only the cell is shared.
        const stickiesByColumn = new Map();
        for (const sticky of placed) {
            const existing = stickiesByColumn.get(sticky.column);
            if (!existing || (!existing.nationwide && sticky.nationwide)) {
                stickiesByColumn.set(sticky.column, sticky);
            }
        }

        for (const [column, sticky] of stickiesByColumn) {
            const cell = cells[column];
            cell.style.fillColor = colorsFor(sticky).cell;
            await run(() => cell.sync());
            markedColumns.push(column);
        }

        // 2. The bands. Row index 0 is alphabetically first and belongs on top,
        //    and bandCenterYs is indexed from the calendar upwards.
        for (const row of rows) {
            const y = layout.bandCenterYs[rows.length - 1 - row.index];

            for (const block of row.blocks) {
                const width = widthOfColumns(grid, block.colSpan);
                const shape = await run(() => board.createShape({
                    shape: 'rectangle',
                    content: `<p>${escapeHtml(block.label)}</p>`,
                    x: xOfColumn(grid, block.colStart) + width / 2,
                    y,
                    width,
                    height: rowHeight,
                    style: {
                        fillColor: row.color,
                        fontFamily: 'open_sans',
                        // One centred line, same rule the month row uses.
                        fontSize: Math.round(rowHeight / 2.5),
                        borderWidth: 0,
                    },
                }));
                created.push(shape);
            }
        }

        // 3. The stickies and their connectors.
        //
        // The reference does not say whether a connector may end on an item
        // that sits inside a group, and the day cells all do. Rather than
        // assume either way, the first one tries the cell directly; if Miro
        // refuses, every connector from then on ends on an invisible anchor
        // placed over the cell instead. The flag is sticky for the whole draw
        // so the answer costs one rejected call, not one per holiday.
        let connectDirectly = true;

        for (const sticky of placed) {
            const subtitle = sticky.subtitle ? `<p>${escapeHtml(sticky.subtitle)}</p>` : '';
            const note = await run(() => board.createStickyNote({
                content: `<p><b>${escapeHtml(sticky.name)}</b></p>${subtitle}`,
                x: sticky.x,
                y: layout.stickyCenterY,
                width: layout.stickySize,
                style: {
                    fillColor: colorsFor(sticky).sticky,
                    textAlign: 'center',
                    textAlignVertical: 'middle',
                },
            }));
            created.push(note);

            const cell = cells[sticky.column];

            if (connectDirectly) {
                try {
                    created.push(await connect(note.id, cell.id));
                    continue;
                } catch (error) {
                    // Only a refusal to point into the group is worth falling
                    // back from. A rate limit means the call never completed,
                    // and retrying it as a different shape of call would hide
                    // that - let it out and be reported like every other one.
                    if (isRateLimitError(error)) throw error;

                    connectDirectly = false;
                    console.warn(
                        'Timeline Builder: connectors cannot end inside a group, using anchors instead',
                        error
                    );
                }
            }

            const anchor = await run(() => board.createShape({
                shape: 'rectangle',
                x: cell.x,
                y: cell.y,
                width: ANCHOR_SIZE,
                height: ANCHOR_SIZE,
                style: { fillOpacity: 0, borderOpacity: 0, borderWidth: 0 },
            }));
            created.push(anchor);
            anchors.push(anchor);
            created.push(await connect(note.id, anchor.id));
        }

        bookkeeping = {
            itemIds: [...carriedIds, ...created.map((item) => item.id)],
            markedColumns,
            reservedRows: layout.reservedRows,
        };

        // Record on success too, not only on failure: today's caller trusts
        // the return value to be written afterwards, and if that write fails,
        // everything just drawn would be unreachable. Writing it here, before
        // the try closes, means a failure of this very write falls into the
        // same recovery path as everything else below - guarded, then
        // rethrown - rather than being a second, differently-shaped failure
        // point. The caller still gets the same object back so it can merge
        // its own key (subdivisions) with recordHolidays.
        await recordHolidays(calendar.entry.calendarId, bookkeeping);
    } catch (error) {
        // Record what is actually on the board before letting this out. Without
        // it a retry cannot find the items that did land and stacks more on top
        // - and the repainted cells would never be restored. carriedIds keeps
        // whatever removeHolidays could not confirm was gone moments earlier;
        // overwriting itemIds with only this draw's created list would lose it.
        try {
            await recordHolidays(calendar.entry.calendarId, {
                itemIds: [...carriedIds, ...created.map((item) => item.id)],
                markedColumns,
                reservedRows: layout.reservedRows,
            });
        } catch (writeError) {
            // The write itself can fail - a rate-limit burst can exhaust
            // run()'s retries on a createStickyNote and then on the recovery
            // write moments later. Report it, but the original error is what
            // must reach the caller either way: replacing it with the write's
            // error would mean nothing at all gets recorded or reported.
            console.error(
                `Timeline Builder: could not record the partial holiday draw for calendar ${calendar.entry.calendarId}`,
                writeError
            );
        }
        throw error;
    }

    // Bands and stickies are grouped for the mouse; the connectors and the
    // fallback anchors are left out. A connector follows its endpoints on its
    // own, so it keeps up when the group is dragged. An anchor is invisible
    // and sits only to give a connector something to end on over a day cell;
    // if it joined the group, moving the group would drag the anchor off that
    // cell, and the connector would then point at whatever now sits under it
    // instead of at the holiday's date - the whole meaning of the drawing.
    const anchorIds = new Set(anchors.map((item) => item.id));
    const groupable = created.filter((item) => item.type !== 'connector' && !anchorIds.has(item.id));
    if (groupable.length > 1) {
        try {
            await run(() => board.group({ items: groupable }));
        } catch (error) {
            // A grouping failure costs nothing that matters - the items are
            // already a complete, working holiday block without it.
            console.warn(
                `Timeline Builder: could not group the holiday block for calendar ${calendar.entry.calendarId}`,
                error
            );
        }
    }

    return bookkeeping;
}

/**
 * Undoes a previous holiday draw.
 *
 * The repainted cells are restored from dayColor, not from a stored original -
 * see colors.js. A column survives the calendar being redrawn; an id would not.
 */
export async function removeHolidays(calendar, cells) {
    const previous = calendar.entry.holidays;
    if (!previous) return;

    const weekdays = dayBlocks(calendar.year);

    // Columns whose cell.sync() failed and so are still holiday-green. Kept,
    // not dropped: unlike a shape, a repainted cell cannot be found or
    // restored by id, only by the column remembered here.
    const stillPainted = [];
    for (const column of previous.markedColumns ?? []) {
        const cell = cells[column];
        if (!cell) continue;

        cell.style.fillColor = dayColor(weekdays[column].weekday);
        try {
            await run(() => cell.sync());
        } catch (error) {
            // A cell that cannot be restored stays green. Reported, not fatal:
            // refusing to draw the new block because an old one would not let
            // go leaves the board in a worse state than one stale cell.
            stillPainted.push(column);
            console.warn(
                `Timeline Builder: could not restore day cell ${column} on calendar ${calendar.entry.calendarId}`,
                error
            );
        }
    }

    // Same distinction removePreviousImport makes: a rate limit means the call
    // never completed, so the id must be kept, not dropped. Anything else means
    // the item is genuinely gone. getById and remove are judged separately,
    // because reaching remove means getById already succeeded - the item
    // demonstrably exists, so only a rate limit there (not any failure) may
    // still drop its id.
    const remaining = [];
    for (const id of previous.itemIds ?? []) {
        let item;
        try {
            item = await run(() => board.getById(id));
        } catch (error) {
            // Only a rate limit leaves the item's fate unknown; anything else
            // means it is genuinely gone - deleted by hand, or by undo.
            if (isRateLimitError(error)) remaining.push(id);
            continue;
        }

        try {
            await run(() => board.remove(item));
        } catch {
            // getById just succeeded, so this item is on the board whatever
            // went wrong here. Dropping its id would orphan something we can
            // see.
            remaining.push(id);
        }
    }

    await recordHolidays(calendar.entry.calendarId, {
        itemIds: remaining,
        markedColumns: stillPainted,
        reservedRows: 0,
    });
}
```

- [x] **Step 2: Check that no colour was written twice**

Run: `grep -n '#[0-9A-Fa-f]\{6\}' src/holidayDraw.js`
Expected: nur `LINE_COLOR = '#000000'`. Jeder grüne Hexwert gehört nach `src/stickyColors.js`, weil das die eine Datei ist, die korrigiert werden muss, wenn die Annahme falsch war.

- [x] **Step 3: Verify the build**

Run: `npm run build && npm test`
Expected: beides erfolgreich.

- [x] **Step 4: Commit**

```bash
git add src/holidayDraw.js
git commit -m "draws the holiday block and takes it back"
```

Die Lücken oben (Buchführung, Escaping, Doppel-Feiertag, Anker außerhalb der Group) kamen erst durch ein Review ans Licht und wurden in einem eigenen Folge-Commit geschlossen (`e7aadaf fixes six holiday-draw failure paths so nothing on the board goes unrecorded`), nicht mehr in diesem.

---

### Task 8: Der dritte Tab

**Files:**
- Create: `src/holidayView.js`
- Modify: `app.html` (Tab-Leiste Zeilen 11–20, neuer View nach `#view-import`)
- Modify: `src/app.js` (`showView`, Zeilen 397–405, und der Aufruf von `initImportView` in Zeile 405)

**Interfaces:**
- Consumes: `fetchHolidays`, `fetchSubdivisions` aus `src/openHolidays.js`; alle `parse*`/`plan*` aus `src/holidays.js`; `findCalendars` aus `src/anchors.js`; `dayCellsOf` aus `src/dayCells.js`; `drawHolidays`, `removeHolidays`, `recordHolidays` aus `src/holidayDraw.js`; `updateIndicators` aus `src/today.js`; `takeStats`, `isRateLimitError` aus `src/board.js`
- Produces: `initHolidayView() → void`

Die Buchführung (`itemIds`, `markedColumns`, `reservedRows`) schreibt `drawHolidays` selbst (Task 7); dieser View schreibt nach dem Zeichnen nur noch die Bundesländer-Auswahl nach, über `recordHolidays(calendarId, { subdivisions: selected })` — nicht mehr per eigenem `updateCalendar({ holidays: {...} })`, das die Buchführung überschreiben würde.

- [x] **Step 1: Add the tab and the view to `app.html`**

Replace the `tabs-header-list` block (lines 12–19) with:

```html
                <div class="tabs-header-list">
                    <div class="tab tab-active" data-view="calendar" role="tab" tabindex="0">
                        <div class="tab-text">Calendar</div>
                    </div>
                    <div class="tab" data-view="import" role="tab" tabindex="0">
                        <div class="tab-text">Vacation</div>
                    </div>
                    <div class="tab" data-view="holidays" role="tab" tabindex="0">
                        <div class="tab-text">Holidays</div>
                    </div>
                </div>
```

Insert after the closing `</div>` of `#view-import` (currently line 177), before the closing `</div>` of `.scrollable-container`:

```html
            <div id="view-holidays" class="hidden">
                <fieldset class="section">
                    <div class="h4 section-title">German Holidays</div>
                    <div class="form-group form-group-small">
                        <label for="subdivisions">Which federal states?</label>
                        <select class="select select-small" id="subdivisions" multiple size="8"></select>
                        <p class="p-small vacation-hint">
                            Public holidays and school breaks come from
                            <a href="https://www.openholidaysapi.org/" target="_blank" rel="noopener">OpenHolidays</a>.
                            Hold Cmd or Ctrl to pick more than one state.
                        </p>
                    </div>
                    <div class="form-group form-group-small hidden" id="holidayCalendarChoice">
                        <label for="targetHolidayCalendar">Which calendar?</label>
                        <select class="select select-small" id="targetHolidayCalendar"></select>
                    </div>
                </fieldset>

                <div class="footer-stack">
                    <button type="button" id="holidaySubmit" class="button button-primary button-small button-wide">Draw Holidays</button>
                </div>
                <p id="holidayStatus" class="p-small draw-status hidden" role="status" aria-live="polite"></p>
                <ul id="holidayProblems" class="p-small import-problems hidden"></ul>
            </div>
```

- [x] **Step 2: Teach `showView` about the third view**

Replace `showView` in `src/app.js` (lines 397–403) with:

```js
const VIEWS = ['calendar', 'import', 'holidays'];

function showView(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('tab-active', tab.dataset.view === name);
    });
    for (const view of VIEWS) {
        document.getElementById(`view-${view}`).classList.toggle('hidden', view !== name);
    }
}
```

Add the new initialiser next to the existing one at the bottom of `src/app.js`:

```js
initImportView();
initHolidayView();
```

and extend the imports at the top:

```js
import { initHolidayView } from './holidayView.js';
```

- [x] **Step 3: Write `src/holidayView.js`**

```js
import dayjs from 'dayjs';

import { board, takeStats, isRateLimitError } from './board.js';
import { findCalendars } from './anchors.js';
import { dayCellsOf } from './dayCells.js';
import { fetchHolidays, fetchSubdivisions } from './openHolidays.js';
import {
    parseSubdivisions,
    parsePublicHolidays,
    parseSchoolHolidays,
    planStickies,
    planBands,
} from './holidays.js';
import { drawHolidays, removeHolidays, recordHolidays } from './holidayDraw.js';
import { updateIndicators } from './today.js';

// Fetched once per panel load and kept: the list of German states does not
// change while somebody has a board open.
let names = null;

export function initHolidayView() {
    document.getElementById('holidaySubmit').addEventListener('click', runHolidays);
    document
        .querySelector('.tab[data-view="holidays"]')
        .addEventListener('click', fillStatesOnce);
}

async function fillStatesOnce() {
    if (names) return;

    const select = document.getElementById('subdivisions');
    setStatus('Loading the list of states...', true);

    try {
        names = parseSubdivisions(await fetchSubdivisions());
    } catch (error) {
        setStatus(error?.message ?? String(error), false);
        return;
    }

    // Only the top-level states are pickable. Augsburg is reachable through
    // Bavaria; offering it on its own would suggest you could have the Peace
    // Festival without the rest of Bavaria's holidays.
    const states = [...names.entries()]
        .filter(([code]) => code.split('-').length === 2)
        .sort((a, b) => (a[1].name < b[1].name ? -1 : 1));

    select.innerHTML = '';
    for (const [code, state] of states) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = state.name;
        select.appendChild(option);
    }

    setStatus('', false);
    await preselectFromLastRun(select);
}

/** Whatever was drawn last time, so a redraw is one click. */
async function preselectFromLastRun(select) {
    try {
        const calendars = await findCalendars();
        const previous = calendars.find((calendar) => calendar.entry.holidays?.subdivisions?.length);
        if (!previous) return;

        const chosen = new Set(previous.entry.holidays.subdivisions);
        for (const option of select.options) option.selected = chosen.has(option.value);
    } catch {
        // A convenience, not a requirement. An empty selection is a fine
        // starting state, and the draw below reports its own failures.
    }
}

async function runHolidays() {
    showProblems([]);

    // The subdivision list is fetched once, on the first click of the tab
    // (fillStatesOnce). If that fetch is still in flight, failed, or somehow
    // never ran, `names` is null and planStickies/planBands would fail in a
    // way that means nothing to whoever reads the message. In practice the
    // <select> only ever gets options once `names` is set, so this mostly
    // guards a case the "pick a state" check below would already catch - but
    // it says so plainly instead of relying on that ordering by accident.
    if (!names) {
        setStatus('The list of federal states has not finished loading yet. Wait a moment and try again.', false);
        return;
    }

    const select = document.getElementById('subdivisions');
    const selected = [...select.selectedOptions].map((option) => option.value);

    if (selected.length === 0) {
        setStatus('Pick at least one federal state.', false);
        return;
    }

    setStatus('Looking for a calendar...', true);

    const calendar = await chooseCalendar();
    if (!calendar) {
        setStatus('This board has no calendar to draw on.', false);
        return;
    }

    setStatus('Reading the day cells...', true);
    const { cells, reason } = await dayCellsOf(calendar);
    if (!cells) {
        setStatus(describeCellFailure(reason), false);
        return;
    }

    setStatus('Fetching holidays...', true);

    let raw;
    try {
        raw = await fetchHolidays(calendar.year);
    } catch (error) {
        setStatus(error?.message ?? String(error), false);
        return;
    }

    const publicHolidays = parsePublicHolidays(raw.publicHolidays);
    const schoolHolidays = parseSchoolHolidays(raw.schoolHolidays);
    const planned = planStickies(publicHolidays.entries, calendar.year, { selected, names });
    const banded = planBands(schoolHolidays.entries, calendar.year, { selected, names });

    const problems = [
        ...publicHolidays.problems,
        ...schoolHolidays.problems,
        ...planned.problems,
        ...banded.problems,
    ];

    if (planned.stickies.length === 0 && banded.rows.length === 0) {
        setStatus('Nothing was drawn.', false);
        showProblems(problems);
        return;
    }

    try {
        setStatus('Removing the previous holidays...', true);
        await removeHolidays(calendar, cells);

        setStatus('Drawing holidays...', true);
        const drawn = await drawHolidays(calendar, cells, {
            stickies: planned.stickies,
            rows: banded.rows,
        });

        await recordHolidays(calendar.entry.calendarId, { subdivisions: selected });

        // The circle sits above this block, so it has to move now rather than
        // at the next tick - same reason drawCalendar kicks it.
        try {
            await updateIndicators(dayjs());
        } catch (error) {
            console.error('Could not update the TODAY indicator:', error);
        }

        logStats(calendar, planned.stickies.length, drawn.itemIds.length);

        if (problems.length > 0) {
            setStatus(`Drawn, with notes:`, false);
            showProblems(problems);
            return;
        }

        await board.ui.closePanel();
    } catch (error) {
        setStatus(describeFailure(error), false);
        showProblems(problems);
        console.error(error);
    }
}

/**
 * Which calendar the holidays belong to.
 *
 * Unlike the vacation import there is no data to derive a year from, so every
 * calendar on the board is a candidate and the year comes from whichever one is
 * picked.
 */
async function chooseCalendar() {
    const candidates = await findCalendars();

    const choice = document.getElementById('holidayCalendarChoice');
    const select = document.getElementById('targetHolidayCalendar');

    if (candidates.length <= 1) {
        choice.classList.add('hidden');
        return candidates[0] ?? null;
    }

    // Compare the candidate set by identity, not by length: a calendar deleted
    // and another drawn in the same session can leave the same count behind.
    const currentIds = Array.from(select.options, (option) => option.value);
    const candidateIds = candidates.map((candidate) => candidate.entry.calendarId);
    const sameCandidates = currentIds.length === candidateIds.length
        && currentIds.every((id) => candidateIds.includes(id));

    if (!sameCandidates) {
        const previousSelection = select.value;
        select.innerHTML = '';
        for (const candidate of candidates) {
            const option = document.createElement('option');
            option.value = candidate.entry.calendarId;
            option.textContent = String(candidate.year);
            select.appendChild(option);
        }
        if (candidateIds.includes(previousSelection)) select.value = previousSelection;
    }
    choice.classList.remove('hidden');

    return candidates.find((c) => c.entry.calendarId === select.value) ?? candidates[0];
}

function describeCellFailure(reason) {
    if (reason === 'ungrouped') {
        return 'That calendar is not grouped, so its day cells cannot be found. Redraw it, or group it by hand.';
    }
    if (reason === 'rate-limited') {
        return 'Rate limit reached. Wait a minute and try again.';
    }
    return 'That calendar\'s day row is incomplete - a cell was moved or deleted. Redraw it.';
}

function describeFailure(error) {
    if (isRateLimitError(error)) {
        return 'Rate limit reached. Wait a minute and try again.';
    }
    return `Drawing holidays failed: ${error?.message ?? error}`;
}

function logStats(calendar, stickyCount, itemCount) {
    const stats = takeStats();
    if (!stats) return;

    console.log(
        `Timeline Builder - holidays ${calendar.year}: ${stickyCount} public holidays, ` +
        `${itemCount} items in ${(stats.wallClockMs / 1000).toFixed(1)} s, ` +
        `${stats.credits.toLocaleString('en-US')} Credits`
    );
}

function setStatus(message, busy) {
    const button = document.getElementById('holidaySubmit');
    const status = document.getElementById('holidayStatus');

    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    status.textContent = message;
    status.classList.toggle('hidden', message === '');
}

function showProblems(problems) {
    const list = document.getElementById('holidayProblems');
    list.innerHTML = '';

    for (const problem of problems) {
        const item = document.createElement('li');
        item.textContent = problem;
        list.appendChild(item);
    }

    list.classList.toggle('hidden', problems.length === 0);
}
```

- [x] **Step 4: Verify the build and the tests**

Run: `npm run build && npm test`
Expected: beides erfolgreich.

- [x] **Step 5: Commit**

```bash
git add app.html src/app.js src/holidayView.js
git commit -m "adds the Holidays tab"
```

---

## Phase 4 — Der TODAY-Kreis (Task 9)

---

### Task 9: `placedY` und der Kreis über dem Block

**Files:**
- Modify: `src/today.js` (`syncIndicator` Zeilen 37–55, `createIndicator` Zeilen 74–177, `moveIndicator` Zeilen 186–232, `removeIndicator` Zeilen 265–281)
- Modify: `src/anchors.js` (Zeile 45, das initiale `indicator`-Objekt)
- Modify: `test/today.test.js` (anhängen)

**Interfaces:**
- Consumes: `holidays.reservedRows` aus dem Kalendereintrag (Task 7/8)
- Produces: `indicator.placedY: number | null` im AppData-Eintrag; `shouldMoveIndicatorY(y, placedY, legacyY, nudge) → boolean` aus `src/todayColumn.js`

**Nachtrag:** Ein für dieses Feld selbst grundlegendes Problem fiel erst nach dem ersten Durchlauf dieser Task auf und wurde in einem eigenen Folge-Commit geschlossen (`3857a1e reconstructs placedY for indicators drawn before it existed`) — Schritt 3 und 5 unten zeigen bereits die korrigierte Fassung. Für einen Indikator, der gezeichnet wurde, bevor `placedY` existierte, fehlt der Schlüssel schlicht; `undefined == null` hätte beim ersten Tick nach dem Deploy einen Schreibvorgang erzwungen und einen von Hand positionierten Kreis stillschweigend zurückgesetzt. Der Ausweg ist `legacyY`: die Formel, die das alte `createIndicator` schon immer geschrieben hat (`reservedRows: 0`). Ein Alt-Indikator ohne `placedY` vergleicht dagegen statt gegen „schreiben, koste es was es wolle" — er bleibt stehen, solange es keine Feiertage gibt, und rückt trotzdem hoch, sobald welche dazukommen. Die Entscheidung sitzt als eigene, testbare Funktion `shouldMoveIndicatorY` in `src/todayColumn.js`, aus demselben Grund, aus dem `indicatorY` dort liegt statt in `today.js`.

- [x] **Step 1: Write the failing test**

Append to `test/today.test.js`:

```js
import { indicatorY } from '../src/todayColumn.js';

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
```

Nachträglich, als die Lücke mit den Alt-Indikatoren auffiel, kamen `shouldMoveIndicatorY` und ihre eigenen Tests dazu (siehe Nachtrag oben und `src/todayColumn.js` unten):

```js
import { columnForToday, indicatorY, shouldMoveIndicatorY } from '../src/todayColumn.js';

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
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL, `does not provide an export named 'indicatorY'`

- [x] **Step 3: Add `indicatorY` to `src/todayColumn.js`**

Es gehört dorthin und nicht in `today.js`, weil `today.js` `board.js` importiert und `board.js` beim Laden `window` liest — ein Test-Import würde unter Node abstürzen. Genau dafür wurde `todayColumn.js` abgespalten.

```js
/**
 * The centre y of the TODAY circle.
 *
 * `reservedRows` is what the holiday import wrote into the calendar entry: how
 * many rowHeights the bands and stickies occupy above the calendar. At zero
 * this is literally the formula the circle used before holidays existed, which
 * is why a calendar without them does not move.
 */
export function indicatorY({ top, rowHeight, diameter, reservedRows }) {
    return top - (reservedRows ?? 0) * rowHeight - rowHeight / 2 - diameter / 2;
}

/**
 * Whether moveIndicator should write the circle's y.
 *
 * `placedY` is the y *we* last wrote - absent (never recorded) or explicitly
 * null (cleared by removeIndicator) for any indicator predating that field.
 * For those, `legacyY` stands in: createIndicator was the only writer of the
 * circle's y before reservedRows existed, and it always used the no-holidays
 * formula, so that value IS what was last written, not a guess. Falling back
 * to it - rather than to "write it anyway" - is what lets a hand-drag from
 * before this change survive the first tick, while still letting a holiday
 * block that appeared since push the circle up.
 */
export function shouldMoveIndicatorY(y, placedY, legacyY, nudge) {
    const lastWritten = placedY ?? legacyY;
    return Math.abs(y - lastWritten) >= nudge;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [x] **Step 5: Use it in `src/today.js`**

Extend the import:

```js
import { columnForToday, indicatorY, shouldMoveIndicatorY } from './todayColumn.js';
```

In `syncIndicator`, compute the wanted y next to the wanted x, plus `legacyY` — the y an indicator predating `placedY` must be assumed to already carry (see the Nachtrag above) — and pass all three on:

```js
    const x = xOfColumn(grid, column) + grid.shapeWidth / 2;
    const diameter = calendar.rowHeight * DIAMETER_FACTOR;
    const y = indicatorY({
        top: calendar.top,
        rowHeight: calendar.rowHeight,
        diameter,
        reservedRows: entry.holidays?.reservedRows,
    });

    // What createIndicator would have written before placedY (and reservedRows)
    // existed. A legacy indicator - one with no placedY on record - has no other
    // way to know what its own y was last set to; this reconstructs it instead
    // of guessing, so moveIndicator can tell whether the holiday block actually
    // changed anything.
    const legacyY = indicatorY({
        top: calendar.top,
        rowHeight: calendar.rowHeight,
        diameter,
        reservedRows: 0,
    });

    if (!entry.indicator.circleId) {
        await createIndicator(calendar, x);
        return;
    }

    await moveIndicator(entry, x, y, legacyY);
```

In `createIndicator`, replace the `centerY` computation with the shared one and record it:

```js
    const diameter = rowHeight * DIAMETER_FACTOR;
    const centerY = indicatorY({
        top: calendar.top,
        rowHeight,
        diameter,
        reservedRows: entry.holidays?.reservedRows,
    });
```

and add `placedY: centerY` to the AppData write inside it:

```js
        await updateCalendar(entry.calendarId, {
            indicator: {
                ...entry.indicator,
                circleId: circle.id,
                anchorId: anchor.id,
                connectorId: connector.id,
                placedY: centerY,
            },
        });
```

Replace `moveIndicator` with the version that writes y only on a real change:

```js
/**
 * x always follows today; y only follows the holiday block.
 *
 * Writing x on every difference is right - the marker is supposed to track the
 * date. y is not: the user is meant to be able to drag the circle higher and
 * have it stay, which is why this function wrote x alone for as long as the
 * circle had a fixed height above the calendar.
 *
 * Now that the holiday block can push it up, y has to move sometimes. The
 * guard is `placedY` - the y *we* last wrote - rather than the circle's actual
 * position. Comparing against the actual position would undo a hand-drag on
 * the very next tick; comparing against our own intent means a tick that wants
 * the same y as last time does not touch y at all, and only a changed holiday
 * block moves the circle. That is the moment the user expects it to jump.
 *
 * The lower anchor keeps its own y throughout: dragging it down is how the
 * line is made longer, and nothing here may take that back.
 */
async function moveIndicator(entry, x, y, legacyY) {
    // See shouldMoveIndicatorY in todayColumn.js for why a legacy indicator
    // (no placedY on record) falls back to legacyY instead of just writing y.
    const moveY = shouldMoveIndicatorY(y, entry.indicator.placedY, legacyY, NUDGE);

    const ids = [entry.indicator.circleId, entry.indicator.anchorId];

    for (const id of ids) {
        let item;
        try {
            item = await run(() => board.getById(id));
        } catch (error) {
            if (isRateLimitError(error)) {
                console.warn(`Timeline Builder: rate limited while moving the TODAY indicator for calendar ${entry.calendarId}, keeping it and skipping this pass.`);
                return;
            }

            await removeIndicator(entry);
            return;
        }

        const isCircle = id === entry.indicator.circleId;
        const wantsX = Math.abs(item.x - x) >= NUDGE;
        const wantsY = isCircle && moveY;

        if (!wantsX && !wantsY) continue;

        if (wantsX) item.x = x;
        if (wantsY) item.y = y;
        await run(() => item.sync());
    }

    if (moveY) {
        await updateCalendar(entry.calendarId, {
            indicator: { ...entry.indicator, placedY: y },
        });
    }
}
```

In `removeIndicator`, clear it along with the ids:

```js
    await updateCalendar(entry.calendarId, {
        indicator: {
            ...entry.indicator,
            circleId: null,
            anchorId: null,
            connectorId: null,
            placedY: null,
        },
    });
```

- [x] **Step 6: Initialise the field in `src/anchors.js`**

Replace line 45:

```js
        indicator: { enabled: indicatorEnabled, circleId: null, anchorId: null, connectorId: null, placedY: null },
```

- [x] **Step 7: Run the tests and the build**

Run: `npm test && npm run build`
Expected: beides erfolgreich. Insbesondere bleibt `the indicator does not move with the clock` aus `test/today.test.js` grün.

- [x] **Step 8: Commit**

```bash
git add src/today.js src/todayColumn.js src/anchors.js test/today.test.js
git commit -m "lifts the TODAY circle above the holiday block"
```

Die Rekonstruktion über `legacyY`/`shouldMoveIndicatorY` (siehe Nachtrag zu Beginn dieser Task) kam als eigener Folge-Commit dazu, nachdem auffiel, dass `entry.indicator.placedY == null` für einen Alt-Indikator beim ersten Tick nach dem Deploy fälschlich `true` ergeben und einen von Hand positionierten Kreis zurückgesetzt hätte:

```bash
git commit -m "reconstructs placedY for indicators drawn before it existed"
```

---

### Task 10: Spec und Plan mit dem gebauten Stand abgleichen

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-feiertage-und-schulferien-design.md`
- Modify: `docs/superpowers/plans/2026-07-30-feiertage-und-schulferien.md`

- [x] **Step 1: Reconcile the spec with what was built**

Durchgehen und korrigieren, wo die Umsetzung vom Spec abgewichen ist. Bekannt schon jetzt:

- Der Spec beschreibt die Endpunkte **mit** `subdivisionCode`. Gebaut wird **ohne**: ein Aufruf pro Art für ganz Deutschland, gefiltert wird lokal. Der Abschnitt „Die Datenquelle" ist entsprechend anzupassen, inklusive der Begründung (konstante Zahl von Netzwerkaufrufen, Auswahlwechsel ohne Neuabruf).
- Der Spec erwähnt `/Subdivisions` nur beiläufig. Es ist ein dritter Aufruf, der beim ersten Öffnen des Tabs passiert und die Namen für die Kürzelzeile liefert — inklusive „Augsburg".
- Der NRW-Override (`DE-NW` → `NRW`, weil die API `NW` liefert) steht nirgends im Spec.
- Die „Offenen API-Fragen" sind nicht beantwortet, sondern verlagert: die Sticky-Grüntöne stehen als belegte Annahme in `src/stickyColors.js`, und die Connector-Frage beantwortet `holidayDraw.js` zur Laufzeit mit einem Rückfallpfad. Der Abschnitt ist entsprechend umzuschreiben, samt Verweis auf `docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md`.
- `HOLIDAY_COLORS` nutzt `dark_green`, nicht `green`. Der Spec nennt `green`/`light_green`; Miros `green` ist ein Olivton und trifft das Mockup nicht.

- [x] **Step 2: Tick every checkbox in this plan that was actually done**

- [x] **Step 3: Commit**

```bash
git add docs/superpowers
git commit -m "brings the holiday spec in line with what shipped"
```

---

## Manuelle Board-Prüfung (nach Phase 3 und 4)

Kein Unit-Test deckt das ab; hier wird von Hand geschaut.

- [ ] Kalender für 2026 zeichnen, Tab **Holidays** öffnen, Bayern und Hessen wählen, zeichnen.
- [ ] Neun Stickies erwartet: Neujahr, Heilige Drei Könige, Karfreitag, Ostermontag, Tag der Arbeit, Christi Himmelfahrt, Pfingstmontag, Fronleichnam, 1. Weihnachtsfeiertag. Neujahr, Karfreitag, Ostermontag, Tag der Arbeit, Christi Himmelfahrt, Pfingstmontag und der 25.12. kräftig grün; Heilige Drei Könige und Fronleichnam blass.
- [ ] In der Hinweisliste fünf Wochenend-Meldungen: Friedensfest, Mariä Himmelfahrt, Tag der Deutschen Einheit, Allerheiligen, 2. Weihnachtsfeiertag. (2026 ist dafür ein besonders unglückliches Jahr — das ist richtig so, kein Fehler.)
- [ ] Karfreitag und Ostermontag stehen in benachbarten Spalten: die Stickies weichen seitlich aus, die Connectoren laufen schräg.
- [ ] Zwei Ferienbänder, Bayern über Hessen, verschiedene Pastelltöne, Beschriftung mit echten Datumsangaben.
- [ ] **Die beiden Grüntöne prüfen.** Tagesmarke und zugehöriges Sticky müssen wie ein Paar aussehen. Tun sie das nicht, sind die angenommenen Hexwerte falsch — zu korrigieren ausschließlich in `src/stickyColors.js`.
- [ ] **In der Konsole nachsehen, welchen Weg der Connector genommen hat.** Erscheint `connectors cannot end inside a group, using anchors instead`, hat Miro das direkte Ziel abgelehnt und der Rückfallpfad läuft — funktioniert, kostet aber eine unsichtbare Shape pro Feiertag.
- [ ] Der TODAY-Kreis sitzt über den Stickies.
- [ ] Kreis von Hand höher ziehen, zehn Minuten warten (oder das Panel neu laden): er bleibt oben, nur x wird nachgeführt.
- [ ] Erneut zeichnen, diesmal nur Bayern: das Hessen-Band verschwindet, die Tageszellen von Fronleichnam bleiben markiert, kein Duplikat entsteht, der Kreis rückt eine Zeile tiefer.
- [ ] Ein Bundesland abwählen, so dass gar keine Feiertage übrig sind — die Tageszellen kehren zu ihrem Orangeton zurück.
- [ ] Kalender verschieben: die Tagesmarken ziehen mit (sie sind die Zellen), Bänder und Stickies bleiben liegen. Erwartet, nicht schön — steht so im Spec.
- [ ] Einen Kalender ungruppieren und zeichnen: klare Meldung, nichts wird gezeichnet.

---

## Self-Review dieses Plans

**Spec-Abdeckung.** Jeder Abschnitt des Specs hat einen Task: die tragende Idee (`groupId`) → Task 5; Datenquelle → Task 2; `nationwide` gegen `regionalScope`, lokale Feiertage, Auswahl gegen Anzeige → Task 3; Darstellung und Geometrie → Task 4 und 7; seitliches Ausweichen → Task 4; TODAY-Kreis und `placedY` → Task 9; AppData → Task 7 und 9; Fehlerbehandlung → Task 7 und 8; Tests → Tasks 1–5; die offenen API-Fragen → Task 6 und der Rückfallpfad in Task 7.

**Abweichungen vom Spec, die hier bewusst eingebaut sind** und in Task 10 nachgetragen werden:

1. `fetchHolidays` fragt **ohne** `subdivisionCode` ab und filtert lokal. Zwei Aufrufe statt zwei pro Bundesland, und ein Wechsel der Auswahl braucht keinen neuen Abruf.
2. Ein dritter Aufruf `/Subdivisions` beim ersten Öffnen des Tabs. Er füllt die Auswahlliste mit deutschen Namen und liefert „Augsburg" für die Kürzelzeile des Friedensfests — ohne ihn wäre dort nur `BY-AU` möglich, und die Entscheidung „Kürzel nennt den Ort" ließe sich nicht umsetzen.
3. `SHORT_NAME_OVERRIDES`: die API liefert `NW`, der Screenshot und jeder deutsche Leser schreiben `NRW`. Ein Eintrag.
4. Die zwei offenen API-Fragen werden **nicht am Board gemessen**, wie der Spec vorsah — so entschieden. Stattdessen: die Grüntöne als belegte Annahme an genau einer Stelle (`src/stickyColors.js`, `dark_green`/`light_green` statt `green`/`light_green`), und die Connector-Frage als Rückfallpfad zur Laufzeit statt als Vorabmessung. Beides ist in `docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md` festgehalten, inklusive der Symptome, an denen man merkt, dass die Annahme falsch war.

**Was dieser Plan bewusst nicht testet.** Board-I/O — `dayCells.js`, `holidayDraw.js`, `holidayView.js` — hat keine Unit-Tests. Das ist dieselbe Grenze wie im Vorgängerplan und der Grund, warum die manuelle Prüfliste oben so ausführlich ist. `dayCellsOf` ist die riskanteste ungetestete Stelle, weil ein falscher Index die Marke auf den falschen Tag setzt; die `cells.length !== totalWorkingDays(year)`-Prüfung ist das, was einen solchen Fehler in eine Verweigerung verwandelt statt in eine stille Falschmarkierung.
