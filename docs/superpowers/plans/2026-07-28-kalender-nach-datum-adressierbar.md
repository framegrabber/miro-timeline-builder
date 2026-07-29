# Kalender nach Datum adressierbar machen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein gezeichneter Kalender bleibt nach Datum adressierbar, sodass ein TODAY-Indikator sich selbst positioniert und der SAP-Urlaubsimport am Kalenderdatum ausgerichtet ins Plugin umzieht.

**Architecture:** Drei Shapes pro Kalender tragen Metadaten (erste Tageszelle, letzte Tageszelle, linke Zelle der obersten Zeile). Aus ihren gemessenen Koordinaten rekonstruiert die reine Funktion `gridFrom` exakt das Settings-Objekt `{startX, shapeWidth, padding}`, das `xOfColumn` und `widthOfColumns` ohnehin schon entgegennehmen. Nichts Berechnetes wird gespeichert; alles wird vom Board zurückgemessen. Board-I/O liegt in dünnen, ungetesteten Modulen, alle Rechnung in reinen, getesteten Modulen.

**Tech Stack:** Vanilla ES-Module, Vite 3, dayjs (+ isoWeek), Mirotone 5, Miro Web SDK v2, Testrunner `node:test`.

**Spec:** [docs/superpowers/specs/2026-07-28-kalender-nach-datum-adressierbar-design.md](../specs/2026-07-28-kalender-nach-datum-adressierbar-design.md)

## Global Constraints

- **Keine neuen Abhängigkeiten.** `package.json` bleibt unverändert. Alles baut auf dayjs, Mirotone und dem Web SDK auf.
- **Jeder Board-Aufruf läuft über den Limiter** aus `src/rateLimit.js`. Miro zählt Credits pro Nutzersitzung, nicht pro Modul — zwei Limiter würden beide das volle Budget annehmen.
- **Reine Module importieren niemals `src/board.js`.** `calendar.js`, `today.js` (Rechenteil), `vacation.js` und `colors.js` müssen unter `node --test` ohne Browser laufen.
- **Tests laufen mit `npm test`** (`node --test "test/*.test.js"`). Alle bestehenden 31 Tests müssen nach jedem Task grün bleiben.
- **Kommentare auf Englisch**, wie im übrigen `src/`. Nutzersichtbare Texte im Panel auf Englisch.
- **Commit-Messages** im Stil des Repos: englisch, dritte Person Präsens, kleingeschrieben, ohne Präfix — z. B. `adds gridFrom to rebuild the grid from two measured cells`. Kein `feat:`/`fix:`.
- **`vacationDuration` und Konsorten** sind die Feldnamen, die `SAPVac/sapvac.js` erzeugt: `employeeName`, `vacationStartDate`, `vacationEndDate`, `vacationDuration`, `vacationPeriod`. Das Format wird nicht geändert.
- **Metadaten-Schlüssel** ist überall `'timelineBuilder'`. **AppData-Schlüssel** ist überall `'calendars'`.
- Nach `setMetadata` ist **kein** `sync()` nötig (laut Miro-Doku persistiert es direkt). Nach dem Ändern von `x` ist `sync()` **erforderlich**.

## File Structure

| Datei | Verantwortung | Getestet |
|---|---|---|
| `src/calendar.js` | Rasterrechnung. Neu: `nextWorkingDay`, `previousWorkingDay`, `gridFrom` | ja |
| `src/board.js` | NEU. Genau eine Stelle, die `window.miro` und den Limiter hält | nein |
| `src/anchors.js` | NEU. Anker taggen, wiederfinden, messen; AppData lesen/schreiben | nein |
| `src/today.js` | NEU. `columnForToday` (rein) plus Lebenszyklus der Indikator-Items | teilweise |
| `src/vacation.js` | NEU. SAP-JSON parsen und in Spaltenkoordinaten planen | ja |
| `src/colors.js` | NEU. `stringToColor`, aus `SAPVac/drawshapes.js` übernommen | ja |
| `src/import.js` | NEU. Panel-Ansicht „Vacation" | nein |
| `src/app.js` | Panel-Ansicht „Calendar" plus Tab-Umschaltung | nein |
| `src/index.js` | headless: `icon:click` und der TODAY-Updater | nein |
| `app.html` | Panel mit zwei Tabs | — |

---

# Phase 1 — Fundament

Verändert optisch nichts und ist für sich ausrollbar.

## Task 1: Rasterrekonstruktion in `calendar.js`

**Files:**
- Modify: `src/calendar.js`
- Test: `test/calendar.test.js`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `nextWorkingDay(date: Dayjs): Dayjs` — `date` selbst, wenn es ein Arbeitstag ist, sonst der nächste
  - `previousWorkingDay(date: Dayjs): Dayjs` — `date` selbst, wenn es ein Arbeitstag ist, sonst der vorherige
  - `gridFrom({firstCenterX: number, lastCenterX: number, cellWidth: number, columns: number}): {startX, shapeWidth, padding} | null`

- [ ] **Step 1: Write the failing tests**

An `test/calendar.test.js` anhängen. Der Import-Block oben in der Datei muss um `nextWorkingDay`, `previousWorkingDay` und `gridFrom` ergänzt werden.

```js
// --- working day stepping ----------------------------------------------------

test('nextWorkingDay and previousWorkingDay step off weekends', () => {
    // 2026-07-24 Fri, 07-25 Sat, 07-26 Sun, 07-27 Mon
    const saturday = dayjs('2026-07-25');
    assert.equal(nextWorkingDay(saturday).format('YYYY-MM-DD'), '2026-07-27');
    assert.equal(previousWorkingDay(saturday).format('YYYY-MM-DD'), '2026-07-24');

    const sunday = dayjs('2026-07-26');
    assert.equal(nextWorkingDay(sunday).format('YYYY-MM-DD'), '2026-07-27');
    assert.equal(previousWorkingDay(sunday).format('YYYY-MM-DD'), '2026-07-24');

    const monday = dayjs('2026-07-27');
    assert.equal(nextWorkingDay(monday).format('YYYY-MM-DD'), '2026-07-27',
        'a working day is its own next working day');
    assert.equal(previousWorkingDay(monday).format('YYYY-MM-DD'), '2026-07-27');
});

// --- rebuilding the grid from the board --------------------------------------

// What the board reports back. Shapes are created centred - app.js passes
// `x + width / 2` to createShape - so a measured x is the centre of the cell,
// not the left edge that xOfColumn works with.
function measure(settings, columns) {
    return {
        firstCenterX: xOfColumn(settings, 0) + settings.shapeWidth / 2,
        lastCenterX: xOfColumn(settings, columns - 1) + settings.shapeWidth / 2,
        cellWidth: settings.shapeWidth,
        columns,
    };
}

const DRAW_SETTINGS = [
    { startX: 0, shapeWidth: 100, padding: 2 },
    { startX: -1234.5, shapeWidth: 40, padding: 0 },
    { startX: 980, shapeWidth: 250, padding: 12 },
];

test('gridFrom rebuilds the settings the calendar was drawn with', () => {
    for (const year of YEARS) {
        const columns = totalWorkingDays(year);

        for (const settings of DRAW_SETTINGS) {
            const grid = gridFrom(measure(settings, columns));
            assert.ok(grid, `${year} / width ${settings.shapeWidth}`);

            for (let column = 0; column < columns; column++) {
                assert.ok(
                    Math.abs(xOfColumn(grid, column) - xOfColumn(settings, column)) < 1e-6,
                    `${year} column ${column}: ${xOfColumn(grid, column)} != ${xOfColumn(settings, column)}`
                );
                assert.ok(
                    Math.abs(widthOfColumns(grid, 5) - widthOfColumns(settings, 5)) < 1e-6,
                    `${year} span width`
                );
            }
        }
    }
});

test('gridFrom survives a calendar that was moved and scaled', () => {
    const drawn = { startX: 100, shapeWidth: 100, padding: 2 };
    const columns = totalWorkingDays(2026);
    const measured = measure(drawn, columns);

    // Dragging the group shifts every coordinate; scaling multiplies them.
    const moved = { ...measured, firstCenterX: measured.firstCenterX + 5000, lastCenterX: measured.lastCenterX + 5000 };
    assert.equal(gridFrom(moved).shapeWidth, 100);
    assert.ok(Math.abs(gridFrom(moved).padding - 2) < 1e-6);

    const scaled = {
        firstCenterX: measured.firstCenterX * 2,
        lastCenterX: measured.lastCenterX * 2,
        cellWidth: measured.cellWidth * 2,
        columns,
    };
    assert.equal(gridFrom(scaled).shapeWidth, 200);
    assert.ok(Math.abs(gridFrom(scaled).padding - 4) < 1e-6);
});

test('gridFrom refuses measurements that cannot describe a grid', () => {
    const sane = measure({ startX: 0, shapeWidth: 100, padding: 2 }, 261);

    assert.equal(gridFrom({ ...sane, cellWidth: 0 }), null, 'no cell width');
    assert.equal(gridFrom({ ...sane, columns: 1 }), null, 'a single column has no pitch');
    assert.equal(gridFrom({ ...sane, lastCenterX: sane.firstCenterX }), null, 'both anchors in one spot');
    assert.equal(gridFrom({ ...sane, lastCenterX: sane.firstCenterX - 1000 }), null, 'anchors swapped');

    // Someone dragged the last day cell far out of the calendar: the derived
    // pitch then describes nothing real, and a plausible-looking wrong answer
    // is worse than no answer.
    assert.equal(gridFrom({ ...sane, lastCenterX: sane.firstCenterX + 261 * 500 }), null, 'pitch far beyond one cell');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../src/calendar.js' does not provide an export named 'gridFrom'`

