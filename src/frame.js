import { board, isRateLimitError, run, runLevel3 } from './board.js';
import {
    BOARD_ORIGIN,
    FRAME_MARGIN_ROWS,
    containsEdges,
    edgesOf,
    frameRectFor,
    frameTitle,
    originOf,
    padEdges,
    toBoard,
    unionEdges,
} from './frameGeometry.js';

// The frame around a calendar is ours to size: it grows before anything is
// drawn or moved past its edge (frame.add rejects an item that is not already
// inside, and a child synced past the edge is undocumented), and it is cut back
// to the actual content once at the end of every flow.
//
// Everything here thinks in board coordinates, like the rest of the app. The
// only two places relative coordinates show up are a frame's children (x/y are
// relative to the frame's top-left corner, relativeTo 'parent_top_left') and
// the frame itself, whose x/y are its centre on the board like any other item.
//
// Every function throws. A frame is a convenience in the same way grouping is,
// so the decision to shrug a failure off belongs to the caller, which knows
// whether it is in the middle of a draw, an import or a tick - and reports it
// with console.warn('Timeline Builder: ...') instead of failing its own flow.
// The one exception is the metadata write in createCalendarFrame, see there.

const METADATA_KEY = 'timelineBuilder';

const FRAME_FILL = '#ffffff';

// Anything closer than this is the same size as far as anyone can see, and
// writing it again would only burn credits - the same tolerance today.js uses
// for the indicator.
const NUDGE = 0.5;

/**
 * Origin of an item's parent frame, in board coordinates; BOARD_ORIGIN when the
 * item has no parent.
 *
 * null when the parent is something other than a frame. Miro only nests items
 * in frames today (and mind map nodes, which report relative to the parent's
 * centre rather than its top-left), and for any parent the SDK cannot place it
 * reports -Infinity - so instead of converting into nonsense the caller gets an
 * explicit "can't place this" and decides what that means for its pass.
 *
 * `cache` maps frameId -> Frame so a pass over several items reads each frame
 * once. Only frames go in: a non-frame parent is the rare unsupported case and
 * a second read for it is cheaper than a cache whose values are not what its
 * name says.
 *
 * Rate-limit errors propagate untouched - a parent we could not read is not a
 * parent that is gone, and the caller has to be able to tell the two apart.
 */
export async function parentOrigin(item, cache = new Map()) {
    if (!item.parentId) return BOARD_ORIGIN;

    let parent = cache.get(item.parentId);
    if (!parent) {
        parent = await run(() => board.getById(item.parentId));
        if (parent.type !== 'frame') return null;
        cache.set(item.parentId, parent);
    }

    return originOf(parent);
}

/**
 * Creates our frame: white, titled frameTitle(range), enclosing edgesList (board
 * coordinates) plus FRAME_MARGIN_ROWS * rowHeight on every side. Returns the
 * Frame.
 *
 * The frame is tagged { role: 'frame', calendarId, year } like the anchors in
 * anchors.js, so a person (or a later version) looking at it on the board can
 * tell which calendar it belongs to. Nothing reads that tag back - ownership is
 * decided by entry.frameId in AppData - so a failed metadata write costs only
 * the label, and throwing it away along with a perfectly good frame would make
 * the caller fall back to an unframed calendar for no reason. That is why this
 * one write is warned here instead of thrown.
 */
export async function createCalendarFrame({ edgesList, range, rowHeight, calendarId }) {
    const rect = frameRectFor(edgesList, FRAME_MARGIN_ROWS * rowHeight);

    const frame = await run(() => board.createFrame({
        title: frameTitle(range),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        style: { fillColor: FRAME_FILL },
    }));

    try {
        await run(() => frame.setMetadata(METADATA_KEY, { role: 'frame', calendarId, year: range.year }));
    } catch (error) {
        console.warn(`Timeline Builder: could not tag the frame of calendar ${calendarId}, keeping it untagged.`, error);
    }

    return frame;
}

/**
 * Grows the frame so that every edges in edgesList (board coordinates) lies
 * inside with FRAME_MARGIN_ROWS * rowHeight to spare. Never shrinks - that is
 * fitFrame's job at the end of a flow, once the content is final; shrinking
 * here would cut away room for something that is about to be drawn.
 *
 * A no-op (no write, one read) when everything already fits, which is the
 * common case on a tick. Returns whether the frame was written.
 */
