// A name always produces the same pastel, on every run and every board.
//
// The hash is made unsigned before anything is derived from it. It used
// to be signed and therefore usually negative, which made every modulo
// below negative too: saturation came out at 61-70% and lightness at
// 71-80%, not the 70-80% and 80-90% the comments claimed, and the hue
// was negative and only worked because CSS wraps it.
function hashOf(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (Math.imul(hash, 31) + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
}

// Written out rather than fetched back from a canvas. Safari adds noise
// to getImageData as a fingerprinting defence, which is exactly the
// kind of thing that makes "deterministic" quietly stop being true.
export function hslToHex(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const lift = lightness - chroma / 2;

    const [r, g, b] =
        hue <  60 ? [chroma, second, 0] :
        hue < 120 ? [second, chroma, 0] :
        hue < 180 ? [0, chroma, second] :
        hue < 240 ? [0, second, chroma] :
        hue < 300 ? [second, 0, chroma] :
                    [chroma, 0, second];

    return '#' + [r, g, b]
        .map((channel) => Math.round((channel + lift) * 255).toString(16).padStart(2, '0'))
        .join('');
}

const GOLDEN_RATIO = 0.618033988749895;

// Derived from the name alone, deliberately - not from the employee's
// position in the roster.
//
// Hashing scatters, it does not distribute: with a handful of people
// some hues will land close together, and a six-person team really did
// come out with three pinks. Spreading them evenly over the sorted
// roster (i / n * 360) would fix that, but then everyone's colour
// shifts as soon as one person joins or leaves, and the same board
// redrawn a month later looks unrelated to the old one.
//
// Stability was chosen over even spread. Do not "improve" this into an
// index-based palette without deciding that trade-off again.
export function stringToColor(str) {
    const hash = hashOf(str);

    // Two alphabetically adjacent names hash to nearby numbers, and
    // nearby numbers would map to nearby hues. Taking the fractional
    // part of n x phi breaks that up: consecutive n land roughly 222
    // degrees apart, so "Meyer A" and "Meyer B" come out clearly
    // different rather than one shade off.
    const hue = ((hash * GOLDEN_RATIO) % 1) * 360;

    // Higher bits, so a shared hue does not imply a shared shade.
    const saturation = 0.70 + ((hash >>> 11) % 11) / 100;
    const lightness = 0.80 + ((hash >>> 21) % 11) / 100;

    return hslToHex(hue, saturation, lightness);
}
