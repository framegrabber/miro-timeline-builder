# Prüfung am Board: Teilkalender

**Datum:** 2026-08-11
**Gehört zu:** [Teilkalender: Design](../specs/2026-08-11-teilkalender-design.md), [Teilkalender: Plan](../plans/2026-08-11-teilkalender.md)

**Status (2026-08-11): offen, braucht ein echtes Board.** Die Checkliste unten
ist noch nicht durchgearbeitet. Board-I/O — das Schreiben des Bereichs, das
Zurückmessen des Rasters vom Board, das Adressieren der Tageszellen nach
Spalte, der verschobene Zeichenursprung und das Panel — hat kein Test-Harness;
kein Agent kann diese Liste ausführen. Die Bestätigung trägt der
Repository-Owner ein, sobald ein Durchlauf gemacht wurde.

## Checkliste für die Prüfung am Board

1. **Ganzes Jahr: gleiche Form, geschnittene Ränder.** Kalender für 2026 mit
   Januar–Dezember zeichnen.
   Erwartet: dieselbe Zahl an Shapes, dieselben Beschriftungen, dieselbe Zahl
   im Fortschritt wie vor der Änderung — aber nicht mehr dieselbe Breite an den
   Rändern. `clipBlocks` (`src/calendar.js:221`) läuft für jedes Fenster, auch
   das ganzjährige (`src/app.js:264`), und schneidet den Überhang ab, den ein
   Wochen- oder Iterationsblock über den 1. Januar oder den 31. Dezember hinaus
   hatte. Konkret für 2026: der erste Wochenblock schrumpft von `{ colStart:
   -3, colSpan: 5 }` auf `{ colStart: 0, colSpan: 2 }`, der letzte Wochenblock
   von `colSpan 5` auf `4`; bei zehntägigen Iterationen schrumpft der letzte
   Block von `252/10` auf `252/9`. Am Board sieht man das als flush
   abschließende erste und letzte Wochen-/Iterationszelle statt der bisher
   überhängenden. (Rein visuelle Prüfung, kein Konsolen- oder Panel-String
   dafür im Code gefunden.)

2. **Bestehender Kalender bleibt adressierbar.** Ein vor dieser Änderung
   gezeichneter Kalender: Urlaub importieren.
   Erwartet: Balken sitzen lagerichtig — der Eintrag hat kein `range`, wird
   also über `fullYearRange(entry.year)` als ganzes Jahr aufgelöst
   (`src/anchors.js:195`, ebenso `src/anchors.js:44` beim Zeichnen). (Rein
   visuelle Prüfung des Ergebnisses, kein eigener String dafür; nur der
   Fehlerfall meldet sich, wörtlich `Timeline Builder: measurement
   implausible for calendar ${entry.calendarId}, skipping.`, siehe
   `src/anchors.js:107` — der gehört zu diesem Schritt, aber nur wenn er
   schiefgeht.)

3. **H2 landet im Blickfeld.** H2 drücken, zeichnen.
   Erwartet: der Kalender beginnt dort, wo der Viewport steht, nicht ein
   halbes Jahr rechts daneben. Das ist der verschobene Zeichenursprung aus
   `src/app.js:281` (`settings.startX -= range.firstColumn * (settings.shapeWidth
   + settings.padding);`). (Rein visuelle Prüfung, kein Konsolen- oder
   Panel-String dafür im Code gefunden.)

4. **Randblöcke tragen ihre Beschriftung.** Am H2-Kalender die erste
   Wochenzelle und die erste Quartalszelle ansehen.
   Erwartet: beide sind schmaler und heißen weiter „calendar week 27"
   beziehungsweise „Q3/2026". Der Wochen-Präfix „calendar week" ist der
   Vorgabewert des Feldes `weekPrefix` (`app.html:162`); das Label selbst
   entsteht in `src/app.js:184` (`` `${weekPrefix} ${week.week}` ``). Das
   Quartalslabel entsteht in `src/calendar.js:289`
   (`` `Q${index + 1}/${year}` ``) — für die Vorgabe „Q1 beginnt im Januar"
   ist Juli das dritte Quartal, also „Q3/2026". Beide Zellen werden schmaler,
   weil `clipBlocks` (`src/calendar.js:221`) nur `colStart`/`colSpan`
   kappt, die Labels aber unverändert durchreicht.

