import { board, run, isRateLimitError } from './board.js';
import { gridFrom, totalWorkingDays } from './calendar.js';

const APP_DATA_KEY = 'calendars';
const METADATA_KEY = 'timelineBuilder';

/**
 * Makes a freshly drawn calendar findable again.
 *
 * Three cells get a metadata tag; their ids plus the year go into AppData.
 * Nothing derived is stored - the grid is measured back off the board in
 * findCalendars(), which is why moving or scaling the calendar cannot break it.
 *
 * AppData is only an index. If it is lost, everything could be rebuilt from a
 * metadata scan; the other way round it could not. That is why the tags sit on
 * the shapes and not only in AppData.
 */
export async function tagCalendar({ drawnRows, rows, year, indicatorEnabled = true }) {
    const dayRowIndex = rows.findIndex((row) => row.position === 'drawDays');
    const dayShapes = drawnRows[dayRowIndex];

    const shapes = {
        firstDay: dayShapes[0],
        lastDay: dayShapes[dayShapes.length - 1],
        topLeft: drawnRows[0][0],
    };

    // The first day cell's own id. Nothing has to be generated, and it is
    // unique by construction.
    const calendarId = shapes.firstDay.id;

    for (const [role, shape] of Object.entries(shapes)) {
        await run(() => shape.setMetadata(METADATA_KEY, { role, calendarId, year }));
    }

    const calendars = await readCalendars();
    calendars.push({
        calendarId,
        year,
        anchors: {
            firstDay: shapes.firstDay.id,
            lastDay: shapes.lastDay.id,
            topLeft: shapes.topLeft.id,
        },
        indicator: { enabled: indicatorEnabled, circleId: null, anchorId: null, connectorId: null },
        vacationItemIds: [],
    });
    await writeCalendars(calendars);

    return calendarId;
}

/**
 * Every stored calendar, resolved to a measured grid.
 *
 * These are three different outcomes, and they get different treatment:
 * - Anchors gone (calendar deleted, undo): the AppData entry is dropped, so a
 *   board heals itself instead of collecting dead entries.
 * - Anchors present but the measurement is implausible (a day cell dragged out
 *   of the group): the entry is kept as-is and simply skipped for this call.
 *   The anchors and their metadata tags are still there, so dragging the cell
 *   back makes the calendar findable again - dropping the entry here would
 *   permanently defeat that.
 * - getById itself failed on a rate limit that outlasted run()'s retries: the
 *   anchor's real state is unknown, so this is treated like 'implausible', not
 *   like 'missing' - the entry is kept and only this call's draw is skipped.
 *   Pruning here would be permanent over a failure that is only temporary; the
 *   tags stay on the shapes but tagCalendar only runs at draw time, so a
 *   wrongly dropped entry could never be recovered by re-finding it.
 * All three are reported, per the design's error-handling table.
 */
export async function findCalendars() {
    const stored = await readCalendars();
    const alive = [];
    const resolved = [];

    for (const entry of stored) {
        const { calendar, reason } = await measure(entry);

        if (reason === 'missing') {
            console.warn(`Timeline Builder: anchors missing for calendar ${entry.calendarId}, dropping entry.`);
            continue;
        }

        if (reason === 'rate-limited') {
            console.warn(`Timeline Builder: rate limited while resolving anchors for calendar ${entry.calendarId}, keeping entry and skipping.`);
            alive.push(entry);
            continue;
        }

        if (reason === 'implausible') {
            console.warn(`Timeline Builder: measurement implausible for calendar ${entry.calendarId}, skipping.`);
            alive.push(entry);
            continue;
        }

        alive.push(entry);
        resolved.push(calendar);
    }

    if (alive.length !== stored.length) await writeCalendars(alive);

    return resolved;
}

export async function updateCalendar(calendarId, changes) {
    const calendars = await readCalendars();
    await writeCalendars(calendars.map(
        (entry) => (entry.calendarId === calendarId ? { ...entry, ...changes } : entry)
    ));
}

/**
 * The AppData race this module does not close.
 *
 * tagCalendar, updateCalendar and findCalendars' self-pruning (the
 * `writeCalendars(alive)` above) all do the same thing: read the whole
 * `calendars` blob, compute a new array from it, and write the whole blob
 * back - two separate board calls, no compare-and-swap between them. AppData
 * is one board-wide value shared by every viewer's session, not per-session
 * state.
 *
 * The headless updater (index.js) calls tick() -> findCalendars() the moment
 * a board is opened and again every 10 minutes for as long as it stays open,
 * so every open session is a potential writer at any time. If one user
 * finishes tagCalendar's write for a freshly drawn calendar in the same
 * window as another session's tick reads the old list and writes it back
 * (pruning, or an indicator/import update via updateCalendar), the later
 * write wins in full and silently overwrites the earlier one - there is no
 * merge. Because there is also no board-wide scan to reconstruct AppData from
 * (see tagCalendar's doc comment), a calendar entry lost this way is not
 * recoverable; that calendar stays unaddressable until it is redrawn.
 *
 * Not fixed here - see the design doc's accepted costs for why.
 */
export async function readCalendars() {
    return (await run(() => board.getAppData(APP_DATA_KEY))) ?? [];
}

async function writeCalendars(calendars) {
    await run(() => board.setAppData(APP_DATA_KEY, calendars));
}

/**
 * Resolves one entry's anchors to a measured grid.
 *
 * Returns a reason alongside the calendar so callers can tell an unresolvable
 * anchor (the entry should be forgotten) apart from a transient failure or an
 * implausible measurement (the entry stays, only the draw is skipped).
 */
async function measure(entry) {
    let firstDay;
    let lastDay;
    let topLeft;

    try {
        // getById throws when the id is gone, which is exactly how a deleted
        // calendar announces itself. But run() also retries rate-limit errors
        // with backoff and re-throws once retries are exhausted - that is not
        // the anchor being gone, it is the board call never having completed,
        // so it must not be classified the same as a genuinely missing anchor.
        [firstDay, lastDay, topLeft] = await Promise.all([
            run(() => board.getById(entry.anchors.firstDay)),
            run(() => board.getById(entry.anchors.lastDay)),
            run(() => board.getById(entry.anchors.topLeft)),
        ]);
    } catch (error) {
        if (isRateLimitError(error)) return { calendar: null, reason: 'rate-limited' };
        return { calendar: null, reason: 'missing' };
    }

    const grid = gridFrom({
        firstCenterX: firstDay.x,
        lastCenterX: lastDay.x,
        cellWidth: firstDay.width,
        columns: totalWorkingDays(entry.year),
    });
    if (!grid) return { calendar: null, reason: 'implausible' };

    return {
        calendar: {
            entry,
            year: entry.year,
            grid,
            rowHeight: firstDay.height,
            top: topLeft.y - topLeft.height / 2,
            bottom: firstDay.y + firstDay.height / 2,
        },
        reason: null,
    };
}
