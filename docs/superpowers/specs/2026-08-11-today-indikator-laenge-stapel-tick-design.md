# TODAY-Indikator: Länge, Stapelposition, Tick-Kosten

**Datum:** 2026-08-11
**Status:** abgenommen, bereit zur Planung
**Repository:** `miro-timeline-builder`
**Baut auf:** [Kalender nach Datum adressierbar](2026-07-28-kalender-nach-datum-adressierbar-design.md),
[Feiertage und Schulferien](2026-07-30-feiertage-und-schulferien-design.md)
**Issues:** [#4](https://github.com/framegrabber/miro-timeline-builder/issues/4),
[#7](https://github.com/framegrabber/miro-timeline-builder/issues/7),
[#3](https://github.com/framegrabber/miro-timeline-builder/issues/3),
[#2](https://github.com/framegrabber/miro-timeline-builder/issues/2)

## Problem

Der Indikator ist gewachsen, seine Geometrie nicht. Nach oben passt er sich
inzwischen an — der Feiertagsblock schiebt den Kreis hoch, `placedY` schützt ein
Verschieben per Hand. Nach unten steht dieselbe Zahl wie am ersten Tag: drei
Zeilenhöhen unter dem Kalender, einmal bei der Erzeugung geschrieben und danach
nie wieder. Bei einem verteilten Team mit vielen Urlaubszeilen endet die
gepunktete Linie deshalb mitten im Inhalt (#3).

Dazu drei Beobachtungen, die alle denselben Kern haben — der Indikator wird
erzeugt und dann vergessen:

- Alles, was nach ihm entsteht, liegt über ihm. Ein Urlaubs- oder Ferienimport
  malt die Linie zu, weil die Stapelreihenfolge auf einem Miro-Board die
  Erzeugungsreihenfolge ist (#2).
- Auf einem Board hing das untere Ende der Linie an der alten Stelle fest,
  während der Kreis mitgewandert war (#7).
- Und der Verdacht, dass der Indikator dem Board Leistung kostet (#4).

Der Urlaubsimport ruft `updateIndicators` überhaupt nicht auf — nur `app.js`,
`holidayView.js` und der Tick tun das. Der Indikator kann von Urlaubsdaten
heute also gar nichts erfahren. Deshalb wirkt #3 wie „feste Länge" und nicht wie
„manchmal falsche Länge".

## Ziele

- Die Linie reicht immer bis unter den Inhalt, ohne dass jemand sie zieht.
- Sie bleibt sichtbar, auch wenn danach importiert wird.
- Ein abgerissener Konnektor heilt von selbst.
- Ein Board, auf dem sich nichts geändert hat, kostet keinen einzigen
  Board-Call.
- Kein bestehendes Board verschiebt sich durch diese Änderung.

## Nicht-Ziele

- **Die unsichtbare Ankerbox bleibt.** Das war der Wunsch in #7, aber das Web
  SDK lässt sie nicht weg: „it's not possible to create loose (both ends
  disconnected) or dangling (one end disconnected) connectors." Damit ist #7
  keine Frage der Ankerbox mehr, sondern eine der Robustheit der beiden
  Schreibvorgänge — siehe „Reihenfolge und Konnektorprüfung".
- **Keine Teilkalender** (#1). Ändert das Spaltenmodell, eigener Spec.
- **Kein Frame** (#5), kein Sprung zum Kalender (#6).
- **Keine Änderung daran, wie Urlaub oder Ferien selbst gezeichnet werden.**
  Der Import lernt genau eine neue Zeile Buchhaltung, sonst nichts.
- **Kein Profiling in diesem Spec.** #4 bekommt hier die Maßnahmen, die
  unabhängig von jeder Diagnose richtig sind (Tageswächter, sichtbare Kosten).
  Die eigentliche Messung auf einem echten Board bleibt manuelle Nacharbeit am
  Issue.
- **Kein Reparaturmechanismus für fremde Hand.** Wer den Kreis manuell hinter
  etwas legt, bekommt ihn beim nächsten eigenen Import wieder nach vorn, nicht
  vorher.

## Getroffene Entscheidungen

| Frage | Entscheidung |
|---|---|
| Länge | Abgeleitet, mit Wächter: `max(3 Zeilen, Inhaltszeilen + 1)` |
| Wer besitzt die Länge | Wir — aber nur, wenn sich der abgeleitete Wert ändert (`placedAnchorY`) |
| Schrumpfen | Ja, bis auf den 3-Zeilen-Boden, wenn Urlaubsdaten verschwinden |
| Stapelposition | `board.bringToFront`, nur nach eigenen Zeichenvorgängen |
| Fallback, falls `bringToFront` den Konnektor nicht nimmt | Kreis allein nach vorn, Konnektor neu erzeugen |
| #7 | Anker zuerst schreiben, Kreis danach; Konnektorprüfung bei jedem Pass, der schreibt |
| Tick | Kein Board-Call, solange das Datum dasselbe ist; kein Heartbeat |
| Kostenanzeige | `takeStats()` pro Pass loggen, wenn Calls angefallen sind |

## Die tragende Idee

Der Indikator hat schon eine funktionierende Regel für „oben": Wir berechnen die
Sollposition, vergleichen sie mit dem Wert, den **wir** zuletzt geschrieben
haben, und schreiben nur bei echter Abweichung. Das ist der Unterschied zwischen
„die Position stimmt nicht mehr" und „unsere Absicht hat sich geändert" — und
genau deshalb überlebt ein Verschieben per Hand jeden Tick.

Dieser Spec spiegelt diese Regel nach unten. Der Anker bekommt sein eigenes
`placedAnchorY`, und der bestehende `shouldMoveIndicatorY` wird unverändert
weiterverwendet. Der Legacy-Fall ist dabei nicht geraten, sondern exakt: vor
dieser Änderung war `createIndicator` der einzige Schreiber der Ankerhöhe, und
er hat immer `bottom + 3 * rowHeight` benutzt. Dieser Wert **ist** das, was
zuletzt geschrieben wurde. Ein Anker ohne `placedAnchorY` wird also mit genau
dieser Formel verglichen — ein alter Anker, den niemand gezogen hat, bleibt
liegen, ein gezogener bleibt gezogen, und nur ein geänderter Inhalt bewegt ihn.

Dieselbe Denkweise erklärt den Tick: Der Indikator bewegt sich einmal am Tag.
Ein Pass, dessen Ergebnis dasselbe wäre wie das des letzten, muss nicht
stattfinden. Damit fällt der Dauerbetrieb von 144 Pässen pro Tag auf einen.

## Architektur

### Rein, ohne `window.miro` (läuft unter `node --test`)

`todayColumn.js` enthält heute `columnForToday`, `indicatorY` und
`shouldMoveIndicatorY` — also die ganze Geometrie des Indikators, nicht nur
seine Spalte. Die Datei wird zu **`indicatorGeometry.js`** umbenannt (Importe in
`today.js` und `test/today.test.js`) und bekommt zwei Funktionen dazu:

| Funktion | Aufgabe |
|---|---|
| `anchorY({ bottom, rowHeight, padding, contentRows, minRows })` | Sollhöhe des Ankers |
| `shouldPass(dateKey, lastDateKey)` | Ob ein Tick-Pass überhaupt laufen muss |

`indicatorY` und `shouldMoveIndicatorY` bleiben unverändert; `columnForToday`
zieht mit um.

### Mit Board-Zugriff

| Datei | Änderung |
|---|---|
| `today.js` | `moveIndicator` schreibt den Anker mit; neue Konnektorprüfung; `updateIndicators` nimmt `{ raise }` |
| `index.js` | Tageswächter vor dem Pass, Statistik nach dem Pass |
| `import.js` | schreibt `vacationRows`, ruft `updateIndicators(today, { raise: true })` |
| `app.js`, `holidayView.js` | rufen `updateIndicators` mit `{ raise: true }` |

### Datenfluss

```
Kalender zeichnen (app.js)          ─┐
Feiertage zeichnen (holidayView.js) ─┼─> updateIndicators(today, { raise: true })
Urlaub zeichnen (import.js)         ─┘

Urlaub entfernen (import.js)        ─┬─> updateIndicators(today)
Tick (index.js), nur bei neuem Datum ┘

updateIndicators(today, { raise })
  └─ pro Kalender: syncIndicator
       ├─ Sollwerte: x aus der Spalte, y des Kreises aus reservedRows,
       │             y des Ankers aus vacationRows
       ├─ moveIndicator: Anker zuerst, Kreis danach, je nach Wächter
       ├─ wenn geschrieben wurde: Konnektor prüfen, ggf. neu erzeugen
       └─ wenn `raise`: nach vorn holen
```

Das Heben hängt an `updateIndicators` und nicht am Aufrufer, weil nur diese
Funktion die AppData-Einträge schon in der Hand hat. Ein Aufrufer müsste sie
sonst ein zweites Mal lesen, nur um an die Ids zu kommen.

## Datenmodell

Zwei neue Felder am AppData-Eintrag eines Kalenders:

| Feld | Schreiber | Bedeutung |
|---|---|---|
| `vacationRows` | Urlaubsimport | Zahl der Balkenzeilen unter dem Kalender, `0` nach dem Entfernen |
| `indicator.placedAnchorY` | `today.js` | die Ankerhöhe, die **wir** zuletzt geschrieben haben |

`vacationRows` liegt flach neben dem bestehenden flachen `vacationItemIds` und
nicht in einem neuen `vacation`-Objekt — so ist keine Migration nötig. Ein
fehlendes `vacationRows` bedeutet `0`, ein fehlendes oder `null`-es
`placedAnchorY` bedeutet „Legacy", genau wie bei `placedY`.

`removeIndicator` setzt `placedAnchorY` mit den Ids auf `null` zurück.

## Die Länge

Die Balken beginnen bei `bottom + padding` und stapeln sich in Schritten von
`rowHeight + padding` (`drawRows` in `import.js`). Die Formel rechnet mit
`padding`, statt es zu ignorieren:

```
contentBottom = bottom + padding + contentRows * (rowHeight + padding)
anchorY       = max(bottom + MIN_ROWS * rowHeight, contentBottom + rowHeight)
MIN_ROWS      = 3
contentRows   = entry.vacationRows ?? 0
```

Bei `contentRows = 0` ist das Ergebnis bitgleich die heutige Position. Ein
Kalender ohne Urlaubsdaten bewegt sich also nicht, und `MIN_ROWS * rowHeight`
ist gleichzeitig der Legacy-Vergleichswert aus „Die tragende Idee".

Die eine Zeile Zugabe (`+ rowHeight`) ist Absicht: Die Linie soll sichtbar
**hinter** dem Inhalt enden, nicht mit ihm abschließen — sonst sieht sie aus,
als wäre sie zu kurz.

### Warum eine gespeicherte Zeilenzahl und nicht Messen

Man könnte die tiefste Balkenposition vom Board lesen. Das wäre ein `getById`
pro Balken (bei 20 Personen dutzende Reads pro Pass) oder ein `board.get()` der
Klasse Level 3 mit 500 Credits, das das ganze Board zurückgibt. Der Import weiß
die Zeilenzahl ohnehin — `rows.length` steht direkt vor dem Zeichnen da. Eine
Zahl in AppData ist der billigste korrekte Weg.

### Entfernen

`removePreviousImport` setzt `vacationRows` auf `0`, aber nur, wenn es alle
Balken bestätigt entfernt hat. Konnte es das nicht, bleibt der alte Wert stehen:
Eine zu kurze Linie über Balken, die noch auf dem Board liegen, wäre eine
Falschaussage; eine zu lange Linie ist nur unschön. Das ist dieselbe Vorsicht,
mit der `holidayDraw.js` `markedColumns` und `stillPainted` behandelt.

## Reihenfolge und Konnektorprüfung

`moveIndicator` schreibt heute Kreis und Anker in einer Schleife über
`[circleId, anchorId]` — Kreis zuerst, jeder mit eigenem `sync()`. Es gibt keine
Atomarität: Bricht es zwischen den beiden ab (Rate-Limit-Rückkehr oder ein
fehlgeschlagenes `sync()`), steht der Kreis auf heute und das untere Ende der
Linie noch auf gestern. Genau das Bild aus #7.

Zwei Änderungen:

**Der Anker wird zuerst geschrieben, der Kreis danach.** Ein Teilausfall
hinterlässt dann den auffälligen Zustand (Kreis alt, Linie neu) statt des
subtilen. Beide bekommen ihr x aus demselben berechneten Wert wie bisher, also
holt der nächste Pass das Fehlende ohnehin nach.

**Ein Pass, der etwas geschrieben hat, prüft den Konnektor.** Ein `getById` auf
`connectorId`:

- Konnektor weg, oder `start.item` / `end.item` zeigen nicht mehr auf Kreis und
  Anker: Konnektor entfernen (best effort) und neu erzeugen, neue
  `connectorId` speichern.
- Rate-Limit: Prüfung überspringen, nichts anfassen — wie überall sonst in
  dieser Datei.

Dass nur der Konnektor neu entsteht, ist der Kern: Kreis und Anker behalten ihre
Ids und ihre Positionen, ein Ziehen per Hand geht nicht verloren, und der in
`createIndicator` dokumentierte Verdopplungs-Wettlauf wird nie betreten. Das
Prüfen kostet einen Read an den Tagen, an denen sich etwas bewegt — auf ruhigen
Boards keinen.

Warum die Prüfung nötig ist: Ein Pass würde einen abgerissenen Konnektor sonst
nie bemerken. Er schreibt x und y der beiden Shapes korrekt, und die Linie folgt
trotzdem nicht — das erklärt, warum das Board aus #7 über Tage hängen blieb, wo
ein bloßer Teilausfall beim nächsten Tick geheilt wäre.

## Stapelposition

Neu in `today.js`, intern, aufgerufen aus `syncIndicator`, wenn
`updateIndicators` mit `{ raise: true }` läuft:

```
raiseIndicator(entry)   // wirft nie
```

Er ruft `board.bringToFront([circle, connector])`. Zwei Verhalten des SDK sind
unbestätigt: ob ein Konnektor als `BaseItem` akzeptiert wird (die Referenz
schweigt dazu; für Frames ist es ausdrücklich ausgeschlossen), und ob es an
einem Element **innerhalb einer Gruppe** wirkt — die drei Indikatorteile sind
gruppiert. Beides deckt derselbe Fallback ab: bei einem Fehler `bringToFront`
nur für den Kreis, dann den Konnektor neu erzeugen, damit die
Erzeugungsreihenfolge ihn nach oben bringt.

Gehoben wird nur nach unseren eigenen Zeichenvorgängen — Kalender, Feiertage,
Urlaub. Das sind genau die Momente, in denen diese App Elemente erzeugt, die die
Linie zudecken können. Im Tick zu heben würde 1–2 Schreibvorgänge pro Kalender
pro Pass in jeder offenen Sitzung bedeuten, also genau die Dauerlast, die #4
verdächtigt.

`raiseIndicator` darf nie werfen: Eine Dekoration darf keinen Import kosten.
Fehler werden geloggt, der Import gilt trotzdem als erfolgreich.

## Der Tick (#4)

Gemessen an dem, was der Code tut, kann der Tick nicht die Ursache sein:
`findCalendars` (1 `getAppData` + 3 `getById` pro Kalender) plus 2 `getById` pro
Indikator, also rund sechs Reads alle zehn Minuten, ~300 Credits gegen ein
Budget von 100 000 pro Minute. Der Verdacht bleibt trotzdem plausibel, nur an
anderer Stelle: Konnektor-Routing in einer Gruppe mit ~360 Shapes und
AppData-Schreibvorgänge, die jede offene Sitzung als Event erreichen.

Zwei Maßnahmen, die unabhängig von der Diagnose richtig sind:

**Tageswächter.** `index.js` hält `lastPassDate` im Modul-Scope und kehrt sofort
zurück, wenn `today.format('YYYY-MM-DD')` unverändert ist. Der erste Pass nach
dem Öffnen eines Boards läuft immer. Kein Board-Call auf einem Board, auf dem
sich nichts geändert hat.

Bewusst hingenommene Folge: Schäden, die **andere Sitzungen** anrichten (jemand
löscht den Kreis, ein fremder Import verschiebt den Block), heilten bisher
innerhalb von zehn Minuten und heilen jetzt beim nächsten Öffnen oder beim
nächsten eigenen Import. Alles, was diese App selbst ändert, löst ohnehin einen
expliziten Pass aus. Ein langsamer Heartbeat wurde verworfen — er würde genau
die Dauerlast behalten, um die es geht.

**Sichtbare Kosten.** Nach jedem Pass `takeStats()` lesen und, wenn Calls
angefallen sind, eine Zeile loggen (Calls, Credits, Wall Clock). Damit ist der
Tick beim nächsten Verdacht messbar statt geschätzt. Ohne Calls wird nichts
geloggt, damit die Konsole auf ruhigen Boards leer bleibt.

Was dieser Spec **nicht** klärt und am Issue offen bleibt: das Profil beim
Pannen und Zoomen mit und ohne Indikator, und derselbe Test mit mehreren offenen
Sitzungen.

## Fehlerbehandlung

| Fall | Verhalten |
|---|---|
| Rate Limit während eines Move-Passes | alle Ids behalten, Pass überspringen (bestehende Regel) |
| Ein Element wirklich gelöscht | `removeIndicator`, nächster Pass erzeugt neu (bestehende Regel) |
| Konnektor weg oder abgerissen | nur den Konnektor neu erzeugen, Kreis und Anker bleiben |
| `bringToFront` scheitert | warnen, Kreis allein heben, Konnektor neu erzeugen |
| `raiseIndicator` scheitert ganz | nur warnen, der Import bleibt erfolgreich |
| `vacationRows` schreiben scheitert | Balken sind gezeichnet und erfasst; die Linie behält ihre Länge und korrigiert sich beim nächsten Import |
| `updateIndicators` scheitert nach einem Import | pro Kalender isoliert wie bisher, der Import bleibt erfolgreich |

## Tests

`node --test`, nur reine Funktionen — deshalb liegt die Geometrie in einem
eigenen Modul ohne `window`.

**`anchorY`**

- `contentRows = 0` ergibt exakt `bottom + 3 * rowHeight`.
- Inhalt unterhalb des Bodens gewinnt; das Ergebnis liegt eine Zeilenhöhe unter
  dem letzten Balken.
- `padding` wird pro Zeile mitgezählt, nicht einmal.
- Zurück auf den Boden, wenn `contentRows` wieder `0` wird.

**`shouldMoveIndicatorY`, für den Anker verwendet**

- Ohne `placedAnchorY` wird gegen `bottom + 3 * rowHeight` verglichen: ein
  unberührtes Legacy-Board bewegt sich nicht.
- Ein gezogener Anker wird nicht zurückgeholt, solange der abgeleitete Wert
  gleich bleibt.
- Ein geänderter Inhalt bewegt ihn.

**`shouldPass`**

- Gleiches Datum unterdrückt, geändertes Datum lässt durch, kein vorheriges
  Datum lässt durch.

**Regression:** Die bestehenden Fälle in `today.test.js` bleiben unverändert
grün. Sie sind der Nachweis für „kein bestehendes Board verschiebt sich".

**Nicht unit-testbar**, deshalb ausdrücklich manuell und in
`docs/superpowers/notes/` festgehalten: `bringToFront` mit einem Konnektor,
`bringToFront` an einem gruppierten Element, und ob ein neu erzeugter Konnektor
tatsächlich oben landet.

## Kosten

| Situation | Vorher | Nachher |
|---|---|---|
| Ruhiges Board, pro Tag und Kalender | 144 Pässe (~864 Reads) | 1 Pass (~6 Reads) |
| Pass, der etwas bewegt | 2 Reads, 1–2 Writes | + 1 Read (Konnektorprüfung) |
| Import | — | + 1 AppData-Write, + 1–2 Calls fürs Heben (~50–100 Credits) |

## Bewusst hingenommen

- Die beiden unbestätigten SDK-Verhalten oben. Der Fallback deckt sie ab, aber
  bis zur Prüfung auf einem echten Board ist unklar, welcher Pfad läuft.
- Ein per Hand gezogener Anker wird überschrieben, sobald sich die abgeleitete
  Länge ändert. Das ist der Sinn des Wächters, kein Fehler, und es entspricht
  dem, was `placedY` für den Kreis längst tut.
- Fremde Elemente, die die Linie zudecken, bleiben bis zum nächsten eigenen
  Import oben.
- Der AppData-Wettlauf aus `anchors.js` bleibt unangetastet. `vacationRows` und
  `placedAnchorY` fahren im selben Blob mit und teilen dessen Risiko.

## Verworfene Alternativen

**Die Ankerbox loswerden (#7 wie formuliert).** Das SDK erlaubt keine losen oder
einseitig hängenden Konnektoren. Ein Ersatz durch ein dünnes gepunktetes
Rechteck wäre möglich, hätte aber einen Rahmen auf allen vier Seiten und würde
die Geometrie um einen Sonderfall erweitern, ohne ein echtes Problem zu lösen.

**Den ganzen Indikator nach jedem Import neu erzeugen.** Löst Stapelposition und
alle Inkonsistenzen in einem Griff, wechselt aber Ids, verwirft jedes Ziehen per
Hand und betritt den Verdopplungs-Wettlauf aus `createIndicator`.

**Die Länge als Einstellung im Panel.** Vorhersehbar, aber der Nutzer müsste sie
nach jedem Import pflegen — genau der Aufwand, über den #3 sich beschwert.

**Nur wachsen, nie schrumpfen.** Weniger Schreibvorgänge, aber ein Board, auf
dem einmal 20 Personen importiert waren, behält die lange Linie für immer.

**Zehn-Minuten-Tick behalten und nur loggen.** Sicherste Variante, lässt aber die
verdächtige Dauerlast unangetastet, obwohl der Indikator sich einmal am Tag
bewegt.

## Quellen

- [Web SDK: Board](https://developers.miro.com/docs/websdk-reference-board) —
  `bringToFront`, `bringInFrontOf`, `getLayerIndex`, Rate Limit Level 1; Frames
  unterstützen es nicht.
- [Web SDK: Connector](https://developers.miro.com/docs/websdk-reference-connector)
  — „it's not possible to create loose (both ends disconnected) or dangling (one
  end disconnected) connectors."

## Nachtrag: Abweichungen nach dem Review (2026-08-11)

Das Abschlussreview des Branches hat gezeigt, dass die hier vorgeschriebene Form
einen Fehler enthält: Der Konnektor-Neuaufbau schrieb `indicator` als
`{ ...entry.indicator, connectorId }`, und der Fallback von `raiseIndicator`
bekam nur die drei Ids übergeben. Damit landete ein unvollständiges
`indicator`-Objekt in AppData — `enabled`, `placedY` und `placedAnchorY` waren
weg, der nächste Pass las `enabled: undefined`, hielt den Indikator für nicht
gewünscht und löschte Kreis, Anker und Linie. Also genau auf dem Pfad, der
Robustheit herstellen sollte. Der Code weicht deshalb bewusst ab:

- **Alle `indicator`-Schreibvorgänge in `today.js` gehen durch `recordIndicator`.**
  Es liest den gespeicherten Eintrag frisch und mischt die Änderung hinein,
  genau wie `recordHolidays` in `holidayDraw.js`. Ein Teilobjekt kann keinen
  AppData-Write mehr erreichen. Kosten: ein zusätzliches `getAppData` pro
  Indikator-Write — also nur an Tagen, an denen sich etwas bewegt.
- **`raiseIndicator(entry)` nimmt kein Indikator-Objekt mehr.** Die Ids kommen
  vom Eintrag, den `recordIndicator` nach jedem Write aktuell hält. Damit kann
  auch kein veralteter In-Memory-Stand einen frischen Write zurückdrehen.
- **`moveIndicator` gibt `{ wrote, alive }` zurück statt eines Booleans.**
  „Geschrieben" und „existiert noch" sind nicht dasselbe: Der Anker kann
  geschrieben sein und der Kreis danach als gelöscht auffallen. Konnektorprüfung
  und Heben laufen nur, solange `alive` gilt — nach einem Rate Limit ebenfalls
  nicht, weil der wahre Zustand dann unbekannt ist.
- **Der Endpunkt-Wächter greift bei *einem* fehlenden Endpunkt.** Der Spec
  beschrieb ihn als „`start.item` / `end.item` zeigen nicht mehr auf Kreis und
  Anker"; implementiert war „nur wenn beide fehlen". `connectorState` in
  `indicatorGeometry.js` unterscheidet jetzt `gone`, `unreadable`, `attached`
  und `detached`, liest `item` sowohl als Id-String als auch als Objekt mit
  `id`, und behält für `unreadable` das Verhalten „warnen, nichts ändern".
  Weil die Funktion rein ist, ist sie in `test/today.test.js` abgedeckt.
