# Feiertage und Schulferien pro Bundesland

**Datum:** 2026-07-30
**Status:** abgenommen, bereit zur Planung
**Repository:** `miro-timeline-builder`
**Baut auf:** [Kalender nach Datum adressierbar machen](2026-07-28-kalender-nach-datum-adressierbar-design.md)

## Problem

Der Kalender zeigt 261 Arbeitstage, von denen rund 13 keine sind. Wer plant,
muss die Feiertage im Kopf haben; wer mit Eltern im Team plant, zusätzlich die
Schulferien, weil dort der Urlaub hinfällt. Beides steht heute nirgends auf dem
Board.

Der Vorgänger-Spec hat die Voraussetzung geschaffen: ein gezeichneter Kalender
ist nach Datum adressierbar. Damit ist die Frage nicht mehr *ob*, sondern *wie
genau* — und die Antwort darf keine zweite Spaltenrechnung erzeugen.

## Ziele

- Feiertage und Schulferien für beliebig viele deutsche Bundesländer landen mit
  einem Klick lagerichtig auf dem Kalender.
- Die Daten sind aktuell, ohne dass jemand daran denken muss.
- Wiederholtes Ausführen ersetzt, es stapelt nicht.
- Die Spannen-Rechnung (Wochenenden abschneiden, aufs Jahr clippen) existiert
  danach genau einmal — nicht einmal für Urlaub und einmal für Ferien.

## Nicht-Ziele

- **Feiertage nehmen keine Spalte aus dem Raster.** Der Vorgänger-Spec hält das
  schon fest, und es bleibt so. Sonst hinge die Spaltenzahl am Bundesland, jeder
  bereits gezeichnete Kalender würde ungültig, und `columnOf` müsste einen
  Zustand kennen, den es heute nicht hat.