export async function growFrame(frameId, edgesList, rowHeight) {
    const margin = FRAME_MARGIN_ROWS * rowHeight;
    const padded = edgesList.map((edges) => padEdges(edges, margin));
    const wanted = unionEdges(padded);
    if (!wanted) return false;

    const frame = await getFrame(frameId);
    const current = edgesOf(frame);
    if (containsEdges(current, wanted)) return false;

    // Margin 0: the new content already carries its margin, and the frame's
    // current edges must stay exactly where they are on the sides that need
    // no growing.
    await writeRect(frame, frameRectFor([current, ...padded], 0));
    return true;
}

/**
 * Fits the frame exactly to its children plus extraEdges (board coordinates),
 * with FRAME_MARGIN_ROWS * rowHeight around them - grows and shrinks.
 *
 * extraEdges is for content that should count without being a child yet, such
 * as an indicator that is about to be drawn.
 *
 * Connectors have no box of their own (their extent is the two items they hang
 * on, which are children anyway), so they are skipped; so is anything else the
 * SDK hands back without a finite position and size. A frame with no measurable
 * children and no extras is left alone - shrinking it to the 100x100 minimum
 * around nothing would only make the user hunt for it.
 *
 * getChildren is a Level 3 call (see rateLimit.js), so callers run this once at
 * the end of a flow, not per item.
 */
export async function fitFrame(frameId, rowHeight, extraEdges = []) {
    const frame = await getFrame(frameId);
    const children = await runLevel3(() => frame.getChildren());
    const origin = originOf(frame);

    const content = [...extraEdges];
    for (const child of children) {
        if (child.type === 'connector') continue;
        if (![child.x, child.y, child.width, child.height].every(Number.isFinite)) continue;

        const { x, y } = toBoard(child, origin);
        content.push(edgesOf({ x, y, width: child.width, height: child.height }));
    }

    if (!content.length) return false;

    const rect = frameRectFor(content, FRAME_MARGIN_ROWS * rowHeight);
    const changed = Math.abs(rect.x - frame.x) > NUDGE
        || Math.abs(rect.y - frame.y) > NUDGE
        || Math.abs(rect.width - frame.width) > NUDGE
        || Math.abs(rect.height - frame.height) > NUDGE;
    if (!changed) return false;

    await writeRect(frame, rect, children);
    return true;
}

/**
 * Makes the given items children of the frame.
 *
 * frame.add(group) first: one call for a whole calendar instead of hundreds.
 * Whether Miro accepts a group at all - and one holding a connector in
 * particular - is open (Q3/Q6 in
 * docs/superpowers/notes/2026-10-08-frame-unverified.md), so if it refuses, or
 * there is no group, the group's items go in one by one.
 *
 * `items` are added individually regardless: things that belong in the frame
 * but not in the group, like the holiday fallback anchors.
 *
 * Connectors are never added individually: the SDK documents no frame.add for
 * them, and a connector follows the items it hangs on anyway. Items that are
 * already children of this frame are skipped, which keeps a retried flow from
 * spending a call (and an error) on each of them.
 *
 * Every item is attempted even when one fails, so a single item that strayed
 * past the edge does not leave the rest of the calendar outside the frame; the
 * failures are thrown together at the end.
 */
export async function addToFrame(frameId, { group = null, items = [] }) {
    await attach(await getFrame(frameId), { group, items });
}

async function attach(frame, { group = null, items = [] }) {
    const singles = [];

    if (group) {
        try {
            await run(() => frame.add(group));
        } catch (error) {
            // A rate limit that survived run()'s retries would only get worse
            // if we answered it with one call per item - let the caller's next
            // flow try again instead.
            if (isRateLimitError(error)) throw error;

            console.warn(`Timeline Builder: frame ${frame.id} did not take the group, adding its items one by one.`, error);
            singles.push(...await run(() => group.getItems()));
        }
    }

    singles.push(...items);

    const failures = [];
    for (const item of singles) {
        if (item.type === 'connector') continue;
        if (item.parentId === frame.id) continue;

        try {
            await run(() => frame.add(item));
        } catch (error) {
            if (isRateLimitError(error)) throw error;
            failures.push({ id: item.id, error });
        }
    }

    if (failures.length) {
        const ids = failures.map((failure) => failure.id).join(', ');
        throw new Error(`could not add ${failures.length} item(s) to frame ${frame.id}: ${ids}`, {
            cause: failures[0].error,
        });
    }
}

