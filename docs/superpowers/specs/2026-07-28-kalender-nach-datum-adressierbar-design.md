# Kalender nach Datum adressierbar machen

**Datum:** 2026-07-28
**Status:** abgenommen, bereit zur Planung
**Repositories:** `miro-timeline-builder` (Hauptteil), `SAPVac` (Aufräumen in Phase 3)

## Problem

Ein gezeichneter Kalender ist heute ein Haufen Shapes ohne Gedächtnis. Nach dem
Zeichnen weiß niemand mehr, wo im Board der 15. September liegt. Daraus folgen
drei ungelöste Dinge:

1. Der TODAY-Indikator (Kreis plus gepunktete Linie) wird von Hand gebaut und
   von Hand verschoben.
2. Der Urlaubsimport aus SAP richtet Balken relativ zueinander aus, nicht am
   Kalender. Die Ausrichtung am Kalender wurde verworfen, weil ein Bookmarklet
   die Metadaten des Plugins nicht lesen kann.
3. Die Spaltenrechnung existiert zweimal — in `calendar.js` und in
   `SAPVac/drawshapes.js`. Diese zweite Kopie hat dreimal denselben Bug
   produziert (`b26e28f`, Revert in v1.1.2, Fix in v1.1.3).

Punkt 3 ist die eigentliche Ursache. Punkt 1 und 2 sind Symptome derselben
Lücke: es gibt keine Abbildung von Datum auf Board-Koordinate, die nach dem
Zeichnen noch existiert.

## Ziele

- Ein gezeichneter Kalender bleibt nach Datum adressierbar, auch nachdem er
  verschoben oder skaliert wurde.
- Der TODAY-Indikator sitzt ohne Zutun auf dem heutigen Tag, solange jemand das
  Board offen hat.
- Der Urlaubsimport lebt im Plugin, richtet sich am Kalenderdatum aus und ist
  wiederholbar, ohne Duplikate zu stapeln.
- Es gibt genau eine Implementierung des Spaltenrasters.

## Nicht-Ziele

- **Kein Backend, kein Cronjob.** Ein Indikator, der auch bei geschlossenem
  Board korrekt ist, bräuchte die REST API mit OAuth, rotierendem Refresh-Token
  und persistiertem Zustand. Der Nutzen ist ein Marker, den niemand ansieht,
  während niemand hinsieht. Verworfen.
- **Kein Umzug des SAP-Scrapers.** `sapvac.js` liest das DOM des
  Fiori-Teamkalenders. Ein Plugin läuft in einem iframe auf miro.com und kommt
  da nicht hin. Der Scraper bleibt ein Bookmarklet, das JSON-Format bleibt
  unverändert.
- **Keine Feiertagslogik.** `calendar.js` kennt keine Feiertage; ein Feiertag hat
  eine ganz normale Spalte. Das bleibt so.
- **Kein Migrationspfad für Altbestand.** Bereits gezeichnete Kalender und
  Urlaubsbalken tragen keine Metadaten und profitieren rückwirkend von nichts.

## Getroffene Entscheidungen

| Frage | Entscheidung |
|---|---|
| Zuschnitt | Ein Spec, drei Phasen; Phase 1 für sich ausrollbar |
| Adressierung | Anker-Shapes mit Metadaten, Geometrie gemessen statt gespeichert |
| Nutzerkreis | Nur der Autor; `drawshapes.js` wird abgelöst, kein Parallelbetrieb |
| Re-Import | Ersetzen (idempotent), nicht Anhängen |
| TODAY am Wochenende | Zeigt auf den kommenden Montag |
| TODAY außerhalb des Jahres | Indikator wird entfernt |
| Mehrere Kalender pro Board | Eindeutig → automatisch, mehrdeutig → Auswahl im Panel |
| Import-UI | Zweiter Tab im bestehenden Panel (Mirotone `.tabs`) |

## Die tragende Idee

