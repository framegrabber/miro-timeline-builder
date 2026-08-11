# Unbestätigt: `bringToFront` und die Konnektor-Endpunkte

**Datum:** 2026-08-11
**Gehört zu:** [TODAY-Indikator: Länge, Stapelposition, Tick-Kosten](../specs/2026-08-11-today-indikator-laenge-stapel-tick-design.md)

**Status (2026-08-11):** Alle drei Annahmen unten sind unbestätigt. Die Prüfung
braucht ein echtes, offenes Board und kann von keinem Agenten ausgeführt
werden. Wer die Checkliste im Abschnitt „Prüfung am Board" durcharbeitet, trägt
die Ergebnisse in die Tabelle „Ergebnisse" am Ende dieser Notiz ein.

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

## Checkliste für die Prüfung am Board

Die folgenden Schritte sind aus dem Task-9-Plan übernommen (Steps 1–7). Wer sie
durcharbeitet, vergleicht die Konsolenausgabe zeichengenau mit den unten
zitierten Strings — nicht mit einer Umschreibung davon.

1. **Bestehendes Board, nichts darf sich bewegen.** Ein Board mit einem
   Kalender öffnen, der vor dieser Änderung gezeichnet wurde, und die Position
   des Kreises und des unteren Endes vorher/nachher vergleichen.
   Erwartet: keine Bewegung. Die Konsole zeigt genau eine Zeile, die mit
   `Timeline Builder - indicator pass` beginnt (siehe `src/index.js:63-66`,
   exakter Aufbau unten).

2. **Der Tageswächter greift.** Board offen lassen, mehr als zehn Minuten
   warten.
   Erwartet: keine zweite Zeile, die mit `Timeline Builder - indicator pass`
   beginnt.

3. **Die Länge folgt dem Inhalt.** Urlaubsdaten für ein Team mit vielen
   gleichzeitigen Abwesenheiten importieren (viele Zeilen).
   Erwartet: die gepunktete Linie reicht eine Zeilenhöhe unter den tiefsten
   Balken. Danach einen kleineren Datensatz importieren.
   Erwartet: die Linie wird kürzer, mindestens bis auf drei Zeilenhöhen.
   (Rein visuelle Prüfung, kein Konsolen-String dafür im Code gefunden.)

4. **Ein gezogener Anker bleibt gezogen.** Anker per Hand deutlich weiter nach
   unten ziehen, Board neu laden.
   Erwartet: die Länge bleibt, wie sie gezogen wurde. Danach denselben
   Urlaubsdatensatz erneut importieren.
   Erwartet: die Länge springt auf den abgeleiteten Wert — das ist gewollt,
   siehe Spec. (Rein visuelle Prüfung, kein Konsolen-String dafür im Code
   gefunden.)

5. **Die Stapelposition.** Nach dem Import prüfen, ob die gepunktete Linie
   über den Balken und über den Ferienbändern liegt. Konsole auf die
   Fallback-Warnungen aus der Tabelle oben prüfen, wörtlich:
   `Timeline Builder: could not raise the TODAY indicator for calendar ${entry.calendarId} in one call, falling back`
   (`src/today.js:455`), sowie ihre beiden Geschwister
   `Timeline Builder: could not raise the TODAY circle for calendar ${entry.calendarId}`
   (`src/today.js:462`) und
   `Timeline Builder: could not redraw the TODAY connector for calendar ${entry.calendarId}`
   (`src/today.js:469`).
   Erwartet: Linie sichtbar. Warnung oder keine Warnung — beides ist ein
   Ergebnis und wird unten eingetragen.

6. **Der Konnektor heilt.** Das untere Ende der Linie per Hand vom Anker
   abziehen, dann einen Import auslösen (oder das Board am nächsten Tag
   öffnen).
   Erwartet: die Konsole zeigt wörtlich
   `Timeline Builder: the TODAY connector for calendar ${entry.calendarId} was detached or gone and has been redrawn.`
   (`src/today.js:422`), und die Linie hängt wieder an beiden Enden.

7. **Feiertage weiterhin unberührt.** Feiertage für ein Bundesland zeichnen.
   Erwartet: der Kreis rückt über den Block wie bisher, das untere Ende bleibt,
   wo es war. (Rein visuelle Prüfung, kein Konsolen-String dafür im Code
   gefunden.)

Für den Fall, dass die dritte Annahme (Endpunkt-Namen) fällt, meldet sich die
Konsole wörtlich mit
`Timeline Builder: cannot read the TODAY connector's endpoints, leaving it alone.`
(`src/today.js:391`) — diese Zeile gehört zu Step 5/6, nicht zu einem eigenen
Schritt, aber sie ist der Beleg dafür, dass der Fallback statt des Heilens
gelaufen ist.

Der genaue Aufbau der `indicator pass`-Zeile aus `src/index.js:63-66`:

```
Timeline Builder - indicator pass ${dateKey}: ${stats.calls} calls, ${stats.credits.toLocaleString('en-US')} credits, ${Math.round(stats.wallClockMs)} ms
```

## Ergebnisse

| Annahme | Ergebnis | Datum | Eingetragen von |
|---|---|---|---|
| `bringToFront` nimmt einen Connector | _offen_ | | |
| `bringToFront` wirkt an einem gruppierten Element | _offen_ | | |
| Endpunkte heißen `connector.start.item` / `connector.end.item` | _offen_ | | |

**Quellen:**
[Board](https://developers.miro.com/docs/websdk-reference-board),
[Connector](https://developers.miro.com/docs/websdk-reference-connector)
