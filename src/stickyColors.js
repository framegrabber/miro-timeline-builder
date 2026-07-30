/**
 * The two greens a holiday is drawn in, and the hex that goes with each.
 *
 * Sticky notes take only Miro's named palette, shapes take any hex - so the
 * day cell has to be told, in hex, what Miro renders the sticky as. The Web
 * SDK reports only the name back, never the colour, so these hex values cannot
 * be read out of the SDK at all.
 *
 * UNVERIFIED. They come from Miro's community colour table rather than from a
 * real board (see docs/superpowers/notes/2026-07-30-sticky-colours-unverified.md).
 * `dark_green` is the true green of the design mock-up; `green` in Miro's
 * naming is an olive that does not match it. If the cell and its sticky look
 * like two different colours on the board, this file is the only place to fix,
 * and nothing else has to change.
 */
export const HOLIDAY_COLORS = {
    // Applies in every federal state - the stronger of the two.
    nationwide: { sticky: 'dark_green', cell: '#93D275' },
    // Applies in some states only, or in one city.
    regional: { sticky: 'light_green', cell: '#D5F692' },
};