`xOfColumn` und `widthOfColumns` in `src/calendar.js` nehmen heute ein Objekt
`{startX, shapeWidth, padding}` entgegen — die Zeichen-Settings aus dem Panel.

Genau dieses Objekt lässt sich aus zwei gemessenen Ankerzellen rekonstruieren:

```
startX      = x-Kante der ersten Tageszelle
shapeWidth  = gemessene Breite dieser Zelle
pitch       = (x_letzte − x_erste) / (Spaltenzahl − 1)
padding     = pitch − shapeWidth
```

Damit braucht es keine neue Geometrie. Eine reine Funktion `gridFrom` liefert
dasselbe Settings-Objekt, das die Zeichenroutine schon benutzt. Indikator und
Import rechnen ab da mit exakt denselben zwei Funktionen wie die
Zeichenroutine — eine zweite Rasterimplementierung kann nicht entstehen, weil
es keine zweite gibt.

Nichts Berechnetes wird gespeichert. Alles wird aus den Ankern gemessen, und
deshalb überlebt es Verschieben und Skalieren des Kalenders.

## Architektur

```
src/
  calendar.js   unverändert + gridFrom()      rein, getestet, kennt kein Miro
  anchors.js    NEU  Board-I/O: taggen, wiederfinden, messen
  today.js      NEU  Sollzustand des Indikators
  vacation.js   NEU  SAP-JSON → Blöcke in Spaltenkoordinaten (rein, getestet)
  colors.js     NEU  stringToColor, aus drawshapes.js übernommen (rein, getestet)
  app.js             Panel-Ansicht "Kalender zeichnen", abgespeckt
  import.js     NEU  Panel-Ansicht "Urlaub importieren"
  index.js           headless: icon:click + TODAY-Updater
  rateLimit.js  unverändert
app.html             Panel mit zwei Tabs
index.html           unverändert (App URL, headless iframe)
```

Die Trennlinie liegt bei `anchors.js`: alles, was das Board anfasst, ist dumm
und ungetestet; alles, was rechnet, ist rein und getestet. `anchors.js` liefert
Messwerte, `gridFrom` macht daraus ein Raster.

Alle Board-Aufrufe laufen weiterhin ausschließlich über den Limiter aus
`rateLimit.js`, auch die des headless Updaters. Es soll genau eine Stelle geben,
die mit Miro spricht.

## Datenmodell

### Metadaten an Shapes

Drei Shapes pro Kalender tragen `{ role, calendarId, year }`:

| `role` | Shape |
|---|---|
| `first-day` | erste Tageszelle (Spalte 0) |
| `last-day` | letzte Tageszelle |
| `top-left` | linke Zelle der obersten gezeichneten Zeile |

`top-left` liefert die Oberkante des Kalenders für die Platzierung des Kreises.
Welche Zeile die oberste ist, hängt von den Settings ab und ist beim Zeichnen
aus `planRows(...)[0]` bekannt.

Jeder Urlaubsbalken trägt `{ role: 'vacation', calendarId, employee }`.

### AppData

`board.setAppData` hält eine Liste von Kalendern:

```
calendars: [
  {
    calendarId,          // = Item-ID der ersten Tageszelle, nichts wird generiert
    year,
    anchors: { firstDay, lastDay, topLeft },   // Item-IDs
    indicator: {
      enabled,           // Checkbox im Kalender-Tab
      circleId, anchorId, connectorId          // null, solange nicht angelegt
    },
    vacationItemIds: []  // IDs des letzten Imports, für das Ersetzen
  }
]
```

Gespeichert wird nur, was sich nicht messen lässt: IDs, das Jahr und die
Nutzerentscheidung `enabled`. Die Spaltenzahl steht bewusst *nicht* darin — sie
kommt aus `totalWorkingDays(year)` und wäre sonst ein gespeicherter Rechenwert,
der von der Rechnung wegdriften kann. Genau davon lebt dieser Entwurf nicht.