- [ ] **Step 3: Implement the three functions**

In `src/calendar.js`. `nextWorkingDay` und `previousWorkingDay` direkt unter `isWorkingDay` einfügen, und `firstWorkingDayOf`/`lastWorkingDayOf` darauf umstellen, damit es die Schleife nur einmal gibt:

```js
export function nextWorkingDay(date) {
    let day = date;
    while (!isWorkingDay(day)) day = day.add(1, 'day');
    return day;
}

export function previousWorkingDay(date) {
    let day = date;
    while (!isWorkingDay(day)) day = day.subtract(1, 'day');
    return day;
}

/** The date that owns column 0. Skips forward when Jan 1st is a weekend. */
export function firstWorkingDayOf(year) {
    return nextWorkingDay(dayjs(`${year}-01-01`));
}

export function lastWorkingDayOf(year) {
    return previousWorkingDay(dayjs(`${year}-12-31`));
}
```

`gridFrom` ans Ende des Abschnitts „columns -> pixels" setzen, direkt hinter `widthOfColumns`:

```js
/**
 * Rebuilds the drawing settings from two measured day cells, so a calendar
 * that is already on the board can be addressed by date again.
 *
 * The measured x of a cell is its centre, because app.js creates shapes
 * centred - hence the half-width shift back to the left edge.
 *
 * Returns null when the measurement cannot describe a grid. That is the case
 * once a single cell has been dragged out of the calendar: the derived pitch
 * then describes nothing real, and putting something plausible-looking in the
 * wrong place is worse than putting nothing anywhere.
 */
export function gridFrom({ firstCenterX, lastCenterX, cellWidth, columns }) {
    if (!(cellWidth > 0) || !(columns > 1)) return null;

    const pitch = (lastCenterX - firstCenterX) / (columns - 1);
    const padding = pitch - cellWidth;

    if (!(pitch > 0) || padding < 0 || padding > cellWidth) return null;

    return {
        startX: firstCenterX - cellWidth / 2,
        shapeWidth: cellWidth,
        padding,
    };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, alle bisherigen Tests plus vier neue.

- [ ] **Step 5: Commit**

```bash
git add src/calendar.js test/calendar.test.js
git commit -m "adds gridFrom to rebuild the drawing grid from two measured cells"
```

---

## Task 2: Gemeinsamer Board-Zugang in `src/board.js`

Reine Umverdrahtung ohne Verhaltensänderung. Nötig, weil ab Task 3 drei Module den Limiter brauchen und zwei Limiter beide das volle Kreditbudget annehmen würden.

**Files:**
- Create: `src/board.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `CREDITS_PER_ITEM`, `createLimiter`, `isRateLimitError` aus `src/rateLimit.js`
- Produces:
  - `board` — `window.miro.board`
  - `run(task: () => Promise<T>): Promise<T>` — ein Board-Aufruf, über den Limiter, zu `CREDITS_PER_ITEM` Credits
  - `takeStats(): Stats | null` — reicht `limiter.takeStats()` durch
  - `isRateLimitError(error): boolean` — reexportiert

- [ ] **Step 1: Create `src/board.js`**

```js
import { CREDITS_PER_ITEM, createLimiter, isRateLimitError } from './rateLimit.js';

// One limiter for the whole app. Miro counts credits per user session, not per
// module or per board, so a second limiter would quietly assume it had the
// full budget to itself - see rateLimit.js.
const limiter = createLimiter();

export const board = window.miro.board;

/** A single Miro call, paced against the credit budget. */
export const run = (task) => limiter.run(CREDITS_PER_ITEM, task);

export const takeStats = () => limiter.takeStats();

export { isRateLimitError };
```

- [ ] **Step 2: Rewire `src/app.js`**

Die beiden Importzeilen ganz oben ersetzen:

```js
// vorher
const { board } = window.miro;
import { CREDITS_PER_ITEM, createLimiter, isRateLimitError } from './rateLimit.js';
const limiter = createLimiter();

// nachher
import { board, run, takeStats, isRateLimitError } from './board.js';
```

Dann die vier Verwendungsstellen anpassen:

```js
// in drawRectangle
function drawRectangle(content, color, width, height, x, y){
    return run(() => board.createShape({
```

```js
// in drawCalendar
const drawing = takeStats();
```

```js
await run(() => board.group({ items: shapes }));
```

```js
takeStats(); // Reported separately, so keep it out of the round trips.
```

- [ ] **Step 3: Verify nothing broke**

Run: `npm test && npm run build`
Expected: 35 Tests PASS, Build ohne Fehler.

Sollte `npm run build` mit `esbuild-darwin-64` gegen `esbuild-darwin-arm64` scheitern, ist das ein vorbestehendes Umgebungsproblem und kein Ergebnis dieser Änderung. Behebung: `npm rebuild esbuild`. Die Lockfile bleibt dabei unverändert.

- [ ] **Step 4: Manual check on a board**

Dev-Server starten (`npm start`), Kalender zeichnen. Erwartung: unverändertes Verhalten, Statistik-Tabelle erscheint wie bisher in der Konsole.

- [ ] **Step 5: Commit**

```bash
git add src/board.js src/app.js
git commit -m "moves the limiter into a shared board module"
```

---

## Task 3: `src/anchors.js` und das Taggen beim Zeichnen

**Files:**
- Create: `src/anchors.js`
- Modify: `src/app.js` (`drawCalendar`)

**Interfaces:**
- Consumes: `board`, `run`, `isRateLimitError` aus `src/board.js`; `gridFrom`, `totalWorkingDays` aus `src/calendar.js`
- Produces:
  - `tagCalendar({drawnRows: Shape[][], rows: Row[], year: number}): Promise<string>` — liefert die `calendarId`
  - `findCalendars(): Promise<Calendar[]>` mit
    `Calendar = {entry, year, grid, rowHeight, top, bottom}`,
    `entry = {calendarId, year, anchors: {firstDay, lastDay, topLeft}, indicator: {enabled, circleId, anchorId, connectorId}, vacationItemIds: string[]}`,
    `grid = {startX, shapeWidth, padding}`
  - `updateCalendar(calendarId: string, changes: object): Promise<void>` — flaches Merge in den AppData-Eintrag

Abweichung vom Spec, bewusst: dort war ein eigenes `forget(calendarId)` vorgesehen. Das Aufräumen unbrauchbarer Einträge passiert stattdessen automatisch in `findCalendars`, weil dort ohnehin auffällt, dass die Anker weg sind — ein separater Aufruf hätte nie jemand ausgelöst. `updateCalendar` kommt neu dazu, weil Task 5 und Task 10 Felder im Eintrag fortschreiben müssen.

- [ ] **Step 1: Create `src/anchors.js`**

