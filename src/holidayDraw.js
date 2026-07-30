import { board, run, isRateLimitError } from './board.js';
import { updateCalendar, readCalendars } from './anchors.js';
import { xOfColumn, widthOfColumns, dayBlocks } from './calendar.js';
import { dayColor } from './colors.js';
import { layoutBlock, offsetOverlapping } from './holidays.js';
import { HOLIDAY_COLORS } from './stickyColors.js';

const LINE_COLOR = '#000000';
const LINE_WIDTH = 1;

// Anchor for the fallback path below: present, invisible, draggable - the same
// trick today.js uses to give its dotted line something to end on.
const ANCHOR_SIZE = 8;

function colorsFor(sticky) {
    return sticky.nationwide ? HOLIDAY_COLORS.nationwide : HOLIDAY_COLORS.regional;
}

function connect(fromId, toId) {
    return run(() => board.createConnector({
        shape: 'straight',
        start: { item: fromId, snapTo: 'bottom' },
        end: { item: toId, snapTo: 'top' },
        style: {
            strokeStyle: 'normal',
            strokeWidth: LINE_WIDTH,
            strokeColor: LINE_COLOR,
            startStrokeCap: 'none',
            endStrokeCap: 'arrow',
        },
    }));
}

/**
 * Escapes the handful of characters that are significant in HTML.
 *
 * This is about rendering correctly in Miro's rich-text renderer - an
 * unescaped "&" or "<" in a holiday name breaks the markup the sticky or band
 * is built from - not about XSS in this app's own DOM. Unlike the SAP export
 * import.js accepts unescaped from the user themselves, holiday names come
 * from a third-party API over the network, so they get escaped here.
 */
function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/** The stored holiday bookkeeping for one calendar, read fresh, never from the resolved entry's snapshot. */
async function currentHolidays(calendarId) {
    const entries = await readCalendars();
    return entries.find((entry) => entry.calendarId === calendarId)?.holidays ?? {};
}

/**
 * Merges into the stored holiday bookkeeping instead of replacing it.
 *
 * updateCalendar merges at the top level only, so handing it a `holidays`
 * object replaces the whole thing. Reading first and spreading here is what
 * keeps one writer from erasing another's keys - the Bundesland selection the
 * panel stores, or ids that removeHolidays kept because it could not confirm
 * they were gone.
 */
export async function recordHolidays(calendarId, changes) {
    const current = await currentHolidays(calendarId);
    await updateCalendar(calendarId, { holidays: { ...current, ...changes } });
}

/**
 * Paints the holiday block onto one calendar.
 *
 * Order matters. The day cells are repainted first, because they are the
 * connector targets and because they are the one part that cannot be recovered
 * from an id list if this throws halfway - so the columns are recorded before
 * anything else is created. Everything after that is a new item whose id goes
 * into `created`; this function itself writes that list to AppData, on both
 * the success and the failure path, merging it on top of whatever bookkeeping
 * this calendar already had - a caller that wants to add its own key (the
 * Bundesland selection, say) does so afterwards with recordHolidays, not by
 * replacing what was just written.
 */
