# Teilkalender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Kalender lässt sich für einen Abschnitt des Jahres zeichnen (Monatsgrenzen, innerhalb eines Kalenderjahres), und alles, was auf einem Kalender aufsetzt — Urlaub, Feiertage, Schulferien, TODAY-Indikator — arbeitet darauf genauso wie auf einem ganzen Jahr.

**Architecture:** Der Spaltenraum bleibt am 1. Januar verankert; nur das gezeichnete Fenster ist kleiner. Zwei Eingriffe tragen das: `gridFrom` verankert Spalte 0 statt der ersten gezeichneten Zelle, wodurch jede vorhandene Datum→x-Rechnung unverändert weiterläuft, und die Blockbauer rechnen weiter das ganze Jahr, während ein gemeinsames `clipBlocks` das Ergebnis aufs Fenster schneidet. Gespeichert wird die Eingabe (`{ from, to }` als ISO-Daten); alles Abgeleitete wird bei jedem Auflösen neu gerechnet.

**Tech Stack:** Vanilla ES modules, Vite 3, dayjs 1.11, Mirotone 5, Miro Web SDK v2, `node:test` + `node:assert/strict`.

**Spec:** [docs/superpowers/specs/2026-08-11-teilkalender-design.md](../specs/2026-08-11-teilkalender-design.md)

