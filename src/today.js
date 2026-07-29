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

async function createIndicator(calendar, x) {
    const { entry, rowHeight } = calendar;

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

    await updateCalendar(entry.calendarId, {
        indicator: {
            ...entry.indicator,
            circleId: circle.id,
            anchorId: anchor.id,
            connectorId: connector.id,
        },
    });
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
            // Someone deleted a piece of it. Forget the ids so the next tick
            // builds a fresh indicator.
            await updateCalendar(entry.calendarId, {
                indicator: { ...entry.indicator, circleId: null, anchorId: null, connectorId: null },
            });
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
