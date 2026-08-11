# TODAY-Indikator: Länge, Stapelposition, Tick-Kosten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der TODAY-Indikator bemisst seine Länge am Inhalt unter dem Kalender, bleibt nach jedem eigenen Zeichenvorgang sichtbar, heilt einen abgerissenen Konnektor und kostet auf einem unveränderten Board keinen Board-Call.

**Architecture:** Die gesamte Arithmetik des Indikators liegt rein und ohne `window.miro` in einem Modul, das unter `node --test` vollständig abgedeckt ist; `today.js` bleibt der einzige Schreiber von Board-Elementen. Die Sollhöhe des Ankers wird aus einer im AppData gespeicherten Zeilenzahl abgeleitet und nur dann geschrieben, wenn sich der abgeleitete Wert gegen den zuletzt von uns geschriebenen geändert hat — dieselbe Wächter-Regel, mit der `placedY` den Kreis schützt.

**Tech Stack:** Vanilla ES modules, Vite 3, dayjs 1.11, Mirotone 5, Miro Web SDK v2, `node:test` + `node:assert/strict`.

**Spec:** [docs/superpowers/specs/2026-08-11-today-indikator-laenge-stapel-tick-design.md](../specs/2026-08-11-today-indikator-laenge-stapel-tick-design.md)

