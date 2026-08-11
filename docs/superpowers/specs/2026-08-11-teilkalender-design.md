# Teilkalender: nur einen Abschnitt des Jahres zeichnen

**Datum:** 2026-08-11
**Status:** abgenommen, bereit zur Planung
**Repository:** `miro-timeline-builder`
**Baut auf:** [Kalender nach Datum adressierbar](2026-07-28-kalender-nach-datum-adressierbar-design.md),
[Feiertage und Schulferien](2026-07-30-feiertage-und-schulferien-design.md),
[TODAY-Indikator: Länge, Stapelposition, Tick-Kosten](2026-08-11-today-indikator-laenge-stapel-tick-design.md)
**Issue:** [#1](https://github.com/framegrabber/miro-timeline-builder/issues/1)

## Problem

Ein Jahreskalender ist 261 Tageszellen breit. Wer H2 plant, braucht davon die
Hälfte, bekommt aber immer alles: viel Boardfläche für Monate, die niemand
ansieht, und rund 360 Shapes Zeichenzeit für eine Frage, die 180 beantworten.

Das ist keine Frage der Zeichenschleife. Ein gespeicherter Kalender ist heute
per Definition ein ganzes Jahr, und dieselbe Annahme steckt an zehn Stellen —
angefangen bei der Stelle, die das Raster vom Board zurückmisst.

## Ziele

- Ein Kalender lässt sich für einen Abschnitt des Jahres zeichnen: erstes bis
  letztes gewähltes Monatsende, Monatsgrenzen.
- Alles, was auf einem gezeichneten Kalender aufsetzt — Urlaub, Feiertage,
  Schulferien, TODAY-Indikator — arbeitet auf einem Teilkalender genauso wie auf
  einem ganzen Jahr.
- Ein Kalender über das ganze Jahr sieht danach bitgleich aus wie vorher, und
  kein bereits gezeichneter Kalender wird ungültig.
- Es gibt danach weiterhin genau eine Spaltenrechnung.

## Nicht-Ziele

- **Keine jahresübergreifenden Bereiche.** H2/2026 bis H1/2027 ist der
  eigentliche Planungsfall, aber es verlangt, jeden Blockbauer (Monate, Wochen,
  Quartale, Iterationen) vom Jahr auf eine Datumsspanne zu heben, plus eine
  Entscheidung darüber, welches Jahr Spalte 0 verankert und wie Feiertage für
  zwei Jahre geladen werden. Das gespeicherte `{ from, to }` beschreibt so einen
  Bereich schon; die Erweiterung bleibt damit additiv und ist kein Umbau.
- **Keine freien Datumsgrenzen.** Monatsgrenzen decken Halbjahre, Quartale und
  alles andere, wonach das Issue fragt. Mitten im Monat anzufangen kostet
  Validierung und eine Wochenend-Regel für beide Enden, ohne einen Fall zu
  lösen, den jemand hat.
- **Kein Umstellen eines gezeichneten Kalenders.** Ein anderer Abschnitt heißt
  neu zeichnen. Der Bereich nachträglich zu ändern würde bedeuten, Tageszellen
  hinzuzufügen oder zu löschen und alles darauf Gezeichnete mitzuziehen.
- **Keine zwei Abschnitte desselben Jahres nebeneinander.** Technisch fällt es
  fast heraus (zwei Einträge, zwei Bereiche), aber `import.js` und
  `holidayView.js` wählen den Zielkalender heute über das Jahr; zwei Kandidaten
  mit demselben Jahr brauchen eine Auswahlregel, die niemand angefordert hat.
- **Keine Änderung an der Feiertagsabfrage.** Sie läuft weiter pro Kalenderjahr;
  ein Abschnitt filtert davon nur weniger heraus.
- **Kein Frame** (#5), **kein Sprung zum Kalender** (#6).

## Getroffene Entscheidungen

| Frage | Entscheidung |
|---|---|
| Spaltenraum | Bleibt an den 1. Januar verankert; der Abschnitt ist eine Teilmenge |
| Bereichsumfang | Innerhalb eines Kalenderjahres, Monatsgrenzen |
| UI | Zwei Monats-Selects (Standard Januar–Dezember) plus Schnellknöpfe H1/H2 |
| Randblöcke | Werden zugeschnitten und behalten ihre Beschriftung |
| Gespeichert wird | `{ from, to }` als ISO-Daten — die Eingabe, nicht das Abgeleitete |
| Inhalt außerhalb | Wird verworfen, mit Notiz pro Eintrag, die den Bereich nennt |
| Migration | Keine. Fehlender Bereich heißt „ganzes Jahr" |
| Iterationsnummern | Zählen weiter vom Jahresanfang: H2 beginnt bei Sprint 14, nicht bei 1 |

## Die tragende Idee

**Der Spaltenraum bleibt, was er ist. Nur das gezeichnete Fenster ist kleiner.**

`columnOf(year, date)` zählt Arbeitstage ab dem ersten Arbeitstag des Jahres und
begrenzt nichts — negative Spalten für Daten davor, Spalten jenseits von
`totalWorkingDays` für Daten danach. Diese Funktion muss deshalb nicht angefasst
werden, und daran hängen zwei Folgerungen, die die ganze Arbeit erledigen:

**1. `gridFrom` verankert Spalte 0, nicht die erste gezeichnete Zelle.** Heute
ist `startX` der linke Rand der ersten gezeichneten Zelle, was stillschweigend
heißt: die erste gezeichnete Zelle *ist* Spalte 0. Mit einem `firstColumn` im
Aufruf wird daraus

```
startX = firstCenterX - cellWidth / 2 - firstColumn * pitch
```

also die x-Koordinate, die Spalte 0 hätte, wenn sie gezeichnet worden wäre.
Danach liefert `xOfColumn(grid, absoluteSpalte)` unverändert die richtige
Koordinate — `holidayDraw.js`, `import.js` und `today.js` brauchen **keine**
Änderung an ihrer Positionierung. Das ist der Grund, aus dem dieser Spec so
klein ist.

**2. Die Blockbauer bleiben unverändert; einer schneidet zu.** `dayBlocks`,
`monthBlocks`, `weekBlocks`, `quarterBlocks` und `iterationBlocks` rechnen
weiterhin das ganze Jahr, und ein neues gemeinsames `clipBlocks(blocks, range)`
schneidet das Ergebnis aufs Fenster. 261 Tagesblöcke zu rechnen und die Hälfte
zu verwerfen kostet nichts Messbares, und es hält die Regel des Projekts intakt:
kein Bauer lernt einen zweiten Modus, keine zweite Spaltenrechnung entsteht.

Dass die Iterationsnummern dabei weiterzählen, ist kein Zusatzaufwand, sondern
fällt heraus: gerechnet wird das ganze Jahr, geschnitten wird danach.

## Datenmodell

Ein neues Feld am AppData-Eintrag:

| Feld | Schreiber | Bedeutung |
|---|---|---|
| `range` | `tagCalendar` (`anchors.js`) | `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`, inklusive |

Gespeichert wird die **Eingabe**, nicht das Abgeleitete — dasselbe Prinzip, aus
dem `anchors.js` das Raster misst statt es zu speichern. `{ firstColumn,
columns }` wäre bequemer und wurde verworfen: es sind abgeleitete Werte, die
gegen `year` auseinanderlaufen können, sobald jemand eines von beiden anfasst.

Ein fehlendes `range` heißt „ganzes Jahr". Damit funktioniert jeder bereits
gezeichnete Kalender ohne Migrationsschritt weiter. Neu gezeichnete Kalender
schreiben das Feld immer, auch für ein ganzes Jahr, damit es einheitlich ist.

## Architektur

### Rein, ohne `window.miro` (läuft unter `node --test`)

Alles Neue liegt in `src/calendar.js`, weil es die Spaltenrechnung ist:

| Funktion | Aufgabe |
|---|---|
| `rangeFrom({ year, from, to })` | ISO-Eingabe → `{ firstColumn, columns }`, oder `null` |
| `clipBlocks(blocks, range)` | Blöcke aufs Fenster zuschneiden, leere verwerfen |
| `fullYearRange(year)` | Der Standard für einen Eintrag ohne `range` |
| `describeRange({ year, from, to })` | `2026` oder `2026 (Jul-Dec)`, für Auswahllisten und Fehlermeldungen |
| `gridFrom({ …, columns, firstColumn })` | Ein Argument mehr, Spalte 0 verankert |

`rangeFrom` klemmt `from` und `to` aufs Jahr, zieht `from` mit `nextWorkingDay`
und `to` mit `previousWorkingDay` auf Arbeitstage und liefert `null`, wenn danach
weniger als zwei Spalten übrig sind — `gridFrom` kann aus einer einzigen Spalte
keinen Rasterabstand messen, und ein Kalender aus einem Tag ist keiner.

`clipBlocks` behält jedes andere Feld eines Blocks (`label`, `weekday`, `index`,
`week`, `number`) über einen Spread, damit die Zeilen ihre Beschriftung nicht
verlieren; nur `colStart` und `colSpan` werden neu gesetzt. Für die Tageszeile
ist das dieselbe Funktion: `colSpan` ist 1, also wirkt sie als Filter.

### Mit Board-Zugriff

| Datei | Änderung |
|---|---|
| `anchors.js` | `tagCalendar` schreibt `range`; `measure` leitet Grenzen ab und gibt `gridFrom` das `firstColumn`; der aufgelöste Kalender trägt `range` |
| `app.js` | Monatsauswahl in `{ from, to }` übersetzen, Bereich ableiten, Zeilen zuschneiden, Zeichenursprung um `firstColumn` verschieben; der Fortschrittszähler zählt die geschnittenen Blöcke |
| `dayCells.js` | Sollzahl ist `range.columns`; Rückgabe nach **absoluter Spalte** indiziert |
| `spans.js` | `placeSpan` klemmt aufs Fenster, Problem `outside-range` statt `outside-year` |
| `vacation.js` | `planVacations` nimmt den Bereich statt des Jahres, Meldung nennt ihn |
| `holidays.js` | `planStickies` prüft gegen das Fenster, `planBands` über `placeSpan` |
| `indicatorGeometry.js` | `columnForToday` nimmt den Bereich |
| `import.js`, `holidayView.js` | Auswahlliste zeigt `describeRange` statt nur das Jahr |
| `app.html` | Zwei Monats-Selects, zwei Schnellknöpfe |

Unberührt bleiben `today.js`, die Geometrie in `holidayDraw.js`, `colors.js`,
`stickyColors.js`, `rateLimit.js`, `board.js`, `openHolidays.js` und
`index.js` — Folge der Verankerung von Spalte 0.

### Datenfluss beim Zeichnen

Die beiden Selects liefern Monatsindizes (0–11); `app.js` übersetzt sie in die
ISO-Grenzen, die gespeichert werden: `from` ist der erste Tag des gewählten
Anfangsmonats, `to` der letzte Tag des gewählten Endmonats (`endOf('month')`).
Auf Arbeitstage rückt erst `rangeFrom`.

```
Panel: year, rangeFromMonth, rangeToMonth
  └─ from = `${year}-${MM}-01`, to = Monatsende des Endmonats
  └─ rangeFrom({ year, from, to })  ->  { firstColumn, columns }   (oder Fehler im Panel)
       ├─ Zeichenursprung: startX = Viewport-Mitte - firstColumn * (shapeWidth + padding)
       ├─ pro Zeile: Blockbauer (ganzes Jahr)  ->  clipBlocks(..., range)  ->  Shapes
       └─ tagCalendar({ ..., range: { from, to } })
```

### Datenfluss beim Wiederfinden

```
findCalendars -> measure(entry)
  ├─ range   = entry.range ?? fullYearRange(entry.year)
  ├─ bounds  = rangeFrom({ year: entry.year, ...range })   // null -> 'implausible'
  ├─ grid    = gridFrom({ firstCenterX, lastCenterX, cellWidth,
  │                       columns: bounds.columns, firstColumn: bounds.firstColumn })
  └─ calendar.range = { ...range, ...bounds }
```

Danach adressiert jeder Aufrufer den Kalender wie bisher über absolute Spalten.

## Der Zeichenursprung

`app.js` setzt `settings.startX` heute auf die Mitte des Viewports und gibt
dasselbe Objekt als Raster an `xOfColumn`. Mit absoluten Spalten läge ein
H2-Kalender damit um ein halbes Jahr nach rechts versetzt. Der Ursprung wird
deshalb um das Fenster zurückgerechnet:

```
settings.startX = viewportCenterX - firstColumn * (shapeWidth + padding)
```

Damit landet die erste **gezeichnete** Spalte dort, wo der Nutzer hinsieht, und
`xOfColumn` bleibt für alle Zeilen dieselbe Funktion.

## Tageszellen nach absoluter Spalte

`holidayDraw.js` greift an drei Stellen mit `cells[column]` zu, wobei `column`
absolut ist. Bei einem Fenster ist der Array-Index aber `column - firstColumn`.
Statt drei Aufrufstellen zu ändern, gibt `dayCellsOf` ein nach absoluter Spalte
indiziertes Objekt zurück:

```js
const byColumn = {};
sorted.forEach((cell, index) => { byColumn[firstColumn + index] = cell; });
```

`cells[column]` bleibt damit wörtlich stehen, und das vorhandene
`if (!cell) continue` deckt eine Spalte außerhalb des Fensters schon ab.

`removeHolidays` liest zusätzlich `weekdays[column].weekday` aus
`dayBlocks(calendar.year)`. Das bleibt bewusst die **ungeschnittene**
Jahresliste: sie wird nur nach dem Wochentag einer Spalte gefragt, und absolut
indiziert ist sie dafür genau richtig.

## Inhalt außerhalb des Fensters

`placeSpan(year, start, end)` klemmt heute auf `[0, totalWorkingDays - 1]` und
meldet `outside-year`. Die Signatur wird zu
`placeSpan({ year, firstColumn, columns }, start, end)` — ein Objekt, das das
Jahr für `columnOf` und die Fenstergrenzen zusammen trägt, damit kein Aufrufer
zwei Werte getrennt weiterreichen muss. Geklemmt wird auf
`[firstColumn, firstColumn + columns - 1]`, das Problem heißt `outside-range`.
`planVacations(entries, range)` und `planBands(entries, range, { … })` bekommen
dasselbe Objekt statt der Jahreszahl. Das `clipped`-Flag behält seine Bedeutung — es sagt weiter,
dass die gezeichnete Spanne kürzer ist als die gemeldete, weshalb der
Dauer-Vergleich gegen SAP dann nicht gezogen wird.

Die Meldung nennt den Bereich, damit sie erklärt statt nur zu verneinen:

```
Erika Mustermann (2026-03-02 – 2026-03-06): is not in the drawn range 2026 (Jul-Dec).
```

Bei einem SAP-Export über neun Monate gegen einen Halbjahreskalender ist das der
Normalfall und wird eine lange Liste. Bewusst hingenommen: ein wirklich falsches
Datum sieht sonst genauso aus wie ein Datum außerhalb des Abschnitts, und diese
Unterscheidung ist mehr wert als eine kurze Panel-Ausgabe.

`planStickies` behält seine Jahresprüfung und bekommt die Fensterprüfung dazu;
`planBands` erbt beides über `placeSpan`.

## Der TODAY-Indikator auf einem Teilkalender

`columnForToday` bekommt den Bereich und liefert `null`, sobald heute außerhalb
liegt. Das ist ein bereits behandelter Zustand: `syncIndicator` sieht `wanted`
als falsch und entfernt einen vorhandenen Indikator. Ein H1-Kalender hat im
Dezember also keinen Indikator, und im Januar bekommt er ihn zurück. Genau so
soll es sein — eine Marke für „heute" auf einem Abschnitt, der heute nicht
enthält, wäre eine Falschaussage.

## Das Panel

Im Kalender-Tab, über den Zeilen-Umschaltern:

- `rangeFromMonth` und `rangeToMonth`, zwei Selects mit den zwölf Monaten,
  Standard Januar und Dezember. Wer sie nicht anfasst, bekommt genau das
  Verhalten von heute.
- Zwei Knöpfe `H1` und `H2` (`type="button"`, damit sie das Formular nicht
  abschicken), die nur die beiden Selects setzen.
- Fehlerfall `rangeToMonth < rangeFromMonth`: derselbe Mechanismus wie die
  Jahresprüfung — Fehlermarkierung an der Gruppe, Hinweistext, Zeichnen wird
  abgebrochen.

Beide Selects werden von `getSettings` automatisch eingelesen, weil es alle
`<select>` nach `id` einsammelt und mit `parseInt` liest. Neue Verkabelung
brauchen nur die zwei Knöpfe.

Quartals-Voreinstellungen (`Q1`…`Q4`) wurden verworfen: die Quartalszeile hat
mit `qOneStartMonth` eine eigene, konfigurierbare Quartalsdefinition, also würde
ein `Q3`-Knopf entweder den gezeichneten Quartalsbeschriftungen widersprechen
oder den Bereichswähler an einen Zeilenschalter koppeln. Zwei Monate sagen
dasselbe ohne diese Kopplung.

## Fehlerbehandlung

| Fall | Verhalten |
|---|---|
| `rangeToMonth` vor `rangeFromMonth` | Panel markiert den Fehler, zeichnet nicht |
| Bereich ergibt weniger als zwei Spalten | dito, mit eigenem Hinweistext |
| Gespeichertes `range` unlesbar oder ergibt `null` | Eintrag bleibt stehen, gilt als `implausible`, dieser Durchlauf wird übersprungen — wie ein aus dem Kalender gezogene Tageszelle |
| Eintrag ohne `range` | Ganzes Jahr, kein Hinweis, kein Fehler |
| Tageszellen-Zahl passt nicht zu `range.columns` | `dayCellsOf` verweigert (`incomplete`) wie bisher |
| Eintrag außerhalb des Fensters | Verworfen, Notiz pro Eintrag nennt den Bereich |
| Heute außerhalb des Fensters | Kein Indikator; ein vorhandener wird entfernt |

## Tests

Alles Neue ist rein und liegt in `src/calendar.js`, also unter `node --test`
vollständig prüfbar. Neu in `test/calendar.test.js`:

**`clipBlocks`** — Block ganz innen bleibt unverändert (auch die Zusatzfelder);
Block ganz außen fällt weg; Block über den linken Rand wird links beschnitten;
über den rechten Rand rechts; ein Block genau auf der Grenze bleibt ganz; die
Tageszeile wird korrekt gefiltert; die Summe der `colSpan` eines geschnittenen
Monatsjahres ist `range.columns`.

**`rangeFrom`** — Januar–Dezember ergibt `firstColumn` 0 und `columns`
`totalWorkingDays(year)`; H2/2026 gegen eine unabhängig durchgelaufene
Arbeitstagszählung; ein `from` auf einem Wochenende rückt vor, ein `to` auf
einem Wochenende zurück; `to` vor `from` ergibt `null`; ein Bereich mit einer
Spalte ergibt `null`; Daten außerhalb des Jahres werden geklemmt.

**`gridFrom`** — mit `firstColumn: 0` bitgleich zum heutigen Ergebnis
(Regressionsschranke); mit `firstColumn > 0` ein Rundlauf: aus den gemessenen
Mittelpunkten eines Fensters muss `xOfColumn(grid, firstColumn)` wieder den
linken Rand der ersten gezeichneten Zelle ergeben, und die letzte gezeichnete
Spalte ihren.

**`placeSpan`** in `test/spans.test.js` — eine Spanne innerhalb des Fensters;
eine am Fensterrand mit `clipped: true`; eine ganz außerhalb mit
`outside-range`; ein ganzes Jahr als Fenster verhält sich wie bisher.

**`columnForToday`** in `test/today.test.js` — heute innerhalb, heute vor dem
Fenster, heute nach dem Fenster.

**Regression:** die Erwartungswerte der vorhandenen 146 Tests bleiben
unverändert. Ihre Aufrufe nicht: `placeSpan`, `planVacations`, `planStickies`,
`planBands` und `columnForToday` nehmen künftig einen Bereich, also bekommen die
betroffenen Aufrufe ihr Jahr in `fullYearRange(…)` gewickelt — mechanisch, ohne
eine einzige geänderte Zusicherung. Eine Signatur, die eine Jahreszahl *oder*
einen Bereich akzeptiert, wäre ein zweiter Modus in fünf Funktionen und wurde
verworfen.

Ein Kalender über das ganze Jahr muss bitgleiche Blöcke und bitgleiche
Koordinaten ergeben — das ist die eigentliche Abnahme dieses Specs.

**Nicht testbar und darum manuell:** dass ein Teilkalender auf dem Board
tatsächlich dort landet, wo der Nutzer hinsieht (der verschobene Ursprung), und
dass Urlaub, Feiertage und Indikator auf ihm lagerichtig sitzen.

## Bewusst hingenommen

- Der SAP-Export gegen einen Halbjahreskalender erzeugt eine lange
  Problemliste. Das ist die Folge der Entscheidung, außerhalb liegende Einträge
  einzeln zu nennen.
- `import.js` und `holidayView.js` filtern Zielkalender weiter über das Jahr.
  Bei zwei Abschnitten desselben Jahres auf einem Board wären beide Kandidaten;
  der Nutzer wählt dann anhand von `describeRange`, und Einträge außerhalb
  werden ohnehin gemeldet.
- Ein Teilkalender, der heute nicht enthält, verliert seinen Indikator. Wer H1
  im Dezember offen hat, sieht ihn erst im Januar wieder.
- Der AppData-Wettlauf aus `anchors.js` bleibt, wie er ist. `range` fährt im
  selben Blob mit und teilt dessen Risiko.

## Verworfene Alternativen

**`{ firstColumn, columns }` speichern.** Bequem für `measure`, aber abgeleitet:
zwei Zahlen, die gegen `year` auseinanderlaufen können, ohne dass es auffällt.

**Den Blockbauern einen Bereichsmodus geben.** Jeder Bauer bekäme Grenzen und
müsste selbst schneiden — fünf Stellen mit derselben Klemmrechnung, genau das,
wogegen `spans.js` existiert.

**Jahresübergreifende Bereiche jetzt.** Der ehrlichere Planungsfall, aber ein
Umbau von `calendar.js` statt einer Erweiterung. Additiv nachrüstbar, weil
`{ from, to }` ihn schon beschreiben kann.

**Ein `partial`-Flag plus Monatsgrenzen.** Zwei Wahrheiten über denselben
Sachverhalt, und eine davon wäre irgendwann falsch.

**Freie Datumsgrenzen.** Siehe Nicht-Ziele: Kosten ohne angefragten Fall.
