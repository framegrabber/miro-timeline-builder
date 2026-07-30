# Offen: Sticky-Grün und Connector in eine Group

**Datum:** 2026-07-30
**Status:** bewusst ungeprüft, wird beim ersten echten Zeichnen korrigiert

Der Spec sah vor, beides auf einem Board zu messen. Entschieden wurde, mit
belegten Annahmen weiterzubauen.

## Sticky-Grün

Sticky-Notes nehmen nur Miros benannte Palette, Shapes nehmen Hex. Damit
Tagesmarke und Sticky als Paar wirken, muss das Hex zu dem passen, was Miro
für den Namen rendert — und das gibt das SDK nicht heraus.

Angenommen, aus Miros Community-Farbtabelle:

| SDK-Name | angenommenes Hex | Ton |
|---|---|---|
| `dark_green` | `#93D275` | echtes Grün, entspricht dem Mockup |
| `light_green` | `#D5F692` | blasses Gelbgrün |
| `green` | ~`#D0E17A` | Olive — **nicht** benutzt, passt nicht zum Mockup |

**Woran man merkt, dass es falsch war:** Tagesmarke und zugehöriges Sticky
sehen auf dem Board unterschiedlich aus. **Wo es zu reparieren ist:**
ausschließlich `src/stickyColors.js`.

## Connector auf ein Item innerhalb einer Group

Die Referenz sagt nicht, ob das erlaubt ist. Statt zu messen, beantwortet
`holidayDraw.js` die Frage zur Laufzeit: es versucht zuerst die Tageszelle und
weicht bei einer Ablehnung auf eine unsichtbare Ankershape an derselben Stelle
aus — dasselbe Mittel, mit dem `today.js` seine gepunktete Linie enden lässt.
Welcher Weg genommen wurde, steht danach in der Konsole.

**Woran man merkt, welcher Fall eintrat:** die Meldung
`Timeline Builder: connectors cannot end inside a group, using anchors instead`
erscheint genau dann, wenn Miro abgelehnt hat.
