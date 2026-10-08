# Unverified: how frames treat their children

**Date:** 2026-10-08
**Belongs to:** [Calendar in a Frame — Implementation Plan](../plans/2026-10-08-calendar-in-frame.md)

**Status (2026-10-08): unverified.** Nothing below has been checked on a real
board yet. Fill in the results table at the end once the snippet and the
checklist have been run.

Nine behaviours of the Web SDK that the reference does not settle. The code
picks an answer for each, and where a wrong answer would break a flow it falls
back instead of failing. This note records which answer the code assumes and
how you notice that the fallback ran instead — so a quiet console means the
assumptions hold, and a noisy one tells you which of them fell.

The fallback warnings are all of the form `Timeline Builder: could not ...
frame` (for example "could not grow the frame", "could not add ... to the
frame"). The exact strings are written by the agents implementing
`src/frame.js`, `src/app.js`, `src/holidayDraw.js`, `src/import.js` and
`src/today.js`; when running the checklist, grep those files for
`Timeline Builder: could not` and compare the console character by character
with what you find there, not with the paraphrase in this note.

| # | Question | Assumption in code | How to spot the fallback |
|---|---|---|---|
| Q1 | Growing a frame up/left (`x`, `y`, `width`, `height` in one `sync()`) — do children keep their board position? | **no** (seen on a board, 2026-10-08): children keep their offset from the frame's top-left, so they move with it. `writeRect` in `src/frame.js` takes the children out, resizes, and puts them back whenever the top-left moves | The calendar jumping up/left when holidays are drawn means the take-out/put-back step did not run or did not work. |
| Q2 | Same when shrinking. | same as Q1 | The calendar jumping down/right when the frame shrinks (steps 4, 5). |
| Q3 | After `frame.add(group)`, does an item keep its `groupId`, and does `group.getItems()` report relative coordinates? | `groupId` kept; `getItems()` reports coordinates relative to the frame | Holidays/vacations land on the wrong days after the calendar is in a frame (step 6), or a `Timeline Builder:` warning that no day cells were found. |
| Q4 | Can a grouped frame child be moved via relative `x`/`y` + `sync()`? | yes | The TODAY circle stays on yesterday's day; a `Timeline Builder: could not ...` line from the indicator move. |
| Q5 | What happens when a child is `sync()`ed past the frame edge: error, detach, clip? | unknown — so the code always grows the frame *first*, then places items | Only matters if growing fails: `Timeline Builder: could not grow the ... frame` followed by items sticking out of or missing from the frame. |
| Q6 | Does `frame.add(group)` accept a group containing a connector (the TODAY indicator)? | unknown — the code tries the group and falls back to adding the items individually | A `Timeline Builder: could not add ... frame` line mentioning the indicator/group, after which circle and line still end up inside. |
| Q7 | Does an item created via `createShape` inside a frame's area automatically become its child? | no — the code always calls `frame.add` explicitly | Not a warning; only visible in the snippet output. If yes, the explicit `add` is redundant but harmless. |
| Q8 | Actual credit cost of `getChildren`, `frame.add`, `createFrame`. | `getChildren` = 500 credits (level 3, via `runLevel3`); the others like normal writes | Rate-limit warnings or 429s in the console during a large import; the `indicator pass` stats line shows more credits than expected. Cannot be measured from the snippet — read it off the developer dashboard / `indicator pass` line. |
| Q9 | Does `bringToFront` on circle + connector still work inside a frame? | yes | The existing warning `Timeline Builder: could not raise the TODAY indicator ... falling back` (see the [2026-08-11 note](2026-08-11-bringtofront-und-konnektor-unbestaetigt.md)), or the line lying under bars and bands. |
| Q10 | Does `frame.remove(group)` take a whole group out of a frame in one call, leaving its items where they are on the board? Do connectors become frame children? | yes / no — but `writeRect` reads the children again after taking the groups out and takes out whatever is left one by one | `Timeline Builder: frame … still held N shape, M connector after its groups were taken out, taking them out one by one.` (works, but costs one call per item), `… did not let go of group … at once …` (remove(group) threw), or `… would not let go of …, leaving its size as it is` (the frame was not resized). Copy the exact line into the results. |

**Board check:** run the snippet below once (answers Q1–Q7), then work through
the checklist (answers Q8, Q9 and the end-to-end behaviour).

## Console snippet (Q1–Q7)

Open a board with the app, open the app panel, right-click inside the panel →
Inspect, and in DevTools switch the console's context to the panel iframe
(`miro.board` is only defined there). Paste the whole block. It works on an
empty scratch area far away from everything (`ORIGIN`), prints one line per
question, and removes everything it created even if a step throws.

Note on coordinates: for frame children the SDK reports `x`/`y` relative to
the frame's top-left corner. The snippet therefore converts to board
coordinates itself (`frameLeft + child.x`) before comparing, so "kept its
board position" means the same point on the board, not the same numbers.

```js
(async () => {
  const ORIGIN = { x: 200000, y: 200000 }; // scratch area, far from real content
  const created = [];
  const track = (item) => { created.push(item); return item; };
  const log = (q, ...args) => console.log(`[frame-check] ${q}:`, ...args);
  const frameLeft = (f) => f.x - f.width / 2;
  const frameTop = (f) => f.y - f.height / 2;
  // Board position of a frame child, whatever the SDK reports.
  const boardPos = async (id) => {
    const item = await miro.board.getById(id);
    if (item.parentId) {
      const f = await miro.board.getById(item.parentId);
      return { x: Math.round(frameLeft(f) + item.x), y: Math.round(frameTop(f) + item.y), parentId: item.parentId, raw: { x: item.x, y: item.y } };
    }
    return { x: Math.round(item.x), y: Math.round(item.y), parentId: null, raw: { x: item.x, y: item.y } };
  };
  const same = (a, b) => a.x === b.x && a.y === b.y;

  try {
    const frame = track(await miro.board.createFrame({
      title: 'frame-check (safe to delete)',
      x: ORIGIN.x, y: ORIGIN.y, width: 1000, height: 600,
      style: { fillColor: '#ffffff' },
    }));

    // Q7: created inside the frame's area — child automatically?
    const shape = track(await miro.board.createShape({
      shape: 'rectangle', content: 'A', x: ORIGIN.x, y: ORIGIN.y, width: 100, height: 60,
    }));
    const afterCreate = await miro.board.getById(shape.id);
    log('Q7 auto-child on create', afterCreate.parentId === frame.id, 'parentId =', afterCreate.parentId);

    // Q3: group of shapes, frame.add(group), groupId and getItems coords.
    const s1 = track(await miro.board.createShape({ shape: 'rectangle', content: 'G1', x: ORIGIN.x - 200, y: ORIGIN.y + 100, width: 80, height: 40 }));
    const s2 = track(await miro.board.createShape({ shape: 'rectangle', content: 'G2', x: ORIGIN.x - 100, y: ORIGIN.y + 100, width: 80, height: 40 }));
    const group = await miro.board.group({ items: [s1, s2] });
    created.push({ group });
    await frame.add(group);
    if (afterCreate.parentId !== frame.id) await frame.add(shape);
    const s1After = await miro.board.getById(s1.id);
    const items = await group.getItems();
    log('Q3 groupId kept', s1After.groupId === group.id, 'groupId =', s1After.groupId, 'parentId =', s1After.parentId);
    log('Q3 getItems coords', items.map((i) => ({ id: i.id, x: i.x, y: i.y })), '(relative if around 300/400, board if around', ORIGIN.x - 200, ')');
    const children = await frame.getChildren();
    log('Q3 frame.getChildren', children.map((c) => `${c.type}:${c.id}`));

    // Q1: grow up/left in one sync — children keep board position?
    const before = await boardPos(shape.id);
    const gBefore = await boardPos(s1.id);
    frame.x -= 200; frame.y -= 150; frame.width += 400; frame.height += 300;
    await frame.sync();
    const after = await boardPos(shape.id);
    const gAfter = await boardPos(s1.id);
    log('Q1 grow keeps board position', same(before, after) && same(gBefore, gAfter), { before, after, gBefore, gAfter });

    // Q2: shrink back in one sync.
    frame.x += 200; frame.y += 150; frame.width -= 400; frame.height -= 300;
    await frame.sync();
    const shrunk = await boardPos(shape.id);
    const gShrunk = await boardPos(s1.id);
    log('Q2 shrink keeps board position', same(before, shrunk) && same(gBefore, gShrunk), { before, shrunk, gBefore, gShrunk });

    // Q4: move a grouped frame child via relative x/y + sync.
    try {
      const g1 = await miro.board.getById(s1.id);
      const fromRaw = { x: g1.x, y: g1.y };
      g1.x += 50;
      await g1.sync();
      const moved = await miro.board.getById(s1.id);
      log('Q4 grouped child moved', moved.x === fromRaw.x + 50, { fromRaw, to: { x: moved.x, y: moved.y }, groupId: moved.groupId });
    } catch (e) {
      log('Q4 grouped child moved', false, 'error:', e);
    }

    // Q5: sync a child past the frame edge.
    try {
      const c = await miro.board.getById(shape.id);
      c.x = frame.width + 300; // relative coords: well outside the right edge
      await c.sync();
      const out = await miro.board.getById(shape.id);
      log('Q5 past the edge', 'no error', { parentId: out.parentId, x: out.x, y: out.y, stillChild: out.parentId === frame.id });
    } catch (e) {
      log('Q5 past the edge', 'error:', e);
    }

    // Q6: group containing a connector — does frame.add accept it?
    const dot = track(await miro.board.createShape({ shape: 'circle', x: ORIGIN.x + 1500, y: ORIGIN.y, width: 30, height: 30 }));
    const anchor = track(await miro.board.createShape({ shape: 'rectangle', x: ORIGIN.x + 1500, y: ORIGIN.y + 300, width: 8, height: 8 }));
    const line = track(await miro.board.createConnector({
      start: { item: dot.id }, end: { item: anchor.id },
      style: { strokeStyle: 'dotted' },
    }));
    let indicatorGroup = null;
    try {
      indicatorGroup = await miro.board.group({ items: [dot, anchor, line] });
      created.push({ group: indicatorGroup });
    } catch (e) {
      log('Q6 grouping with a connector', false, 'group() itself refused:', e);
    }
    if (indicatorGroup) {
      try {
        frame.width += 3000; await frame.sync(); // make room first (see Q5)
        await frame.add(indicatorGroup);
        const lineAfter = await miro.board.getById(line.id);
        const dotAfter = await miro.board.getById(dot.id);
        log('Q6 frame.add(group with connector)', true, { dotParent: dotAfter.parentId, lineParent: lineAfter.parentId });
      } catch (e) {
        log('Q6 frame.add(group with connector)', false, 'error:', e);
      }
    }
  } catch (e) {
    console.error('[frame-check] aborted:', e);
  } finally {
    // Groups first (removing a group removes its items), then the rest; ignore already-gone items.
    for (const entry of created.reverse()) {
      const item = entry.group ?? entry;
      try { await miro.board.remove(item); } catch (_) { /* already removed with its group/frame */ }
    }
    console.log('[frame-check] cleaned up', created.length, 'items');
  }
})();
```

If the cleanup leaves anything behind (an SDK error aborted it), select the
frame titled `frame-check (safe to delete)` and delete it by hand.

## Checklist for the board check (T9)

Work through these on a real board, with DevTools open on the panel iframe.

1. **Draw a full year.** Expected: a white frame titled `2026`; the TODAY
   circle and line are inside it.
2. **Draw Jul–Dec.** Expected: frame title `2026 (Jul-Dec)`.
3. **Holidays for three states.** Expected: the frame grows up and left (state
   labels); the calendar does not move. (Q1)
4. **Holidays again for one state.** Expected: the frame shrinks. (Q2)
5. **Import a large vacation set, then a small one.** Expected: the frame grows
   down, then shrinks again; the dotted line lies above bars and bands. (Q2, Q9)
6. **Move the frame, reload, redraw holidays.** Expected: everything lands on
   the right days. (Q3)
7. **Open a calendar drawn before this change.** Expected: no frame appears,
   nothing moves; holidays and vacations work as before.
8. **Drag an old calendar into a frame of your own, draw holidays.** Expected:
   right days, your frame untouched.
9. **Console.** Expected: no `Timeline Builder:` warnings beyond expected ones.
   In particular, no `Timeline Builder: could not ... frame` lines. Also note
   the credits in the `Timeline Builder - indicator pass` line for Q8.

## Results

| # | Result | Date | Entered by |
|---|---|---|---|
| Q1 | no — children keep their offset from the frame's top-left; a holiday draw left the bands under the calendar and the sticky on it | 2026-10-08 | Felix Rothballer (screenshot) |
| Q2 | no — follows from Q1 (same `writeRect`) | 2026-10-08 | inferred from Q1 |
| Q3 | | | |
| Q4 | | | |
| Q5 | | | |
| Q6 | | | |
| Q7 | | | |
| Q8 | | | |
| Q9 | | | |
| Q10 | open — a fit after holidays failed with "Cannot resize the frame … children would exist outside the parent frame", so something stayed in the frame after the groups were taken out; the warnings above will say what | 2026-10-08 | Felix Rothballer (console) |
| `frame.setMetadata` | unsupported: "The specified command is unsupported: frame.setMetadata()" — the call was removed | 2026-10-08 | Felix Rothballer (console) |
| Checklist 1–9 | | | |

**Sources:**
[Board](https://developers.miro.com/docs/websdk-reference-board),
[Frame](https://developers.miro.com/docs/websdk-reference-frame),
[Group](https://developers.miro.com/docs/websdk-reference-group),
[Connector](https://developers.miro.com/docs/websdk-reference-connector),
[Rate limiting](https://developers.miro.com/reference/rate-limiting)