AppData ist ein Index, keine Wahrheit. Geht sie verloren, ließe sich alles aus
einem Metadaten-Scan rekonstruieren; umgekehrt ginge es nicht. Deshalb hängen
die Metadaten an den Shapes.

Grenzen laut Miro: AppData 30 KB pro App und Board, ItemMetadata 6 KB pro Item.
Beides ist für diese Datenmengen unkritisch.

### Auflösungsregel bei mehreren Kalendern

- **TODAY:** je Kalender, dessen Jahr das heutige Datum enthält, genau ein
  Indikator. Zwei Jahreskalender nebeneinander regeln sich damit von selbst;
  eine Auswahl-UI hätte der headless iframe ohnehin nicht.
- **Import:** Kandidat ist jeder Kalender, dessen Jahr unter den Datumsangaben
  der Eingabe vorkommt. Genau einer → automatisch. Mehrere → Auswahl im Panel.
  Keiner → Fehlermeldung, es wird nichts gezeichnet.

  Das ist kein Randfall: `sapvac.js` liest neun Monate am Stück und liefert
  damit regelmäßig Daten über eine Jahresgrenze hinweg. Ein Import schreibt
  immer in genau einen Kalender; Einträge außerhalb von dessen Jahr werden
  übersprungen und aufgelistet. Wer beide Jahre auf dem Board hat, importiert
  dieselben Daten zweimal und wählt beim zweiten Mal den anderen Kalender —
  weil jeder Kalender seine eigene `vacationItemIds`-Liste hat, überschreiben
  sich die beiden Importe nicht.

## Komponenten

### `calendar.js` — `gridFrom(messwerte)`

Rein, keine Board-Kenntnis. Nimmt
`{ firstX, lastX, cellWidth, columns }` und liefert
`{ startX, shapeWidth, padding }` — dasselbe Format, das `xOfColumn` und
`widthOfColumns` erwarten.

Plausibilitätsprüfung vor der Rückgabe: `cellWidth > 0`, `pitch > 0`,
`0 ≤ padding ≤ cellWidth`. Fällt eine durch, wird kein Raster geliefert. Das
fängt den Fall ab, dass jemand eine einzelne Tageszelle aus der Gruppe gezogen
hat: dann stimmt der abgeleitete Abstand nicht mehr, und lieber wird nichts
gezeichnet als etwas Falsches an einer richtig aussehenden Stelle.

### `anchors.js` — Board-I/O

- `tagCalendar(shapes, rows, year)` — setzt die drei Metadaten und legt den
  AppData-Eintrag an. Wird am Ende des Zeichnens aufgerufen, vor dem Gruppieren.
- `findCalendars()` — liest AppData, löst die Anker über `getById` auf, misst
  sie und liefert je Kalender `{ calendarId, year, grid, top, bottom, rowHeight }`.
  `grid` kommt aus `gridFrom`.
- `forget(calendarId)` — entfernt einen unbrauchbar gewordenen Eintrag.

Diese Schicht rechnet nicht. Sie liest, schreibt und misst.

### `today.js` — Sollzustand des Indikators

Rein bis auf den Aufruf von `anchors`/Board am Rand. Kern ist eine testbare
Funktion: gegeben Jahr, heutiges Datum und Raster → gewünschte x-Position oder
"kein Indikator".

Der Indikator besteht aus drei Board-Items:

- **Kreis**, `shape: 'circle'`, Inhalt "TODAY", pinke Füllung (`#d81b60`) mit
  weißer Schrift, Durchmesser das 1,6-fache der gemessenen Zeilenhöhe. Der
  Mittelpunkt liegt so, dass zwischen der Unterkante des Kreises und der
  Oberkante des Kalenders immer eine halbe Zeilenhöhe Abstand bleibt — bei der
  alten festen Größe (eine Zeilenhöhe) fiel das mit dem Mittelpunkt einer
  Zeilenhöhe über der Oberkante zusammen; bei einem größeren Kreis wird der
  Mittelpunkt aus dem Durchmesser hergeleitet, damit dieselbe halbe Zeilenhöhe
  Luft erhalten bleibt und der größere Kreis den Kalender nicht überlappt. Die
  Beschriftung ist fett und 24 pt — als einziger Wert hier bewusst fest und
  nicht aus dem Durchmesser hergeleitet: proportional mitwachsend beherrschte
  sie auf einem Kalender in voller Größe den ganzen Kreis.
