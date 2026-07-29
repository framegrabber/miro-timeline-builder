import { board, run, isRateLimitError } from './board.js';
import { xOfColumn } from './calendar.js';
import { updateCalendar, findCalendars } from './anchors.js';
import { columnForToday } from './todayColumn.js';

const CIRCLE_FILL = '#d81b60';
const LINE_COLOR = '#000000';
const LINE_WIDTH = 6;

// Fixed, unlike the diameter above, which scales with the calendar. The label
// only has to be readable; letting it grow with the calendar made it dominate
// the circle on a full-size board.
const LABEL_SIZE = 24;

// The one number to change for the circle's size. Diameter is a multiple of
// the calendar's measured rowHeight rather than a fixed pixel value, so it
// keeps scaling with whatever the calendar was drawn at.
const DIAMETER_FACTOR = 1.6;

// Anything closer than this is the same position as far as anyone can see, and
// writing it again would only burn credits.
const NUDGE = 0.5;

/**
 * Brings the indicator of one calendar in line with today.
 *
 * Reads before it writes, on purpose - but that guarantee only covers the move
 * path. moveIndicator compares the measured x against the wanted one and only
 * writes on a real difference, so five open sessions (one updater each, per
 * the headless iframe) converge on the same value with the normal case being
 * zero writes. createIndicator has no such guard: two sessions opening a board
 * whose indicator does not exist yet can both see `circleId` missing, both
 * pass the check above, and both create a full triple. That race is accepted,
 * not fixed - see the design doc's accepted costs - because closing it would
 * need a compare-and-swap that AppData does not offer.
 */
export async function syncIndicator(calendar, today) {
    const { entry, grid } = calendar;
    const column = columnForToday(calendar.year, today);
    const wanted = entry.indicator.enabled && column !== null;

    if (!wanted) {
        if (entry.indicator.circleId) await removeIndicator(entry);
        return;
    }

    const x = xOfColumn(grid, column) + grid.shapeWidth / 2;

    if (!entry.indicator.circleId) {
        await createIndicator(calendar, x);
        return;
    }

    await moveIndicator(entry, x);
}

/**
 * Creates the circle, the anchor and the connector, then records all three in
 * AppData in one write - or none of them, if anything along the way fails.
 *
 * This is deliberately all-or-nothing. The updater ticks every 10 minutes in
 * the headless iframe of every open board session, and it decides whether an
 * indicator already exists purely by checking `circleId` in AppData. A
 * half-created indicator (say the circle and anchor exist but the connector
 * failed) would still read as "missing" on the next tick, so createIndicator
 * would run again and stack a second circle/anchor pair on top of the first -
 * and again on the tick after that, for as long as the failure persists. The
 * anchor shape has no fill and no border, so these orphans would be almost
 * impossible to notice or clean up by hand. Rolling back whatever this
 * attempt created, before the error propagates, keeps a failed attempt from
 * ever being distinguishable - on the board or in AppData - from an attempt
 * that never started.
 */
async function createIndicator(calendar, x) {
    const { entry, rowHeight } = calendar;
    const created = [];

    // With the old fixed diameter (one rowHeight) the circle's centre sat at
    // `calendar.top - rowHeight`, which left exactly half a row of clearance
    // between the circle's bottom edge and the calendar. Deriving the centre
    // from the diameter, instead of hard-coding that offset, keeps that same
    // half-row gap for any diameter: the centre is always half a row above
    // the calendar top, minus half the circle's own height.
    const diameter = rowHeight * DIAMETER_FACTOR;
    const centerY = calendar.top - rowHeight / 2 - diameter / 2;

    try {
        const circle = await run(() => board.createShape({
            shape: 'circle',
            content: '<p><b>TODAY</b></p>',
            x,
            y: centerY,
            width: diameter,
            height: diameter,
            style: {
                fillColor: CIRCLE_FILL,
                color: '#ffffff',
                fontFamily: 'open_sans',
                fontSize: LABEL_SIZE,
                borderWidth: 0,
            },
        }));
        created.push(circle);

        // Miro refuses loose connectors, so the dotted line needs something to end
        // on. This is that something: present, invisible, and draggable.
        const anchor = await run(() => board.createShape({
            shape: 'rectangle',
            x,
            y: calendar.bottom + 3 * rowHeight,
            width: 8,
            height: 8,
            style: { fillOpacity: 0, borderOpacity: 0, borderWidth: 0 },
        }));
        created.push(anchor);

        const connector = await run(() => board.createConnector({
            shape: 'straight',
            start: { item: circle.id, snapTo: 'bottom' },
            end: { item: anchor.id, snapTo: 'top' },
            style: {
                strokeStyle: 'dotted',
                strokeWidth: LINE_WIDTH,
                strokeColor: LINE_COLOR,
                startStrokeCap: 'none',
                endStrokeCap: 'none',
            },
        }));
        created.push(connector);

        await updateCalendar(entry.calendarId, {
            indicator: {
                ...entry.indicator,
                circleId: circle.id,
                anchorId: anchor.id,
                connectorId: connector.id,
            },
        });

        // Grouping happens last, and is guarded on its own, on purpose. It runs
        // only after the AppData write above, so a failure here can never cost
        // the ids just recorded or trigger the rollback below - the three items
        // are already a fully working indicator without it.
        //
        // The reason for the caution: a Group has no writable x/y, and the Web
        // SDK reference does not say whether a member's x can still be set and
        // sync()'d once it is inside one - which is exactly what moveIndicator
        // does on every tick. Verified on a real board: moving the calendar
        // sideways, the grouped indicator still follows to the new column. So
        // it works, but it works undocumented. The guard stays, because an
        // indicator that silently stopped tracking today would be worse than an
        // ungrouped one, and the group is only a convenience for the mouse.
        try {
            await run(() => board.group({ items: [circle, anchor, connector] }));
        } catch (error) {
            console.warn(`Timeline Builder: could not group the TODAY indicator for calendar ${entry.calendarId}`, error);
        }
    } catch (error) {
        // Undo whatever this attempt managed to create, oldest first. Each
        // removal is isolated and best-effort: one failing to remove must not
        // stop the others from being tried, and a cleanup failure must never
        // replace or hide the original error below.
        for (const item of created) {
            try {
                await run(() => board.remove(item));
            } catch {
                // If removal also fails, this item is genuinely orphaned. That
                // residual risk is accepted rather than designed away - a
                // decoration does not warrant a reconciliation mechanism to
                // hunt down doubly-failed cleanups.
            }
        }

        console.error(`Timeline Builder: failed to create the TODAY indicator for calendar ${entry.calendarId}, rolled back`, error);
        throw error;
    }
}