**Issue:** [#1](https://github.com/framegrabber/miro-timeline-builder/issues/1)

## Global Constraints

- **Sprache im Panel: Englisch, durchgehend.** Alle für den Nutzer sichtbaren Strings und alle Code-Kommentare sind englisch. Diese Planungsdokumente sind deutsch.
- **Genau eine Spaltenrechnung.** Jede Umrechnung Datum → Spalte geht durch `columnOf` in `src/calendar.js`. Kein Modul zählt selbst Tage, und kein Blockbauer lernt einen zweiten Modus — geschnitten wird ausschließlich mit `clipBlocks`.
- **Jeder Board-Call geht durch `run()`** aus `src/board.js`. Kein Modul außer `src/board.js` liest `window.miro`.
- **Reine Module importieren `board.js` nicht.** `src/board.js` liest `window` beim Laden des Moduls; ein Test-Import würde unter Node abstürzen. `calendar.js`, `spans.js`, `vacation.js`, `holidays.js`, `colors.js` und `indicatorGeometry.js` bleiben frei davon.
- **Ratenlimit-Fehler sind kein „ist weg".** Wo ein `getById` fehlschlägt, unterscheidet `isRateLimitError(error)`: bei Ratenlimit bleibt der gespeicherte Zustand stehen und der Durchlauf wird übersprungen.
- **Ein ganzes Jahr muss bitgleich bleiben.** Ein Kalender über Januar–Dezember ergibt dieselben Blöcke und dieselben Koordinaten wie vor dieser Änderung. Das ist die eigentliche Abnahme.
- **Keine Migration.** Ein AppData-Eintrag ohne `range` heißt „ganzes Jahr" und funktioniert unverändert weiter.
- **Bereich = ein Kalenderjahr, Monatsgrenzen.** Keine jahresübergreifenden Bereiche, keine freien Datumsgrenzen (siehe Nicht-Ziele im Spec).
- Commit-Nachrichten englisch, ohne Präfix-Zwang, im Stil der vorhandenen Historie (`counts columns by day rather than by instant`).

## Der Bereich als Objekt

Ein *range* ist im ganzen Projekt dasselbe Objekt, und `rangeFrom` ist die einzige Stelle, die eines erzeugt:

```js
{ year: 2026, from: '2026-07-01', to: '2026-12-31', firstColumn: 130, columns: 131 }
```

`year` fährt mit, weil jeder Verbraucher es für `columnOf` braucht und zwei getrennt weitergereichte Werte auseinanderlaufen können. `from`/`to` sind auf Arbeitstage gerückt, also idempotent: `rangeFrom` auf sein eigenes Ergebnis angewandt ergibt dasselbe Objekt.

## Dateien

**Geändert, rein (`node --test` deckt alles ab):**

| Datei | Änderung |
|---|---|
| `src/calendar.js` | neu: `rangeFrom`, `fullYearRange`, `describeRange`, `clipBlocks`; `gridFrom` bekommt `firstColumn` |
| `src/spans.js` | `placeSpan` nimmt einen Bereich, klemmt aufs Fenster, Problem `outside-range` |
| `src/vacation.js` | `planVacations` nimmt einen Bereich, Meldung nennt ihn |
| `src/holidays.js` | `planStickies` und `planBands` nehmen einen Bereich |
| `src/indicatorGeometry.js` | `columnForToday` nimmt einen Bereich |

**Geändert, mit Board-Zugriff:**

| Datei | Änderung |
|---|---|
| `src/anchors.js` | `tagCalendar` speichert `range`; `measure` leitet ihn ab und gibt `gridFrom` das `firstColumn` |
| `src/dayCells.js` | Sollzahl ist `range.columns`; Rückgabe nach absoluter Spalte indiziert |
| `src/today.js` | ein Aufruf: `columnForToday(calendar.range, today)` |
| `src/app.js` | Monatsauswahl → `{ from, to }`, Zeilen zuschneiden, Zeichenursprung verschieben, Validierung |
| `src/import.js` | Bereich an `planVacations`, `describeRange` in der Auswahlliste |
| `src/holidayView.js` | Bereich an `planStickies`/`planBands`, `describeRange` in der Auswahlliste |
| `app.html` | zwei Monats-Selects, zwei Schnellknöpfe H1/H2 |

**Tests:** `test/calendar.test.js`, `test/spans.test.js`, `test/vacation.test.js`, `test/holidays.test.js`, `test/today.test.js` — neue Fälle plus eine mechanische Umschreibung der Aufrufe (siehe Task 7).

**Unberührt:** `src/today.js` bis auf den einen Aufruf, die Geometrie in `src/holidayDraw.js`, `src/colors.js`, `src/stickyColors.js`, `src/rateLimit.js`, `src/board.js`, `src/openHolidays.js`, `src/index.js`.

---

## Phase 1 — Der Bereich als Begriff (Tasks 1–3)

Rein, ohne Board. Nach Phase 1 verhält sich die App unverändert: die neuen Funktionen existieren, sind getestet und werden von niemandem benutzt.

---

### Task 1: `clipBlocks`

Der einzige Schneider im Projekt. Die Blockbauer bleiben unverändert und rechnen weiter das ganze Jahr; diese Funktion schneidet ihr Ergebnis aufs Fenster. Dass die Iterationsnummern dadurch weiter vom Jahresanfang zählen (H2 beginnt bei Sprint 14), ist gewollt und fällt heraus.

**Files:**
- Modify: `src/calendar.js` (anhängen, nach `widthOfColumns`)
- Test: `test/calendar.test.js` (anhängen)

**Interfaces:**
- Consumes: nichts
- Produces: `clipBlocks(blocks, { firstColumn, columns })` → neues Array; jeder Block behält alle Felder außer `colStart`/`colSpan`, Blöcke ganz außerhalb fallen weg

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

Der Import am Kopf von `test/calendar.test.js` wird um `clipBlocks` erweitert (die Datei importiert schon `monthBlocks`, `dayBlocks`, `totalWorkingDays` und weitere aus `../src/calendar.js` — nur den Namen ergänzen). Dann anhängen:

```js
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
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../src/calendar.js' does not provide an export named 'clipBlocks'`

- [ ] **Step 3: Die minimale Implementierung schreiben**

In `src/calendar.js`, direkt nach `widthOfColumns`:

```js
/**
 * Cuts a full year's blocks down to the drawn window.
 *
 * The row builders above all compute a whole year and know nothing about
 * windows. That is deliberate: teaching each of them to clip would put the same
 * clamping arithmetic in five places, which is exactly what this project keeps
 * out of its row builders. Computing 261 day blocks and dropping half of them
 * costs nothing measurable.
 *
 * Every other field of a block is carried through, because the rows need them:
 * the day row colours by `weekday`, the month row labels by `label`, the week
 * row by `week`. Only colStart and colSpan are recomputed.
 *
 * A side effect worth naming: because the builders still count from the start of
 * the year, iteration numbers keep counting too - a second-half calendar starts
 * at Sprint 14, not at Sprint 1.
 */
export function clipBlocks(blocks, { firstColumn, columns }) {
    const lastColumn = firstColumn + columns - 1;
    const clipped = [];

    for (const block of blocks) {
        const colStart = Math.max(block.colStart, firstColumn);
        const colEnd = Math.min(block.colStart + block.colSpan - 1, lastColumn);

        if (colEnd < colStart) continue;

        clipped.push({ ...block, colStart, colSpan: colEnd - colStart + 1 });
    }

    return clipped;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test`
Expected: PASS, inklusive aller vorhandenen Tests.

- [ ] **Step 5: Den Schnitt gegenprüfen**

Ändere `Math.max(block.colStart, firstColumn)` testweise zu `block.colStart` und lasse `npm test` laufen.
Expected: FAIL in `a block straddling the left edge is cut on the left`, `a block covering the whole window becomes the window`, `a block ending exactly on the first column survives with one column`, `a clipped month row covers every column of the window exactly once` — danach zurücksetzen und `npm test` erneut laufen lassen.

- [ ] **Step 6: Commit**

```bash
git add src/calendar.js test/calendar.test.js
git commit -m "cuts a full year's blocks down to a drawn window"
```

---

### Task 2: `rangeFrom`, `fullYearRange`, `describeRange`

Die einzige Stelle, die einen Bereich erzeugt. Sie klemmt aufs Jahr, rückt auf Arbeitstage und verweigert, was kein Raster ergeben kann.

**Files:**
- Modify: `src/calendar.js` (anhängen)
- Test: `test/calendar.test.js` (anhängen)

**Interfaces:**
- Consumes: `columnOf`, `nextWorkingDay`, `previousWorkingDay`, `firstWorkingDayOf`, `lastWorkingDayOf`, `totalWorkingDays` (alle im selben Modul)
- Produces:
  - `rangeFrom({ year, from, to })` → `{ year, from, to, firstColumn, columns }` oder `null`
  - `fullYearRange(year)` → derselbe Objekttyp, Januar–Dezember
  - `describeRange(range)` → `'2026'` für ein ganzes Jahr, sonst `'2026 (Jul-Dec)'`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

Import um `rangeFrom`, `fullYearRange`, `describeRange` erweitern, dann anhängen:

```js
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
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL — `does not provide an export named 'rangeFrom'`

- [ ] **Step 3: Die minimale Implementierung schreiben**

In `src/calendar.js` anhängen:

```js
/**
 * The one place a drawn range is made, and the only shape of range there is.
 *
 * `year` travels inside the object because every consumer needs it for
 * columnOf, and a year passed separately from its bounds is a pair that can
 * drift. `from` and `to` come back moved onto working days, which makes the
 * result idempotent: feeding a stored range back in yields the same object, so
 * measure() can resolve what tagCalendar wrote without a second rule.
 *
 * Returns null rather than something plausible when the input cannot describe a
 * grid - fewer than two columns has no pitch for gridFrom to measure, and a
 * one-day calendar is not a calendar. Same choice gridFrom itself makes.
 */
export function rangeFrom({ year, from, to }) {
    const yearStart = dayjs(`${year}-01-01`);
    const yearEnd = dayjs(`${year}-12-31`);

    let start = dayjs(from);
    let end = dayjs(to);

    if (!start.isValid() || !end.isValid()) return null;

    // Clamped, not refused: a stored range predating a year change, or a
    // half-open input, still describes a drawable window once cut to the year.
    if (start.isBefore(yearStart, 'day')) start = yearStart;
    if (end.isAfter(yearEnd, 'day')) end = yearEnd;

    start = nextWorkingDay(start);
    end = previousWorkingDay(end);

    if (end.isBefore(start, 'day')) return null;

    const firstColumn = columnOf(year, start);
    const columns = columnOf(year, end) - firstColumn + 1;

    if (columns < 2) return null;

    return {
        year,
        from: start.format('YYYY-MM-DD'),
        to: end.format('YYYY-MM-DD'),
        firstColumn,
        columns,
    };
}

/** What a calendar entry without a stored range means. */
export function fullYearRange(year) {
    return rangeFrom({
        year,
        from: firstWorkingDayOf(year).format('YYYY-MM-DD'),
        to: lastWorkingDayOf(year).format('YYYY-MM-DD'),
    });
}

/**
 * How a range is named to the user - in calendar dropdowns and in the note an
 * import leaves for an entry it could not place.
 */
export function describeRange({ year, from, to }) {
    const wholeYear = dayjs(from).isSame(firstWorkingDayOf(year), 'day')
        && dayjs(to).isSame(lastWorkingDayOf(year), 'day');

    if (wholeYear) return String(year);

    return `${year} (${dayjs(from).format('MMM')}-${dayjs(to).format('MMM')})`;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar.js test/calendar.test.js
git commit -m "makes the drawn range a thing the calendar can describe"
```

---

### Task 3: `gridFrom` verankert Spalte 0

Der Eingriff, der alles andere billig macht. Bisher heißt `startX`: linker Rand der ersten gezeichneten Zelle, also stillschweigend Spalte 0. Mit `firstColumn` wird daraus die x-Koordinate, die Spalte 0 hätte — und `xOfColumn(grid, absoluteSpalte)` stimmt danach überall, ohne dass ein Aufrufer etwas merkt.

`firstColumn` bekommt den Standardwert `0`, damit die vorhandenen Aufrufer und die vorhandenen Tests unverändert bleiben.

**Files:**
- Modify: `src/calendar.js` — `gridFrom`
- Test: `test/calendar.test.js` (anhängen)

**Interfaces:**
- Consumes: `rangeFrom`, `fullYearRange` (Task 2) in den Tests
- Produces: `gridFrom({ firstCenterX, lastCenterX, cellWidth, columns, firstColumn })` → `{ startX, shapeWidth, padding }` oder `null`; `firstColumn` fehlend zählt als `0`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

Anhängen an `test/calendar.test.js`:

```js
// --- measuring a window rather than a whole year -------------------------------

test('a measured window puts its first drawn column where it was measured', () => {
    const range = rangeFrom({ year: 2026, from: '2026-07-01', to: '2026-12-31' });
    const cellWidth = 100;
    const pitch = cellWidth + 2;

    // What the board would report for a window drawn with its first cell's
    // left edge at x = 5000.
    const firstCenterX = 5000 + cellWidth / 2;
    const lastCenterX = firstCenterX + (range.columns - 1) * pitch;

    const grid = gridFrom({
        firstCenterX,
        lastCenterX,
        cellWidth,
        columns: range.columns,
        firstColumn: range.firstColumn,
    });

    assert.equal(grid.shapeWidth, cellWidth);
    assert.ok(Math.abs(grid.padding - 2) < 1e-6);
    // Asking for the absolute column of the first drawn cell must give back the
    // left edge it was measured at.
    assert.ok(Math.abs(xOfColumn(grid, range.firstColumn) - 5000) < 1e-6);
    // And the last drawn column lands on the last measured centre.
    const lastLeft = xOfColumn(grid, range.firstColumn + range.columns - 1);
    assert.ok(Math.abs(lastLeft + cellWidth / 2 - lastCenterX) < 1e-6);
});

test('a window and a whole year agree about a column they share', () => {
    const cellWidth = 100;
    const pitch = cellWidth + 2;
    const whole = fullYearRange(2026);
    const window = rangeFrom({ year: 2026, from: '2026-07-01', to: '2026-12-31' });

    // Both drawn so that absolute column 0 sits at x = 0.
    const wholeGrid = gridFrom({
        firstCenterX: cellWidth / 2,
        lastCenterX: cellWidth / 2 + (whole.columns - 1) * pitch,
        cellWidth,
        columns: whole.columns,
        firstColumn: whole.firstColumn,
    });
    const windowGrid = gridFrom({
        firstCenterX: window.firstColumn * pitch + cellWidth / 2,
        lastCenterX: (window.firstColumn + window.columns - 1) * pitch + cellWidth / 2,
        cellWidth,
        columns: window.columns,
        firstColumn: window.firstColumn,
    });

    const column = window.firstColumn + 20;
    assert.ok(Math.abs(xOfColumn(wholeGrid, column) - xOfColumn(windowGrid, column)) < 1e-6);
});

test('an absent firstColumn still means column zero', () => {
    const sane = { firstCenterX: 50, lastCenterX: 50 + 260 * 102, cellWidth: 100, columns: 261 };

    assert.deepEqual(gridFrom(sane), gridFrom({ ...sane, firstColumn: 0 }));
});
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL in `a measured window puts its first drawn column where it was measured` — `xOfColumn(grid, 130)` liefert die Koordinate, als wäre die erste gezeichnete Zelle Spalte 0, also rund 130 Rasterschritte zu weit rechts.

- [ ] **Step 3: `gridFrom` erweitern**

Signatur und `startX` in `src/calendar.js` ändern; der vorhandene Kommentarblock bleibt und bekommt einen Absatz:

```js
/**
 * Rebuilds the drawing settings from two measured day cells, so a calendar
 * that is already on the board can be addressed by date again.
 *
 * The measured x of a cell is its centre, because app.js creates shapes
 * centred - hence the half-width shift back to the left edge.
 *
 * `startX` is the x that column 0 would have, not the x of the first drawn
 * cell. For a calendar drawn over the whole year those are the same thing,
 * which is why this argument defaults to 0 and nothing else had to change. For
 * a window they are not, and anchoring column 0 is what lets every caller keep
 * asking for an absolute column - holidays, vacation bars and the TODAY
 * indicator all position themselves through xOfColumn and need no idea that a
 * window exists.
 *
 * Returns null when the measurement cannot describe a grid. That is the case
 * once a single cell has been dragged out of the calendar: the derived pitch
 * then describes nothing real, and putting something plausible-looking in the
 * wrong place is worse than putting nothing anywhere.
 */
export function gridFrom({ firstCenterX, lastCenterX, cellWidth, columns, firstColumn = 0 }) {
    if (!(cellWidth > 0) || !(columns > 1)) return null;

    const pitch = (lastCenterX - firstCenterX) / (columns - 1);
    const padding = pitch - cellWidth;

    if (!(pitch > 0) || padding < 0 || padding > cellWidth) return null;

    return {
        startX: firstCenterX - cellWidth / 2 - firstColumn * pitch,
        shapeWidth: cellWidth,
        padding,
    };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test`
Expected: PASS, inklusive der vorhandenen `gridFrom`-Tests — die rufen ohne `firstColumn` auf und dürfen sich nicht bewegen.

- [ ] **Step 5: Commit**

```bash
git add src/calendar.js test/calendar.test.js
git commit -m "anchors the measured grid on column zero, not on the first drawn cell"
```

---

## Phase 2 — Der Kalender kennt seinen Abschnitt (Tasks 4–6)

Ab hier ist Board-I/O im Spiel, für das es kein Test-Harness gibt. `npm test` bleibt die Regressionsschranke für Phase 1, `npm run build` die Syntaxschranke. Nach Phase 2 zeichnet die App noch immer ganze Jahre — aber jeder aufgelöste Kalender trägt einen Bereich, und alles, was ihn liest, ist umgestellt.

---

### Task 4: `anchors.js` speichert und löst den Bereich auf

**Files:**
- Modify: `src/anchors.js` — Importe, `tagCalendar`, `measure`

**Interfaces:**
- Consumes: `rangeFrom`, `fullYearRange` (Task 2), `gridFrom` mit `firstColumn` (Task 3)
- Produces:
  - `tagCalendar({ drawnRows, rows, year, range, indicatorEnabled })` — `range` ist `{ from, to }`; fehlt es, wird `fullYearRange(year)` gespeichert
  - AppData: `entry.range = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`
  - `findCalendars()` liefert Kalender mit `calendar.range = { year, from, to, firstColumn, columns }`

- [ ] **Step 1: Import erweitern**

```js
import { gridFrom, rangeFrom, fullYearRange } from './calendar.js';
```

`totalWorkingDays` wird hier nicht mehr gebraucht — `measure` bekommt die Spaltenzahl jetzt aus dem Bereich. Aus dem Import entfernen.

- [ ] **Step 2: `tagCalendar` speichert den Bereich**

Signatur und der `calendars.push`-Block:

```js
export async function tagCalendar({ drawnRows, rows, year, range, indicatorEnabled = true }) {
```

```js
    // Stored as the input it came from, not as columns: firstColumn and columns
    // are derived from the year, and two stored numbers that can drift from it
    // are a bug waiting for someone to edit one of them. A missing range means
    // the whole year, which is why every calendar drawn before this existed
    // keeps working - but a fresh one always writes the field, so the shape of
    // an entry is uniform.
    const drawn = range ?? fullYearRange(year);

    const calendars = await readCalendars();
    calendars.push({
        calendarId,
        year,
        range: { from: drawn.from, to: drawn.to },
        anchors: {
            firstDay: shapes.firstDay.id,
            lastDay: shapes.lastDay.id,
            topLeft: shapes.topLeft.id,
        },
        indicator: { enabled: indicatorEnabled, circleId: null, anchorId: null, connectorId: null, placedY: null, placedAnchorY: null },
        vacationItemIds: [],
    });
```

- [ ] **Step 3: `measure` löst den Bereich auf**

Der `gridFrom`-Aufruf und die Rückgabe in `measure`:

```js
    // An entry without a range is a calendar drawn before windows existed: the
    // whole year, by definition. A stored range that no longer resolves (an
    // impossible from/to, a hand-edited AppData blob) is treated like an
    // implausible measurement rather than a missing anchor - the entry stays,
    // only this pass is skipped, so nothing is thrown away over data that a
    // redraw can fix.
    const range = entry.range
        ? rangeFrom({ year: entry.year, ...entry.range })
        : fullYearRange(entry.year);
    if (!range) return { calendar: null, reason: 'implausible' };

    const grid = gridFrom({
        firstCenterX: firstDay.x,
        lastCenterX: lastDay.x,
        cellWidth: firstDay.width,
        columns: range.columns,
        firstColumn: range.firstColumn,
    });
    if (!grid) return { calendar: null, reason: 'implausible' };

    return {
        calendar: {
            entry,
            year: entry.year,
            range,
            grid,
            rowHeight: firstDay.height,
            top: topLeft.y - topLeft.height / 2,
            bottom: firstDay.y + firstDay.height / 2,
            groupId: firstDay.groupId,
        },
        reason: null,
    };
```

Der vorhandene Kommentarblock über `measure` bleibt unverändert; die Doku über `tagCalendar` („Nothing derived is stored") stimmt weiterhin und wird um einen Satz ergänzt:

```
 * The drawn range is stored as the two dates it came from, for the same reason:
 * firstColumn and columns are derived, and are recomputed on every resolve.
```

- [ ] **Step 4: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS und ein Build ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/anchors.js
git commit -m "stores the drawn range and resolves it back into columns"
```

---

### Task 5: `dayCells.js` indiziert nach absoluter Spalte

`holidayDraw.js` greift an drei Stellen mit `cells[column]` zu, wobei `column` absolut ist. Bei einem Fenster ist der Array-Index aber `column - firstColumn`. Statt drei Aufrufstellen umzurechnen, ändert sich der Rückgabetyp: ein nach absoluter Spalte indiziertes Objekt. Damit bleibt `cells[column]` wörtlich stehen, und das vorhandene `if (!cell) continue` deckt eine Spalte außerhalb des Fensters ab.

**Files:**
- Modify: `src/dayCells.js` — Import, Kopfkommentar, `dayCellsOf`

**Interfaces:**
- Consumes: `calendar.range` (Task 4)
- Produces: `dayCellsOf(calendar)` → `{ cells, reason }`, wobei `cells` ein Objekt ist, dessen Schlüssel die absoluten Spalten der gezeichneten Tageszellen sind

- [ ] **Step 1: Den Rückgabewert umstellen**

`totalWorkingDays` aus dem Import entfernen (`src/dayCells.js` importiert danach nur noch aus `./board.js`), und den Schluss von `dayCellsOf` ersetzen:

```js
    const dayRowY = calendar.bottom - calendar.rowHeight / 2;
    const sorted = items
        .filter((item) => Math.abs(item.y - dayRowY) < SAME_ROW)
        .sort((a, b) => a.x - b.x);

    // If the count is off, some cell was dragged out or something foreign was
    // dropped onto the row, and every index past that point means a different
    // day than it should. Refuse rather than mark the wrong date - the same
    // choice gridFrom makes when the measurement stops describing a grid.
    if (sorted.length !== calendar.range.columns) {
        return { cells: null, reason: 'incomplete' };
    }

    // Keyed by absolute column, not by position: a calendar drawn for part of a
    // year starts at firstColumn, and every caller addresses a cell by the
    // column a date resolves to. Handing back an array would make each of them
    // subtract firstColumn, which is three chances to forget.
    const cells = {};
    sorted.forEach((cell, index) => {
        cells[calendar.range.firstColumn + index] = cell;
    });

    return { cells, reason: null };
```

- [ ] **Step 2: Den Kopfkommentar nachziehen**

Im Modulkommentar den Satz über die Indizierung ersetzen. Aus

```
 * distinguishes it: every day cell shares the firstDay anchor's y. Sorted by x,
 * the position in the array is the column.
```

wird

```
 * distinguishes it: every day cell shares the firstDay anchor's y. Sorted by x,
 * the position plus the range's firstColumn is the column - and that is the key
 * the result is indexed by, so callers never do the addition themselves.
```

- [ ] **Step 3: Prüfen, dass kein Aufrufer den Array-Typ voraussetzt**

Run: `grep -n "cells" src/holidayDraw.js src/holidayView.js | grep -v "^.*://" | grep -vi "day cells\|the cells\|cells cannot"`
Expected: nur `cells[column]`-Zugriffe (`holidayDraw.js` an drei Stellen), Destrukturierungen `{ cells, reason }` und Weitergaben als Argument. Kein `cells.length`, kein `cells.map`, kein `for (const cell of cells)`. Findet sich doch eines, muss es in dieser Task mit umgestellt werden — nicht in einer späteren.

- [ ] **Step 4: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/dayCells.js
git commit -m "hands back day cells keyed by the column they hold"
```

---

### Task 6: `columnForToday` prüft gegen das Fenster

**Files:**
- Modify: `src/indicatorGeometry.js` — `columnForToday`
- Modify: `src/today.js` — der eine Aufruf
- Test: `test/today.test.js` — mechanische Umstellung plus drei neue Fälle

**Interfaces:**
- Consumes: `fullYearRange`, `rangeFrom` (Task 2); `calendar.range` (Task 4)
- Produces: `columnForToday(range, today)` → absolute Spalte oder `null`

- [ ] **Step 1: Die vorhandenen Aufrufe in den Tests umstellen**

18 Aufrufe in `test/today.test.js` übergeben eine Jahreszahl. Sie bekommen denselben Bereich, den ein ganzes Jahr ergibt — die Erwartungswerte ändern sich dadurch nicht:

```bash
sed -i '' -E 's/columnForToday\(([0-9]{4}),/columnForToday(fullYearRange(\1),/g' test/today.test.js
grep -n "columnForToday(" test/today.test.js
```
Expected: kein Aufruf mehr mit einer nackten Jahreszahl.

Den Import in `test/today.test.js` um `fullYearRange` und `rangeFrom` aus `../src/calendar.js` erweitern (die Datei importiert von dort schon `totalWorkingDays`, `firstWorkingDayOf`, `lastWorkingDayOf`).

- [ ] **Step 2: Die neuen Fälle schreiben**

Anhängen an `test/today.test.js`:

```js
// --- today against a partial calendar -----------------------------------------

const SECOND_HALF = rangeFrom({ year: 2026, from: '2026-07-01', to: '2026-12-31' });

test('a date inside the window keeps its absolute column', () => {
    const day = dayjs('2026-09-15');

    assert.equal(columnForToday(SECOND_HALF, day), columnOf(2026, day));
});

test('a date before the window has no column on this calendar', () => {
    assert.equal(columnForToday(SECOND_HALF, dayjs('2026-03-02')), null);
});

test('the window edges are inside it', () => {
    assert.equal(columnForToday(SECOND_HALF, dayjs(SECOND_HALF.from)), SECOND_HALF.firstColumn);
    assert.equal(
        columnForToday(SECOND_HALF, dayjs(SECOND_HALF.to)),
        SECOND_HALF.firstColumn + SECOND_HALF.columns - 1
    );
});

test('a date after the window has no column either', () => {
    const firstHalf = rangeFrom({ year: 2026, from: '2026-01-01', to: '2026-06-30' });

    assert.equal(columnForToday(firstHalf, dayjs('2026-08-03')), null);
});
```

`columnOf` dafür in den Import von `test/today.test.js` aufnehmen.

- [ ] **Step 3: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL — `columnForToday` liest `range` noch als Jahreszahl, also wirft `columnOf` auf `undefined` oder liefert unbrauchbare Spalten.

- [ ] **Step 4: `columnForToday` umstellen**

In `src/indicatorGeometry.js`:

```js
/**
 * The grid column today belongs in, or null when the drawn calendar does not
 * contain it.
 *
 * Saturdays and Sundays have no column of their own. columnOf counts working
 * days, so a weekend already resolves to the coming Monday - the agreed
 * behaviour needs no special case here, only the test that pins it down.
 *
 * The bounds are the drawn window's, not the year's. A calendar drawn for the
 * first half of the year has no column for a day in September, and the caller
 * treats that exactly like a disabled indicator: none is drawn, and an existing
 * one is removed. A marker for "today" on a calendar that does not contain
 * today would be a false statement.
 *
 * Kept in its own file, importing nothing but calendar.js: today.js also pulls
 * in board.js, which evaluates window.miro at module scope. Under
 * `node --test` there is no window, so a test importing this pure function
 * through today.js would fail on import alone, before any assertion runs.
 */
export function columnForToday({ year, firstColumn, columns }, today) {
    const column = columnOf(year, today);
    if (column < firstColumn || column >= firstColumn + columns) return null;
    return column;
}
```

`totalWorkingDays` wird in `src/indicatorGeometry.js` danach nicht mehr benutzt — aus dem Import entfernen, `columnOf` bleibt.

- [ ] **Step 5: Den Aufruf in `today.js` umstellen**

```js
    const column = columnForToday(calendar.range, today);
```

- [ ] **Step 6: Tests und Build**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

- [ ] **Step 7: Commit**

```bash
git add src/indicatorGeometry.js src/today.js test/today.test.js
git commit -m "asks whether today is on the drawn calendar, not in the year"
```

---

## Phase 3 — Inhalt auf einem Fenster (Tasks 7–8)

---

### Task 7: `placeSpan` klemmt aufs Fenster

**Files:**
- Modify: `src/spans.js` — Import, `placeSpan`
- Test: `test/spans.test.js` — mechanische Umstellung, zwei Problemnamen, drei neue Fälle

**Interfaces:**
- Consumes: `fullYearRange`, `rangeFrom` (Task 2)
- Produces: `placeSpan(range, start, end)` → `{ colStart, colSpan, clipped }` oder `{ problem: 'no-working-day' | 'outside-range' }`

- [ ] **Step 1: Die vorhandenen Aufrufe und Erwartungen umstellen**

```bash
sed -i '' -E 's/placeSpan\(([0-9]{4}),/placeSpan(fullYearRange(\1),/g' test/spans.test.js
sed -i '' "s/problem: 'outside-year'/problem: 'outside-range'/g" test/spans.test.js
grep -n "placeSpan(\|outside-" test/spans.test.js
```
Expected: kein `placeSpan` mit nackter Jahreszahl mehr, kein `outside-year` mehr. Den Import von `test/spans.test.js` um `fullYearRange` und `rangeFrom` aus `../src/calendar.js` erweitern.

- [ ] **Step 2: Die neuen Fälle schreiben**

Anhängen an `test/spans.test.js`:

```js
// --- spans against a window rather than a whole year ---------------------------

const SECOND_HALF = rangeFrom({ year: 2026, from: '2026-07-01', to: '2026-12-31' });

test('a span inside the window keeps its absolute columns', () => {
    const placed = placeSpan(SECOND_HALF, day('2026-09-01'), day('2026-09-04'));

    assert.deepEqual(placed, {
        colStart: columnOf(2026, day('2026-09-01')),
        colSpan: 4,
        clipped: false,
    });
});

test('a span reaching over the window start is cut and says so', () => {
    // Ends on the first drawn day, starts three working days before the window.
    const placed = placeSpan(SECOND_HALF, day('2026-06-26'), day(SECOND_HALF.from));

    assert.equal(placed.colStart, SECOND_HALF.firstColumn);
    assert.equal(placed.colSpan, 1);
    assert.equal(placed.clipped, true);
});

test('a span entirely before the window is outside the range', () => {
    assert.deepEqual(placeSpan(SECOND_HALF, day('2026-03-02'), day('2026-03-06')), {
        problem: 'outside-range',
    });
});

test('a span entirely after the window is outside the range too', () => {
    const firstHalf = rangeFrom({ year: 2026, from: '2026-01-01', to: '2026-06-30' });

    assert.deepEqual(placeSpan(firstHalf, day('2026-09-01'), day('2026-09-04')), {
        problem: 'outside-range',
    });
});
```

`columnOf` steht im Import von `test/spans.test.js` schon; `totalWorkingDays` wird dort nach dieser Umstellung nicht mehr gebraucht und kann bleiben oder entfallen — was `npm test` ohne Warnung akzeptiert, entscheidet der Implementierer.

- [ ] **Step 3: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL — `placeSpan` liest den Bereich noch als Jahreszahl.

- [ ] **Step 4: `placeSpan` umstellen**

In `src/spans.js`; `totalWorkingDays` fällt aus dem Import, `columnOf`, `nextWorkingDay` und `previousWorkingDay` bleiben:

```js
/**
 * Places one date span on the grid of one drawn calendar.
 *
 * The span is columnOf(end) - columnOf(start) + 1, both from the same tested
 * function that positioned the day cells. There is no second day count that
 * could drift from the first - which is the whole reason this exists as one
 * shared function rather than once per caller. The same arithmetic lived a
 * second time in SAPVac/drawshapes.js and produced the same off-by-one three
 * times.
 *
 * The bounds are the drawn window's, which for a calendar over the whole year
 * are the year's. A span outside them cannot be drawn at all; one reaching over
 * an edge is drawn short and says so through `clipped`.
 *
 * Returns either a placement or a single problem, never both.
 */
export function placeSpan({ year, firstColumn, columns }, start, end) {
    const lastColumn = firstColumn + columns - 1;

    // A period reported as Sat-Sun means the working days inside it.
    const from = nextWorkingDay(start);
    const to = previousWorkingDay(end);

    if (to.isBefore(from, 'day')) return { problem: 'no-working-day' };

    const rawStart = columnOf(year, from);
    const rawEnd = columnOf(year, to);

    if (rawEnd < firstColumn || rawStart > lastColumn) return { problem: 'outside-range' };

    const colStart = Math.max(firstColumn, rawStart);
    const colEnd = Math.min(lastColumn, rawEnd);

    return {
        colStart,
        colSpan: colEnd - colStart + 1,
        // A period running past either edge of the drawn calendar is
        // legitimately shorter on it, and callers that compare against a
        // reported duration need to know not to complain about it.
        clipped: rawStart < colStart || rawEnd > colEnd,
    };
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npm test`
Expected: FAIL, und zwar nur noch in `test/vacation.test.js` und `test/holidays.test.js` — die rufen `planVacations`/`planBands` mit einer Jahreszahl auf, die dort an `placeSpan` weitergegeben wird. Genau das stellt Task 8 um. `test/spans.test.js` und `test/calendar.test.js` sind grün.

- [ ] **Step 6: Commit**

Der Zwischenstand ist absichtlich rot: `placeSpan` und seine beiden Aufrufer gehören in eine Reihenfolge, und ein Commit, der beide Seiten in einem Schritt umbaut, wäre nicht mehr zu lesen.

```bash
git add src/spans.js test/spans.test.js
git commit -m "clips a span to the drawn window instead of to the year"
```

---

### Task 8: Die Planer und ihre zwei Aufrufer

`planVacations`, `planStickies` und `planBands` bekommen den Bereich statt der Jahreszahl, und die Meldung für einen Eintrag, der nicht platziert werden kann, nennt ihn. Nach dieser Task ist der Baum wieder grün.

**Files:**
- Modify: `src/vacation.js` — Import, `planVacations`
- Modify: `src/holidays.js` — Import, `planStickies`, `planBands`
- Modify: `src/import.js` — der `planVacations`-Aufruf, `describeRange` in der Auswahlliste
- Modify: `src/holidayView.js` — die `planStickies`/`planBands`-Aufrufe, `describeRange` in der Auswahlliste
- Test: `test/vacation.test.js`, `test/holidays.test.js` — mechanische Umstellung

**Interfaces:**
- Consumes: `placeSpan(range, start, end)` (Task 7), `describeRange(range)` (Task 2), `calendar.range` (Task 4)
- Produces:
  - `planVacations(entries, range)` → `{ rows, problems }`
  - `planStickies(entries, range, { selected, names })` → `{ stickies, problems }`
  - `planBands(entries, range, { selected, names })` → `{ rows, problems }`

- [ ] **Step 1: Die vorhandenen Aufrufe in den Tests umstellen**

```bash
sed -i '' -E 's/planVacations\(([^,]+), ([0-9]{4})\)/planVacations(\1, fullYearRange(\2))/g' test/vacation.test.js
sed -i '' -E 's/plan(Stickies|Bands)\(([^,]+), ([0-9]{4}),/plan\1(\2, fullYearRange(\3),/g' test/holidays.test.js
grep -n "planVacations(\|planStickies(\|planBands(" test/vacation.test.js test/holidays.test.js
```
Expected: kein Aufruf mehr mit einer nackten Jahreszahl. Beide Testdateien bekommen `fullYearRange` in den Import aus `../src/calendar.js` (`test/holidays.test.js` importiert von dort noch nichts — dann eine neue Importzeile anlegen).

Die Erwartungen selbst bleiben unverändert: die beiden Tests, die eine Meldung prüfen, matchen auf `/2026/`, und `describeRange(fullYearRange(2026))` ist genau `'2026'`.

- [ ] **Step 2: `planVacations` umstellen**

In `src/vacation.js` den Import ergänzen und die Signatur samt Meldung ändern:

```js
import { describeRange } from './calendar.js';
```

```js
/**
 * Places every entry on the grid of one drawn calendar.
 *
 * The arithmetic lives in spans.js, shared with the school holiday bands. Only
 * the comparison against the duration SAP reported is specific to this caller.
 */
export function planVacations(entries, range) {
```

```js
        if (span.problem === 'outside-range') {
            problems.push(`${where}: is not in the drawn range ${describeRange(range)}.`);
            continue;
        }
```

und der `placeSpan`-Aufruf in derselben Funktion:

```js
        const span = placeSpan(range, entry.start, entry.end);
```

- [ ] **Step 3: `planStickies` und `planBands` umstellen**

In `src/holidays.js` den Import ergänzen (die Datei importiert schon `columnOf` und `isWorkingDay` aus `./calendar.js`):

```js
import { columnOf, isWorkingDay, describeRange } from './calendar.js';
```

`planStickies` bekommt den Bereich, behält die Jahresprüfung und bekommt die Fensterprüfung dazu:

```js
export function planStickies(entries, range, { selected, names }) {
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
        if (entry.date.year() !== range.year) {
            problems.push(`${entry.name}: is not in ${range.year}.`);
            continue;
        }

        const column = columnOf(range.year, entry.date);

        // Inside the year but outside the drawn window: there is no day cell to
        // mark and no column to hang a sticky over. Named rather than dropped,
        // for the same reason an out-of-range vacation entry is named - a wrong
        // date and a date outside the section must not look the same.
        if (column < range.firstColumn || column >= range.firstColumn + range.columns) {
            problems.push(`${entry.name}: is not in the drawn range ${describeRange(range)}.`);
            continue;
        }

        stickies.push({
            column,
            name: entry.name,
            subtitle: subtitleFor(entry, names),
            nationwide: entry.nationwide,
        });
    }

    stickies.sort((a, b) => a.column - b.column || (a.name < b.name ? -1 : 1));
    return { stickies, problems };
}
```

`planBands` erbt die Fenstergrenzen über `placeSpan`:

```js
export function planBands(entries, range, { selected, names }) {
```

```js
            const span = placeSpan(range, entry.start, entry.end);
```

```js
            if (span.problem === 'outside-range') {
                problems.push(`${where}: is not in the drawn range ${describeRange(range)}.`);
                continue;
            }
```

- [ ] **Step 4: Die zwei Aufrufer umstellen**

In `src/import.js`:

```js
    const { rows, problems: planProblems } = planVacations(entries, calendar.range);
```

und in der Auswahlliste (`chooseCalendar`) die Beschriftung:

```js
            option.textContent = describeRange(candidate.range);
```

mit `describeRange` im Import aus `./calendar.js` (`src/import.js` importiert von dort schon `xOfColumn` und `widthOfColumns`).

In `src/holidayView.js`:

```js
    const planned = planStickies(publicHolidays.entries, calendar.range, { selected, names });
    const banded = planBands(schoolHolidays.entries, calendar.range, { selected, names });
```

und ebenfalls in der Auswahlliste:

```js
            option.textContent = describeRange(candidate.range);
```

`describeRange` dazu in den Import aufnehmen.

Die Filterung der Kandidaten über `years.includes(calendar.year)` in `src/import.js` bleibt, wie sie ist: sie ist bei zwei Abschnitten desselben Jahres zu grob, aber der Nutzer wählt dann anhand der Beschriftung, und Einträge außerhalb des Fensters werden ohnehin gemeldet.

- [ ] **Step 5: Tests und Build**

Run: `npm test && npm run build`
Expected: PASS für alle Tests, Build ohne Fehler. Damit ist der rote Zwischenstand aus Task 7 geschlossen.

- [ ] **Step 6: Commit**

```bash
git add src/vacation.js src/holidays.js src/import.js src/holidayView.js test/vacation.test.js test/holidays.test.js
git commit -m "plans vacation and holidays against the drawn range"
```

---

## Phase 4 — Zeichnen und Panel (Tasks 9–10)

---

### Task 9: `app.js` zeichnet ein Fenster

Drei Dinge in einer Task, weil sie sich gegenseitig bedingen: den Bereich aus dem Panel lesen, die Zeilen zuschneiden und den Zeichenursprung verschieben. Ohne die Verschiebung landet ein H2-Kalender ein halbes Jahr weit rechts vom Blickfeld.

**Files:**
- Modify: `src/app.js` — Importe, `drawCalendar`, `planRows`, `validateRange`

**Interfaces:**
- Consumes: `rangeFrom`, `clipBlocks` (Tasks 1–2); `tagCalendar({ …, range })` (Task 4)
- Produces: nichts, was andere Tasks brauchen. Die Panel-Felder `rangeFromMonth` und `rangeToMonth` legt Task 10 an; bis dahin liest `getSettings` sie als `undefined`, weshalb `drawCalendar` sie mit `?? 0` und `?? 11` auffängt — ein ganzes Jahr, also das heutige Verhalten.

- [ ] **Step 1: Importe erweitern**

```js
import {
    dayBlocks,
    monthBlocks,
    weekBlocks,
    iterationBlocks,
    quarterBlocks,
    xOfColumn,
    widthOfColumns,
    rangeFrom,
    clipBlocks,
} from './calendar.js';
```

- [ ] **Step 2: Den Bereich aus den Monatswahlen bilden**

Neue Funktion in `src/app.js`, über `drawCalendar`:

```js
// The panel offers months, not dates: a section of a year that starts mid-month
// is not a case anyone has, and month bounds cover halves and quarters. dayjs
// resolves the end of the month, so no table of month lengths is needed and a
// leap February is right by construction.
function rangeFromSettings(settings) {
    const year = settings.year;
    const fromMonth = settings.rangeFromMonth ?? 0;
    const toMonth = settings.rangeToMonth ?? 11;

    return rangeFrom({
        year,
        from: dayjs(`${year}-01-01`).month(fromMonth).startOf('month').format('YYYY-MM-DD'),
        to: dayjs(`${year}-01-01`).month(toMonth).endOf('month').format('YYYY-MM-DD'),
    });
}
```

- [ ] **Step 3: `planRows` schneidet zu**

```js
// Coarsest rows first. The board receives the calls in this order, so the
// shape of the year is visible within a second while the day boxes - three
// quarters of all shapes - fill in behind it.
//
// Every row is built for the whole year and then cut to the drawn window. The
// builders stay window-blind on purpose: five builders clipping for themselves
// would be five copies of the same clamping arithmetic, and iteration numbers
// would restart at 1 instead of continuing from the start of the year.
function planRows(year, settings, range) {
    const rows = [];

    if (settings.drawQuarters) rows.push(quarterRow(year, settings));
    rows.push(monthRow(year)); // Always draw months
    if (settings.drawIterations) rows.push(iterationRow(year, settings));
    if (settings.drawWeeks) rows.push(weekRow(year, settings));
    rows.push(dayRow(year)); // Always draw days

    return rows.map((row) => ({ ...row, blocks: clipBlocks(row.blocks, range) }));
}
```

- [ ] **Step 4: `drawCalendar` verschieben, zuschneiden, speichern**

Der Kopf von `drawCalendar` bis zum `try`:

```js
async function drawCalendar() {
    const settings = await getSettings();
    const year = settings.year;

    const range = rangeFromSettings(settings);
    if (!range) {
        setBusy(false, 'That range has no working days to draw. Pick a wider one.');
        return;
    }

    // xOfColumn works in absolute columns - column 0 is the first working day
    // of the year, drawn or not - so a window would otherwise start as far
    // right of the viewport as its first column is into the year. Pulling the
    // origin back by exactly that much puts the first *drawn* column where the
    // user is looking.
    settings.startX -= range.firstColumn * (settings.shapeWidth + settings.padding);

    const rows = planRows(year, settings, range);
    const total = rows.reduce((count, row) => count + row.blocks.length, 0);
```

und der `tagCalendar`-Aufruf im `try`:

```js
            await tagCalendar({ drawnRows, rows, year, range, indicatorEnabled: settings.drawTodayIndicator });
```

- [ ] **Step 5: Die Bereichsprüfung an den Zeichenknopf hängen**

Im Click-Handler des Submit-Knopfes, nach `validateYear`:

```js
    const yearInput = document.getElementById('year');
    if (!validateYear(yearInput)) return;
    if (!validateRange()) return;

    await drawCalendar();
```

und die Prüfung selbst, neben `validateYear`:

```js
// The two month selects are the only pair in the panel that can contradict each
// other, so this is the one cross-field check. Same mechanics as validateYear:
// mark the group, show its status text, refuse to draw.
function validateRange() {
    const from = document.getElementById('rangeFromMonth');
    const to = document.getElementById('rangeToMonth');
    if (!from || !to) return true;

    const group = from.closest('.form-group');
    const isValid = parseInt(to.value) >= parseInt(from.value);

    group.classList.toggle('error', !isValid);
    group.querySelector('.status-text').style.display = isValid ? 'none' : 'block';

    if (!isValid) group.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return isValid;
}
```

- [ ] **Step 6: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler. Ohne die Panel-Felder aus Task 10 zeichnet die App weiterhin ganze Jahre — das ist der Zwischenstand, den dieser Commit hinterlässt.

- [ ] **Step 7: Commit**

```bash
git add src/app.js
git commit -m "draws only the window the settings ask for"
```

---

### Task 10: Das Panel bekommt den Bereich

**Files:**
- Modify: `app.html` — neuer Abschnitt im Kalender-Tab
- Modify: `src/app.js` — die zwei Schnellknöpfe verkabeln, Standardwerte setzen

**Interfaces:**
- Consumes: `validateRange`, `rangeFromSettings` (Task 9)
- Produces: `rangeFromMonth` und `rangeToMonth` als `<select>`-Werte 0–11; `getSettings` liest sie automatisch ein, weil es alle `<select>` nach `id` einsammelt und mit `parseInt` liest

- [ ] **Step 1: Die Markup einfügen**

In `app.html`, direkt hinter dem `Year`-Fieldset und vor dem `<hr>`, das darauf folgt:

```html
                    <fieldset class="section">
                        <div class="h4 section-title">Range</div>
                        <div class="grid">
                            <div class="form-group form-group-small cs1 ce6">
                                <label for="rangeFromMonth">From</label>
                                <select class="select select-small" id="rangeFromMonth">
                                    <option value="0" selected="selected">January</option>
                                    <option value="1">February</option>
                                    <option value="2">March</option>
                                    <option value="3">April</option>
                                    <option value="4">May</option>
                                    <option value="5">June</option>
                                    <option value="6">July</option>
                                    <option value="7">August</option>
                                    <option value="8">September</option>
                                    <option value="9">October</option>
                                    <option value="10">November</option>
                                    <option value="11">December</option>
                                </select>
                                <div class="status-text">The last month cannot be before the first</div>
                            </div>
                            <div class="form-group-small cs7 ce12">
                                <label for="rangeToMonth">To</label>
                                <select class="select select-small" id="rangeToMonth">
                                    <option value="0">January</option>
                                    <option value="1">February</option>
                                    <option value="2">March</option>
                                    <option value="3">April</option>
                                    <option value="4">May</option>
                                    <option value="5">June</option>
                                    <option value="6">July</option>
                                    <option value="7">August</option>
                                    <option value="8">September</option>
                                    <option value="9">October</option>
                                    <option value="10">November</option>
                                    <option value="11" selected="selected">December</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group form-group-small">
                            <button type="button" id="rangeFullYear" class="button button-secondary button-small">Full year</button>
                            <button type="button" id="rangeFirstHalf" class="button button-secondary button-small">H1</button>
                            <button type="button" id="rangeSecondHalf" class="button button-secondary button-small">H2</button>
                        </div>
                    </fieldset>
```

Die `status-text`-Zeile sitzt in derselben `.form-group` wie `rangeFromMonth`, weil `validateRange` (Task 9) sie über `from.closest('.form-group')` sucht. `type="button"` an allen drei Knöpfen ist Pflicht: sie stehen in einem `<form>`, und ein Standardknopf würde es abschicken und das Panel neu laden.

- [ ] **Step 2: Die Knöpfe verkabeln**

In `src/app.js`, bei den anderen Listener-Registrierungen (neben dem `settingsMap`-Block):

```js
// Quick sets, not a second source of truth: they only move the two selects, so
// there is exactly one place the range is read from.
const rangePresets = {
    rangeFullYear: [0, 11],
    rangeFirstHalf: [0, 5],
    rangeSecondHalf: [6, 11],
};

Object.entries(rangePresets).forEach(([buttonId, [fromMonth, toMonth]]) => {
    document.getElementById(buttonId).addEventListener('click', () => {
        document.getElementById('rangeFromMonth').value = String(fromMonth);
        document.getElementById('rangeToMonth').value = String(toMonth);
        validateRange();
    });
});
```

- [ ] **Step 3: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

- [ ] **Step 4: Die Standardwerte im gebauten Panel prüfen**

Run: `grep -c 'selected="selected"' app.html`
Expected: 4 — die zwei vorhandenen (`qOneStartMonth` Februar, `IterationDayOffset` Mittwoch) plus Januar und Dezember. Wer das Panel öffnet und nichts anfasst, zeichnet ein ganzes Jahr.

- [ ] **Step 5: Commit**

```bash
git add app.html src/app.js
git commit -m "lets the panel pick the months to draw"
```

---

## Phase 5 — Nachweis (Task 11)

---

### Task 11: Am Board prüfen

Board-I/O hat kein Test-Harness. Diese Liste ist der Nachweis für alles in Phase 2 bis 4, und sie wird von einem Menschen mit einem echten Board durchgearbeitet — kein Agent kann sie ausführen.

**Files:**
- Create: `docs/superpowers/notes/2026-08-11-teilkalender-board-pruefung.md`

**Interfaces:**
- Consumes: alles aus Tasks 1–10
- Produces: nichts

- [ ] **Step 1: Die Prüfliste als Notiz anlegen**

`docs/superpowers/notes/2026-08-11-teilkalender-board-pruefung.md`, deutsch, im Stil der vorhandenen Notizen. Sie enthält den Status („offen, braucht ein echtes Board"), die folgenden acht Schritte mit ihrem erwarteten Ergebnis, und eine Ergebnistabelle mit einer Zeile je Schritt plus Datumsspalte:

1. **Ganzes Jahr unverändert.** Kalender für 2026 mit Januar–Dezember zeichnen. Erwartet: dieselbe Breite, dieselben Beschriftungen, dieselbe Zahl im Fortschritt wie vor der Änderung.
2. **Bestehender Kalender bleibt adressierbar.** Ein vor dieser Änderung gezeichneter Kalender: Urlaub importieren. Erwartet: Balken sitzen lagerichtig — der Eintrag hat kein `range`, wird also als ganzes Jahr aufgelöst.
3. **H2 landet im Blickfeld.** H2 drücken, zeichnen. Erwartet: der Kalender beginnt dort, wo der Viewport steht, nicht ein halbes Jahr rechts daneben.
4. **Randblöcke tragen ihre Beschriftung.** Am H2-Kalender die erste Wochenzelle und die erste Quartalszelle ansehen. Erwartet: beide sind schmaler und heißen weiter „calendar week 27" beziehungsweise „Q3/2026".
5. **Iterationsnummern zählen weiter.** Iterationen einschalten, H2 zeichnen. Erwartet: die erste Iteration ist nicht 1, sondern die Nummer, die sie im Jahr hat.
6. **Urlaub und Feiertage sitzen richtig.** Auf dem H2-Kalender Feiertage für ein Bundesland zeichnen und einen SAP-Export importieren. Erwartet: Bänder, Stickies und Balken an den richtigen Tagen; Einträge aus dem ersten Halbjahr stehen in der Problemliste mit dem Text `is not in the drawn range 2026 (Jul-Dec).`
7. **Der Indikator folgt dem Fenster.** Auf einem H2-Kalender im zweiten Halbjahr: Indikator vorhanden. Auf einem H1-Kalender am selben Tag: keiner, und ein vorher vorhandener ist entfernt.
8. **Fehlerfall im Panel.** „From" auf Oktober, „To" auf März stellen und zeichnen. Erwartet: Fehlermarkierung und Hinweistext, kein Shape auf dem Board.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-08-11-teilkalender-board-pruefung.md
git commit -m "writes down what a partial calendar has to prove on a board"
```

---

## Selbstprüfung dieses Plans

**Spec-Abdeckung.** Jeder Abschnitt des Specs hat einen Task: die tragende Idee, Teil 2 (`clipBlocks`) → Task 1; Datenmodell und `describeRange` → Task 2; die tragende Idee, Teil 1 (`gridFrom`) → Task 3; Datenmodell/AppData und der Datenfluss beim Wiederfinden → Task 4; „Tageszellen nach absoluter Spalte" → Task 5; „Der TODAY-Indikator auf einem Teilkalender" → Task 6; „Inhalt außerhalb des Fensters" → Task 7 und 8; „Der Zeichenursprung" und der Datenfluss beim Zeichnen → Task 9; „Das Panel" → Task 10; Fehlerbehandlung → verteilt auf Task 4 (unlesbares `range`), 5 (Zellzahl), 8 (Einträge außerhalb), 9 (Bereich ohne Arbeitstage) und 10 (`To` vor `From`); Tests → Tasks 1, 2, 3, 6, 7; „nicht testbar und darum manuell" → Task 11.

**Abweichung vom Spec, bewusst.** Der Spec schreibt, die vorhandenen 146 Tests blieben „unverändert" grün. Genauer: ihre **Erwartungswerte** bleiben unverändert, aber 49 Aufrufe in vier Testdateien bekommen ihr Jahr in `fullYearRange(…)` gewickelt, weil `placeSpan`, `planVacations`, `planStickies`, `planBands` und `columnForToday` künftig einen Bereich nehmen. Die Alternative — eine Signatur, die eine Jahreszahl *oder* einen Bereich akzeptiert — wäre ein zweiter Modus in fünf Funktionen und wurde verworfen. Die Umstellung ist mechanisch (`sed`, dann `grep` als Gegenprobe) und ändert keine einzige Assertion.

**Zwei Tasks hinterlassen absichtlich einen Zwischenstand.** Task 7 committet einen roten Baum (`placeSpan` umgestellt, seine Aufrufer noch nicht), den Task 8 schließt; Task 9 committet ein Panel ohne Bereichsfelder, das Task 10 nachliefert. Beides ist in den Tasks benannt, damit ein Reviewer es nicht für einen Fehler hält. Wer die Reihenfolge bricht, bricht den Baum.

**Was dieser Plan bewusst nicht testet.** Board-I/O in `anchors.js`, `dayCells.js`, `app.js`, `import.js` und `holidayView.js` — dieselbe Grenze wie in den drei Vorgängerplänen. Die riskanteste ungetestete Stelle ist der verschobene Zeichenursprung in Task 9: ein Vorzeichenfehler dort zeichnet den Kalender weit außerhalb des Blickfelds, sichtbar sofort, aber von keinem Test greifbar. Zweitriskantester Punkt ist `dayCells.js`, weil ein falscher Schlüssel die Feiertagsmarke auf den falschen Tag setzt; die `sorted.length !== range.columns`-Prüfung verwandelt das in eine Verweigerung statt in eine stille Falschmarkierung.
