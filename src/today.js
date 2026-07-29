import { board, run } from './board.js';
import { xOfColumn } from './calendar.js';
import { updateCalendar } from './anchors.js';
import { columnForToday } from './todayColumn.js';

const ACCENT = '#ff5722';

// Anything closer than this is the same position as far as anyone can see, and
// writing it again would only burn credits.
const NUDGE = 0.5;

/**
 * Brings the indicator of one calendar in line with today.
 *
 * Reads before it writes, on purpose: the headless iframe runs once per user,
 * so five open sessions mean five updaters. Comparing first makes the normal
 * case zero writes, and in a collision every updater writes the same value.
 * The state is idempotent rather than coordinated.
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

    try {
        const circle = await run(() => board.createShape({
            shape: 'circle',
            content: '<p>TODAY</p>',
            x,
            y: calendar.top - rowHeight,
            width: rowHeight,
            height: rowHeight,
            style: {
                fillColor: ACCENT,
                color: '#ffffff',
                fontFamily: 'open_sans',
                fontSize: Math.round(rowHeight / 4),
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
                strokeWidth: 2,
                strokeColor: ACCENT,
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
        } catch {
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