- ~~**Keine beweglichen Ferientage, keine schulfreien Einzeltage.**~~
  **Zurückgenommen.** Sie kommen im `SchoolHolidays`-Feed mit, nicht als
  eigenes Konzept, und nichts filtert sie — „Variabler Ferientag",
  „Unterrichtsfreier Tag", „Zusätzlicher Ferientag", „Tag nach Himmelfahrt",
  neun Bänder bei voller Auswahl. Aufgefallen ist es erst, als sie auf dem
  Board standen. Entschieden wurde, sie zu behalten: sie sind schulfrei und
  damit für planende Eltern echte Information, auch wenn sie pro Schule
  verschieden sind. Sie sind zugleich die engsten Bänder überhaupt und der
  Grund, warum die Schriftgröße berechnet werden muss (siehe „Beschriftung").
- **Keine anderen Länder.** OpenHolidays liefert auch Österreich und die
  Schweiz. Nicht jetzt.
- **Kein automatisches Nachziehen im 10-Minuten-Tick.** Der Tick existiert für
  den TODAY-Indikator, der sich täglich bewegt. Feiertage tun das nicht.
- **Kein Migrationspfad nötig.** Siehe „Die tragende Idee" — bestehende Kalender
  funktionieren ohne Änderung.

## Getroffene Entscheidungen

| Frage | Entscheidung |
|---|---|
| Tagesmarke | Die echte Tageszelle wird umgefärbt, kein Overlay |
| Adressierung der Zelle | Über `firstDay.groupId`, nichts gespeichert |
| Umfang Feiertage | Nur die, die in einem gewählten Land gelten; die Kürzelzeile nennt alle |
| Lokale Feiertage (Friedensfest) | Werden gezeichnet, Kürzelzeile nennt den Ort statt des Landes |
| Datenquelle | Live von der OpenHolidays API |
| UI | Dritter Tab „Holidays" neben Calendar und Vacation; Bundesländer als Checkbox-Liste |
| Bandbeschriftung | Zwei Zeilen, Name fett; Landesname einmal je Zeile, Kürzel auf jedem Band |
| Schriftgröße | Berechnet aus Bandbreite und längstem Wort, nicht fest |
| Sticky-Kollision | Seitliches Ausweichen, Connector wird schräg |
| TODAY-Kreis | Rückt über den Feiertagsblock; y wird nur bei echter Änderung geschrieben |
| Ferienzeilen | Eine Zeile pro Bundesland, alphabetisch von oben gelesen |
| Re-Import | Ersetzen, wie beim Urlaub |

## Die tragende Idee

`Shape.groupId` ist im Web SDK eine readonly-Property. `measure()` in
`anchors.js` holt die `firstDay`-Zelle ohnehin schon — dort steht die ID der
Kalender-Group drin.

```
firstDay.groupId → getById(groupId) → getItems()
                 → nach y filtern (die Tageszeile)
                 → nach x sortieren
                 → Index = Spalte
```

Zwei Calls, und **jede Tageszelle ist adressierbar, ohne dass beim Zeichnen ein
einziges zusätzliches Byte geschrieben wurde**. (`getById` ist Level 1, also 50
Credits; für `getItems()` nennt die Referenz keinen Level — vermutlich ebenfalls
1, notfalls 500 wie `board.get()`. Selbst im teuren Fall bleibt es *ein* Call.)
Das ist der Grund,
warum bestehende Kalender keine Migration brauchen: die Information war schon
immer da, wir haben sie nur nicht gelesen.

Die verworfenen Alternativen dazu stehen unten.

## Architektur

### Neue Module, rein (kein `window.miro`, laufen unter `node --test`)

| Modul | Aufgabe |
|---|---|
| `src/openHolidays.js` | Die einzige Stelle mit `fetch`. Basis-URL, Query-Parameter, Fehlerübersetzung. `fetch` ist injizierbar, damit Tests ohne Netz laufen. |
| `src/holidays.js` | Rohantwort → Spaltenraum: `parsePublicHolidays`, `parseSchoolHolidays`, `planSchoolBands`, `planStickies`, `offsetOverlapping`, `layoutBlock`, `fitFontSize` |
| `src/spans.js` | Die aus `vacation.js` herausgelöste Spannen-Platzierung |

### Neue Module mit Board-Zugriff

| Modul | Aufgabe |
|---|---|
| `src/dayCells.js` | Group auflösen, Tageszeile herausfiltern, nach Spalte indizieren |
| `src/holidayDraw.js` | Bänder, Stickies, Connectors, Zellen umfärben, Zurücknehmen |
| `src/holidayView.js` | Der dritte Tab: DOM, Status, Hinweisliste |

### Bestehendes, das angefasst wird

- **`src/colors.js`** bekommt die Tagesfarben (`colorMaps.day` und `getColor`)
  aus `app.js`. Sie müssen geteilt werden, weil das Zurücknehmen die
  Originalfarbe der Zelle neu berechnet statt sie zu speichern.
- **`src/vacation.js`** gibt die Spannen-Platzierung an `spans.js` ab.
  `planVacations` und die Ferienbänder machen bis auf die SAP-Dauerprüfung
  exakt dasselbe: Wochenenden abschneiden, `columnOf` für beide Enden, aufs Jahr
  clippen, „enthält keinen Arbeitstag" melden. Das ist genau die Rechnung, die
  in `SAPVac/drawshapes.js` dreimal danebenlag. Sie darf kein zweites Mal
  existieren. Die 16 vorhandenen `vacation`-Tests sind das Netz und müssen die
  Extraktion **unverändert** überleben.
- **`src/today.js`** bekommt `placedY` und liest `holidays.reservedRows`.
- **`src/app.js`** verliert die Tagesfarben an `colors.js`, `app.html` bekommt
  den dritten Tab.

### Datenfluss

```
Bundesländer + Kalenderjahr
   → openHolidays.fetchHolidays()        2 × fetch, kein Board
   → parse* + plan*                      rein, keine Calls
   → dayCells.dayCellsOf(calendar)       2 Calls
   → holidayDraw.removeHolidays(...)     Farben zurück, alte Items weg
   → holidayDraw.drawHolidays(...)       Bänder, Stickies, Connectors, Marken;
                                          schreibt itemIds/markedColumns/
                                          reservedRows selbst nach AppData
   → holidayDraw.recordHolidays(id, {subdivisions})  1 Call, nur die Auswahl
   → updateIndicators(dayjs())           Kreis rückt über den neuen Block
```

`drawHolidays` schreibt seine eigene Buchführung, nicht der Aufrufer — siehe
„AppData" unten für die Begründung.

## Die Datenquelle

[OpenHolidays API](https://www.openholidaysapi.org/), kein Schlüssel,
`access-control-allow-origin: *`, also direkt aus dem Panel-iframe abrufbar.

```
GET /PublicHolidays?countryIsoCode=DE&languageIsoCode=DE&validFrom=…&validTo=…
GET /SchoolHolidays?countryIsoCode=DE&languageIsoCode=DE&validFrom=…&validTo=…
GET /Subdivisions?countryIsoCode=DE&languageIsoCode=DE
```

**Ohne `subdivisionCode`, mit Absicht.** Jeder der beiden ersten Aufrufe fragt
ganz Deutschland ab; welche Bundesländer gezeichnet werden, entscheidet
`src/holidays.js` danach lokal, ohne ein weiteres Byte über das Netz. Das hält
die Zahl der Netzwerkaufrufe bei genau zwei, egal wie viele Bundesländer
ausgewählt sind, und ein Wechsel der Auswahl braucht keinen neuen Abruf — die
Antwort steckt schon im Panel.

Der dritte Aufruf, `/Subdivisions`, ist kein Beiwerk, sondern wird tatsächlich
gebraucht: er läuft einmal, beim ersten Öffnen des Holidays-Tabs, und liefert
zwei Dinge, die sonst fehlen würden. Erstens die deutschen Namen für die
Bundesländer-Auswahlliste — die beiden ersten Aufrufe kennen nur Codes wie
`DE-BY`. Zweitens „Augsburg" für die Kürzelzeile des Friedensfests: ohne
diesen Aufruf gäbe es dort nur den Rohcode `BY-AU`, und die Entscheidung
„Kürzel nennt den Ort" (siehe unten) ließe sich gar nicht umsetzen.

Antwortform: `{startDate, endDate, name: [{language, text}], nationwide,
regionalScope, subdivisions: [{code, shortName}]}`.

Feiertage sind berechnet und reichen beliebig weit; Schulferien sind gepflegt
und reichen (Stand Juli 2026) bis 2030. Für einen Jahresplaner genug Vorlauf.

### Der NRW-Sonderfall

Die API liefert Nordrhein-Westfalen als `shortName: "NW"` — das ist das
ISO-3166-2-Kürzel. Jeder deutsche Leser schreibt „NRW". `src/holidays.js`
korrigiert das mit einer einzigen Override-Zeile,
`SHORT_NAME_OVERRIDES = { 'DE-NW': 'NRW' }`, statt einer ganzen
Übersetzungstabelle, weil es der einzige Fall ist, in dem Kürzel und API
auseinanderlaufen.

### `nationwide` ist das verlässliche Feld, nicht `regionalScope`

Neujahr kommt mit `regionalScope: "Regional"` und `nationwide: true`. Nur der
Tag der Deutschen Einheit trägt `regionalScope: "National"`. Wer nach
`regionalScope` unterscheidet, malt Neujahr als landesspezifischen Feiertag.

`regionalScope` wird trotzdem gebraucht, aber nur für einen Zweck: der Wert
`"Local"` markiert Stadtfeiertage. Das Augsburger Friedensfest kommt bei einer
Bayern-Abfrage mit, gilt aber nur in `DE-BY-AU`. Es wird gezeichnet, und die
Kürzelzeile nennt den Ort („Augsburg") statt des Landes.

### Auswahl gegen Anzeige

Ob ein Feiertag gezeichnet wird, entscheidet die Auswahl: bundesweite immer,
landesspezifische nur, wenn mindestens ein ausgewähltes Bundesland betroffen
ist. Was in der Kürzelzeile steht, entscheidet sie nicht: dort stehen **alle**
Länder, in denen der Tag gilt. Sonst stünde bei der Auswahl „nur Bayern" unter
Allerheiligen immer nur „BY", und die Zeile wäre wertlos.

### Ein Tag mit zwei Feiertagen

Nicht in der ursprünglichen Planung bedacht, aber real: der 1. Mai 2008 war
gleichzeitig Tag der Arbeit und Christi Himmelfahrt. Die Tageszelle wird trotzdem
nur einmal eingefärbt — bundesweit gewinnt gegen regional, falls sich beide
einen Tag teilen —, aber **beide** Stickies werden gezeichnet. Das seitliche
Ausweichen (siehe unten) trennt sie ohnehin schon optisch, weil zwei Stickies
über derselben Spalte immer kollidieren würden.

## Darstellung

Von unten nach oben:

1. **Tagesmarke** — die Tageszelle des Feiertags wird umgefärbt, die Zahl bleibt
   stehen. Bundesweit kräftig, landesspezifisch und lokal blass.
2. **Kalender** — unverändert.
3. **Ferienbänder** — direkt über dem Kalender, eine Zeile pro Bundesland,
   alphabetisch von oben gelesen, je eigene Farbe. Zweizeilig beschriftet:
   `Sommerferien` **fett**, darunter `BY 27.07. - 07.09.` normal. Mit den
   echten Daten der API, nicht den aufs Jahr geclippten.
   Am Anfang jeder Zeile, links neben dem Kalender, steht der volle
   Landesname einmal — siehe „Beschriftung" unten.
4. **Stickies** — eine Reihe darüber. Farbe passt zur Tagesmarke. Name **fett**,
   darunter normal die Kürzel.
5. **Connector** — dünn, schwarz, mit Pfeilspitze, vom Sticky auf die
   Tageszelle.

### Beschriftung

Nachgetragen, nachdem die erste Fassung auf einem Board mit allen 16 Ländern
unlesbar war. Die Schriftgröße stand fest auf `rowHeight / 2.5` — 40 px,
unabhängig davon, wie breit das Band ist und wie viel darauf steht. Von 120
Bändern sind 27 ein oder zwei Spalten breit, und das längste Label hatte 65
Zeichen. Sichtbar waren neun davon; der Rest war abgeschnitten, ohne dass etwas
darauf hinwies.

Drei Dinge tragen die Lösung:

**Das Label sagt nicht mehr, was das Bild schon sagt.** Die Ausdehnung des
Bandes *ist* der Zeitraum, also braucht das Datum keine Jahreszahl und ein
eintägiger Block nennt sein Datum einmal statt zweimal. Und die Zeile *ist* ein
Bundesland, also steht der volle Name einmal am Zeilenanfang und auf dem Band
nur das Kürzel. Aus `Zusätzlicher Ferientag Mecklenburg-Vorpommern 15.05.26 -
15.05.26` (65 Zeichen) wird `Zusätzlicher Ferientag` / `MV 15.05.` (31). Das
Jahr kommt zurück, sobald ein Block über Silvester läuft, weil `22.12. - 10.01.`
sonst nicht sagt, welches Ende welches ist.

**Das Kürzel bleibt trotzdem auf jedem Band.** Auf einem jahresbreiten Kalender
ist die Zeilenbeschriftung fast immer aus dem Bild gescrollt.

**Die Schriftgröße wird berechnet.** `fitFontSize` in `src/holidays.js` sucht
die größte Größe, bei der der Text noch hineinpasst, und bricht dabei **an
Wortgrenzen** um — nicht an Zeichen. Das ist der Kern: ein Wort, das breiter
ist als die Zeile, bricht nicht um, sondern hängt aus der Shape heraus.
„Unterrichtsfreier" hat 17 Zeichen, und auf einem einspaltigen Band entscheidet
dieses eine Wort die Größe, nicht die Gesamtlänge. Die erste Fassung zählte
Zeichen, bestand ihren eigenen Test und ließ trotzdem vier von sechs schmalen
Bändern überlaufen.

Die Metriken dahinter stehen als `TEXT_METRICS` an einer Stelle, mit den
gemessenen Werten im Kommentar: Open Sans läuft mit 0,458 em pro Zeichen bei
Normaltext, 0,495 bei Ziffern und 0,502 fett. Angesetzt sind 0,55 — ein Zehntel
Reserve, weil Miros eigener Textabstand von außen nicht ermittelbar ist und
Überlauf auf einem Board **still** ist: der Text wird an der Kante abgeschnitten
und nichts zeigt an, dass etwas fehlt. Der Fehler muss deshalb auf die Seite
fallen, auf der die Schrift zu klein ist.

### Was Miro dabei vorgibt

- Sticky-Notes kennen nur eine **feste Farbpalette**, kein Hex. `dark_green` und
  `light_green` sind die beiden Stufen — **nicht** `green`: Miros `green` ist ein
  Olivton und trifft das Mockup nicht (siehe „Die zwei Grüntöne" unten).
- Sticky-Notes haben **keine Schriftgrößen-Einstellung**. Fett gegen normal
  können wir steuern, groß gegen klein nicht.
- Sticky-Inhalt erlaubt `<p>`, `<b>`, `<strong>`, `<br>` — genug für Name plus
  Kürzelzeile.
- Shapes nehmen beliebiges Hex, also kann die Tageszelle den Sticky-Ton treffen.
  Welches Hex das genau ist, steht als belegte Annahme in `src/stickyColors.js`
  (siehe „Die zwei Grüntöne" unten) — nicht am Board abgelesen, wie ursprünglich
  geplant.

### Feiertagsnamen werden escaped

`src/holidayDraw.js` escaped `sticky.name`, `sticky.subtitle` und `block.label`,
bevor sie in `<p>`/`<b>`-Markup eingebettet werden. Das weicht bewusst von
`src/import.js` ab, das seinen Text unescaped einsetzt — dessen eigener
Kommentar begründet das aber ausdrücklich damit, dass die Daten der eigene
SAP-Export des Nutzers sind, und sagt in aller Deutlichkeit, dass das kein
Präzedenzfall für Daten Dritter ist. Feiertagsnamen kommen dagegen über das Netz
von einer Drittanbieter-API; ein „&" oder "<" darin würde sonst das Markup
brechen, in dem Sticky oder Band gebaut sind.

### Geometrie

Alles wird aus `rowHeight` und `grid.padding` abgeleitet, die am Kalender
gemessen werden — kein fester Pixelwert, genau wie beim TODAY-Kreis.

```
gap = grid.padding

Ferienband k (k = 0 ist das unterste, direkt am Kalender), Höhe = rowHeight
   Unterkante = top − (k + 1) · gap − k · rowHeight
   Oberkante  = Unterkante − rowHeight
bandsTop      = top − n · (rowHeight + gap)

stickySize    = 2 · rowHeight       (quadratisch, Miro hält das Seitenverhältnis)
stickyGap     = 1,5 · rowHeight     (der Raum, in dem die Linie sichtbar ist)
stickyBottom  = bandsTop − stickyGap

blockTop      = stickyBottom − stickySize
reservedRows  = (top − blockTop) / rowHeight
```

`stickySize` skaliert mit `rowHeight`, nicht mit der Spaltenbreite — dieselbe
Entscheidung wie beim `DIAMETER_FACTOR` des TODAY-Kreises, und aus demselben
Grund: Basisbreite und Basishöhe sind im Panel unabhängig einstellbar, und ein
Sticky, das an der Spaltenbreite hängt, wird auf einem schmalspaltigen Kalender
unlesbar.

### Seitliches Ausweichen

Rein, testbar, ohne Board-Kenntnis:

```
sortiert nach Spalte, von links nach rechts:
   x = max( mitteX(spalte),  vorherigesX + stickySize + minGap )
```

Karfreitag und Ostermontag liegen in **benachbarten** Spalten — das Wochenende
dazwischen hat keine. Bei `shapeWidth = 100` sind das 102 px Abstand, gebraucht
werden rund 250: das zweite Sticky rutscht nach rechts, die Linie wird schräg.
Der 25./26.12. ebenso. Drei Feiertage hintereinander schieben sich kaskadierend
weiter; am Jahresende kann das letzte Sticky über den rechten Kalenderrand
hinausragen. Das ist die richtige Folge der Regel, kein Fehler.

## Der TODAY-Kreis über dem Block

Der Kreis sitzt künftig über dem Feiertagsblock:

```
y = top − reservedRows · rowHeight − 0,5 · rowHeight − diameter / 2
```

Bei `reservedRows = 0` ist das buchstäblich die heutige Formel. Ohne Feiertage
bewegt sich nichts.

Damit muss `moveIndicator` erstmals auch `y` schreiben — und genau das war der
Grund, es bisher nicht zu tun: nur `x` zu schreiben ist es, was das Höherziehen
des Kreises von Hand überleben lässt.

Die Lösung ist ein neues Feld `indicator.placedY`: **das y, das wir zuletzt
geschrieben haben.** Beim Tick wird das gewünschte y dagegen verglichen, nicht
gegen die tatsächliche Position des Kreises.

- Wir schreiben y = 100, merken 100. Der Nutzer zieht auf 50. Nächster Tick:
  gewünscht 100, gemerkt 100 → **y wird nicht angefasst**, der Zug bleibt.
- Feiertage kommen dazu, gewünscht ist 20 ≠ gemerkt 100 → y wird geschrieben.
  Der Kreis springt, genau in dem Moment, in dem der Nutzer es erwartet.

Gegen die eigene Absicht vergleichen, nicht gegen den beobachteten Zustand. Für
`x` bleibt es beim Vergleich gegen `item.x`, denn `x` soll immer dem Datum
folgen.

### Ein Kreis von vor `placedY`

Ein Indikator, der gezeichnet wurde, bevor dieses Feld existierte, hat schlicht
keinen `placedY`-Schlüssel — nicht `null`, sondern abwesend. `undefined == null`
hätte das beim ersten Tick nach dem Deploy als „noch nie geschrieben" gedeutet
und einen Schreibvorgang erzwungen, der einen von Hand höher gezogenen Kreis
stillschweigend zerstört hätte.

Der Ausweg: für einen fehlenden `placedY` wird der Wert rekonstruiert, den das
alte `createIndicator` schon immer geschrieben hat — dieselbe Formel mit
`reservedRows: 0`. Das ist keine Vermutung, sondern exakt das, was dort stand,
solange es keine Feiertage gab. Ein Alt-Kreis bleibt also stehen, solange der
Kalender keine Feiertage zeigt, und rückt trotzdem hoch, sobald welche
dazukommen. Die Entscheidung sitzt als eigene Funktion `shouldMoveIndicatorY`
in `src/todayColumn.js`.

## AppData

Im Kalendereintrag kommt dazu:

```js
holidays: {
  subdivisions:  ['DE-BY', 'DE-HE'],  // letzte Auswahl, beim nächsten Mal vorausgewählt
  itemIds:       [...],               // Bänder, Stickies, Connectors
  markedColumns: [3, 91, 208, ...],   // Spalten, nicht IDs
  reservedRows:  5.54,                // was today.js liest
}
```

Und in `indicator`: `placedY`.

`markedColumns` speichert **Spalten statt Item-IDs**, mit Absicht. Zum
Zurücksetzen brauchen wir die Originalfarbe, und die ist
`dayColor(dayBlocks(year)[spalte].weekday)` — wieder aus dem Raster hergeleitet
statt zweitbuchhaltet. Eine Spalte überlebt außerdem ein Neuzeichnen des
Kalenders, eine ID nicht.

Größe: rund 1 KB pro Kalender im 30-KB-Budget.

### Wer `holidays` schreibt

Anders als hier ursprünglich vorgesehen, schreibt nicht der Aufrufer nach dem
`await` auf `drawHolidays` das ganze `holidays`-Objekt. `drawHolidays` selbst
schreibt `itemIds`, `markedColumns` und `reservedRows` — sowohl beim Erfolg als
auch, mit dem bis dahin erreichten Stand, wenn es unterwegs wirft. Der Aufrufer
(der dritte Tab) ergänzt danach nur noch `subdivisions`, über eine eigens dafür
exportierte `recordHolidays(calendarId, changes)`.

Zwei Gründe, beide aus dem Review:

1. `updateCalendar` mergt nur auf der obersten Ebene. Ein `holidays`-Objekt zu
   übergeben ersetzt das komplette Unterobjekt — und hätte damit IDs gelöscht,
   die `removeHolidays` bewusst stehen ließ, weil ein Rate-Limit nicht bestätigen
   konnte, dass das jeweilige Item wirklich weg ist. `recordHolidays` liest den
   aktuellen Stand deshalb zuerst und mergt hinein.
2. Den Schreibvorgang dem Aufrufer zu überlassen hieß: ein fehlschlagender
   Schreibvorgang beim Aufrufer verwaiste alles, was gerade erst gezeichnet
   wurde — die Items stehen auf dem Board, aber nichts zeigt mehr auf sie.

## Fehlerbehandlung

| Situation | Folge |
|---|---|
| API nicht erreichbar oder kein 2xx | Nichts gezeichnet, Meldung im Panel, erneut versuchbar |
| Einzelner Eintrag unlesbar | Übersprungen und in der Hinweisliste benannt |
| Kein Kalender für das Jahr | „This board has no calendar for this data" — wie beim Urlaub |
| Kalender nicht gruppiert (`groupId` fehlt) | Nichts gezeichnet, klare Meldung |
| Zellenzahl ≠ `totalWorkingDays(year)` | Nichts gezeichnet — dieselbe Haltung wie `gridFrom`, das lieber `null` liefert als etwas plausibel Aussehendes an der falschen Stelle |
| Feiertag fällt auf ein Wochenende | Keine Spalte, übersprungen und benannt (1. Mai 2027 ist ein Samstag) |
| Ferienblock ganz außerhalb des Jahres | Übersprungen und benannt — macht `planVacations` schon |
| Rate-Limit beim Zeichnen | Was schon auf dem Board liegt, steht vorher in AppData, dann wird geworfen — wie in `drawRows` |
| Rate-Limit beim Zurücknehmen | ID bleibt stehen statt verworfen zu werden — wie in `removePreviousImport` |

Bei einem ungruppierten Kalender wird bewusst **gar nichts** gezeichnet statt
nur Bänder und Stickies ohne Tagesmarken. Ein Sticky ohne Connector zeigt auf
nichts, und ein zweiter Codepfad mit Overlay-Shapes für einen seltenen Fall wäre
teurer als die Meldung.

## Tests

Aufgezeichnete echte API-Antworten für DE-BY und DE-HE 2026 liegen als Fixture
im Repo, damit die Tests ohne Netz laufen.

- `nationwide` gegen `regionalScope`: Neujahr darf nicht als landesspezifisch
  durchgehen.
- Friedensfest als `Local`-Fall: gezeichnet, Kürzelzeile nennt den Ort.
- Kürzelzeile nennt alle Länder, auch die nicht ausgewählten.
- Weihnachtsferien über die Jahresgrenze werden geclippt, nicht verworfen.
- Ein Ferienblock ganz im Vorjahr wird verworfen und benannt.
- Zeilenbildung: eine Zeile pro Bundesland, mehrere Blöcke darin.
- Ausweichen: benachbarte Spalten, Kaskade über drei, kein Versatz bei weit
  auseinanderliegenden Tagen, Ausgabe-x ist monoton steigend.
- `reservedRows` ist 0 ohne Feiertage und wächst pro Band um genau
  `rowHeight + gap`.
- Feiertag am Wochenende wird übersprungen und benannt.
- Die 16 vorhandenen `vacation`-Tests bleiben unverändert grün.

Board-I/O wird nicht unit-getestet — dieselbe Grenze wie im Vorgänger-Spec.

## Phasen

1. **Datenschicht.** `openHolidays.js`, `holidays.js`, `spans.js`-Extraktion.
   Nichts auf dem Board, alles unter `node --test`. Ausrollbar ohne sichtbare
   Wirkung.
2. **Adressierbare Tageszellen.** `dayCells.js`, `dayColor` raus aus `app.js`.
   Am echten Board prüfbar: eine Zelle umfärben und zurück.
3. **Zeichnen.** Bänder, Stickies, Connectors, Marken, Zurücknehmen, dritter
   Tab.
4. **TODAY-Kreis.** `placedY`, Kreis über dem Block.

## Die zwei Grüntöne und der Connector — verlagert statt geklärt

Dieser Abschnitt hieß ursprünglich „Offene API-Fragen": zwei Dinge sollten am
echten Board gemessen werden, so wie im Vorgänger-Spec die Frage, ob sich ein
Group-Mitglied noch verschieben lässt. Der Auftraggeber hat stattdessen
entschieden, mit belegten Annahmen weiterzubauen und erst beim ersten echten
Zeichnen zu korrigieren. Beides ist damit nicht beantwortet, sondern
verlagert — auf genau eine Stelle im Code, an der sich ein falscher Ausgangswert
später korrigieren lässt, ohne etwas anderes anzufassen.

1. **Welches Hex trifft Miros gerendertes `dark_green` und `light_green`?**
   Die Werte stehen als `HOLIDAY_COLORS` in `src/stickyColors.js`, markiert
   UNVERIFIED, aus Miros Community-Farbtabelle übernommen statt am Board
   abgelesen. `dark_green` (`#93D275`) ist das echte Grün des Mockups;
   Miros `green` wäre ein Olivton gewesen und flog deshalb aus der Auswahl.
2. **Darf ein Connector auf ein Item innerhalb einer Group zeigen?** Die
   Referenz sagt dazu nichts. Statt es vorab zu messen, beantwortet
   `src/holidayDraw.js` die Frage zur Laufzeit: der erste Connector versucht die
   Tageszelle direkt; weist Miro das zurück, schaltet der Rest des Zeichnens auf
   unsichtbare Ankershapes über derselben Zelle um. Ein Rate-Limit löst diesen
   Rückfall bewusst **nicht** aus — nur eine echte Ablehnung des Ziels tut das,
   sonst würde ein vorübergehender Fehler fälschlich als „Group nicht erlaubt"
   gedeutet. Die Konsole nennt den genommenen Weg.

Beide Annahmen, samt der Symptome, an denen man eine falsche Annahme erkennt,
stehen in
[`docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md`](../notes/2026-07-30-sticky-colours-unverified.md).

## Bewusst in Kauf genommen

- **Zwei senkrechte Linien in derselben Spalte**, wenn heute ein Feiertag ist:
  die gepunktete TODAY-Linie und der Feiertags-Connector. Kosmetisch, an rund 13
  Tagen im Jahr.
- **Der TODAY-Kreis springt beim Import.** Eine von Hand eingestellte Höhe geht
  in dem Moment verloren, in dem sich der Feiertagsblock ändert. Das ist der
  Preis für „Kreis über allem"; `placedY` drückt ihn auf genau diesen Moment
  zusammen, statt ihn alle 10 Minuten zu zahlen.
- **Die AppData-Race bleibt offen.** Der Vorgänger-Spec beschreibt sie; ein
  weiteres Feld ändert nichts daran.
- **Der Feiertagsblock zieht beim Verschieben des Kalenders nicht mit** — außer
  den Tagesmarken, die ja die Zellen selbst sind. Dasselbe gilt heute schon für
  die Urlaubsbalken.

## Verworfene Alternativen

**Metadaten an alle ~360 Shapes hängen.** Naheliegend, aber es löst das Problem
nicht: `board.get()` filtert nach `id`, `type` und `tags` — nicht nach
Metadaten. Ein Tag hilft beim Wiedererkennen, nicht beim Finden. Suchen hieße
weiterhin, alle Items zu holen und `getMetadata()` einzeln aufzurufen.
Gleichzeitig kostet es: `createShape` nimmt keine Metadaten entgegen und einen
Batch gibt es nicht, also würde jedes Zeichnen von 360 auf 720 Calls und von
18.000 auf 36.000 Credits wachsen — dauerhaft, für ein Feature, das gelegentlich
läuft. `groupId` liefert dasselbe Ergebnis für zwei Calls und null Schreibkosten.

**Board-Scan statt Group.** `board.get({type: 'shape'})` in einem Call, dann
nach `y` und x-Bereich filtern. Funktioniert auch ohne Group und wäre robust
gegen Auflösen der Gruppierung. Verworfen, weil `board.get()` Level 3 ist (500
Credits) und alle Shapes des gesamten Boards liefert statt nur die dieses
Kalenders — bei zwei nebeneinanderliegenden Jahren macht das den Unterschied.

**Extra-Shape über die Tageszelle legen.** Braucht keine Adressierung und ist
trivial zu löschen. Aber die Marke bleibt liegen, wenn jemand den Kalender
verschiebt, und im Screenshot *ist* der Feiertag grün, er hat nicht etwas
Grünes obendrauf.

**TODAY-Band freihalten, Feiertage darüber.** Hätte jede Kopplung zwischen
`today.js` und den Feiertagen vermieden. Verworfen zugunsten der Optik: der
Kreis krönt den Stapel. `placedY` macht den Preis erträglich.

**Ein Layout-Modul verteilt die Slots.** Auf dem Papier die sauberste Trennung.
In der Praxis müsste die Slot-Belegung in AppData stehen, damit der Tick im
headless-iframe sie kennt — also mehr geteilter Zustand über genau den Kanal,
der schon eine ungelöste Race hat. Die Einbahnstraße `holidays.reservedRows`
tut dasselbe mit einer Zahl.

**Datensatz beim Build erzeugen und mitliefern.** Offline, deterministisch,
testbar ohne Netz. Aber die Tabelle veraltet still: ein nachträglich korrigierter
Ferientermin bleibt falsch, bis jemand neu baut — und niemand merkt, dass er das
müsste.

**Senkrechte Connectors mit gestaffelten Stickies.** Hätte die Optik des
Screenshots erhalten. Verworfen, weil die Blockhöhe dann von der Zahl der
Kollisionen abhinge und damit auch die Position des TODAY-Kreises — die soll
stabil sein.

## Nachtrag: die Bundesländer-Auswahl

Der Plan sah ein `<select multiple size="8">` mit Mirotones `.select` vor. Das
rendert genau **eine** Zeile: `.select` setzt `height: var(--input-height)`
(und `.select-small` 36 px) und ist als einzeiliges Dropdown gebaut, mit
`appearance: none` und einem Pfeil als Hintergrundbild — die feste Höhe
überschreibt das `size`-Attribut.

Ersetzt durch Mirotones `.checkbox`, sechzehn Stück in einem eigenen
Scrollbereich von 216 px, mit einer Zeile „N states picked." darunter. Der
Scrollbereich hält den Draw-Button über der Falz; die Zählzeile macht sichtbar,
was oberhalb des Sichtfensters angehakt ist. Nebenbei entfällt das Cmd-Klicken,
bei dem ein Fehlklick die ganze Auswahl löscht.
