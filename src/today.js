import { board, run, isRateLimitError } from './board.js';
import { xOfColumn } from './calendar.js';
import { updateCalendar, findCalendars } from './anchors.js';
import { columnForToday, indicatorY, shouldMoveIndicatorY, anchorY, legacyAnchorY } from './indicatorGeometry.js';

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
    const diameter = calendar.rowHeight * DIAMETER_FACTOR;
    const y = indicatorY({
        top: calendar.top,
        rowHeight: calendar.rowHeight,
        diameter,
        reservedRows: entry.holidays?.reservedRows,
    });

    // What createIndicator would have written before placedY (and reservedRows)
    // existed. A legacy indicator - one with no placedY on record - has no other
    // way to know what its own y was last set to; this reconstructs it instead
    // of guessing, so moveIndicator can tell whether the holiday block actually
    // changed anything.
    const legacyY = indicatorY({
        top: calendar.top,
        rowHeight: calendar.rowHeight,
        diameter,
        reservedRows: 0,
    });

    // The lower end follows the content below the calendar, and only the
    // content: `legacyAnchor` is what createIndicator wrote before this
    // existed, so an anchor with no placedAnchorY on record is compared
    // against a fact instead of being written unconditionally - the same
    // reasoning as legacyY above, for the other end of the line.
    const anchorTarget = anchorY({
        bottom: calendar.bottom,
        rowHeight: calendar.rowHeight,
        padding: grid.padding,
        contentRows: entry.vacationRows,
    });
    const legacyAnchor = legacyAnchorY({ bottom: calendar.bottom, rowHeight: calendar.rowHeight });

    if (!entry.indicator.circleId) {
        await createIndicator(calendar, x, anchorTarget);
        return;
    }

    const wrote = await moveIndicator(entry, {
        x,
        circleY: y,
        legacyCircleY: legacyY,
        anchorTarget,
        legacyAnchor,
    });

    // Only worth a read when something actually moved: a pass that wrote
    // nothing cannot have revealed a detached line that the last pass missed.
    if (wrote) await verifyConnector(entry);
}

/**
 * The dotted line, and the only place its shape and style are defined.
 *
 * Both createIndicator and the repair path below create this connector, and a
 * repaired line that looks different from a fresh one would be worse than no
 * repair at all.
 */
