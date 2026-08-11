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