/**
 * Only x is ever written, never y. Drag the lower anchor down and the line
 * stays longer; push the circle up and it stays up. That is the whole length
 * and height adjustment, and it has to work this way: width and height are
 * read-only on shapes, so a rectangle used as a line could not be stretched at
 * all without deleting and recreating it.
 */
async function moveIndicator(entry, x) {
    const ids = [entry.indicator.circleId, entry.indicator.anchorId];

    for (const id of ids) {
        let item;
        try {
            item = await run(() => board.getById(id));
        } catch (error) {
            // getById throwing after run() exhausts its retries on a rate
            // limit is not the same as the item being gone - the call never
            // completed, so the item's real state is unknown. Treating it as
            // gone here would call removeIndicator, whose own board.remove
            // calls would hit the same limit and be swallowed by its
            // best-effort catches, so circleId/anchorId/connectorId would be
            // cleared in AppData while the shapes stayed on the board. The
            // next tick would then see no indicator at all and draw a second
            // circle, anchor and connector beside the orphaned first set, and
            // it would silently discard any manual repositioning the user did
            // - the documented way to adjust the indicator's height and the
            // connector's length. So a rate limit must leave the ids
            // untouched and just skip this pass, exactly like anchors.js's
            // measure() does for the same failure.
            if (isRateLimitError(error)) {
                console.warn(`Timeline Builder: rate limited while moving the TODAY indicator for calendar ${entry.calendarId}, keeping it and skipping this pass.`);
                return;
            }

            // Someone deleted a piece of it - but not necessarily all of it.
            // Simply forgetting the ids here would abandon whatever survives
            // (the circle, say, if only the anchor was deleted) as an orphan
            // that AppData no longer points to and the next tick cannot see,
            // so createIndicator would draw a second circle/anchor/connector
            // right beside it. The anchor shape has no fill and no border, so
            // that orphan could never be found or cleaned up by hand.
            // removeIndicator already tears down all three ids and tolerates
            // each one being gone, which is exactly what a broken indicator
            // needs, so reuse it instead of writing a second teardown.
            await removeIndicator(entry);
            return;
        }

        if (Math.abs(item.x - x) < NUDGE) continue;

        item.x = x;
        await run(() => item.sync());
    }
}

/**
 * Brings every calendar's indicator up to date in one pass.
 *
 * Never throws. This runs in every board viewer's session (the headless
 * updater in index.js) and, since drawing a calendar heals indicators too,
 * from the panel's own iframe right after a draw - one broken calendar entry
 * must not take somebody's board down with it, nor cost the calendar that was
 * just drawn.
 */
export async function updateIndicators(today) {
    let calendars;
    try {
        calendars = await findCalendars();
    } catch (error) {
        // Nothing to iterate, so this is one failure for the whole run.
        console.error('Timeline Builder: could not update the TODAY indicator', error);
        return;
    }

    for (const calendar of calendars) {
        try {
            await syncIndicator(calendar, today);
        } catch (error) {
            // Isolated per calendar: if this one fails deterministically (a style
            // value Miro rejects, say), it must not starve every other calendar on
            // the board of its update, tick after tick, forever.
            console.error(`Timeline Builder: failed to update the TODAY indicator for calendar ${calendar.entry.calendarId}`, error);
        }
    }
}

async function removeIndicator(entry) {
    const ids = [entry.indicator.connectorId, entry.indicator.circleId, entry.indicator.anchorId];

    for (const id of ids) {
        if (!id) continue;
        try {
            const item = await run(() => board.getById(id));
            await run(() => board.remove(item));
        } catch {
            // Already gone. Nothing to do.
        }
    }

    await updateCalendar(entry.calendarId, {
        indicator: { ...entry.indicator, circleId: null, anchorId: null, connectorId: null },
    });
}