function createDottedConnector(circleId, anchorId) {
    return run(() => board.createConnector({
        shape: 'straight',
        start: { item: circleId, snapTo: 'bottom' },
        end: { item: anchorId, snapTo: 'top' },
        style: {
            strokeStyle: 'dotted',
            strokeWidth: LINE_WIDTH,
            strokeColor: LINE_COLOR,
            startStrokeCap: 'none',
            endStrokeCap: 'none',
        },
    }));
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
async function createIndicator(calendar, x, anchorTarget) {
    const { entry, rowHeight } = calendar;
    const created = [];
    let circle, anchor, connector;

    // With the old fixed diameter (one rowHeight) the circle's centre sat at
    // `calendar.top - rowHeight`, which left exactly half a row of clearance
    // between the circle's bottom edge and the calendar. Deriving the centre
    // from the diameter, instead of hard-coding that offset, keeps that same
    // half-row gap for any diameter: the centre is always half a row above
    // the calendar top, minus half the circle's own height - and, when the
    // holiday block reserves rows above the calendar, further up by exactly
    // that much.
    const diameter = rowHeight * DIAMETER_FACTOR;
    const centerY = indicatorY({
        top: calendar.top,
        rowHeight,
        diameter,
        reservedRows: entry.holidays?.reservedRows,
    });

    try {
        circle = await run(() => board.createShape({
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
        anchor = await run(() => board.createShape({
            shape: 'rectangle',
            x,
            y: anchorTarget,
            width: 8,
            height: 8,
            style: { fillOpacity: 0, borderOpacity: 0, borderWidth: 0 },
        }));
        created.push(anchor);

        connector = await createDottedConnector(circle.id, anchor.id);
        created.push(connector);

        await updateCalendar(entry.calendarId, {
            indicator: {
                ...entry.indicator,
                circleId: circle.id,
                anchorId: anchor.id,
                connectorId: connector.id,
                placedY: centerY,
                placedAnchorY: anchorTarget,
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

    return { circleId: circle.id, anchorId: anchor.id, connectorId: connector.id };
}

/**
 * x always follows today; y follows the content, guarded.
 *
 * Writing x on every difference is right - the marker is supposed to track the
 * date. y is not: the user is meant to be able to drag the circle higher and
 * have it stay, which is why this function wrote x alone for as long as the
 * circle had a fixed height above the calendar.
 *
 * Now that the holiday block can push it up, y has to move sometimes. The
 * guard is `placedY` - the y *we* last wrote - rather than the circle's actual
 * position. Comparing against the actual position would undo a hand-drag on
 * the very next tick; comparing against our own intent means a tick that wants
 * the same y as last time does not touch y at all, and only a changed holiday
 * block moves the circle. That is the moment the user expects it to jump.
 *
 * The lower anchor keeps its own y throughout: dragging it down is how the
 * line is made longer, and nothing here may take that back.
 *
 * The anchor is written before the circle. Neither write is atomic and there is
 * no transaction to put around them, so the question is only which half-done
 * state is the better one to be left in. Circle first leaves the circle on
 * today with the line's lower end behind - which reads as "the indicator is
 * broken" and is exactly the report in issue #7. Anchor first leaves the line
 * long and the circle on yesterday, which reads as "it has not updated yet"
 * and heals on the next pass just the same.
 *
 * Returns whether anything was written, so the caller knows when it is worth
 * spending a read on checking the connector.
 */
async function moveIndicator(entry, targets) {
    const moveCircleY = shouldMoveIndicatorY(targets.circleY, entry.indicator.placedY, targets.legacyCircleY, NUDGE);
    const moveAnchorY = shouldMoveIndicatorY(targets.anchorTarget, entry.indicator.placedAnchorY, targets.legacyAnchor, NUDGE);

    const items = [
        { id: entry.indicator.anchorId, y: targets.anchorTarget, wantsY: moveAnchorY },
        { id: entry.indicator.circleId, y: targets.circleY, wantsY: moveCircleY },
    ];

    let wrote = false;

    for (const { id, y, wantsY } of items) {
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
                return wrote;
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
            return wrote;
        }

        const wantsX = Math.abs(item.x - targets.x) >= NUDGE;

        if (!wantsX && !wantsY) continue;

        if (wantsX) item.x = targets.x;
        if (wantsY) item.y = y;
        await run(() => item.sync());
        wrote = true;
    }

    // Only the field that actually moved is recorded. Writing both every time
    // would quietly promote the *other* end's target to "we wrote this" - and
    // for an indicator that predates these fields, that would destroy the
    // legacy fallback the guard above depends on, so a hand-positioned circle
    // would never be recognised as hand-positioned again.
    if (moveCircleY || moveAnchorY) {
        const indicator = { ...entry.indicator };
        if (moveCircleY) indicator.placedY = targets.circleY;
        if (moveAnchorY) indicator.placedAnchorY = targets.anchorTarget;
        await updateCalendar(entry.calendarId, { indicator });
    }

    return wrote;
}

/**
 * Confirms the dotted line still hangs on the circle and the anchor.
 *
 * Miro lets a connector be detached by hand, and nothing about that shows up in
 * the two shapes: a pass writes their x and y perfectly and the line stays
 * where it was. That is the failure in issue #7, and the only way to notice it
 * is to look at the connector itself.
 *
 * Only the connector is ever replaced. The circle and the anchor keep their ids
 * and their positions, so a hand-drag survives and createIndicator's
 * documented duplication race is never entered.
 *
 * Returns the connector id that is now on record - the old one when nothing was
 * wrong, a new one after a repair, or null when the check could not be made and
 * the caller should not conclude anything.
 */
async function verifyConnector(entry) {
    const { connectorId, circleId, anchorId } = entry.indicator;
    if (!connectorId) return null;

    let connector;
    try {
        connector = await run(() => board.getById(connectorId));
    } catch (error) {
        if (isRateLimitError(error)) {
            console.warn(`Timeline Builder: rate limited while checking the TODAY connector for calendar ${entry.calendarId}, skipping the check.`);
            return null;
        }
        // Any other error means the connector is genuinely gone - a deleted
        // line, or an undo that took only it. The circle and anchor are still
        // there, so drawing a new line is all that is missing.
        connector = null;
    }

    // The endpoint shape is the one thing here the SDK reference does not spell
    // out (see the note in docs/superpowers/notes/). If it is not what we
    // expect, say so once and change nothing: recreating a healthy connector on
    // every pass would be worse than never repairing a broken one.
    if (connector && !connector.start && !connector.end) {
        console.warn('Timeline Builder: cannot read the TODAY connector\'s endpoints, leaving it alone.');
        return connectorId;
    }

    const attached = connector
        && connector.start?.item === circleId
        && connector.end?.item === anchorId;

    if (attached) return connectorId;

    return reconnect(entry, connector);
}

/** Replaces the dotted line and records the new id. Best effort about the old one. */
async function reconnect(entry, staleConnector) {
    if (staleConnector) {
        try {
            await run(() => board.remove(staleConnector));
        } catch {
            // A line we could not remove is a visible orphan, which is ugly but
            // harmless - and stopping here would leave the indicator with no
            // line at all, which is the thing being repaired.
        }
    }

    const connector = await createDottedConnector(entry.indicator.circleId, entry.indicator.anchorId);

    await updateCalendar(entry.calendarId, {
        indicator: { ...entry.indicator, connectorId: connector.id },
    });

    console.warn(`Timeline Builder: the TODAY connector for calendar ${entry.calendarId} was detached or gone and has been redrawn.`);

    return connector.id;
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
        indicator: {
            ...entry.indicator,
            circleId: null,
            anchorId: null,
            connectorId: null,
            placedY: null,
            placedAnchorY: null,
        },
    });
}