- **unsichtbares Anker-Shape** (keine Füllung, keine Umrandung), beim Anlegen
  drei Zeilenhöhen unter der Tageszeile
- **Connector** zwischen beiden, `strokeStyle: 'dotted'`, schwarz (`#000000`)
  und mit `strokeWidth: 6` deutlich kräftiger als die übrige Linienstärke im
  Board

Die Startwerte für Abstand und Länge sind bewusst grob: sie müssen nur brauchbar
sein, weil beides danach durch Verschieben der Items korrigierbar ist.

Der Connector ist der Grund für den unsichtbaren Anker: Miro erlaubt keine frei
hängenden Verbinder, beide Enden brauchen ein Item. Dafür pflegt Miro die Linie
danach selbst — an ihr wird nie wieder geschrieben.

Nachdem alle drei Items angelegt und ihre IDs in AppData geschrieben sind,
werden sie zusätzlich per `board.group` zu einer Gruppe zusammengefasst, rein
als Komfort fürs Anfassen mit der Maus. Das passiert bewusst als letzter
Schritt und in einem eigenen try/catch: die Web-SDK-Referenz dokumentiert, dass
eine Group kein schreibbares `x`/`y` hat, lässt aber offen, ob sich ein Item
*innerhalb* einer Gruppe weiterhin per `x` und `sync()` verschieben lässt —
genau das tut der Updater bei jedem Tick. Schlägt das Gruppieren fehl oder
hört das Verschieben innerhalb der Gruppe irgendwann unbemerkt auf zu
funktionieren, bleibt der Indikator trotzdem voll funktionsfähig; nur eben
ungruppiert. Ein Fehler beim Gruppieren wird daher nur mit `console.warn`
vermerkt und ändert nichts an den bereits geschriebenen IDs oder am Rollback,
der ausschließlich für Fehler beim Anlegen der drei Items selbst gilt.

**Beide Shapes werden nach dem Anlegen nur noch in x geschrieben, nie in y.**
Zieht man das untere Anker-Shape nach unten, ist die Linie ab dann länger und
bleibt es; schiebt man den Kreis höher, bleibt er höher. Damit sind Länge und
Höhe einstellbar, ohne dass es dafür Einstellungen gibt. Für die Länge ist das
auch der einzige gangbare Weg, weil `width` und `height` bei Shapes read-only
sind und eine Rechteck-Linie zum Verlängern gelöscht und neu angelegt werden
müsste.

Am Wochenende liefert `columnOf` von sich aus die Montagsspalte. Die
abgesprochene Regel braucht damit keinen Sonderfall, sondern nur einen Test, der
festhält, dass sie gilt.

### `index.js` — der Updater

Läuft im headless iframe, der startet, sobald jemand das Board öffnet, und
läuft, solange das Board offen ist. Einmal beim Laden, danach alle 10 Minuten.
Zusätzlich stößt `drawCalendar` (`app.js`) denselben Durchlauf direkt nach dem
Taggen an, damit ein frisch in ein bereits offenes Board gezeichneter Kalender
nicht bis zum nächsten Tick — im schlimmsten Fall zehn Minuten, oder bis zum
Neuladen des Boards — ohne Indikator dasteht.

Pro Durchlauf und pro Kalender:

1. Anker auflösen; schlägt das fehl → Eintrag verwerfen
2. `indicator.enabled === false` → vorhandenen Indikator entfernen, fertig
3. heute nicht im Jahr des Kalenders → vorhandenen Indikator entfernen, fertig
4. Soll-x aus `columnOf(jahr, heute)` und dem gemessenen Raster
5. Indikator fehlt → anlegen, IDs in AppData
6. sonst Ist-x lesen und **nur schreiben, wenn es abweicht**