**Issues:** [#4](https://github.com/framegrabber/miro-timeline-builder/issues/4), [#7](https://github.com/framegrabber/miro-timeline-builder/issues/7), [#3](https://github.com/framegrabber/miro-timeline-builder/issues/3), [#2](https://github.com/framegrabber/miro-timeline-builder/issues/2)

## Global Constraints

- **Sprache im Panel: Englisch, durchgehend.** Alle für den Nutzer sichtbaren Strings und alle Code-Kommentare sind englisch. Diese Planungsdokumente sind deutsch.
- **Jeder Board-Call geht durch `run()`** aus `src/board.js` — auch `getAppData`/`setAppData`, auch `bringToFront`. Kein Modul außer `src/board.js` liest `window.miro`.
- **Reine Module importieren `board.js` nicht.** `src/board.js` liest `window` beim Laden des Moduls; ein Test-Import würde unter Node abstürzen. Alles, was getestet wird, bleibt frei davon.
- **Ratenlimit-Fehler sind kein „ist weg".** Wo ein `getById` fehlschlägt, wird mit `isRateLimitError(error)` unterschieden: bei Ratenlimit bleibt der gespeicherte Zustand stehen und der Durchlauf wird übersprungen; nur ein anderer Fehler bedeutet, dass das Item wirklich fort ist.
- **Der Indikator ist Dekoration.** Kein Fehler in seinem Pfad darf einen Zeichenvorgang oder einen Import scheitern lassen. `updateIndicators` wirft nie, `raiseIndicator` wirft nie.
- **Kein bestehendes Board verschiebt sich.** `contentRows = 0` muss bitgleich `bottom + 3 * rowHeight` ergeben, und die vorhandenen Tests in `test/today.test.js` bleiben unverändert grün.
- **Genau eine Konnektor-Definition.** Style und Endpunkte des gepunkteten Konnektors existieren nach diesem Plan an genau einer Stelle, benutzt von `createIndicator` und vom Reparaturpfad.
- Commit-Nachrichten englisch, ohne Präfix-Zwang, im Stil der vorhandenen Historie (`counts columns by day rather than by instant`).

## Dateien

**Umbenannt:**

| Vorher | Nachher | Verantwortung |
|---|---|---|
| `src/todayColumn.js` | `src/indicatorGeometry.js` | Die ganze reine Arithmetik des Indikators: Spalte, Kreishöhe, Ankerhöhe, Wächter, Tageswächter |

**Geändert:**

| Datei | Änderung |
|---|---|
| `src/today.js` | Anker wird mitgeschrieben, Reihenfolge Anker→Kreis, `placedAnchorY`, Konnektorprüfung, `{ raise }` |
| `src/index.js` | Tageswächter vor dem Pass, Statistik nach dem Pass |
| `src/import.js` | schreibt `vacationRows`, ruft `updateIndicators(today, { raise: true })` |
| `src/app.js` | `updateIndicators(dayjs(), { raise: true })` |
| `src/holidayView.js` | `updateIndicators(dayjs(), { raise: true })` |
| `test/today.test.js` | Importpfad, neue Tests für `anchorY`, `legacyAnchorY`, `shouldPass` |

**Neu:** `docs/superpowers/notes/2026-08-11-bringtofront-und-konnektor-unbestaetigt.md`

**Unberührt:** `src/calendar.js`, `src/anchors.js`, `src/dayCells.js`, `src/holidayDraw.js`, `src/spans.js`, `src/vacation.js`, `src/rateLimit.js`, `app.html`.

---

## Phase 1 — Reine Geometrie (Tasks 1–3)

Nichts davon berührt das Board. Nach Phase 1 verhält sich die App unverändert; die neuen Funktionen sind vorhanden, getestet und noch von niemandem benutzt.

---

### Task 1: `todayColumn.js` wird `indicatorGeometry.js`

Die Datei enthält längst nicht mehr nur die Spalte, sondern die gesamte Geometrie des Indikators — und bekommt in Task 2 und 3 zwei weitere Funktionen. Der Name muss das aushalten. Rein mechanisch, kein Verhalten ändert sich; die vorhandenen Tests sind der Nachweis.

**Files:**
- Rename: `src/todayColumn.js` → `src/indicatorGeometry.js`
- Modify: `src/today.js:4` (Importzeile)
- Modify: `test/today.test.js:7` (Importzeile)

**Interfaces:**
- Consumes: nichts
- Produces: `src/indicatorGeometry.js` exportiert unverändert `columnForToday(year, today)`, `indicatorY({ top, rowHeight, diameter, reservedRows })`, `shouldMoveIndicatorY(y, placedY, legacyY, nudge)`

- [ ] **Step 1: Datei umbenennen**

```bash
git mv src/todayColumn.js src/indicatorGeometry.js
```

- [ ] **Step 2: Die beiden Importzeilen umziehen**

In `src/today.js`:

```js
import { columnForToday, indicatorY, shouldMoveIndicatorY } from './indicatorGeometry.js';
```

In `test/today.test.js`:

```js
import { columnForToday, indicatorY, shouldMoveIndicatorY } from '../src/indicatorGeometry.js';
```

- [ ] **Step 3: Prüfen, dass kein Verweis auf den alten Namen übrig ist**

Run: `grep -rn "todayColumn" src test docs app.html`
Expected: Treffer nur noch in `docs/` (die alten Spec- und Plandokumente beschreiben den damaligen Stand und werden nicht umgeschrieben). Kein Treffer in `src/`, `test/`, `app.html`.

- [ ] **Step 4: Kopfkommentar der Datei nachziehen**

Der Kommentar begründet, warum die Funktion in einer eigenen Datei liegt, und nennt dabei den alten Namen nicht — er bleibt inhaltlich richtig. Nur der erste Satz wird auf den neuen Zuschnitt gehoben. Ersetze in `src/indicatorGeometry.js` den Satz

```
 * Kept in its own file, importing nothing but calendar.js: today.js also pulls
```

durch

```
 * This module is the indicator's arithmetic, and nothing else. It imports
 * nothing but calendar.js: today.js also pulls
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npm test`
Expected: PASS, alle vorhandenen Tests, keine neuen.

- [ ] **Step 6: Commit**

```bash
git add src/indicatorGeometry.js src/today.js test/today.test.js
git commit -m "renames todayColumn to indicatorGeometry, which is what it holds"
```

---

### Task 2: `anchorY` und `legacyAnchorY`

Die Sollhöhe des unteren Endes. Die Balken des Urlaubsimports beginnen bei `bottom + padding` und stapeln sich in Schritten von `rowHeight + padding` (`drawRows` in `src/import.js`), deshalb rechnet die Formel `padding` pro Zeile mit. `MIN_ANCHOR_ROWS = 3` ist gleichzeitig der Boden und der Legacy-Vergleichswert: vor dieser Änderung hat `createIndicator` immer `bottom + 3 * rowHeight` geschrieben, also ist das der Wert, gegen den ein Anker ohne `placedAnchorY` verglichen werden muss.

**Files:**
- Modify: `src/indicatorGeometry.js` (anhängen)
- Test: `test/today.test.js` (anhängen)

**Interfaces:**
- Consumes: nichts
- Produces:
  - `MIN_ANCHOR_ROWS` — Konstante, `3`
  - `anchorY({ bottom, rowHeight, padding, contentRows, minRows })` → `number`; `contentRows` fehlend oder `null` zählt als `0`, `minRows` fehlend als `MIN_ANCHOR_ROWS`
  - `legacyAnchorY({ bottom, rowHeight })` → `number`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An das Ende von `test/today.test.js` anhängen. Der Import in Zeile 7 wird um die drei neuen Namen erweitert:

```js
import {
    columnForToday,
    indicatorY,
    shouldMoveIndicatorY,
    anchorY,
    legacyAnchorY,
    MIN_ANCHOR_ROWS,
} from '../src/indicatorGeometry.js';
```

```js
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

    // The lowest bar's bottom edge, derived the way import.js draws it.
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
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../src/indicatorGeometry.js' does not provide an export named 'MIN_ANCHOR_ROWS'`

- [ ] **Step 3: Die minimale Implementierung schreiben**

An das Ende von `src/indicatorGeometry.js` anhängen:

```js
/**
 * The minimum length of the dotted line, in row heights below the calendar.
 *
 * This is also the whole history of the anchor's y: before the length was
 * derived from anything, createIndicator wrote exactly this and nothing ever
 * wrote it again. legacyAnchorY below is that formula, which is why an anchor
 * with no placedAnchorY on record can be compared against a fact rather than
 * against a guess - see shouldMoveIndicatorY.
 */
export const MIN_ANCHOR_ROWS = 3;

/**
 * The centre y of the invisible shape the dotted line ends on.
 *
 * `contentRows` is what the vacation import wrote into the calendar entry: how
 * many rows of bars sit below the calendar. The bars start at `bottom +
 * padding` and step by `rowHeight + padding` (drawRows in import.js), so
 * padding is counted per row rather than once - a line that stops half a bar
 * short looks like a bug, and on a full-size board those two pixels per row
 * add up.
 *
 * The extra `rowHeight` is deliberate slack: the line should visibly end past
 * the content instead of flush with it. The floor keeps a calendar without any
 * vacation data at the exact position it has had all along, so nothing on an
 * existing board moves.
 */
export function anchorY({ bottom, rowHeight, padding, contentRows, minRows = MIN_ANCHOR_ROWS }) {
    const rows = contentRows ?? 0;
    const contentBottom = bottom + padding + rows * (rowHeight + padding);
    return Math.max(bottom + minRows * rowHeight, contentBottom + rowHeight);
}

/** What createIndicator wrote before the length was derived from anything. */
export function legacyAnchorY({ bottom, rowHeight }) {
    return bottom + MIN_ANCHOR_ROWS * rowHeight;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test`
Expected: PASS, inklusive aller vorhandenen Tests.

- [ ] **Step 5: Den Boden gegenprüfen**

Ändere in `anchorY` testweise `minRows` auf `0` und lasse `npm test` laufen.
Expected: FAIL in `with no vacation rows the anchor sits exactly where it always did`, `a missing contentRows counts as none`, `one content row still cannot pull the anchor above the floor` — danach zurücksetzen und `npm test` erneut laufen lassen.

- [ ] **Step 6: Commit**

```bash
git add src/indicatorGeometry.js test/today.test.js
git commit -m "derives the anchor's height from the rows below the calendar"
```

---

### Task 3: `shouldPass` — der Tageswächter

Eine Zeile Logik, die als benannte, getestete Funktion existiert, weil sie eine Entscheidung trifft und nicht eine Rechnung: „Würde dieser Pass dasselbe Ergebnis haben wie der letzte?" `index.js` darf `board.js` importieren, aber das Urteil selbst soll ohne Board testbar sein — derselbe Grund, aus dem `shouldMoveIndicatorY` hier liegt und nicht in `today.js`.

**Files:**
- Modify: `src/indicatorGeometry.js` (anhängen)
- Test: `test/today.test.js` (anhängen)

**Interfaces:**
- Consumes: nichts
- Produces: `shouldPass(dateKey, lastDateKey)` → `boolean`

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

Den Import in `test/today.test.js` um `shouldPass` erweitern und anhängen:

```js
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
```

- [ ] **Step 2: Tests laufen lassen und Fehlschlag bestätigen**

Run: `npm test`
Expected: FAIL — `does not provide an export named 'shouldPass'`

- [ ] **Step 3: Die minimale Implementierung schreiben**

```js
/**
 * Whether the updater's periodic pass has anything to do.
 *
 * The indicator moves once a day, but the tick fires every ten minutes in the
 * headless iframe of every open board session. A pass whose date key matches
 * the last one would compute the same target as the last one did, so it can be
 * skipped before a single board call is made - which is the whole point: an
 * unchanged board should cost nothing.
 *
 * `lastDateKey` is absent on the first pass after the board opened, and that
 * pass must always run: it is what heals an indicator somebody else damaged
 * while nobody had the board open.
 */
export function shouldPass(dateKey, lastDateKey) {
    return dateKey !== lastDateKey;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/indicatorGeometry.js test/today.test.js
git commit -m "names the question the updater's tick has to answer"
```

---

## Phase 2 — Der Indikator auf dem Board (Tasks 4–6)

Ab hier gibt es keine Unit-Tests: `today.js` schreibt Board-Elemente und importiert `board.js`, das beim Laden `window.miro` liest. `npm test` bleibt trotzdem nach jeder Task die Regressionsschranke für Phase 1, `npm run build` die Syntaxschranke für Phase 2. Die manuelle Prüfliste in Task 9 ist der eigentliche Nachweis.

---

### Task 4: Der Anker wird mitgeschrieben

`moveIndicator` schreibt heute nur x, und zwar in einer Schleife `[circleId, anchorId]` mit dem Kreis zuerst. Nach dieser Task schreibt es auch die Ankerhöhe, hinter dem Wächter, und in umgekehrter Reihenfolge: Anker zuerst, Kreis danach. Bricht es zwischen den beiden ab, bleibt damit der auffällige Zustand zurück (Kreis alt, Linie neu) statt des subtilen aus #7.

Die sechs Stellwerte werden nicht als sechs Positionsargumente durchgereicht, sondern als ein `targets`-Objekt — bei `moveIndicator(entry, x, y, legacyY, anchorTarget, legacyAnchor)` kann man die Reihenfolge nicht mehr lesen.

**Files:**
- Modify: `src/today.js` — `syncIndicator`, `createIndicator`, `moveIndicator`, `removeIndicator`

**Interfaces:**
- Consumes: `anchorY`, `legacyAnchorY` (Task 2); `entry.vacationRows` (wird in Task 7 geschrieben, fehlt bis dahin und zählt als `0`)
- Produces:
  - `moveIndicator(entry, targets)` → `Promise<boolean>`; `true`, wenn etwas geschrieben wurde. `targets` = `{ x, circleY, legacyCircleY, anchorTarget, legacyAnchor }`
  - `createIndicator(calendar, x, anchorTarget)` → `Promise<{ circleId, anchorId, connectorId }>`
  - AppData: `indicator.placedAnchorY` (Zahl oder `null`)

- [ ] **Step 1: Import erweitern und die Sollwerte in `syncIndicator` berechnen**

In `src/today.js` die Importzeile ersetzen:

```js
import { columnForToday, indicatorY, shouldMoveIndicatorY, anchorY, legacyAnchorY } from './indicatorGeometry.js';
```

In `syncIndicator`, direkt nach der Berechnung von `legacyY`, einfügen:

```js
    // The lower end follows the content below the calendar, and only the
    // content: `legacyAnchor` is what createIndicator wrote before this
    // existed, so an anchor with no placedAnchorY on record is compared
    // against a fact instead of being written unconditionally - the same
    // reasoning as legacyY above, for the other end of the line.
    const anchorTarget = anchorY({
        bottom: calendar.bottom,
        rowHeight: calendar.rowHeight,
        padding: grid.padding,
        contentRows: entry.vacationRows,
    });
    const legacyAnchor = legacyAnchorY({ bottom: calendar.bottom, rowHeight: calendar.rowHeight });
```

- [ ] **Step 2: Die beiden Aufrufe am Ende von `syncIndicator` umstellen**

Ersetze

```js
    if (!entry.indicator.circleId) {
        await createIndicator(calendar, x);
        return;
    }

    await moveIndicator(entry, x, y, legacyY);
```

durch

```js
    if (!entry.indicator.circleId) {
        await createIndicator(calendar, x, anchorTarget);
        return;
    }

    await moveIndicator(entry, {
        x,
        circleY: y,
        legacyCircleY: legacyY,
        anchorTarget,
        legacyAnchor,
    });
```

- [ ] **Step 3: `createIndicator` auf den abgeleiteten Anker umstellen**

Signatur und Ankererzeugung ändern. `async function createIndicator(calendar, x)` wird zu `async function createIndicator(calendar, x, anchorTarget)`; die Ankerhöhe kommt nicht mehr aus einer Konstante im Aufruf:

```js
        const anchor = await run(() => board.createShape({
            shape: 'rectangle',
            x,
            y: anchorTarget,
            width: 8,
            height: 8,
            style: { fillOpacity: 0, borderOpacity: 0, borderWidth: 0 },
        }));
```

Der AppData-Schreibvorgang in derselben Funktion nimmt das Feld mit auf:

```js
        await updateCalendar(entry.calendarId, {
            indicator: {
                ...entry.indicator,
                circleId: circle.id,
                anchorId: anchor.id,
                connectorId: connector.id,
                placedY: centerY,
                placedAnchorY: anchorTarget,
            },
        });
```

Und ganz am Ende, nach dem `try`/`catch`-Block, gibt die Funktion die frischen Ids zurück, damit Task 6 sie zum Heben benutzen kann, ohne AppData ein zweites Mal zu lesen:

```js
    return { circleId: circle.id, anchorId: anchor.id, connectorId: connector.id };
```

Dazu müssen `circle`, `anchor` und `connector` vor dem `try` deklariert werden (`let circle, anchor, connector;`) und im `try` nur noch zugewiesen werden.

- [ ] **Step 4: `moveIndicator` ersetzen**

Die ganze Funktion durch diese Fassung ersetzen. Der bestehende Kommentarblock über der Funktion bleibt, ergänzt um den Absatz zur Reihenfolge:

```js
/**
 * x always follows today; y follows the content, guarded.
 *
 * [bestehenden Kommentar hier unverändert stehen lassen]
 *
 * The anchor is written before the circle. Neither write is atomic and there is
 * no transaction to put around them, so the question is only which half-done
 * state is the better one to be left in. Circle first leaves the circle on
 * today with the line's lower end behind - which reads as "the indicator is
 * broken" and is exactly the report in issue #7. Anchor first leaves the line
 * long and the circle on yesterday, which reads as "it has not updated yet"
 * and heals on the next pass just the same.
 *
 * Returns whether anything was written, so the caller knows when it is worth
 * spending a read on checking the connector.
 */
async function moveIndicator(entry, targets) {
    const moveCircleY = shouldMoveIndicatorY(targets.circleY, entry.indicator.placedY, targets.legacyCircleY, NUDGE);
    const moveAnchorY = shouldMoveIndicatorY(targets.anchorTarget, entry.indicator.placedAnchorY, targets.legacyAnchor, NUDGE);

    const items = [
        { id: entry.indicator.anchorId, y: targets.anchorTarget, wantsY: moveAnchorY },
        { id: entry.indicator.circleId, y: targets.circleY, wantsY: moveCircleY },
    ];

    let wrote = false;

    for (const { id, y, wantsY } of items) {
        let item;
        try {
            item = await run(() => board.getById(id));
        } catch (error) {
            // [bestehende beiden Kommentarblöcke hier unverändert stehen lassen]
            if (isRateLimitError(error)) {
                console.warn(`Timeline Builder: rate limited while moving the TODAY indicator for calendar ${entry.calendarId}, keeping it and skipping this pass.`);
                return wrote;
            }

            await removeIndicator(entry);
            return wrote;
        }

        const wantsX = Math.abs(item.x - targets.x) >= NUDGE;

        if (!wantsX && !wantsY) continue;

        if (wantsX) item.x = targets.x;
        if (wantsY) item.y = y;
        await run(() => item.sync());
        wrote = true;
    }

    // Only the field that actually moved is recorded. Writing both every time
    // would quietly promote the *other* end's target to "we wrote this" - and
    // for an indicator that predates these fields, that would destroy the
    // legacy fallback the guard above depends on, so a hand-positioned circle
    // would never be recognised as hand-positioned again.
    if (moveCircleY || moveAnchorY) {
        const indicator = { ...entry.indicator };
        if (moveCircleY) indicator.placedY = targets.circleY;
        if (moveAnchorY) indicator.placedAnchorY = targets.anchorTarget;
        await updateCalendar(entry.calendarId, { indicator });
    }

    return wrote;
}
```

- [ ] **Step 5: `removeIndicator` setzt das neue Feld mit zurück**

```js
    await updateCalendar(entry.calendarId, {
        indicator: {
            ...entry.indicator,
            circleId: null,
            anchorId: null,
            connectorId: null,
            placedY: null,
            placedAnchorY: null,
        },
    });
```

- [ ] **Step 6: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS und ein Build ohne Fehler. Die Tests decken Phase 1 ab; der Build ist hier die Schranke gegen Tippfehler in `today.js`.

- [ ] **Step 7: Commit**

```bash
git add src/today.js
git commit -m "writes the anchor's height from the content, anchor before circle"
```

---

### Task 5: Der abgerissene Konnektor heilt

Ein Pass schreibt x und y korrekt und die Linie folgt trotzdem nicht, wenn der Konnektor nicht mehr an Kreis und Anker hängt. Nichts prüft das heute — das ist die wahrscheinlichste Erklärung dafür, dass das Board aus #7 über Tage hängen blieb, wo ein bloßer Teilausfall beim nächsten Tick geheilt wäre.

Geprüft wird nur, wenn der Pass etwas geschrieben hat: ein Read an den Tagen, an denen sich etwas bewegt, keiner auf ruhigen Boards.

**Files:**
- Modify: `src/today.js` — neue Funktionen `createDottedConnector`, `verifyConnector`, `reconnect`; Aufruf in `syncIndicator`

**Interfaces:**
- Consumes: `moveIndicator` → `boolean` (Task 4)
- Produces:
  - `createDottedConnector(circleId, anchorId)` → `Promise<Connector>`
  - `verifyConnector(entry)` → `Promise<string | null>`; gibt die (ggf. neue) `connectorId` zurück, `null` wenn nichts geprüft werden konnte

- [ ] **Step 1: Die Konnektor-Erzeugung aus `createIndicator` herausziehen**

Neue Funktion, oberhalb von `createIndicator`. Der Style-Block wandert dabei aus `createIndicator` hierher und existiert danach genau einmal:

```js
/**
 * The dotted line, and the only place its shape and style are defined.
 *
 * Both createIndicator and the repair path below create this connector, and a
 * repaired line that looks different from a fresh one would be worse than no
 * repair at all.
 */
function createDottedConnector(circleId, anchorId) {
    return run(() => board.createConnector({
        shape: 'straight',
        start: { item: circleId, snapTo: 'bottom' },
        end: { item: anchorId, snapTo: 'top' },
        style: {
            strokeStyle: 'dotted',
            strokeWidth: LINE_WIDTH,
            strokeColor: LINE_COLOR,
            startStrokeCap: 'none',
            endStrokeCap: 'none',
        },
    }));
}
```

In `createIndicator` wird der `board.createConnector`-Aufruf dadurch ersetzt:

```js
        connector = await createDottedConnector(circle.id, anchor.id);
        created.push(connector);
```

- [ ] **Step 2: Die Prüfung und die Reparatur schreiben**

```js
/**
 * Confirms the dotted line still hangs on the circle and the anchor.
 *
 * Miro lets a connector be detached by hand, and nothing about that shows up in
 * the two shapes: a pass writes their x and y perfectly and the line stays
 * where it was. That is the failure in issue #7, and the only way to notice it
 * is to look at the connector itself.
 *
 * Only the connector is ever replaced. The circle and the anchor keep their ids
 * and their positions, so a hand-drag survives and createIndicator's
 * documented duplication race is never entered.
 *
 * Returns the connector id that is now on record - the old one when nothing was
 * wrong, a new one after a repair, or null when the check could not be made and
 * the caller should not conclude anything.
 */
async function verifyConnector(entry) {
    const { connectorId, circleId, anchorId } = entry.indicator;
    if (!connectorId) return null;

    let connector;
    try {
        connector = await run(() => board.getById(connectorId));
    } catch (error) {
        if (isRateLimitError(error)) {
            console.warn(`Timeline Builder: rate limited while checking the TODAY connector for calendar ${entry.calendarId}, skipping the check.`);
            return null;
        }
        // Any other error means the connector is genuinely gone - a deleted
        // line, or an undo that took only it. The circle and anchor are still
        // there, so drawing a new line is all that is missing.
        connector = null;
    }

    // The endpoint shape is the one thing here the SDK reference does not spell
    // out (see the note in docs/superpowers/notes/). If it is not what we
    // expect, say so once and change nothing: recreating a healthy connector on
    // every pass would be worse than never repairing a broken one.
    if (connector && !connector.start && !connector.end) {
        console.warn('Timeline Builder: cannot read the TODAY connector\'s endpoints, leaving it alone.');
        return connectorId;
    }

    const attached = connector
        && connector.start?.item === circleId
        && connector.end?.item === anchorId;

    if (attached) return connectorId;

    return reconnect(entry, connector);
}

/** Replaces the dotted line and records the new id. Best effort about the old one. */
async function reconnect(entry, staleConnector) {
    if (staleConnector) {
        try {
            await run(() => board.remove(staleConnector));
        } catch {
            // A line we could not remove is a visible orphan, which is ugly but
            // harmless - and stopping here would leave the indicator with no
            // line at all, which is the thing being repaired.
        }
    }

    const connector = await createDottedConnector(entry.indicator.circleId, entry.indicator.anchorId);

    await updateCalendar(entry.calendarId, {
        indicator: { ...entry.indicator, connectorId: connector.id },
    });

    console.warn(`Timeline Builder: the TODAY connector for calendar ${entry.calendarId} was detached or gone and has been redrawn.`);

    return connector.id;
}
```

- [ ] **Step 3: In `syncIndicator` aufrufen, wenn der Pass geschrieben hat**

Das Ende von `syncIndicator` wird zu:

```js
    const wrote = await moveIndicator(entry, {
        x,
        circleY: y,
        legacyCircleY: legacyY,
        anchorTarget,
        legacyAnchor,
    });

    // Only worth a read when something actually moved: a pass that wrote
    // nothing cannot have revealed a detached line that the last pass missed.
    if (wrote) await verifyConnector(entry);
```

- [ ] **Step 4: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add src/today.js
git commit -m "redraws the dotted line when it is no longer attached to both ends"
```

---

### Task 6: Nach vorn holen

Die Stapelreihenfolge auf einem Miro-Board ist die Erzeugungsreihenfolge, und der Indikator entsteht vor allem, was danach importiert wird. `board.bringToFront` ist der dokumentierte Ausweg (Rate Limit Level 1). Zwei Verhalten sind unbestätigt und werden zur Laufzeit beantwortet statt vorher gemessen: ob ein Konnektor als `BaseItem` akzeptiert wird, und ob es an einem Element innerhalb einer Gruppe wirkt — die drei Indikatorteile sind gruppiert. Beides deckt derselbe Fallback ab.

Gehoben wird nur nach eigenen Zeichenvorgängen. Im Tick zu heben wäre ein Schreibvorgang pro Kalender pro Pass in jeder offenen Sitzung, also genau die Dauerlast, um die es in #4 geht.

**Files:**
- Modify: `src/today.js` — `raiseIndicator`, `{ raise }` durch `updateIndicators` und `syncIndicator`
- Modify: `src/app.js:264`
- Modify: `src/holidayView.js:188`
- Create: `docs/superpowers/notes/2026-08-11-bringtofront-und-konnektor-unbestaetigt.md`

**Interfaces:**
- Consumes: `createIndicator` → `{ circleId, anchorId, connectorId }` (Task 4); `verifyConnector` → `string | null`, `reconnect` (Task 5)
- Produces:
  - `updateIndicators(today, { raise } = {})` — `raise` standardmäßig `false`
  - `syncIndicator(calendar, today, { raise } = {})`
  - `raiseIndicator(entry, indicator)` → `Promise<void>`, wirft nie

- [ ] **Step 1: `raiseIndicator` schreiben**

```js
/**
 * Puts the indicator back on top of whatever was drawn after it.
 *
 * Never throws. This runs at the end of an import that has already succeeded;
 * a decoration failing to raise itself must not turn that into an error the
 * user sees.
 *
 * Two things here are not in the SDK reference: whether a Connector counts as a
 * BaseItem for bringToFront (it is explicitly excluded for frames), and whether
 * bringToFront works on an item that sits inside a group - ours do. Rather than
 * measure both first, the code answers them at runtime: try the pair, and on
 * any rejection raise the circle alone and redraw the line, which lands it on
 * top by creation order. See docs/superpowers/notes/ for what to watch on a
 * real board.
 */
async function raiseIndicator(entry, indicator) {
    const { circleId, connectorId } = indicator;
    if (!circleId) return;

    try {
        const items = await Promise.all(
            [circleId, connectorId]
                .filter(Boolean)
                .map((id) => run(() => board.getById(id)))
        );
        await run(() => board.bringToFront(items));
        return;
    } catch (error) {
        console.warn(`Timeline Builder: could not raise the TODAY indicator for calendar ${entry.calendarId} in one call, falling back`, error);
    }

    try {
        const circle = await run(() => board.getById(circleId));
        await run(() => board.bringToFront(circle));
    } catch (error) {
        console.warn(`Timeline Builder: could not raise the TODAY circle for calendar ${entry.calendarId}`, error);
    }

    try {
        const stale = connectorId ? await run(() => board.getById(connectorId)) : null;
        await reconnect({ ...entry, indicator }, stale);
    } catch (error) {
        console.warn(`Timeline Builder: could not redraw the TODAY connector for calendar ${entry.calendarId}`, error);
    }
}
```

- [ ] **Step 2: `syncIndicator` und `updateIndicators` die Option durchreichen lassen**

Signaturen:

```js
export async function syncIndicator(calendar, today, { raise = false } = {}) {
```

```js
export async function updateIndicators(today, { raise = false } = {}) {
```

In `updateIndicators` den Aufruf ergänzen:

```js
            await syncIndicator(calendar, today, { raise });
```

In `syncIndicator` den Erzeugungspfad und den Bewegungspfad ergänzen. Erzeugung:

```js
    if (!entry.indicator.circleId) {
        const created = await createIndicator(calendar, x, anchorTarget);
        if (raise) await raiseIndicator(entry, created);
        return;
    }
```

Bewegung, nach der Konnektorprüfung:

```js
    const connectorId = wrote ? await verifyConnector(entry) : entry.indicator.connectorId;

    if (raise) {
        await raiseIndicator(entry, { ...entry.indicator, connectorId: connectorId ?? entry.indicator.connectorId });
    }
```

Das Heben hängt an `updateIndicators` und nicht am Aufrufer, weil nur diese Funktion die AppData-Einträge schon in der Hand hat. Ein Aufrufer müsste sie sonst ein zweites Mal lesen, nur um an die Ids zu kommen.

- [ ] **Step 3: Die beiden vorhandenen Aufrufer umstellen**

In `src/app.js` (im `try`-Block nach dem Zeichnen):

```js
            await updateIndicators(dayjs(), { raise: true });
```

In `src/holidayView.js` an der entsprechenden Stelle dasselbe:

```js
            await updateIndicators(dayjs(), { raise: true });
```

- [ ] **Step 4: Die Notiz zu den unbestätigten Verhalten anlegen**

`docs/superpowers/notes/2026-08-11-bringtofront-und-konnektor-unbestaetigt.md`:

```markdown
# Unbestätigt: `bringToFront` und die Konnektor-Endpunkte

**Datum:** 2026-08-11
**Gehört zu:** [TODAY-Indikator: Länge, Stapelposition, Tick-Kosten](../specs/2026-08-11-today-indikator-laenge-stapel-tick-design.md)

Drei Verhalten des Web SDK, die die Referenz nicht beantwortet. Der Code
beantwortet sie zur Laufzeit und fällt zurück; diese Notiz hält fest, woran man
merkt, welcher Pfad tatsächlich läuft.

| Frage | Annahme im Code | Woran man den Fallback erkennt |
|---|---|---|
| Nimmt `bringToFront` einen Connector? | ja | Konsole: „could not raise the TODAY indicator … in one call, falling back" |
| Wirkt `bringToFront` an einem gruppierten Element? | ja | dieselbe Warnung, aber auch bei einem Aufruf nur mit dem Kreis |
| Heißen die Endpunkte `connector.start.item` / `connector.end.item`? | ja | Konsole: „cannot read the TODAY connector's endpoints, leaving it alone" |

**Prüfung am Board:** Kalender zeichnen, Urlaub für ein größeres Team
importieren, danach Konsole lesen. Bleibt sie still, gelten alle drei Annahmen.

**Wenn die dritte Annahme fällt:** Die Prüfung schaltet sich selbst ab, statt
einen gesunden Konnektor bei jedem Pass neu zu zeichnen. Dann muss die echte
Form der Endpunkte hier eingetragen und `verifyConnector` darauf gehoben
werden — bis dahin heilt ein abgerissener Konnektor nicht.

**Quellen:**
[Board](https://developers.miro.com/docs/websdk-reference-board),
[Connector](https://developers.miro.com/docs/websdk-reference-connector)
```

- [ ] **Step 5: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/today.js src/app.js src/holidayView.js docs/superpowers/notes/2026-08-11-bringtofront-und-konnektor-unbestaetigt.md
git commit -m "raises the indicator after every draw this app does"
```

---

## Phase 3 — Die Aufrufer (Tasks 7–8)

---

### Task 7: Der Urlaubsimport meldet seine Zeilen

Der Import ruft `updateIndicators` heute überhaupt nicht auf — nur `app.js`, `holidayView.js` und der Tick tun das. Der Indikator kann von Urlaubsdaten also gar nichts erfahren, und genau deshalb wirkt #3 wie „feste Länge" und nicht wie „manchmal falsche Länge". Diese Task schließt die Lücke: eine Zahl in AppData und ein Aufruf.

**Files:**
- Modify: `src/import.js` — Erfolgsschreibung, Fehlerschreibung in `drawRows`, `removePreviousImport`, neuer `updateIndicators`-Aufruf

**Interfaces:**
- Consumes: `updateIndicators(today, { raise })` (Task 6); `entry.vacationRows` wird von `anchorY` über `syncIndicator` gelesen (Task 4)
- Produces: AppData `vacationRows` (Zahl)

- [ ] **Step 1: `dayjs` und `updateIndicators` importieren**

Am Kopf von `src/import.js` ergänzen, falls nicht vorhanden:

```js
import dayjs from 'dayjs';
import { updateIndicators } from './today.js';
```

- [ ] **Step 2: Die Zeilenzahl auf dem Erfolgspfad mitschreiben**

Der Schreibvorgang nach `drawRows` nimmt das Feld auf:

```js
        await updateCalendar(calendar.entry.calendarId, {
            vacationItemIds: shapes.map((shape) => shape.id),
            vacationRows: rows.length,
        });
```

- [ ] **Step 3: Auch auf dem Fehlerpfad in `drawRows`**

Dort, wo `drawRows` vor dem `throw` die Ids sichert, ebenfalls:

```js
        await updateCalendar(entry.calendarId, {
            vacationItemIds: shapes.map((shape) => shape.id),
            vacationRows: rows.length,
        });
```

`rows.length` und nicht die Zahl der tatsächlich gelandeten Zeilen: Balken aus jeder Zeile können auf dem Board liegen, und eine zu lange Linie ist nur unschön, während eine zu kurze über echten Balken eine Falschaussage wäre. `drawRows` bekommt dafür `rows` bereits als Parameter.

- [ ] **Step 4: Beim Entfernen zurücksetzen, aber nur bei Bestätigung**

In `removePreviousImport`, im vorhandenen Schreibvorgang:

```js
    // Only a removal that confirmed every bar is gone may shorten the line.
    // Bars we could not confirm might still be on the board, and a line that
    // stops above them would be a lie - the same caution holidayDraw.js applies
    // to markedColumns.
    await updateCalendar(entry.calendarId, {
        vacationItemIds: remaining,
        vacationRows: remaining.length === 0 ? 0 : (entry.vacationRows ?? 0),
    });
```

- [ ] **Step 5: Den Indikator nach dem Zeichnen nachziehen**

Nach dem Gruppieren, vor `logStats`, isoliert wie in `app.js`:

```js
        // The bars just changed how far the content reaches below the calendar,
        // and they were drawn after the indicator, so they cover its line. Both
        // are fixed by the same pass. Isolated: a decoration must not cost an
        // import that has already succeeded.
        try {
            await updateIndicators(dayjs(), { raise: true });
        } catch (error) {
            console.error('Could not update the TODAY indicator:', error);
        }
```

Ein eigener Aufruf für den Entfernen-Pfad ist nicht nötig: `removePreviousImport` läuft nur als erster Schritt eines Imports, der unmittelbar danach zeichnet, und der Aufruf hier deckt beide Zustandsänderungen ab. Ein Import mit null Zeilen kehrt vor dem Entfernen zurück.

- [ ] **Step 6: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler. `test/vacation.test.js` bleibt unverändert grün — die Planungslogik wurde nicht angefasst.

- [ ] **Step 7: Commit**

```bash
git add src/import.js
git commit -m "tells the indicator how many rows of bars sit below the calendar"
```

---

### Task 8: Der Tick kostet nur noch, wenn sich das Datum ändert

Sechs Reads alle zehn Minuten sind 144 Pässe am Tag für eine Marke, die sich einmal am Tag bewegt. Nach dieser Task ist es einer, plus einer pro Öffnen des Boards.

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `shouldPass` (Task 3), `takeStats` aus `src/board.js`
- Produces: nichts, was andere Tasks brauchen

- [ ] **Step 1: `index.js` umschreiben**

Die Importe ergänzen:

```js
import { board, takeStats } from './board.js';
import { updateIndicators } from './today.js';
import { shouldPass } from './indicatorGeometry.js';
```

Und `tick` ersetzen:

```js
// The date of the last pass we ran, kept in memory rather than in AppData:
// asking the board what we did last would cost the very call this guard exists
// to avoid, and every session having its own answer is correct - a session that
// just opened a board should run a pass regardless of what other sessions did.
let lastPassDate = null;

// Scheduling wrapper only; the actual per-calendar work lives in today.js so
// drawCalendar (src/app.js) can share it instead of running a second copy.
//
// A pass is skipped outright when the date has not changed since the last one:
// its outcome would be identical, and skipping it before the first board call
// is what makes an unchanged board free. The cost is that damage done by
// *other* sessions (someone deleting the circle) is no longer repaired within
// ten minutes but on the next board open - everything this app changes itself
// triggers a pass explicitly.
async function tick() {
  const today = dayjs();
  const dateKey = today.format('YYYY-MM-DD');

  if (!shouldPass(dateKey, lastPassDate)) return;

  // Set before the pass, not after: updateIndicators never throws, so there is
  // no failure for a retry to react to, and a pass that logged its errors and
  // moved on must not be repeated every ten minutes for the rest of the day.
  lastPassDate = dateKey;

  await updateIndicators(today);
  logPassStats(dateKey);
}

// The tick used to be invisible, which is why issue #4 could only ever be a
// hunch. takeStats() already knows what every call cost; this is the one line
// that makes it readable. Silent when the pass made no calls, so a board nobody
// touches keeps a clean console.
function logPassStats(dateKey) {
  const stats = takeStats();
  if (!stats || stats.calls === 0) return;

  console.log(
    `Timeline Builder - indicator pass ${dateKey}: ${stats.calls} calls, ` +
    `${stats.credits.toLocaleString('en-US')} credits, ${Math.round(stats.wallClockMs)} ms`
  );
}
```

- [ ] **Step 2: Build und Tests**

Run: `npm test && npm run build`
Expected: PASS, Build ohne Fehler.

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "skips the updater's pass while the date has not changed"
```

---

## Phase 4 — Nachweis (Task 9)

---

### Task 9: Am Board prüfen und die Notiz füllen

Alles in Phase 2 und 3 ist Board-I/O ohne Unit-Tests. Diese Liste ist der eigentliche Nachweis, und sie ist der Grund, warum die drei unbestätigten SDK-Verhalten überhaupt notiert wurden.

**Files:**
- Modify: `docs/superpowers/notes/2026-08-11-bringtofront-und-konnektor-unbestaetigt.md` (Ergebnisse eintragen)
- Modify: `docs/superpowers/specs/2026-08-11-today-indikator-laenge-stapel-tick-design.md` (nur falls die Realität abweicht)

**Interfaces:**
- Consumes: alles aus Tasks 4–8
- Produces: nichts

- [ ] **Step 1: Bestehendes Board, nichts darf sich bewegen**

Ein Board mit einem Kalender öffnen, der vor dieser Änderung gezeichnet wurde, und die Position des Kreises und des unteren Endes vorher/nachher vergleichen.
Expected: keine Bewegung. Konsole zeigt genau eine `indicator pass`-Zeile.

- [ ] **Step 2: Der Tageswächter greift**

Board offen lassen, mehr als zehn Minuten warten.
Expected: keine zweite `indicator pass`-Zeile.

- [ ] **Step 3: Die Länge folgt dem Inhalt**

Urlaubsdaten für ein Team mit vielen gleichzeitigen Abwesenheiten importieren (viele Zeilen).
Expected: die gepunktete Linie reicht eine Zeilenhöhe unter den tiefsten Balken. Danach einen kleineren Datensatz importieren.
Expected: die Linie wird kürzer, mindestens bis auf drei Zeilenhöhen.

- [ ] **Step 4: Ein gezogener Anker bleibt gezogen**

Anker per Hand deutlich weiter nach unten ziehen, Board neu laden.
Expected: die Länge bleibt, wie sie gezogen wurde. Danach denselben Urlaubsdatensatz erneut importieren.
Expected: die Länge springt auf den abgeleiteten Wert — das ist gewollt, siehe Spec.

- [ ] **Step 5: Die Stapelposition**

Nach dem Import prüfen, ob die gepunktete Linie über den Balken und über den Ferienbändern liegt. Konsole auf die Fallback-Warnungen aus der Notiz prüfen.
Expected: Linie sichtbar. Warnung oder keine Warnung — beides ist ein Ergebnis und wird in Schritt 8 eingetragen.

- [ ] **Step 6: Der Konnektor heilt**

Das untere Ende der Linie per Hand vom Anker abziehen, dann einen Import auslösen (oder das Board am nächsten Tag öffnen).
Expected: Konsolenzeile „the TODAY connector … was detached or gone and has been redrawn", und die Linie hängt wieder an beiden Enden.

- [ ] **Step 7: Feiertage weiterhin unberührt**

Feiertage für ein Bundesland zeichnen.
Expected: der Kreis rückt über den Block wie bisher, das untere Ende bleibt, wo es war.

- [ ] **Step 8: Ergebnisse eintragen**

Die drei Annahmen in der Notiz auf „bestätigt" oder „gefallen, Fallback läuft" setzen, mit Datum. Weicht das Verhalten vom Spec ab, den betroffenen Abschnitt des Specs nachziehen statt ihn stehen zu lassen.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/notes/2026-08-11-bringtofront-und-konnektor-unbestaetigt.md docs/superpowers/specs/2026-08-11-today-indikator-laenge-stapel-tick-design.md
git commit -m "records what the board actually does with bringToFront and the connector"
```

---

## Selbstprüfung dieses Plans

**Spec-Abdeckung.** Jeder Abschnitt des Specs hat einen Task: Architektur/reines Modul → Task 1; Die Länge und ihre Formel → Task 2; Der Tick (#4) → Task 3 und 8; Datenmodell `placedAnchorY` → Task 4; Datenmodell `vacationRows` → Task 7; Reihenfolge und Konnektorprüfung (#7) → Task 4 und 5; Stapelposition (#2) → Task 6; Datenfluss/Aufrufer → Task 6 und 7; Fehlerbehandlung → in den betroffenen Tasks, Zeile für Zeile; Tests → Task 2 und 3; „Bewusst hingenommen" → Task 6 (Notiz) und Task 9 (Prüfung am Board).

**Abweichung vom Spec, bewusst.** Der Datenfluss im Spec nennt einen eigenen `updateIndicators`-Aufruf für „Urlaub entfernen". Das Panel hat keinen eigenständigen Entfernen-Knopf — `removePreviousImport` läuft nur als erster Schritt eines Imports, der danach zeichnet. Task 7 setzt deshalb `vacationRows` beim Entfernen im schon vorhandenen Schreibvorgang zurück und ruft `updateIndicators` einmal nach dem Zeichnen. Ergebnis identisch, ein Board-Call weniger.

**Was dieser Plan bewusst nicht testet.** Board-I/O in `today.js`, `import.js`, `index.js`. Dieselbe Grenze wie in den beiden Vorgängerplänen, und der Grund für die Ausführlichkeit von Task 9. Die riskanteste ungetestete Stelle ist `verifyConnector`: liest es die Endpunkte falsch, würde es einen gesunden Konnektor bei jedem Pass neu zeichnen — deshalb die Abschaltung bei unerwarteter Form statt eines blinden Neuzeichnens.

**Was #4 offen lässt.** Dieser Plan senkt die Dauerlast und macht sie sichtbar. Er beantwortet nicht, ob der Indikator dem Board beim Pannen und Zoomen Leistung kostet; dazu braucht es ein Profil mit und ohne Indikator und einen Test mit mehreren offenen Sitzungen. Das bleibt am Issue.