```js
import { board, run, isRateLimitError } from './board.js';
import { gridFrom, totalWorkingDays } from './calendar.js';

const APP_DATA_KEY = 'calendars';
const METADATA_KEY = 'timelineBuilder';

/**
 * Makes a freshly drawn calendar findable again.
 *
 * Three cells get a metadata tag; their ids plus the year go into AppData.
 * Nothing derived is stored - the grid is measured back off the board in
 * findCalendars(), which is why moving or scaling the calendar cannot break it.
 *
 * AppData is only an index. If it is lost, everything could be rebuilt from a
 * metadata scan; the other way round it could not. That is why the tags sit on
 * the shapes and not only in AppData.
 */
export async function tagCalendar({ drawnRows, rows, year }) {
    const dayRowIndex = rows.findIndex((row) => row.position === 'drawDays');
    const dayShapes = drawnRows[dayRowIndex];

    const shapes = {
        firstDay: dayShapes[0],
        lastDay: dayShapes[dayShapes.length - 1],
        topLeft: drawnRows[0][0],
    };

    // The first day cell's own id. Nothing has to be generated, and it is
    // unique by construction.
    const calendarId = shapes.firstDay.id;

    for (const [role, shape] of Object.entries(shapes)) {
        await run(() => shape.setMetadata(METADATA_KEY, { role, calendarId, year }));
    }

    const calendars = await readCalendars();
    calendars.push({
        calendarId,
        year,
        anchors: {
            firstDay: shapes.firstDay.id,
            lastDay: shapes.lastDay.id,
            topLeft: shapes.topLeft.id,
        },
        // Phase 2 adds the checkbox that writes `enabled`; until then the
        // indicator is simply on for every calendar that gets drawn.
        indicator: { enabled: true, circleId: null, anchorId: null, connectorId: null },
        vacationItemIds: [],
    });
    await writeCalendars(calendars);

    return calendarId;
}

/**
 * Every stored calendar, resolved to a measured grid.
 *
 * These are three different outcomes, and they get different treatment:
 * - Anchors gone (calendar deleted, undo): the AppData entry is dropped, so a
 *   board heals itself instead of collecting dead entries.
 * - Anchors present but the measurement is implausible (a day cell dragged out
 *   of the group): the entry is kept as-is and simply skipped for this call.
 *   The anchors and their metadata tags are still there, so dragging the cell
 *   back makes the calendar findable again - dropping the entry here would
 *   permanently defeat that.
 * - getById itself failed on a rate limit that outlasted run()'s retries: the
 *   anchor's real state is unknown, so this is treated like 'implausible', not
 *   like 'missing' - the entry is kept and only this call's draw is skipped.
 *   Pruning here would be permanent over a failure that is only temporary; the
 *   tags stay on the shapes but tagCalendar only runs at draw time, so a
 *   wrongly dropped entry could never be recovered by re-finding it.
 * All three are reported, per the design's error-handling table.
 */
export async function findCalendars() {
    const stored = await readCalendars();
    const alive = [];
    const resolved = [];

    for (const entry of stored) {
        const { calendar, reason } = await measure(entry);

        if (reason === 'missing') {
            console.warn(`Timeline Builder: anchors missing for calendar ${entry.calendarId}, dropping entry.`);
            continue;
        }

        if (reason === 'rate-limited') {
            console.warn(`Timeline Builder: rate limited while resolving anchors for calendar ${entry.calendarId}, keeping entry and skipping.`);
            alive.push(entry);
            continue;
        }

        if (reason === 'implausible') {
            console.warn(`Timeline Builder: measurement implausible for calendar ${entry.calendarId}, skipping.`);
            alive.push(entry);
            continue;
        }

        alive.push(entry);
        resolved.push(calendar);
    }

    if (alive.length !== stored.length) await writeCalendars(alive);

    return resolved;
}

export async function updateCalendar(calendarId, changes) {
    const calendars = await readCalendars();
    await writeCalendars(calendars.map(
        (entry) => (entry.calendarId === calendarId ? { ...entry, ...changes } : entry)
    ));
}

export async function readCalendars() {
    return (await run(() => board.getAppData(APP_DATA_KEY))) ?? [];
}

async function writeCalendars(calendars) {
    await run(() => board.setAppData(APP_DATA_KEY, calendars));
}

/**
 * Resolves one entry's anchors to a measured grid.
 *
 * Returns a reason alongside the calendar so callers can tell an unresolvable
 * anchor (the entry should be forgotten) apart from a transient failure or an
 * implausible measurement (the entry stays, only the draw is skipped).
 */
async function measure(entry) {
    let firstDay;
    let lastDay;
    let topLeft;

    try {
        // getById throws when the id is gone, which is exactly how a deleted
        // calendar announces itself. But run() also retries rate-limit errors
        // with backoff and re-throws once retries are exhausted - that is not
        // the anchor being gone, it is the board call never having completed,
        // so it must not be classified the same as a genuinely missing anchor.
        [firstDay, lastDay, topLeft] = await Promise.all([
            run(() => board.getById(entry.anchors.firstDay)),
            run(() => board.getById(entry.anchors.lastDay)),
            run(() => board.getById(entry.anchors.topLeft)),
        ]);
    } catch (error) {
        if (isRateLimitError(error)) return { calendar: null, reason: 'rate-limited' };
        return { calendar: null, reason: 'missing' };
    }

    const grid = gridFrom({
        firstCenterX: firstDay.x,
        lastCenterX: lastDay.x,
        cellWidth: firstDay.width,
        columns: totalWorkingDays(entry.year),
    });
    if (!grid) return { calendar: null, reason: 'implausible' };

    return {
        calendar: {
            entry,
            year: entry.year,
            grid,
            rowHeight: firstDay.height,
            top: topLeft.y - topLeft.height / 2,
            bottom: firstDay.y + firstDay.height / 2,
        },
        reason: null,
    };
}
```

- [ ] **Step 2: Wire it into `drawCalendar`**

In `src/app.js`. Import ergänzen:

```js
import dayjs from 'dayjs';
import { tagCalendar } from './anchors.js';
import { updateIndicators } from './today.js';
```

Im `try`-Block von `drawCalendar` die Zeile, die die Shapes einsammelt, aufteilen und das Taggen einschieben — **vor** dem Gruppieren, damit ein Fehler beim Gruppieren die Anker nicht mitreißt. Direkt danach die Indikatoren aller Kalender auffrischen, aus demselben Grund und mit derselben Isolierung wie das Taggen: der Fehler eines Updates darf das Zeichnen nicht kosten. Das läuft bewusst **vor** `await board.ui.closePanel()` und wird **awaited** — schließt das Panel, bevor der Aufruf fertig ist, reißt es die App-Iframe mitsamt allem noch Laufenden weg, genau das Problem, das die Struktur dieses `try`-Blocks überhaupt erst nötig gemacht hat:

```js
        // Nothing below may run before every shape actually exists on the
        // board: grouping an empty array fails, and closing the panel unloads
        // the app along with any calls still in flight.
        const drawnRows = await Promise.all(
            rows.map((row) => drawRow(settings, row, onShapeDrawn))
        );
        const shapes = drawnRows.flat();

        // Tag the calendar for later lookup, but do not let a bookkeeping failure
        // cost the grouping. The calendar exists and is visible whether or not the
        // tagging succeeds; its findability later is important but not a precondition
        // for showing the user what they asked for now.
        try {
            await tagCalendar({ drawnRows, rows, year });
        } catch (error) {
            console.error('Calendar could not be tagged for later lookup:', error);
        }

        // The headless updater (index.js) only ticks on load and every 10 minutes
        // after, so without this a calendar drawn into an already-open board would
        // show no TODAY indicator until the next tick, or a reload. Bringing every
        // calendar's indicator up to date now is the same work the next tick would
        // do; do not let a failure here cost the draw, for the same reason tagging
        // above is isolated.
        try {
            await updateIndicators(dayjs());
        } catch (error) {
            console.error('Could not update the TODAY indicator:', error);
        }

        const drawing = takeStats();
```

- [ ] **Step 3: Verify the test suite still passes**

Run: `npm test`
Expected: 35 Tests PASS. `anchors.js` wird von keinem Test importiert — es fasst das Board an und ist bewusst dumm gehalten.

- [ ] **Step 4: Manual verification on a real board**

Dies ist die Abnahme für Phase 1. `npm start`, Panel öffnen, Kalender für 2026 zeichnen. Dann in der Konsole des App-iframes (DevTools → Kontext-Dropdown → `app.html`):

```js
await miro.board.getAppData('calendars')
```

Erwartung: ein Eintrag mit `year: 2026`, drei Anker-IDs, `indicator.enabled === true`, `vacationItemIds: []`.

Danach den Kalender als Gruppe **verschieben** und **skalieren**, und erneut prüfen:

```js
const { findCalendars } = await import('/src/anchors.js');
(await findCalendars())[0].grid
```

Erwartung: `shapeWidth` und `padding` entsprechen dem, womit gezeichnet wurde (bzw. dem skalierten Vielfachen), `startX` folgt der Verschiebung. Genau das ist die Eigenschaft, die Phase 2 und 3 tragen.

Zum Schluss den Kalender löschen und `findCalendars()` erneut aufrufen: das Ergebnis muss leer sein und der AppData-Eintrag verschwunden.

- [ ] **Step 5: Commit**

```bash
git add src/anchors.js src/app.js
git commit -m "tags every drawn calendar so its grid can be measured back off the board"
```

---

# Phase 2 — TODAY-Indikator

## Task 4: `columnForToday` in `src/today.js`

**Files:**
- Create: `src/today.js`
- Test: `test/today.test.js`

**Interfaces:**
- Consumes: `columnOf`, `totalWorkingDays` aus `src/calendar.js`
- Produces: `columnForToday(year: number, today: Dayjs): number | null`

- [ ] **Step 1: Write the failing test**

Neue Datei `test/today.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/today.js'`

- [ ] **Step 3: Create `src/today.js` with the pure part only**

```js
import { columnOf, totalWorkingDays } from './calendar.js';

/**
 * The grid column today belongs in, or null when the year does not contain it.
 *
 * Saturdays and Sundays have no column of their own. columnOf counts working
 * days, so a weekend already resolves to the coming Monday - the agreed
 * behaviour needs no special case here, only the test that pins it down.
 */
export function columnForToday(year, today) {
    const column = columnOf(year, today);
    if (column < 0 || column >= totalWorkingDays(year)) return null;
    return column;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, vier neue Tests.

- [ ] **Step 5: Commit**

```bash
git add src/today.js test/today.test.js
git commit -m "adds the column lookup for the TODAY indicator"
```

---

## Task 5: Lebenszyklus der Indikator-Items und der Updater

**Files:**
- Modify: `src/today.js`
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `columnForToday` (Task 4); `board`, `run` aus `src/board.js`; `xOfColumn` aus `src/calendar.js`; `updateCalendar` aus `src/anchors.js`; `findCalendars` aus `src/anchors.js`
- Produces: `syncIndicator(calendar: Calendar, today: Dayjs): Promise<void>` — legt an, verschiebt oder entfernt, je nach Sollzustand

- [ ] **Step 1: Extend `src/today.js`**

An die Datei anhängen:

```js
import { board, run, isRateLimitError } from './board.js';
import { xOfColumn } from './calendar.js';
import { updateCalendar, findCalendars } from './anchors.js';