5. **Iterationsnummern zählen weiter.** Iterationen einschalten, H2 zeichnen.
   Erwartet: die erste Iteration ist nicht 1, sondern die Nummer, die sie im
   Jahr hat. Das folgt daraus, dass `iterationBlocks` (`src/calendar.js:175`)
   immer für das ganze Jahr rechnet und erst danach auf das Fenster
   geschnitten wird — siehe den Kommentar dazu in `src/calendar.js:217-219`.
   (Rein visuelle Prüfung der Zahl selbst, kein Konsolen- oder Panel-String
   dafür im Code gefunden.)

6. **Urlaub und Feiertage sitzen richtig.** Auf dem H2-Kalender Feiertage für
   ein Bundesland zeichnen und einen SAP-Export importieren.
   Erwartet: Bänder, Stickies und Balken an den richtigen Tagen; Einträge aus
   dem ersten Halbjahr stehen in der Problemliste mit dem Text
   ```
   is not in the drawn range 2026 (Jul-Dec).
   ```
   Dieser Text ist die Endung von drei nahezu gleichen Zeilen — je einer für
   Bänder, Stickies und Urlaubsbalken:
   - Schulferien-Bänder: `` `${where}: is not in the drawn range
     ${describeRange(range)}.` `` (`src/holidays.js:243`)
   - Feiertags-Stickies: `` `${entry.name}: is not in the drawn range
     ${describeRange(range)}.` `` (`src/holidays.js:202`)
   - Urlaubsbalken: `` `${where}: is not in the drawn range
     ${describeRange(range)}.` `` (`src/vacation.js:94`)
   `describeRange` liefert für einen Bereich, der nicht das ganze Jahr
   abdeckt, `` `${year} (${von-Monat}-${bis-Monat})` `` (`src/calendar.js:369`);
   für ein H2-2026-Fenster (Juli bis Dezember) ergibt das genau
   `2026 (Jul-Dec)`.

7. **Der Indikator folgt dem Fenster.** Auf einem H2-Kalender im zweiten
   Halbjahr: Indikator vorhanden. Auf einem H1-Kalender am selben Tag: keiner,
   und ein vorher vorhandener ist entfernt.
   Erwartet: genau dieses Verhalten, gesteuert durch `columnForToday` in
   `src/today.js:82` — liefert sie `null`, weil der heutige Tag außerhalb des
   Bereichs liegt, wird ein vorhandener Indikator über `removeIndicator`
   entfernt (`src/today.js:86`), sonst gezeichnet/verschoben. (Rein visuelle
   Prüfung, kein Konsolen- oder Panel-String dafür im Code gefunden.)

8. **Fehlerfall im Panel.** „From" auf Oktober, „To" auf März stellen und
   zeichnen.
   Erwartet: Fehlermarkierung und Hinweistext, kein Shape auf dem Board.
   `validateRange()` (`src/app.js:447`) prüft
   `parseInt(to.value) >= parseInt(from.value)`, setzt bei Verstoß die Klasse
   `error` auf die Feldgruppe und zeigt deren `.status-text`. Der Hinweistext
   ist wörtlich
   ```
   The last month cannot be before the first
   ```
   (`app.html:62`). Der Klick-Handler auf dem Submit-Button ruft
   `validateRange()` vor `drawCalendar()` auf und bricht bei einem ungültigen
   Bereich ab (`src/app.js:79-82`), sodass tatsächlich kein Shape gezeichnet
   wird.

## Ergebnisse

| Schritt | Ergebnis | Datum | Wer |
|---|---|---|---|
| 1. Ganzes Jahr: gleiche Form, geschnittene Ränder | | | |
| 2. Bestehender Kalender bleibt adressierbar | | | |
| 3. H2 landet im Blickfeld | | | |
| 4. Randblöcke tragen ihre Beschriftung | | | |
| 5. Iterationsnummern zählen weiter | | | |
| 6. Urlaub und Feiertage sitzen richtig | | | |
| 7. Der Indikator folgt dem Fenster | | | |
| 8. Fehlerfall im Panel | | | |

**Quellen:**
[Board](https://developers.miro.com/docs/websdk-reference-board)
