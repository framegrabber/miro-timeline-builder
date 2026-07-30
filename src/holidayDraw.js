import { board, run, isRateLimitError } from './board.js';
import { updateCalendar } from './anchors.js';
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
 * Paints the holiday block onto one calendar.
 *
 * Order matters. The day cells are repainted first, because they are the
 * connector targets and because they are the one part that cannot be recovered
 * from an id list if this throws halfway - so the columns are recorded before
 * anything else is created. Everything after that is a new item whose id goes
 * into `created`, and the caller writes that list to AppData even on failure,
 * for the same reason drawRows does: those ids are the only handle that will
 * ever exist on the items that did land.
 */
export async function drawHolidays(calendar, cells, { stickies, rows }) {
    const { grid, rowHeight, top } = calendar;
    const created = [];
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

    try {
        // 1. The day cells.
        for (const sticky of placed) {
            const cell = cells[sticky.column];
            cell.style.fillColor = colorsFor(sticky).cell;
            await run(() => cell.sync());
            markedColumns.push(sticky.column);
        }

        // 2. The bands. Row index 0 is alphabetically first and belongs on top,
        //    and bandCenterYs is indexed from the calendar upwards.
        for (const row of rows) {
            const y = layout.bandCenterYs[rows.length - 1 - row.index];

            for (const block of row.blocks) {
                const width = widthOfColumns(grid, block.colSpan);
                const shape = await run(() => board.createShape({
                    shape: 'rectangle',
                    content: `<p>${block.label}</p>`,
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
            const subtitle = sticky.subtitle ? `<p>${sticky.subtitle}</p>` : '';
            const note = await run(() => board.createStickyNote({
                content: `<p><b>${sticky.name}</b></p>${subtitle}`,
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
            created.push(await connect(note.id, anchor.id));
        }
    } catch (error) {
        // Record what is actually on the board before letting this out. Without
        // it a retry cannot find the items that did land and stacks more on top
        // - and the repainted cells would never be restored.
        await updateCalendar(calendar.entry.calendarId, {
            holidays: {
                ...(calendar.entry.holidays ?? {}),
                itemIds: created.map((item) => item.id),
                markedColumns,
                reservedRows: layout.reservedRows,
            },
        });
        throw error;
    }

    // Bands and stickies are grouped for the mouse; the connectors are left
    // out. A connector follows its endpoints on its own, so it keeps up when
    // the group is dragged - and one end of it lives inside the calendar's
    // group, which is not this group's business.
    const groupable = created.filter((item) => item.type !== 'connector');
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

    return {
        itemIds: created.map((item) => item.id),
        markedColumns,
        reservedRows: layout.reservedRows,
    };
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

    for (const column of previous.markedColumns ?? []) {
        const cell = cells[column];
        if (!cell) continue;

        cell.style.fillColor = dayColor(weekdays[column].weekday);
        try {
            await run(() => cell.sync());
        } catch (error) {
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
    // the item is genuinely gone.
    const remaining = [];
    for (const id of previous.itemIds ?? []) {
        try {
            const item = await run(() => board.getById(id));
            await run(() => board.remove(item));
        } catch (error) {
            if (isRateLimitError(error)) remaining.push(id);
        }
    }

    await updateCalendar(calendar.entry.calendarId, {
        holidays: { ...previous, itemIds: remaining, markedColumns: [], reservedRows: 0 },
    });
}