const CIRCLE_FILL = '#d81b60';
const LINE_COLOR = '#000000';
const LINE_WIDTH = 6;

// Fixed, unlike the diameter above, which scales with the calendar. The label
// only has to be readable; letting it grow with the calendar made it dominate
// the circle on a full-size board.
const LABEL_SIZE = 24;

// The one number to change for the circle's size. Diameter is a multiple of
// the calendar's measured rowHeight rather than a fixed pixel value, so it
// keeps scaling with whatever the calendar was drawn at.
const DIAMETER_FACTOR = 1.6;

// Anything closer than this is the same position as far as anyone can see, and
// writing it again would only burn credits.
const NUDGE = 0.5;

/**
 * Brings the indicator of one calendar in line with today.
 *
 * Reads before it writes, on purpose - but that guarantee only covers the move
 * path. moveIndicator compares the measured x against the wanted one and only
 * writes on a real difference, so five open sessions (one updater each, per
 * the headless iframe) converge on the same value with the normal case being
 * zero writes. createIndicator has no such guard: two sessions opening a board
 * whose indicator does not exist yet can both see `circleId` missing, both
 * pass the check above, and both create a full triple. That race is accepted,
 * not fixed - see the design doc's accepted costs - because closing it would
 * need a compare-and-swap that AppData does not offer.
 */
export async function syncIndicator(calendar, today) {
    const { entry, grid } = calendar;
    const column = columnForToday(calendar.year, today);
    const wanted = entry.indicator.enabled && column !== null;

    if (!wanted) {
        if (entry.indicator.circleId) await removeIndicator(entry);
        return;
    }

    const x = xOfColumn(grid, column) + grid.shapeWidth / 2;

    if (!entry.indicator.circleId) {
        await createIndicator(calendar, x);
        return;
    }

    await moveIndicator(entry, x);
}

/**
 * Creates the circle, the anchor and the connector, then records all three in
 * AppData in one write - or none of them, if anything along the way fails.
 *
 * This is deliberately all-or-nothing. The updater ticks every 10 minutes in
 * the headless iframe of every open board session, and it decides whether an
 * indicator already exists purely by checking `circleId` in AppData. A
 * half-created indicator (say the circle and anchor exist but the connector
 * failed) would still read as "missing" on the next tick, so createIndicator
 * would run again and stack a second circle/anchor pair on top of the first -
 * and again on the tick after that, for as long as the failure persists. The
 * anchor shape has no fill and no border, so these orphans would be almost
 * impossible to notice or clean up by hand. Rolling back whatever this
 * attempt created, before the error propagates, keeps a failed attempt from
 * ever being distinguishable - on the board or in AppData - from an attempt
 * that never started.
 */
async function createIndicator(calendar, x) {
    const { entry, rowHeight } = calendar;
    const created = [];

    // With the old fixed diameter (one rowHeight) the circle's centre sat at
    // `calendar.top - rowHeight`, which left exactly half a row of clearance
    // between the circle's bottom edge and the calendar. Deriving the centre
    // from the diameter, instead of hard-coding that offset, keeps that same
    // half-row gap for any diameter: the centre is always half a row above
    // the calendar top, minus half the circle's own height.
    const diameter = rowHeight * DIAMETER_FACTOR;
    const centerY = calendar.top - rowHeight / 2 - diameter / 2;

    try {
        const circle = await run(() => board.createShape({
            shape: 'circle',
            content: '<p><b>TODAY</b></p>',
            x,
            y: centerY,
            width: diameter,
            height: diameter,
            style: {
                fillColor: CIRCLE_FILL,
                color: '#ffffff',
                fontFamily: 'open_sans',
                fontSize: LABEL_SIZE,
                borderWidth: 0,
            },
        }));
        created.push(circle);

        // Miro refuses loose connectors, so the dotted line needs something to end
        // on. This is that something: present, invisible, and draggable.
        const anchor = await run(() => board.createShape({
            shape: 'rectangle',
            x,
            y: calendar.bottom + 3 * rowHeight,
            width: 8,
            height: 8,
            style: { fillOpacity: 0, borderOpacity: 0, borderWidth: 0 },
        }));
        created.push(anchor);

        const connector = await run(() => board.createConnector({
            shape: 'straight',
            start: { item: circle.id, snapTo: 'bottom' },
            end: { item: anchor.id, snapTo: 'top' },
            style: {
                strokeStyle: 'dotted',
                strokeWidth: LINE_WIDTH,
                strokeColor: LINE_COLOR,
                startStrokeCap: 'none',
                endStrokeCap: 'none',
            },
        }));
        created.push(connector);

        await updateCalendar(entry.calendarId, {
            indicator: {
                ...entry.indicator,
                circleId: circle.id,
                anchorId: anchor.id,
                connectorId: connector.id,
            },
        });

        // Grouping happens last, and is guarded on its own, on purpose. It runs
        // only after the AppData write above, so a failure here can never cost
        // the ids just recorded or trigger the rollback below - the three items
        // are already a fully working indicator without it.
        //
        // The reason for the caution: a Group has no writable x/y, and the Web
        // SDK reference does not say whether a member's x can still be set and
        // sync()'d once it is inside one - which is exactly what moveIndicator
        // does on every tick. Verified on a real board: moving the calendar
        // sideways, the grouped indicator still follows to the new column. So
        // it works, but it works undocumented. The guard stays, because an
        // indicator that silently stopped tracking today would be worse than an
        // ungrouped one, and the group is only a convenience for the mouse.
        try {
            await run(() => board.group({ items: [circle, anchor, connector] }));
        } catch (error) {
            console.warn(`Timeline Builder: could not group the TODAY indicator for calendar ${entry.calendarId}`, error);
        }
    } catch (error) {
        // Undo whatever this attempt managed to create, oldest first. Each
        // removal is isolated and best-effort: one failing to remove must not
        // stop the others from being tried, and a cleanup failure must never
        // replace or hide the original error below.
        for (const item of created) {
            try {
                await run(() => board.remove(item));
            } catch {
                // If removal also fails, this item is genuinely orphaned. That
                // residual risk is accepted rather than designed away - a
                // decoration does not warrant a reconciliation mechanism to
                // hunt down doubly-failed cleanups.
            }
        }

        console.error(`Timeline Builder: failed to create the TODAY indicator for calendar ${entry.calendarId}, rolled back`, error);
        throw error;
    }
}

/**
 * Only x is ever written, never y. Drag the lower anchor down and the line
 * stays longer; push the circle up and it stays up. That is the whole length
 * and height adjustment, and it has to work this way: width and height are
 * read-only on shapes, so a rectangle used as a line could not be stretched at
 * all without deleting and recreating it.
 */
async function moveIndicator(entry, x) {
    const ids = [entry.indicator.circleId, entry.indicator.anchorId];

    for (const id of ids) {
        let item;
        try {
            item = await run(() => board.getById(id));
        } catch (error) {
            // getById throwing after run() exhausts its retries on a rate
            // limit is not the same as the item being gone - the call never
            // completed, so the item's real state is unknown. Treating it as
            // gone here would call removeIndicator, whose own board.remove
            // calls would hit the same limit and be swallowed by its
            // best-effort catches, so circleId/anchorId/connectorId would be
            // cleared in AppData while the shapes stayed on the board. The
            // next tick would then see no indicator at all and draw a second
            // circle, anchor and connector beside the orphaned first set, and
            // it would silently discard any manual repositioning the user did
            // - the documented way to adjust the indicator's height and the
            // connector's length. So a rate limit must leave the ids
            // untouched and just skip this pass, exactly like anchors.js's
            // measure() does for the same failure.
            if (isRateLimitError(error)) {
                console.warn(`Timeline Builder: rate limited while moving the TODAY indicator for calendar ${entry.calendarId}, keeping it and skipping this pass.`);
                return;
            }

            // Someone deleted a piece of it - but not necessarily all of it.
            // Simply forgetting the ids here would abandon whatever survives
            // (the circle, say, if only the anchor was deleted) as an orphan
            // that AppData no longer points to and the next tick cannot see,
            // so createIndicator would draw a second circle/anchor/connector
            // right beside it. The anchor shape has no fill and no border, so
            // that orphan could never be found or cleaned up by hand.
            // removeIndicator already tears down all three ids and tolerates
            // each one being gone, which is exactly what a broken indicator
            // needs, so reuse it instead of writing a second teardown.
            await removeIndicator(entry);
            return;
        }

        if (Math.abs(item.x - x) < NUDGE) continue;

        item.x = x;
        await run(() => item.sync());
    }
}

async function removeIndicator(entry) {
    const ids = [entry.indicator.connectorId, entry.indicator.circleId, entry.indicator.anchorId];

    for (const id of ids) {
        if (!id) continue;
        try {
            const item = await run(() => board.getById(id));
            await run(() => board.remove(item));
        } catch {
            // Already gone. Nothing to do.
        }
    }

    await updateCalendar(entry.calendarId, {
        indicator: { ...entry.indicator, circleId: null, anchorId: null, connectorId: null },
    });
}