Schritt 6 ist wichtiger, als er aussieht: der headless iframe läuft pro Nutzer,
fünf offene Sessions heißen fünf Updater. Weil verglichen wird, bevor
geschrieben wird, ist der Normalfall null Schreibvorgänge, und im
Kollisionsfall schreiben alle denselben Wert. Der Zustand ist idempotent, nicht
koordiniert.

Kosten: drei Lesevorgänge alle 10 Minuten, Schreibvorgänge nur bei echtem
Datumswechsel. Gegen ein Budget, das 357 Shapes am Stück verkraftet, ist das
nicht messbar.

### `vacation.js` — Import-Logik

Rein, keine Board-Kenntnis.

- `parseVacations(text)` → Einträge plus Probleme (kein JSON, fehlende Felder,
  unlesbares Datum)
- `planVacations(einträge, jahr)` → eine Zeile je Mitarbeiter:in, alphabetisch,
  mit Blöcken in Spaltenkoordinaten, plus Probleme (Datum außerhalb des Jahres,
  Abweichung zwischen SAP-`vacationDuration` und gerechneter Spannweite)

Die Spannweite ist `columnOf(jahr, ende) − columnOf(jahr, start) + 1`. Beide
Werte kommen aus derselben getesteten Funktion, die auch die Tageszellen
positioniert hat. Der Drift-Bug aus SAPVac ist damit nicht behoben, sondern
nicht mehr formulierbar: es gibt keine zweite Tageszählung, und keine Stelle
mehr, an der `<` gegen `<=` getauscht werden kann.

Der Anker auf `vacationData[0]` entfällt ersatzlos — Balken hängen am Datum,
nicht am ersten Eintrag der Daten. Die Sortierung der Eingabe wird damit für die
Korrektheit irrelevant und bestimmt nur noch die Zeilenreihenfolge.

Probleme führen nicht zum Abbruch: betroffene Einträge fallen raus, der Rest
wird gezeichnet, die Liste erscheint sichtbar im Panel statt wie heute nur in
`console.warn`.

### `colors.js`

`hashOf`, `hslToHex` und `stringToColor` ziehen unverändert aus
`SAPVac/drawshapes.js` um, **inklusive der Kommentarblöcke** zur
Hash-Stabilität und zum bewusst nicht verwendeten Canvas. Diese Entscheidungen
sind in SAPVac je zweimal getroffen und einmal zurückgerollt worden; die
Begründung muss die Umzugskiste überleben.

### `import.js` und `app.html`

Ein Panel, zwei Tabs (Mirotone `.tabs` / `.tab` / `.tab-active`, in der
installierten Version 5 vorhanden). Miro gibt über `icon:click` ohnehin nur
einen Panel-Aufruf, und der Import braucht den Kalenderkontext.

Ablauf im Tab "Urlaub":

1. Textarea zum Einfügen des JSON. Bewusst nicht die Clipboard-API — ob die im
   Miro-iframe erlaubt ist, entscheidet Miro über die iframe-Permissions.
2. Kalender auflösen (Regel oben)
3. `parseVacations` und `planVacations`
4. Balken des letzten Imports zu diesem Kalender löschen
   (`vacationItemIds` aus AppData)
5. Zeichnen, gruppieren, IDs zurück in AppData

Beschriftung und Stil der Balken bleiben wie in `drawshapes.js`: Name fett,
darunter der Zeitraum, `open_sans`, keine Umrandung, Füllfarbe aus
`stringToColor`.

Platzierung: Zeilen beginnen direkt unter der Tageszeile, mit dem gemessenen
`padding` als Abstand, und übernehmen die **gemessene Zeilenhöhe des
Kalenders**. Damit fällt der heutige Bruch weg, dass Kalenderzeilen 100 px hoch
sind und Urlaubsbalken 70. x und Breite kommen aus `xOfColumn` und
`widthOfColumns` mit dem gemessenen Raster, sind also pixelgleich zum Kalender —
per Konstruktion, nicht per Nachmessen.