export async function drawHolidays(calendar, cells, { stickies, rows }) {
    const previous = await currentHolidays(calendar.entry.calendarId);
    const carriedIds = previous.itemIds ?? [];
    // A carried column is a cell still painted from a removal that could not
    // confirm it restored (removeHolidays' stillPainted). Dropping it here,
    // the same way carriedIds must not be dropped, would strand that cell
    // with no handle: a repainted cell has no id, only its column.
    const carriedColumns = previous.markedColumns ?? [];

    const { grid, rowHeight, top } = calendar;
    const created = [];
    const anchors = [];
    const markedColumns = [];

    const layout = layoutBlock({
        top,
        rowHeight,
        gap: grid.padding,
        bandCount: rows.length,
        stickyCount: stickies.length,
    });

    const centerXof = (column) => xOfColumn(grid, column) + grid.shapeWidth / 2;
    const placed = offsetOverlapping(stickies, { centerXof, stickySize: layout.stickySize });

    // Assigned once the creation loops below finish and their own bookkeeping
    // write succeeds; grouping (after the try/catch) reads it back to return.
    let bookkeeping;

    try {
        // 1. The day cells. Two holidays can share a working day - 1 May 2008
        //    was both Tag der Arbeit and Christi Himmelfahrt - so this dedupes
        //    by column first and lets nationwide win over regional when both
        //    land on the same day, painting and recording each column once.
        //    Both stickies are still drawn in step 3; only the cell is shared.
        const stickiesByColumn = new Map();
        for (const sticky of placed) {
            const existing = stickiesByColumn.get(sticky.column);
            if (!existing || (!existing.nationwide && sticky.nationwide)) {
                stickiesByColumn.set(sticky.column, sticky);
            }
        }

        for (const [column, sticky] of stickiesByColumn) {
            const cell = cells[column];
            cell.style.fillColor = colorsFor(sticky).cell;
            await run(() => cell.sync());
            markedColumns.push(column);
        }

        // 2. The bands. Row index 0 is alphabetically first and belongs on top,
        //    and bandCenterYs is indexed from the calendar upwards.
        for (const row of rows) {
            const y = layout.bandCenterYs[rows.length - 1 - row.index];

            for (const block of row.blocks) {
                const width = widthOfColumns(grid, block.colSpan);
                const shape = await run(() => board.createShape({
                    shape: 'rectangle',
                    content: `<p>${escapeHtml(block.label)}</p>`,
                    x: xOfColumn(grid, block.colStart) + width / 2,
                    y,
                    width,
                    height: rowHeight,
                    style: {
                        fillColor: row.color,
                        fontFamily: 'open_sans',
                        // One centred line, same rule the month row uses.
                        fontSize: Math.round(rowHeight / 2.5),
                        borderWidth: 0,
                    },
                }));
                created.push(shape);
            }
        }

        // 3. The stickies and their connectors.
        //
        // The reference does not say whether a connector may end on an item
        // that sits inside a group, and the day cells all do. Rather than
        // assume either way, the first one tries the cell directly; if Miro
        // refuses, every connector from then on ends on an invisible anchor
        // placed over the cell instead. The flag is sticky for the whole draw
        // so the answer costs one rejected call, not one per holiday.
        let connectDirectly = true;

        for (const sticky of placed) {
            const subtitle = sticky.subtitle ? `<p>${escapeHtml(sticky.subtitle)}</p>` : '';
            const note = await run(() => board.createStickyNote({
                content: `<p><b>${escapeHtml(sticky.name)}</b></p>${subtitle}`,
                x: sticky.x,
                y: layout.stickyCenterY,
                width: layout.stickySize,
                style: {
                    fillColor: colorsFor(sticky).sticky,
                    textAlign: 'center',
                    textAlignVertical: 'middle',
                },
            }));
            created.push(note);

            const cell = cells[sticky.column];

            if (connectDirectly) {
                try {
                    created.push(await connect(note.id, cell.id));
                    continue;
                } catch (error) {
                    // Only a refusal to point into the group is worth falling
                    // back from. A rate limit means the call never completed,
                    // and retrying it as a different shape of call would hide
                    // that - let it out and be reported like every other one.
                    if (isRateLimitError(error)) throw error;

                    connectDirectly = false;
                    console.warn(
                        'Timeline Builder: connectors cannot end inside a group, using anchors instead',
                        error
                    );
                }
            }

            const anchor = await run(() => board.createShape({
                shape: 'rectangle',
                x: cell.x,
                y: cell.y,
                width: ANCHOR_SIZE,
                height: ANCHOR_SIZE,
                style: { fillOpacity: 0, borderOpacity: 0, borderWidth: 0 },
            }));
            created.push(anchor);
            anchors.push(anchor);
            created.push(await connect(note.id, anchor.id));
        }

        const persisted = {
            itemIds: [...carriedIds, ...created.map((item) => item.id)],
            markedColumns: [...new Set([...carriedColumns, ...markedColumns])],
            reservedRows: layout.reservedRows,
        };
        // createdCount is only about this one call - how many items it
        // actually created, for logStats to report - not part of the
        // calendar's stored bookkeeping, so it is added to the return value
        // but not written to AppData.
        bookkeeping = { ...persisted, createdCount: created.length };

        // Record on success too, not only on failure: today's caller trusts
        // the return value to be written afterwards, and if that write fails,
        // everything just drawn would be unreachable. Writing it here, before
        // the try closes, means a failure of this very write falls into the
        // same recovery path as everything else below - guarded, then
        // rethrown - rather than being a second, differently-shaped failure
        // point. The caller still gets the same object back so it can merge
        // its own key (subdivisions) with recordHolidays.
        await recordHolidays(calendar.entry.calendarId, persisted);
    } catch (error) {
        // Record what is actually on the board before letting this out. Without
        // it a retry cannot find the items that did land and stacks more on top
        // - and the repainted cells would never be restored. carriedIds keeps
        // whatever removeHolidays could not confirm was gone moments earlier;
        // overwriting itemIds with only this draw's created list would lose it.
        try {
            await recordHolidays(calendar.entry.calendarId, {
                itemIds: [...carriedIds, ...created.map((item) => item.id)],
                // Same carry-forward as the success path above: a column kept
                // from an earlier removal that could not confirm it restored
                // is still holiday-green and must not be dropped just because
                // this draw also failed.
                markedColumns: [...new Set([...carriedColumns, ...markedColumns])],
                // Asymmetric on purpose: if nothing was created yet (the very
                // first cell.sync() threw), there is no block on the board to
                // reserve space for, and reserving it anyway lifts the TODAY
                // circle into empty space with nothing to move it back. If a
                // draw got partway, over-reserving slightly is the safe side -
                // the circle sits a little high rather than getting buried.
                reservedRows: created.length === 0 ? 0 : layout.reservedRows,
            });
        } catch (writeError) {
            // The write itself can fail - a rate-limit burst can exhaust
            // run()'s retries on a createStickyNote and then on the recovery
            // write moments later. Report it, but the original error is what
            // must reach the caller either way: replacing it with the write's
            // error would mean nothing at all gets recorded or reported.
            console.error(
                `Timeline Builder: could not record the partial holiday draw for calendar ${calendar.entry.calendarId}`,
                writeError
            );
        }
        throw error;
    }

    // Bands and stickies are grouped for the mouse; the connectors and the
    // fallback anchors are left out. A connector follows its endpoints on its
    // own, so it keeps up when the group is dragged. An anchor is invisible
    // and sits only to give a connector something to end on over a day cell;
    // if it joined the group, moving the group would drag the anchor off that
    // cell, and the connector would then point at whatever now sits under it
    // instead of at the holiday's date - the whole meaning of the drawing.
    const anchorIds = new Set(anchors.map((item) => item.id));
    const groupable = created.filter((item) => item.type !== 'connector' && !anchorIds.has(item.id));
    if (groupable.length > 1) {
        try {
            await run(() => board.group({ items: groupable }));
        } catch (error) {
            // A grouping failure costs nothing that matters - the items are
            // already a complete, working holiday block without it.
            console.warn(
                `Timeline Builder: could not group the holiday block for calendar ${calendar.entry.calendarId}`,
                error
            );
        }
    }

    return bookkeeping;
}