/**
 * Brings every calendar's indicator up to date in one pass.
 *
 * Never throws. This runs in every board viewer's session (the headless
 * updater in index.js) and, since drawing a calendar heals indicators too,
 * from the panel's own iframe right after a draw - one broken calendar entry
 * must not take somebody's board down with it, nor cost the calendar that was
 * just drawn.
 */
export async function updateIndicators(today) {
    let calendars;
    try {
        calendars = await findCalendars();
    } catch (error) {
        // Nothing to iterate, so this is one failure for the whole run.
        console.error('Timeline Builder: could not update the TODAY indicator', error);
        return;
    }

    for (const calendar of calendars) {
        try {
            await syncIndicator(calendar, today);
        } catch (error) {
            // Isolated per calendar: if this one fails deterministically (a style
            // value Miro rejects, say), it must not starve every other calendar on
            // the board of its update, tick after tick, forever.
            console.error(`Timeline Builder: failed to update the TODAY indicator for calendar ${calendar.entry.calendarId}`, error);
        }
    }
}
```

- [ ] **Step 2: Replace `src/index.js`**

```js
import dayjs from 'dayjs';

import { board } from './board.js';
import { updateIndicators } from './today.js';

// Miro loads this file in a headless iframe when the board opens and keeps it
// running for as long as the board stays open. That is the only clock we get:
// nothing runs while nobody has the board open, and nothing needs to.
const TICK_MS = 10 * 60 * 1000;

export async function init() {
  // Not a credited board call, just an event subscription, so it does not go
  // through run(). It still goes through the shared `board` export rather
  // than the bare `miro` global, so this file has exactly one way of reaching
  // the SDK, same as every other module here.
  board.ui.on('icon:click', async () => {
    await board.ui.openPanel({url: 'app.html'});
  });

  await tick();
  setInterval(tick, TICK_MS);
}

// Scheduling wrapper only; the actual per-calendar work lives in today.js so
// drawCalendar (src/app.js) can share it instead of running a second copy.
async function tick() {
  await updateIndicators(dayjs());
}

init();
```

- [ ] **Step 3: Verify the suite still passes**

Run: `npm test`
Expected: 42 Tests PASS. `today.js` importiert jetzt `board.js`, aber `test/today.test.js` importiert nur `columnForToday` — **prüfen, dass der Test weiterhin grün ist**. Läuft er in `window is not defined`, hat der statische Import von `board.js` das reine Modul verunreinigt; dann `columnForToday` in eine eigene Datei `src/todayColumn.js` ziehen, die nichts importiert außer `calendar.js`, und `today.js` daraus importieren lassen. Der Test importiert dann `../src/todayColumn.js`.

- [ ] **Step 4: Manual verification on a real board**

`npm start`, Board neu laden (der headless iframe startet nur beim Öffnen des Boards). Erwartung: über dem Kalender erscheint ein oranger TODAY-Kreis mit einer gepunkteten Linie nach unten, auf der Spalte des heutigen Tages.

Prüfpunkte:
1. Board neu laden — es entsteht **kein zweiter** Indikator.
2. Den unteren, unsichtbaren Anker nach unten ziehen (er liegt drei Zeilenhöhen unter der Tageszeile, per Rechtecksauswahl greifbar). Neu laden: die Linie bleibt lang.
3. Kreis nach oben ziehen, neu laden: er bleibt oben.
4. Kreis löschen, ~10 Minuten warten oder neu laden: er kommt zurück. Das ist beabsichtigt; zum Abschalten dient die Checkbox aus Task 6.

Lehnt Miro einen Stilwert ab, nennt der Fehler die Eigenschaft. Wahrscheinlichster Kandidat ist `startStrokeCap: 'none'` — dann diese beiden Zeilen entfernen, die Voreinstellung zeichnet ohnehin keine Pfeilspitze am Start.

- [ ] **Step 5: Commit**

```bash
git add src/today.js src/index.js
git commit -m "keeps a TODAY indicator on the current column while the board is open"
```

---

## Task 6: Checkbox „TODAY-Indikator" im Kalender-Tab

**Files:**
- Modify: `app.html`
- Modify: `src/app.js`
- Modify: `src/anchors.js`

**Interfaces:**
- Consumes: `updateCalendar` aus `src/anchors.js`
- Produces: `tagCalendar` akzeptiert zusätzlich `indicatorEnabled: boolean`

- [ ] **Step 1: Add the checkbox to `app.html`**

Im Fieldset „Shape Settings" direkt vor `</fieldset>` einfügen:

```html
                    <div class="form-group form-group-small toggle-container">
                        <label class="toggle">
                            <input type="checkbox" id="drawTodayIndicator" tabindex="0" checked/>
                            <span>Draw Today Indicator</span>
                        </label>
                    </div>
```

- [ ] **Step 2: Pass the setting through in `src/app.js`**

`getSettings()` liest bereits jede Checkbox in `settings` ein, `drawTodayIndicator` steht also ohne weiteres Zutun zur Verfügung. Im `try`-Block von `drawCalendar` den Aufruf ergänzen:

```js
        await tagCalendar({ drawnRows, rows, year, indicatorEnabled: settings.drawTodayIndicator });