async function getFrame(frameId) {
    const frame = await run(() => board.getById(frameId));
    if (frame.type !== 'frame') {
        throw new Error(`item ${frameId} is a ${frame.type}, not a frame`);
    }
    return frame;
}

/**
 * Gives the frame a new rect without moving anything inside it.
 *
 * Miro keeps a child's offset from the frame's top-left corner, not its place
 * on the board: every change of x, y, width or height that moves the top-left
 * drags all children along. Seen on a real board - a holiday draw grew the
 * frame up and left for its bands, the calendar travelled up and left with it,
 * and the bands ended up underneath. So:
 *
 * - When the top-left stays where it is (growing or shrinking only to the right
 *   and down), the rect is written as is. That is the common case on a tick.
 * - Otherwise the children are taken out of the frame first, the rect is
 *   written, and they are put back. A child outside a frame keeps its board
 *   position, which is the whole point. They go out and back as whole groups -
 *   the calendar, a holiday block, a vacation import, the indicator - so this
 *   costs a handful of calls, not one per day cell; only items that are in no
 *   group (the holiday fallback anchors) move on their own.
 *
 * Putting them back is attempted even when the write failed, so a failure
 * leaves a frame of the wrong size rather than a calendar outside its frame.
 *
 * `children` is the frame's getChildren() result when the caller already has
 * it; otherwise it is read here, only when it is actually needed.
 */
async function writeRect(frame, rect, children = null) {
    const before = originOf(frame);
    const after = originOf(rect);
    const anchoredTopLeft = Math.abs(before.x - after.x) <= NUDGE && Math.abs(before.y - after.y) <= NUDGE;

    if (anchoredTopLeft) {
        await syncRect(frame, rect);
        return;
    }

    const units = await topLevelUnits(children ?? await runLevel3(() => frame.getChildren()));

    // Whatever went out comes back, whether the write - or a later detach -
    // failed: a frame of the wrong size is a cosmetic problem, a calendar left
    // outside its frame is not.
    const detached = [];
    let failure = null;
    try {
        for (const unit of units) {
            // Recorded before the call: a group that failed halfway through
            // its item-by-item fallback is partly out and must come back too.
            detached.push(unit);
            await detach(frame, unit);
        }
        await syncRect(frame, rect);
    } catch (error) {
        failure = error;
    }

    for (const unit of detached) {
        // A loose item is read again: the object from getChildren still names
        // this frame as its parent, and attach skips anything that does.
        const items = unit.group ? [] : [await run(() => board.getById(unit.item.id))];
        await attach(frame, { group: unit.group ?? null, items });
    }

    if (failure) throw failure;
}

// One write for all four values; see writeRect for why they cannot be written
// without care.
async function syncRect(frame, { x, y, width, height }) {
    frame.x = x;
    frame.y = y;
    frame.width = width;
    frame.height = height;
    await run(() => frame.sync());
}

/**
 * The frame's children as the units they move in: one entry per group, one per
 * ungrouped item. Connectors are no frame children of their own and follow
 * their endpoints.
 */
async function topLevelUnits(children) {
    const units = [];
    const seenGroups = new Set();

    for (const child of children) {
        if (child.type === 'connector') continue;

        if (!child.groupId) {
            units.push({ item: child });
            continue;
        }

        if (seenGroups.has(child.groupId)) continue;
        seenGroups.add(child.groupId);
        units.push({ group: await run(() => board.getById(child.groupId)) });
    }

    return units;
}

/**
 * Takes one unit out of the frame. A group goes in one call when Miro accepts
 * that - frame.add(group) is documented, frame.remove(group) is not - and item
 * by item otherwise.
 */
async function detach(frame, unit) {
    if (unit.item) {
        await run(() => frame.remove(unit.item));
        return;
    }

    try {
        await run(() => frame.remove(unit.group));
    } catch (error) {
        if (isRateLimitError(error)) throw error;

        console.warn(`Timeline Builder: frame ${frame.id} did not let go of group ${unit.group.id} at once, removing its items one by one.`, error);
        for (const item of await run(() => unit.group.getItems())) {
            if (item.type === 'connector' || item.parentId !== frame.id) continue;
            await run(() => frame.remove(item));
        }
    }
}
