import test from 'node:test';
import assert from 'node:assert/strict';

import { hslToHex, stringToColor } from '../src/colors.js';

const NAMES = ['Meyer, Anna', 'Meyer, Bernd', 'Schmidt, Clara', 'Ali, Dilan', 'Ötztürk, Emre', ''];

test('a name always produces the same colour', () => {
    for (const name of NAMES) {
        assert.equal(stringToColor(name), stringToColor(name));
    }
    assert.match(stringToColor('Meyer, Anna'), /^#[0-9a-f]{6}$/);
});

// The hash used to be signed and therefore usually negative, which made every
// modulo below it negative too and pushed saturation and lightness a full ten
// points under the documented range. This is the test that would have caught it.
test('every colour lands inside the documented pastel range', () => {
    for (const name of NAMES) {
        const { s, l } = toHsl(stringToColor(name));
        assert.ok(s >= 0.69 && s <= 0.81, `${name}: saturation ${s}`);
        assert.ok(l >= 0.79 && l <= 0.91, `${name}: lightness ${l}`);
    }
});

test('alphabetically adjacent names do not come out as the same shade', () => {
    const a = toHsl(stringToColor('Meyer, Anna')).h;
    const b = toHsl(stringToColor('Meyer, Bernd')).h;
    const apart = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    assert.ok(apart > 20, `only ${apart} degrees apart`);
});

// hslToHex was written out by hand rather than fetched back from a canvas, so
// it needs checking against maths that came from somewhere else. This is the
// textbook hue2rgb formulation, over the whole space the app can produce.
test('hslToHex agrees with an independent HSL conversion everywhere', () => {
    let worst = 0;

    for (let h = 0; h < 360; h += 1) {
        for (let s = 60; s <= 90; s += 5) {
            for (let l = 70; l <= 95; l += 5) {
                const mine = hslToHex(h, s / 100, l / 100);
                const theirs = referenceHslToHex(h, s / 100, l / 100);

                for (const i of [1, 3, 5]) {
                    worst = Math.max(worst, Math.abs(
                        parseInt(mine.slice(i, i + 2), 16) - parseInt(theirs.slice(i, i + 2), 16)
                    ));
                }
            }
        }
    }

    assert.ok(worst <= 1, `channels differ by up to ${worst}, which is more than rounding`);
});

// --- independent ground truth ------------------------------------------------
// Deliberately not the implementation's own maths run backwards.

function referenceHslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h / 360;

    return '#' + [hue2rgb(p, q, hk + 1 / 3), hue2rgb(p, q, hk), hue2rgb(p, q, hk - 1 / 3)]
        .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
        .join('');
}

function toHsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;

    if (d === 0) return { h: 0, s: 0, l };

    const s = d / (1 - Math.abs(2 * l - 1));
    const h =
        max === r ? 60 * (((g - b) / d) % 6) :
        max === g ? 60 * ((b - r) / d + 2) :
                    60 * ((r - g) / d + 4);

    return { h: (h + 360) % 360, s, l };
}