```

- [ ] **Step 3: Honour it in `src/anchors.js`**

Signatur und Eintrag in `tagCalendar` anpassen:

```js
export async function tagCalendar({ drawnRows, rows, year, indicatorEnabled = true }) {
```

```js
        indicator: { enabled: indicatorEnabled, circleId: null, anchorId: null, connectorId: null },
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: 42 Tests PASS, Build sauber.

Auf dem Board: Kalender mit abgewählter Checkbox zeichnen, Board neu laden — es erscheint kein Indikator. `(await miro.board.getAppData('calendars')).at(-1).indicator.enabled` muss `false` sein.

- [ ] **Step 5: Commit**

```bash
git add app.html src/app.js src/anchors.js
git commit -m "makes the TODAY indicator optional per calendar"
```

---

# Phase 3 — Urlaubsimport

## Task 7: `src/colors.js`

Wörtlicher Umzug aus `SAPVac/drawshapes.js`, Zeilen 71–136, **inklusive der Kommentarblöcke**. Diese Entscheidungen wurden in SAPVac je zweimal getroffen und einmal zurückgerollt; die Begründung muss den Umzug überleben.

**Files:**
- Create: `src/colors.js`
- Test: `test/colors.test.js`

**Interfaces:**
- Consumes: nichts
- Produces: `stringToColor(str: string): string` — Hex mit führendem `#`, immer sieben Zeichen

- [ ] **Step 1: Write the failing test**

Neue Datei `test/colors.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { hslToHex, stringToColor } from '../src/colors.js';

const NAMES = ['Meyer, Anna', 'Meyer, Bernd', 'Schmidt, Clara', 'Ali, Dilan', 'Ötztürk, Emre', ''];

test('a name always produces the same colour', () => {
    for (const name of NAMES) {
        assert.equal(stringToColor(name), stringToColor(name));
    }
    assert.match(stringToColor('Meyer, Anna'), /^#[0-9a-f]{6}$/);
});

// The hash used to be signed and therefore usually negative, which made every
// modulo below it negative too and pushed saturation and lightness a full ten
// points under the documented range. This is the test that would have caught it.
test('every colour lands inside the documented pastel range', () => {
    for (const name of NAMES) {
        const { s, l } = toHsl(stringToColor(name));
        assert.ok(s >= 0.69 && s <= 0.81, `${name}: saturation ${s}`);
        assert.ok(l >= 0.79 && l <= 0.91, `${name}: lightness ${l}`);
    }
});

test('alphabetically adjacent names do not come out as the same shade', () => {
    const a = toHsl(stringToColor('Meyer, Anna')).h;
    const b = toHsl(stringToColor('Meyer, Bernd')).h;
    const apart = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    assert.ok(apart > 20, `only ${apart} degrees apart`);
});

// hslToHex was written out by hand rather than fetched back from a canvas, so
// it needs checking against maths that came from somewhere else. This is the
// textbook hue2rgb formulation, over the whole space the app can produce.
test('hslToHex agrees with an independent HSL conversion everywhere', () => {
    let worst = 0;

    for (let h = 0; h < 360; h += 1) {
        for (let s = 60; s <= 90; s += 5) {
            for (let l = 70; l <= 95; l += 5) {
                const mine = hslToHex(h, s / 100, l / 100);
                const theirs = referenceHslToHex(h, s / 100, l / 100);

                for (const i of [1, 3, 5]) {
                    worst = Math.max(worst, Math.abs(
                        parseInt(mine.slice(i, i + 2), 16) - parseInt(theirs.slice(i, i + 2), 16)
                    ));
                }
            }
        }
    }

    assert.ok(worst <= 1, `channels differ by up to ${worst}, which is more than rounding`);
});

// --- independent ground truth ------------------------------------------------
// Deliberately not the implementation's own maths run backwards.

function referenceHslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h / 360;

    return '#' + [hue2rgb(p, q, hk + 1 / 3), hue2rgb(p, q, hk), hue2rgb(p, q, hk - 1 / 3)]
        .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
        .join('');
}

function toHsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;

    if (d === 0) return { h: 0, s: 0, l };

    const s = d / (1 - Math.abs(2 * l - 1));
    const h =
        max === r ? 60 * (((g - b) / d) % 6) :
        max === g ? 60 * ((b - r) / d + 2) :
                    60 * ((r - g) / d + 4);

    return { h: (h + 360) % 360, s, l };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/colors.js'`

- [ ] **Step 3: Create `src/colors.js`**

`hashOf`, `hslToHex`, `GOLDEN_RATIO` und `stringToColor` aus `SAPVac/drawshapes.js` übernehmen, Kommentare unverändert. `stringToColor` und `hslToHex` werden exportiert — letzteres nur, damit der Referenztest es einzeln prüfen kann:

```js
// A name always produces the same pastel, on every run and every board.
//
// The hash is made unsigned before anything is derived from it. It used to be
// signed and therefore usually negative, which made every modulo below
// negative too: saturation came out at 61-70% and lightness at 71-80%, not the
// 70-80% and 80-90% the comments claimed, and the hue was negative and only
// worked because CSS wraps it.
function hashOf(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (Math.imul(hash, 31) + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

// Written out rather than fetched back from a canvas. Safari adds noise to
// getImageData as a fingerprinting defence, which is exactly the kind of thing
// that makes "deterministic" quietly stop being true.
export function hslToHex(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const lift = lightness - chroma / 2;

    const [r, g, b] =
        hue <  60 ? [chroma, second, 0] :
        hue < 120 ? [second, chroma, 0] :
        hue < 180 ? [0, chroma, second] :
        hue < 240 ? [0, second, chroma] :
        hue < 300 ? [second, 0, chroma] :
                    [chroma, 0, second];

    return '#' + [r, g, b]
        .map((channel) => Math.round((channel + lift) * 255).toString(16).padStart(2, '0'))
        .join('');
}

const GOLDEN_RATIO = 0.618033988749895;

// Derived from the name alone, deliberately - not from the employee's
// position in the roster.
//
// Hashing scatters, it does not distribute: with a handful of people some hues
// will land close together, and a six-person team really did come out with
// three pinks. Spreading them evenly over the sorted roster (i / n * 360)
// would fix that, but then everyone's colour shifts as soon as one person
// joins or leaves, and the same board redrawn a month later looks unrelated to
// the old one.
//
// Stability was chosen over even spread. Do not "improve" this into an
// index-based palette without deciding that trade-off again.
export function stringToColor(str) {
    const hash = hashOf(str);

    // Two alphabetically adjacent names hash to nearby numbers, and nearby
    // numbers would map to nearby hues. Taking the fractional part of n x phi
    // breaks that up: consecutive n land roughly 222 degrees apart, so
    // "Meyer A" and "Meyer B" come out clearly different rather than one shade
    // off.
    const hue = ((hash * GOLDEN_RATIO) % 1) * 360;

    // Higher bits, so a shared hue does not imply a shared shade.
    const saturation = 0.70 + ((hash >>> 11) % 11) / 100;
    const lightness = 0.80 + ((hash >>> 21) % 11) / 100;

    return hslToHex(hue, saturation, lightness);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, vier neue Tests (46 insgesamt).

- [ ] **Step 5: Commit**

```bash
git add src/colors.js test/colors.test.js
git commit -m "moves the employee colour hash into the plugin, with tests"
```

---

## Task 8: `src/vacation.js`

**Files:**
- Create: `src/vacation.js`
- Test: `test/vacation.test.js`

**Interfaces:**
- Consumes: `columnOf`, `totalWorkingDays`, `nextWorkingDay`, `previousWorkingDay` aus `src/calendar.js`; `stringToColor` aus `src/colors.js`
- Produces:
  - `parseVacations(text: string): {entries: Entry[], problems: string[]}` mit
    `Entry = {employee: string, start: Dayjs, end: Dayjs, label: string, duration: number | null}`
  - `yearsIn(entries: Entry[]): number[]` — aufsteigend, ohne Duplikate
  - `planVacations(entries: Entry[], year: number): {rows: Row[], problems: string[]}` mit
    `Row = {employee: string, index: number, color: string, blocks: Block[]}` und
    `Block = {colStart: number, colSpan: number, label: string}`

- [ ] **Step 1: Write the failing test**

Neue Datei `test/vacation.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/vacation.js'`

- [ ] **Step 3: Create `src/vacation.js`**

```js
import dayjs from 'dayjs';

import {
    columnOf,
    nextWorkingDay,
    previousWorkingDay,
    totalWorkingDays,
} from './calendar.js';
import { stringToColor } from './colors.js';

/**
 * Turns the JSON that SAPVac/sapvac.js produces into entries we can plan with.
 *
 * A bad entry never aborts the import. It is dropped and named, so the panel
 * can show what did not make it instead of silently drawing less than expected.
 */
export function parseVacations(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        return { entries: [], problems: ['That is not valid JSON.'] };
    }

    if (!Array.isArray(raw)) {
        return { entries: [], problems: ['Expected a list of vacation entries.'] };
    }

    const entries = [];
    const problems = [];

    raw.forEach((item, index) => {
        const employee = item?.employeeName;
        const label = item?.vacationPeriod ?? '';
        const where = `Entry ${index + 1}`;

        if (typeof employee !== 'string' || employee === '') {
            problems.push(`${where}: no employeeName.`);
            return;
        }

        const start = dayjs(item?.vacationStartDate);
        // A missing or empty vacationEndDate is treated as a same-day period,
        // not a problem: the scraper always sends both dates, so this only
        // ever happens with a period that starts and ends on the same day.
        const end = item?.vacationEndDate ? dayjs(item.vacationEndDate) : start;

        if (!start.isValid() || !end.isValid()) {
            problems.push(`${where} (${employee}): unreadable date.`);
            return;
        }
        if (end.isBefore(start, 'day')) {
            problems.push(`${where} (${employee}): end is before the start.`);
            return;
        }

        entries.push({
            employee,
            start,
            end,
            label,
            duration: typeof item?.vacationDuration === 'number' ? item.vacationDuration : null,
        });
    });

    return { entries, problems };
}

/** Every calendar year the data touches, ascending. */
export function yearsIn(entries) {
    const years = new Set();
    for (const entry of entries) {
        years.add(entry.start.year());
        years.add(entry.end.year());
    }
    return [...years].sort((a, b) => a - b);
}

/**
 * Places every entry on the grid of one drawn year.
 *
 * The span is columnOf(end) - columnOf(start) + 1, both from the same tested
 * function that positioned the day cells. There is no second day count that
 * could drift from the first - which is the whole reason this moved out of
 * SAPVac/drawshapes.js, where the same off-by-one came back three times.
 */
export function planVacations(entries, year) {
    const columns = totalWorkingDays(year);
    const problems = [];
    const placed = [];

    for (const entry of entries) {
        const where = `${entry.employee} (${entry.label})`;

        // A period reported as Sat-Sun means the working days inside it.
        const start = nextWorkingDay(entry.start);
        const end = previousWorkingDay(entry.end);

        if (end.isBefore(start, 'day')) {
            problems.push(`${where}: contains no working day.`);
            continue;
        }

        const rawStart = columnOf(year, start);
        const rawEnd = columnOf(year, end);

        if (rawEnd < 0 || rawStart > columns - 1) {
            problems.push(`${where}: is not in ${year}.`);
            continue;
        }

        const colStart = Math.max(0, rawStart);
        const colEnd = Math.min(columns - 1, rawEnd);
        const colSpan = colEnd - colStart + 1;

        // Only compare against SAP when nothing was clipped - a period running
        // past New Year is legitimately shorter on this calendar.
        const clipped = rawStart < colStart || rawEnd > colEnd;
        if (!clipped && entry.duration !== null && colSpan !== entry.duration) {
            problems.push(`${where}: SAP reports ${entry.duration}, calculated ${colSpan}.`);
        }

        placed.push({ employee: entry.employee, colStart, colSpan, label: entry.label });
    }

    const employees = [...new Set(placed.map((item) => item.employee))].sort();
    const rows = employees.map((employee, index) => ({
        employee,
        index,
        color: stringToColor(employee),
        // colStart alone is not a total order: two periods pulled onto the
        // same Monday by nextWorkingDay share a colStart, and Array.sort is
        // stable, so ties would fall back to input order - exactly what this
        // sort exists to remove. colSpan and then label break every tie that
        // colStart cannot; once all three agree the blocks are identical in
        // content, so no order is observable.
        blocks: placed
            .filter((item) => item.employee === employee)
            .map(({ colStart, colSpan, label }) => ({ colStart, colSpan, label }))
            .sort((a, b) => a.colStart - b.colStart || a.colSpan - b.colSpan || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    }));

    return { rows, problems };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, zwölf neue Tests (58 insgesamt).

- [ ] **Step 5: Commit**

```bash
git add src/vacation.js test/vacation.test.js
git commit -m "plans imported vacations against the calendar grid instead of against each other"
```

---

## Task 9: Zwei Tabs im Panel

**Files:**
- Modify: `app.html`
- Modify: `src/app.js`
- Modify: `src/assets/style.css`

**Interfaces:**
- Consumes: nichts
- Produces: `#view-calendar` und `#view-import` als umschaltbare Ansichten; `.hidden` markiert die inaktive

- [ ] **Step 1: Restructure `app.html`**

Direkt hinter `<div class="scrollable-container container">` die Tab-Leiste einfügen, das bestehende `<form>` in `#view-calendar` einwickeln und `#view-import` daneben stellen. Die Mirotone-Struktur ist `.tabs > .tabs-header-list > .tab > .tab-text`; `.tab-active` markiert den aktiven Tab.

```html
        <div class="scrollable-container container">
            <div class="tabs">
                <div class="tabs-header-list">
                    <div class="tab tab-active" data-view="calendar" role="tab" tabindex="0">
                        <div class="tab-text">Calendar</div>
                    </div>
                    <div class="tab" data-view="import" role="tab" tabindex="0">
                        <div class="tab-text">Vacation</div>
                    </div>
                </div>
            </div>

            <div id="view-calendar">
                <!-- Das bestehende <form> ... </form> aus app.html Zeile 11-129
                     wandert hier unverändert hinein. Kein Inhalt darin ändert
                     sich; es bekommt nur diesen Wrapper. -->
            </div>

            <div id="view-import" class="hidden">
                <fieldset class="section">
                    <div class="h4 section-title">Vacation Data</div>
                    <div class="form-group form-group-small">
                        <label for="vacationJson">Paste JSON from the SAP bookmarklet</label>
                        <textarea class="textarea" id="vacationJson" rows="8"
                                  placeholder='[{"employeeName": "...", "vacationStartDate": "2026-03-02", ...}]'></textarea>
                    </div>
                    <div class="form-group form-group-small hidden" id="calendarChoice">
                        <label for="targetCalendar">Which calendar?</label>
                        <select class="select select-small" id="targetCalendar"></select>
                    </div>
                </fieldset>

                <div class="footer-stack">
                    <button type="button" id="importSubmit" class="button button-primary button-small button-wide">Draw Vacation</button>
                </div>
                <p id="importStatus" class="p-small draw-status hidden" role="status" aria-live="polite"></p>
                <ul id="importProblems" class="p-small import-problems hidden"></ul>
            </div>
        </div>
```

- [ ] **Step 2: Add the problem list style to `src/assets/style.css`**

```css
.import-problems {
  margin: var(--space-xsmall) 0 0;
  padding-left: var(--space-medium);
  color: var(--red800, #c71414);
}

.import-problems li {
  margin-bottom: var(--space-xxsmall);
}
```

- [ ] **Step 3: Add tab switching to `src/app.js`**

Am Ende der Datei, hinter `validateYear`:

```js
// One panel, two views. Miro only ever hands the app a single icon:click, and
// the import needs the calendar context anyway.
document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
});

function showView(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('tab-active', tab.dataset.view === name);
    });
    document.getElementById('view-calendar').classList.toggle('hidden', name !== 'calendar');
    document.getElementById('view-import').classList.toggle('hidden', name !== 'import');
}
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: 58 Tests PASS, Build sauber.

Im Panel: beide Tabs schalten um, das Kalenderformular funktioniert unverändert, der Urlaub-Tab zeigt Textarea und Button (der noch nichts tut).

- [ ] **Step 5: Commit**

```bash
git add app.html src/app.js src/assets/style.css
git commit -m "splits the panel into a calendar tab and an import tab"
```

---

## Task 10: `src/import.js`

**Files:**
- Create: `src/import.js`
- Modify: `src/app.js` (Import der neuen Datei)

**Interfaces:**
- Consumes: `parseVacations`, `planVacations`, `yearsIn` (Task 8); `findCalendars`, `updateCalendar` (Task 3); `board`, `run`, `takeStats`, `isRateLimitError` aus `src/board.js`; `xOfColumn`, `widthOfColumns` aus `src/calendar.js`
- Produces: `initImportView(): void`

- [ ] **Step 1: Create `src/import.js`**

```js
import { board, run, takeStats, isRateLimitError } from './board.js';
import { findCalendars, updateCalendar } from './anchors.js';
import { xOfColumn, widthOfColumns } from './calendar.js';
import { parseVacations, planVacations, yearsIn } from './vacation.js';

const METADATA_KEY = 'timelineBuilder';

export function initImportView() {
    document.getElementById('importSubmit').addEventListener('click', runImport);
}

async function runImport() {
    setStatus('Reading data...', true);
    showProblems([]);

    const { entries, problems: parseProblems } = parseVacations(
        document.getElementById('vacationJson').value
    );

    if (entries.length === 0) {
        setStatus('Nothing was drawn.', false);
        showProblems(parseProblems);
        return;
    }

    const calendar = await chooseCalendar(entries);
    if (!calendar) {
        setStatus('This board has no calendar for this data.', false);
        showProblems(parseProblems);
        return;
    }

    const { rows, problems: planProblems } = planVacations(entries, calendar.year);
    const problems = [...parseProblems, ...planProblems];

    if (rows.length === 0) {
        setStatus('Nothing was drawn.', false);
        showProblems(problems);
        return;
    }

    try {
        await removePreviousImport(calendar.entry);

        setStatus('Drawing vacation...', true);
        const shapes = await drawRows(calendar, rows);

        await updateCalendar(calendar.entry.calendarId, {
            vacationItemIds: shapes.map((shape) => shape.id),
        });

        if (shapes.length > 1) await run(() => board.group({ items: shapes }));

        logStats(calendar, shapes.length);

        if (problems.length > 0) {
            // Keep the panel open: a half-understood import is exactly the
            // thing you want to see rather than have vanish.
            setStatus(`${shapes.length} bars drawn, with notes:`, false);
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
 * Which calendar the bars belong to.
 *
 * sapvac.js reads nine months at a stretch, so the data regularly crosses a
 * year boundary. One import always writes into exactly one calendar; entries
 * outside its year are reported by planVacations and skipped. Import twice and
 * pick the other calendar to cover both years - each calendar keeps its own
 * list of bars, so the two do not overwrite each other.
 */
async function chooseCalendar(entries) {
    const years = yearsIn(entries);
    const candidates = (await findCalendars()).filter((calendar) => years.includes(calendar.year));

    const choice = document.getElementById('calendarChoice');
    const select = document.getElementById('targetCalendar');

    if (candidates.length <= 1) {
        choice.classList.add('hidden');
        return candidates[0] ?? null;
    }

    // Compare the candidate set by identity, not by length: a calendar deleted
    // and another drawn in the same session can leave the same count behind,
    // and rebuilding only on a count change would let the dropdown keep
    // showing stale entries while the code resolves against the new list.
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
        // Keep the user's choice if it is still among the candidates; otherwise
        // the select falls back to its first option, same as before.
        if (candidateIds.includes(previousSelection)) {
            select.value = previousSelection;
        }
    }
    choice.classList.remove('hidden');

    return candidates.find((c) => c.entry.calendarId === select.value) ?? candidates[0];
}

async function removePreviousImport(entry) {
    const ids = entry.vacationItemIds ?? [];
    if (ids.length === 0) return;

    setStatus('Removing previous import...', true);

    // A per-id failure here is not one thing. getById or remove throwing
    // after run() exhausts its retries on a rate limit means the call never
    // completed - the bar's fate is unknown, not decided - while any other
    // throw means the bar is genuinely gone (deleted by hand, by undo, or
    // just removed by the call above). Collapsing both into "gone", as this
    // used to, cleared vacationItemIds unconditionally: a bar that only hit a
    // transient rate limit was left on the board with its one handle
    // discarded, so every later import stacked a duplicate on top of it.
    // Keeping the rate-limited ids here, and only ever dropping ids that are
    // confirmed gone or were actually removed, is the same distinction
    // anchors.js's measure() makes for the equivalent failure.
    const remaining = [];

    for (const id of ids) {
        try {
            const item = await run(() => board.getById(id));
            await run(() => board.remove(item));
        } catch (error) {
            if (isRateLimitError(error)) {
                remaining.push(id);
            }
            // else: already gone, by hand or by undo - drop it.
        }
    }

    await updateCalendar(entry.calendarId, { vacationItemIds: remaining });
}

// Bars sit directly under the day row and take the calendar's own measured row
// height, so they line up with it by construction rather than by eye.
async function drawRows(calendar, rows) {
    const { grid, rowHeight, bottom, entry } = calendar;

    const results = await Promise.allSettled(rows.flatMap((row) =>
        row.blocks.map(async (block) => {
            const width = widthOfColumns(grid, block.colSpan);
            const x = xOfColumn(grid, block.colStart);
            const y = bottom + grid.padding + row.index * (rowHeight + grid.padding);

            // employee and label are interpolated into HTML unescaped. Accepted
            // deliberately, not an oversight: this data comes from the user's
            // own SAP export, not from a third party, and it lands in Miro's
            // rich-text renderer rather than this app's DOM, so there is no
            // injection surface to guard against here. It is a new pattern in
            // this codebase, though - treat it as a one-off exception, not a
            // precedent for the next place that interpolates user-facing text.
            const shape = await run(() => board.createShape({
                content: `<p><b>${row.employee}</b><br />${block.label}</p>`,
                shape: 'rectangle',
                x: x + width / 2,
                y: y + rowHeight / 2,
                width,
                height: rowHeight,
                style: {
                    fillColor: row.color,
                    fontFamily: 'open_sans',
                    fontSize: Math.round(rowHeight / 7),
                    borderWidth: 0,
                },
            }));

            try {
                await run(() => shape.setMetadata(METADATA_KEY, {
                    role: 'vacation',
                    calendarId: entry.calendarId,
                    employee: row.employee,
                }));
            } catch (error) {
                // createShape already put this one on the board, tagging it is
                // a separate call that can fail on its own (rate limit, say).
                // Carry the shape along on the rejection so it is not lost
                // below - a bar missing its tag is still a bar that needs to
                // be findable and removable by the next import.
                if (error && typeof error === 'object') error.createdShape = shape;
                throw error;
            }

            return shape;
        })
    ));

    // Every shape actually sitting on the board, whether or not its metadata
    // tag also made it - a rejected result can still carry one via
    // createdShape, attached above.
    const shapes = results
        .map((result) => (result.status === 'fulfilled' ? result.value : result.reason?.createdShape))
        .filter(Boolean);
    const failure = results.find((result) => result.status === 'rejected');

    if (failure) {
        // These ids are the only handle that will ever exist on the bars that
        // did land: there is deliberately no board-wide scan to recover them
        // afterwards (getMetadata is one call per item, so scanning a full
        // board would be hundreds of reads). AppData must describe what is
        // actually on the board before this throws, or a later import can
        // neither find nor remove them and every retry stacks more on top.
        await updateCalendar(entry.calendarId, {
            vacationItemIds: shapes.map((shape) => shape.id),
        });
        throw failure.reason;
    }

    return shapes;
}

function logStats(calendar, count) {
    const stats = takeStats();
    if (!stats) return;

    console.log(
        `Timeline Builder - vacation import ${calendar.year}: ${count} bars in ` +
        `${(stats.wallClockMs / 1000).toFixed(1)} s, ${stats.credits.toLocaleString('en-US')} Credits`
    );
}

function describeFailure(error) {
    if (isRateLimitError(error)) {
        return 'Rate limit reached. Wait a minute and try again.';
    }
    return `Import failed: ${error?.message ?? error}`;
}

function setStatus(message, busy) {
    const button = document.getElementById('importSubmit');
    const status = document.getElementById('importStatus');

    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    status.textContent = message;
    status.classList.toggle('hidden', message === '');
}

function showProblems(problems) {
    const list = document.getElementById('importProblems');
    list.innerHTML = '';

    for (const problem of problems) {
        const item = document.createElement('li');
        item.textContent = problem;
        list.appendChild(item);
    }

    list.classList.toggle('hidden', problems.length === 0);
}
```

- [ ] **Step 2: Start it from `src/app.js`**

Import oben ergänzen und den Initialisierer aufrufen — direkt hinter dem Tab-Umschaltcode aus Task 9:

```js
import { initImportView } from './import.js';
```

```js
initImportView();
```

- [ ] **Step 3: Verify the build**

Run: `npm test && npm run build`
Expected: 58 Tests PASS, Build sauber.

- [ ] **Step 4: Manual verification on a real board**

Kalender für 2026 zeichnen. In den Urlaub-Tab wechseln und diese Daten einfügen:

```json
[{"employeeName":"Meyer, Anna","vacationStartDate":"2026-03-02","vacationEndDate":"2026-03-06","vacationPeriod":"02.03. - 06.03.","vacationDuration":5},
 {"employeeName":"Ali, Dilan","vacationStartDate":"2026-07-25","vacationEndDate":"2026-08-02","vacationPeriod":"25.07. - 02.08.","vacationDuration":5},
 {"employeeName":"Meyer, Anna","vacationStartDate":"2026-12-28","vacationEndDate":"2027-01-08","vacationPeriod":"28.12. - 08.01.","vacationDuration":10}]
```

Erwartung:
1. Zwei Zeilen, alphabetisch: „Ali, Dilan" oben, „Meyer, Anna" darunter, direkt unter der Tageszeile.
2. Die Balken sind **pixelgenau** an den Tageszellen ausgerichtet — das ist der eigentliche Prüfpunkt. Der März-Balken deckt exakt Mo 02.03. bis Fr 06.03. ab.
3. Der Juli-Balken beginnt an Montag dem 27.07., nicht am Samstag.
4. Der Dezember-Balken endet an der letzten Spalte des Jahres, ohne Warnung.
5. Erneut auf „Draw Vacation" klicken: es entstehen **keine** Duplikate, die alten Balken verschwinden zuerst.
6. Den Kalender verschieben und erneut importieren: die Balken landen wieder korrekt unter ihm.

- [ ] **Step 5: Commit**

```bash
git add src/import.js src/app.js
git commit -m "imports SAP vacation data straight onto the calendar grid"
```

---

## Task 11: `drawshapes.js` in SAPVac ablösen

**Files:**
- Delete: `/Users/felix/Documents/code/SAPVac/drawshapes.js`
- Create: `/Users/felix/Documents/code/SAPVac/README.md`

`create_bookmarklet.sh` und `.github/workflows/generate_bookmarks.yml` bleiben unverändert: die CI ruft `./create_bookmarklet.sh -o ./output ./*.js` auf, also ein Glob. Das Löschen der Datei genügt, `drawshapes` wird nirgends namentlich genannt.

**Interfaces:**
- Consumes: nichts. `sapvac.js` bleibt unverändert, das JSON-Format ändert sich nicht.
- Produces: nichts

- [ ] **Step 1: Remove the script**

```bash
cd /Users/felix/Documents/code/SAPVac && git rm drawshapes.js
```

- [ ] **Step 2: Confirm nothing else references it**

```bash
cd /Users/felix/Documents/code/SAPVac && grep -rn "drawshapes" --exclude-dir=.git --exclude-dir=node_modules .
```

Expected: keine Treffer, Exit-Status 1. Gibt es welche, sind es Reste, die mit weg müssen.

- [ ] **Step 3: Record where the drawing went**

`README.md` existiert in diesem Repo noch nicht, wird hier also neu angelegt:

```markdown
# SAPVac

Bookmarklets rund um den SAP-Teamkalender.

- `sapvac.js` — liest neun Monate Urlaubsdaten aus dem Fiori-Teamkalender und
  legt sie als JSON in die Zwischenablage.
- `text2stickies.js` — macht aus Textzeilen Miro-Sticky-Notes.

## Urlaubsdaten zeichnen

`drawshapes.js` gibt es nicht mehr. Das Zeichnen ist in das Miro-Plugin
[miro-timeline-builder](https://github.com/framegrabber/miro-timeline-builder)
umgezogen, Tab „Vacation".

Der Grund ist nicht Bequemlichkeit: Als Bookmarklet konnte der Zeichencode die
Metadaten des Plugins nicht lesen und musste die Balken deshalb relativ
zueinander ausrichten statt am Kalenderdatum. Dieselbe Off-by-one in der
Arbeitstagszählung kam dadurch dreimal zurück (b26e28f, Revert in v1.1.2, Fix
in v1.1.3). Im Plugin gibt es nur noch eine Spaltenrechnung, und sie ist
getestet.

`sapvac.js` bleibt ein Bookmarklet — es liest das DOM des SAP-Teamkalenders,
an das ein Plugin in einem Miro-iframe nicht herankommt. Das JSON-Format ist
unverändert.
```

- [ ] **Step 4: Verify the build still produces the remaining bookmarklets**

Setzt global installiertes `uglify-js` voraus (`npm install -g uglify-js`), so wie es die CI auch tut.

```bash
cd /Users/felix/Documents/code/SAPVac && rm -rf output && ./create_bookmarklet.sh -o ./output ./*.js && ls output
```

Expected: `output` enthält `sapvac` und `text2stickies`, kein `drawshapes`.

- [ ] **Step 5: Commit**

```bash
cd /Users/felix/Documents/code/SAPVac
rm -rf output
git add -A
git commit -m "retires drawshapes in favour of the timeline builder plugin"
```

- [ ] **Step 6: Tag a release — nur nach Rückfrage beim Nutzer**

Dies entfernt ein Bookmarklet, das andere installiert haben könnten, und veröffentlicht ein Artefakt. Erst nach ausdrücklicher Zustimmung ausführen:

```bash
cd /Users/felix/Documents/code/SAPVac && git push origin main && git tag v1.2.0 && git push origin v1.2.0
```

Der Tag-Push startet `generate_bookmarks.yml`; der Job `create-release` ist auf `refs/tags/` gegated und hängt `bookmarks.html` an das Release. Nach dem Durchlauf prüfen:

```bash
cd /Users/felix/Documents/code/SAPVac && gh release view v1.2.0
```

---

# Abnahme der Gesamtstrecke

- [ ] `npm test` in `miro-timeline-builder`: 58 Tests grün
- [ ] `npm run build`: sauber
- [ ] Auf einem frischen Board: Kalender 2026 zeichnen → TODAY-Indikator erscheint auf dem heutigen Tag
- [ ] Kalender verschieben und skalieren, Board neu laden → Indikator sitzt weiterhin richtig
- [ ] Urlaub importieren → Balken pixelgenau unter den Tageszellen
- [ ] Zweimal importieren → keine Duplikate
- [ ] Kalender löschen, Board neu laden → keine Fehler in der Konsole, AppData ist leer