Panel-Verhalten: sauberer Import → Panel schließt wie beim Kalender. Import mit
Warnungen → Panel bleibt offen und zeigt sie. Fehler → Panel bleibt offen,
nichts wurde gezeichnet.

## Ersetzen statt Stapeln

Die IDs der gezeichneten Balken stehen im AppData-Eintrag des Kalenders. Ein
zweiter Import löscht sie und zeichnet neu, beides über den Limiter.

Bewusst *keine* Suche über alle Shapes: `getMetadata` ist ein Aufruf pro Item,
ein Scan über ein volles Board wären hunderte Lesevorgänge. Die Metadaten an den
Balken bleiben trotzdem dran, aber als Dokumentation und Notnagel, nicht als
Suchindex.

Geht der AppData-Eintrag verloren, stapelt der nächste Import wieder; dann wird
einmal von Hand aufgeräumt. Das ist der Preis dafür, keine Scan-Mechanik für
einen seltenen Fall mit geringem Schaden zu bauen.

## Fehlerbehandlung

| Fall | Verhalten |
|---|---|
| Anker fehlen oder unvollständig | AppData-Eintrag verwerfen; Panel meldet es, headless loggt nur |
| Messwerte unplausibel | Kein Raster, nicht zeichnen, melden |
| Indikator-Items gelöscht | Werden beim nächsten Durchlauf neu angelegt |
| Kein Kalender auf dem Board | Import verweigert mit klarer Meldung |
| Ungültiges JSON | Panel-Meldung, nichts wird gezeichnet |
| Einträge außerhalb des Jahres | Übersprungen und aufgelistet, Rest wird gezeichnet |
| Rate Limit | Bestehender Limiter mit Backoff, `describeDrawFailure` |
| Fehler im headless Updater | try/catch um den ganzen Durchlauf, loggen, weitermachen |

Der Updater darf niemals werfen. Ein kaputter Kalendereintrag darf nicht das
Board eines anderen Nutzers lahmlegen.

**Bewusst in Kauf genommen:** löscht man den TODAY-Kreis von Hand, kommt er beim
nächsten Durchlauf wieder. Zum Abschalten dient die Checkbox im Kalender-Tab,
deren Zustand in AppData steht — der Updater stellt her, was dort steht. Das ist
vorhersagbar, heißt aber, dass Löschen nicht "aus" bedeutet. Die Alternative
wäre, dass ein versehentliches Löschen den Indikator dauerhaft verliert; das
wäre schlechter.

**Bewusst in Kauf genommen:** `tagCalendar`, `updateCalendar` und das
Selbst-Aufräumen in `findCalendars` lesen und schreiben den AppData-Eintrag
`calendars` jeweils nicht-atomar — lesen, im Speicher verändern, zurückschreiben,
ohne Compare-and-Swap dazwischen. AppData ist aber ein einziger Wert für das
ganze Board, geteilt von jeder offenen Sitzung, und der headless Updater ruft
`tick()` sofort beim Öffnen des Boards und danach alle 10 Minuten erneut auf.
Zeichnet jemand gerade einen Kalender, während im selben Moment bei einer
anderen Sitzung ein Tick liest und zurückschreibt, gewinnt der jüngere
Schreibvorgang vollständig — der frisch angelegte Eintrag ist dann weg, ohne
Fehlermeldung. Da es keinen board-weiten Scan gibt, der AppData aus den
Metadaten neu aufbauen könnte, ist dieser Kalender damit dauerhaft nicht mehr
adressierbar, bis er neu gezeichnet wird. Das Zeitfenster ist eng und der
Nutzerkreis laut Spec eine Person; eine echte Lösung bräuchte eine
Synchronisationsprimitive, die AppData nicht anbietet. Nicht behoben, nur in
Kauf genommen.