/**
 * Undoes a previous holiday draw.
 *
 * The repainted cells are restored from dayColor, not from a stored original -
 * see colors.js. A column survives the calendar being redrawn; an id would not.
 */
export async function removeHolidays(calendar, cells) {
    const previous = calendar.entry.holidays;
    if (!previous) return;

    const weekdays = dayBlocks(calendar.year);

    // Columns whose cell.sync() failed and so are still holiday-green. Kept,
    // not dropped: unlike a shape, a repainted cell cannot be found or
    // restored by id, only by the column remembered here.
    const columns = previous.markedColumns ?? [];
    const stillPainted = [];
    for (const column of columns) {
        const cell = cells[column];
        if (!cell) continue;

        cell.style.fillColor = dayColor(weekdays[column].weekday);
        try {
            await run(() => cell.sync());
        } catch (error) {
            stillPainted.push(column);

            // A rate limit will hit the next column too, and the one after that,
            // each burning run()'s full retry budget. Every column left is still
            // painted, so record them all and stop rather than grind through them.
            if (isRateLimitError(error)) {
                const reached = columns.indexOf(column);
                stillPainted.push(...columns.slice(reached + 1));
                console.warn(`Timeline Builder: rate limited while restoring day cells on calendar ${calendar.entry.calendarId}, keeping ${stillPainted.length} columns for the next attempt.`);
                break;
            }

            // A cell that cannot be restored stays green. Reported, not fatal:
            // refusing to draw the new block because an old one would not let
            // go leaves the board in a worse state than one stale cell.
            console.warn(
                `Timeline Builder: could not restore day cell ${column} on calendar ${calendar.entry.calendarId}`,
                error
            );
        }
    }

    // Same distinction removePreviousImport makes: a rate limit means the call
    // never completed, so the id must be kept, not dropped. Anything else means
    // the item is genuinely gone. getById and remove are judged separately,
    // because reaching remove means getById already succeeded - the item
    // demonstrably exists, so only a rate limit there (not any failure) may
    // still drop its id.
    const remaining = [];
    for (const id of previous.itemIds ?? []) {
        let item;
        try {
            item = await run(() => board.getById(id));
        } catch (error) {
            // Only a rate limit leaves the item's fate unknown; anything else
            // means it is genuinely gone - deleted by hand, or by undo.
            if (isRateLimitError(error)) remaining.push(id);
            continue;
        }

        try {
            await run(() => board.remove(item));
        } catch {
            // getById just succeeded, so this item is on the board whatever
            // went wrong here. Dropping its id would orphan something we can
            // see.
            remaining.push(id);
        }
    }

    await recordHolidays(calendar.entry.calendarId, {
        itemIds: remaining,
        markedColumns: [...new Set(stillPainted)],
        reservedRows: 0,
    });
}
