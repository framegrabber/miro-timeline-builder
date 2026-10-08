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

    await writeRect(frame, rect);
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
    const frame = await getFrame(frameId);

    const singles = [];

    if (group) {
        try {
            await run(() => frame.add(group));
        } catch (error) {
            // A rate limit that survived run()'s retries would only get worse
            // if we answered it with one call per item - let the caller's next
            // flow try again instead.
            if (isRateLimitError(error)) throw error;

            console.warn(`Timeline Builder: frame ${frameId} did not take the group, adding its items one by one.`, error);
            singles.push(...await run(() => group.getItems()));
        }
    }

    singles.push(...items);

    const failures = [];
    for (const item of singles) {
        if (item.type === 'connector') continue;
        if (item.parentId === frameId) continue;

        try {
            await run(() => frame.add(item));
        } catch (error) {
            if (isRateLimitError(error)) throw error;
            failures.push({ id: item.id, error });
        }
    }

    if (failures.length) {
        const ids = failures.map((failure) => failure.id).join(', ');
        throw new Error(`could not add ${failures.length} item(s) to frame ${frameId}: ${ids}`, {
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

// One write for all four values. Writing x/y and width/height in separate syncs
// would leave the frame for a moment at a size and place that matches neither
// the old nor the new content, and cost a second call.
//
// This assumes Miro keeps every child at its board position when the frame is
// resized and moved - i.e. that it recalculates the children's relative x/y
// rather than dragging them along with the new top-left corner. That is
// unverified (Q1 growing, Q2 shrinking in
// docs/superpowers/notes/2026-10-08-frame-unverified.md). If it turns out wrong,
// growing a frame up or left would shift the whole calendar with it, and this
// is the one place to compensate.
async function writeRect(frame, { x, y, width, height }) {
    frame.x = x;
    frame.y = y;
    frame.width = width;
    frame.height = height;
    await run(() => frame.sync());
}