## Tests

Neu, alle unter `node --test` und ohne Miro:

- **`gridFrom`-Rundlauf** — für mehrere Jahre und Settings: Settings →
  simulierte Messwerte → `gridFrom` → `xOfColumn` muss für **jede** Spalte exakt
  denselben Wert liefern wie mit den Original-Settings. Dieser Test trägt die
  ganze Konstruktion: er schlägt fehl, sobald Messung und Zeichnung
  auseinanderlaufen. Zusätzlich die Plausibilitätsprüfung mit verfälschten
  Messwerten.
- **`today`** — Wochenende → Montag, Jahresgrenzen, Schaltjahr, außerhalb des
  Jahres → kein Indikator.
- **`vacation`** — Spannweiten, Einträge außerhalb des Jahres, Erkennung der
  `vacationDuration`-Abweichung, Zeilenreihenfolge, und dass eine unsortierte
  Eingabe dasselbe Ergebnis liefert wie eine sortierte.
- **`colors`** — Determinismus, S/L-Bereiche, plus eine unabhängige
  Referenzimplementierung von HSL→RGB über den gesamten Wertebereich.

`calendar.test.js` und `rateLimit.test.js` bleiben unverändert.

Nicht unit-testbar bleiben `anchors.js` und das Anlegen der Board-Items. Deshalb
ist diese Schicht bewusst dumm. Sie wird einmal manuell verifiziert:
Kalender zeichnen, AppData in der Konsole lesen, Kalender verschieben und
skalieren, erneut messen — das Raster muss identisch herauskommen.

## Phasen

**Phase 1 — Fundament.** `gridFrom` mit Tests, `anchors.js`, Taggen beim
Zeichnen, AppData-Eintrag. Verändert optisch nichts und ist für sich
ausrollbar. Nimmt das Risiko aus den beiden anderen Phasen.

**Phase 2 — TODAY.** `today.js`, Updater in `index.js`, Checkbox im
Kalender-Tab.

**Phase 3 — Import.** `vacation.js`, `colors.js`, Tabs in `app.html`,
`import.js`. Danach in SAPVac: `drawshapes.js` aus dem Bookmarklet-Build
entfernen, README anpassen, Release. `sapvac.js` bleibt unverändert.

## Verworfene Alternativen

**Jede Tageszelle mit ihrem Datum taggen.** Kein Rechnen, direkte Suche,
überlebt sogar das Löschen einzelner Zellen. Verdoppelt aber die
Schreibaufrufe beim Zeichnen — aus 357 werden 618, aus rund 18.000 Credits rund
31.000 — und macht damit genau die Performance kaputt, die in `d41026b`
vermessen und optimiert wurde. Der Robustheitsgewinn betrifft einen Fall, der
praktisch nicht vorkommt.

**Nur AppData, keine Metadaten.** Zeichen-Settings ablegen, null Zusatzkosten.
Bricht aber, sobald jemand den Kalender verschiebt — und das ist das Erste, was
man mit einem frisch gezeichneten Kalender tut.

**Rechteck mit gepunktetem Rand statt Connector.** Ein Item weniger, aber die
Länge wäre wegen der read-only `width`/`height` nur durch Löschen und
Neuanlegen änderbar.

**REST API mit Cronjob für den Indikator.** Siehe Nicht-Ziele.

## Quellen

- [Board-Referenz (AppData, Metadaten, Limits)](https://developers.miro.com/docs/websdk-reference-board)
- [Connector (keine frei hängenden Enden, `strokeStyle`)](https://developers.miro.com/docs/websdk-reference-connector)
- [Shape (`width`/`height` read-only, `borderStyle`)](https://developers.miro.com/docs/websdk-reference-shape)
- [App panels and modals (headless iframe, `icon:click`)](https://developers.miro.com/docs/app-panels-and-modals)
- [Update and sync item properties](https://developers.miro.com/docs/update-and-sync-item-properties)
