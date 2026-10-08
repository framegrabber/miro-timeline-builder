// Pure geometry for the frame that holds a generated calendar. Kept free of
// `board.js` on purpose: that module reads `window` at load and would crash
// under Node, and everything here is plain arithmetic worth testing directly.
//
// Convention: internally we always think in board coordinates. The SDK reports
// a child's x/y relative to its parent frame's top-left corner, so conversion
// happens only at the SDK boundary, via `toBoard` / `toParent`.

import { describeRange } from './calendar.js';

// Margin around the content, in rowHeights. One row keeps the frame border
// visibly off the calendar without wasting board space.
export const FRAME_MARGIN_ROWS = 1;

// The SDK refuses frames smaller than this on either axis.
export const MIN_FRAME_SIZE = 100;

// Origin used for items without a parent frame: their coordinates already are
// board coordinates, so converting with this origin is the identity.
export const BOARD_ORIGIN = Object.freeze({ x: 0, y: 0 });

/** Top-left corner of a frame ({x, y, width, height}, centre-based) in board coordinates. */
export function originOf(frame) {
    return { x: frame.x - frame.width / 2, y: frame.y - frame.height / 2 };
}

/** Child position -> board, and back. */
export function toBoard({ x, y }, origin) {
    return { x: x + origin.x, y: y + origin.y };
}

export function toParent({ x, y }, origin) {
    return { x: x - origin.x, y: y - origin.y };
}

/** Centre-based SDK rect -> edges; union; containment. */
export function edgesOf({ x, y, width, height }) {
    return {
        left: x - width / 2,
        top: y - height / 2,
        right: x + width / 2,
        bottom: y + height / 2,
    };
}

// `null` for an empty list rather than an infinite box: callers must decide
// what "no content" means instead of fitting a frame around nothing.
export function unionEdges(edgesList) {
    if (edgesList.length === 0) return null;
    return edgesList.reduce((acc, e) => ({
        left: Math.min(acc.left, e.left),
        top: Math.min(acc.top, e.top),
        right: Math.max(acc.right, e.right),
        bottom: Math.max(acc.bottom, e.bottom),
    }));
}

// Equal edges count as inside, so content fitted exactly by `frameRectFor`
// never looks like it needs growing again.
export function containsEdges(outer, inner) {
    return inner.left >= outer.left
        && inner.top >= outer.top
        && inner.right <= outer.right
        && inner.bottom <= outer.bottom;
}

export function padEdges(edges, margin) {
    return {
        left: edges.left - margin,
        top: edges.top - margin,
        right: edges.right + margin,
        bottom: edges.bottom + margin,
    };
}

/** Frame rect around the union of edgesList plus margin, at least MIN_FRAME_SIZE per axis, centred on the content. */
export function frameRectFor(edgesList, margin) {
    const union = unionEdges(edgesList);
    if (union === null) throw new Error('frameRectFor needs at least one edge set');
    const padded = padEdges(union, margin);
    // Centre on the content, then enforce the SDK minimum symmetrically, so
    // a tiny calendar still sits in the middle of its frame.
    return {
        x: (padded.left + padded.right) / 2,
        y: (padded.top + padded.bottom) / 2,
        width: Math.max(MIN_FRAME_SIZE, padded.right - padded.left),
        height: Math.max(MIN_FRAME_SIZE, padded.bottom - padded.top),
    };
}

// Same wording as the panel uses for the range, so the frame title matches
// what the user picked.
export function frameTitle(range) {
    return describeRange(range);
}
