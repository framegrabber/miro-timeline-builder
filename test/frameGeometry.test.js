import test from 'node:test';
import assert from 'node:assert/strict';

import {
    originOf,
    toBoard,
    toParent,
    unionEdges,
    containsEdges,
    frameRectFor,
    MIN_FRAME_SIZE,
} from '../src/frameGeometry.js';

test('toParent undoes toBoard', () => {
    const origin = { x: -340, y: 125.5 };
    const p = { x: 12, y: -7.25 };
    assert.deepEqual(toParent(toBoard(p, origin), origin), p);
});

test('originOf is the top-left corner of a centre-based frame', () => {
    assert.deepEqual(originOf({ x: 0, y: 0, width: 200, height: 100 }), { x: -100, y: -50 });
});

test('frameRectFor adds the margin on every side and centres on the union', () => {
    const rect = frameRectFor([
        { left: 0, top: 0, right: 300, bottom: 100 },
        { left: 100, top: 50, right: 500, bottom: 200 },
    ], 20);
    assert.deepEqual(rect, { x: 250, y: 100, width: 540, height: 240 });
});

test('frameRectFor enforces the SDK minimum and stays centred', () => {
    const rect = frameRectFor([{ left: 10, top: 20, right: 30, bottom: 60 }], 0);
    assert.deepEqual(rect, { x: 20, y: 40, width: MIN_FRAME_SIZE, height: MIN_FRAME_SIZE });
});

test('containsEdges counts an equal edge as inside and anything beyond as outside', () => {
    const outer = { left: 0, top: 0, right: 100, bottom: 100 };
    assert.equal(containsEdges(outer, { ...outer }), true);
    assert.equal(containsEdges(outer, { ...outer, left: -0.01 }), false);
    assert.equal(containsEdges(outer, { ...outer, top: -0.01 }), false);
    assert.equal(containsEdges(outer, { ...outer, right: 100.01 }), false);
    assert.equal(containsEdges(outer, { ...outer, bottom: 100.01 }), false);
});

test('unionEdges of an empty list is null', () => {
    assert.equal(unionEdges([]), null);
});
