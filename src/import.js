import dayjs from 'dayjs';
import { board, run, takeStats, isRateLimitError } from './board.js';
import { findCalendars, updateCalendar } from './anchors.js';
import { xOfColumn, widthOfColumns, describeRange } from './calendar.js';
import { parseVacations, planVacations, yearsIn } from './vacation.js';
import { updateIndicators } from './today.js';

const METADATA_KEY = 'timelineBuilder';

export function initImportView() {
    document.getElementById('importSubmit').addEventListener('click', runImport);
}

async function runImport() {
    setStatus('Reading data...', true);
    showProblems([]);

    const { entries, problems: parseProblems } = parseVacations(
        document.getElementById('vacationJson').value
    );

    if (entries.length === 0) {
        setStatus('Nothing was drawn.', false);
        showProblems(parseProblems);
        return;
    }

    const calendar = await chooseCalendar(entries);
    if (!calendar) {
        setStatus('This board has no calendar for this data.', false);
        showProblems(parseProblems);
        return;
    }

    const { rows, problems: planProblems } = planVacations(entries, calendar.range);
    const problems = [...parseProblems, ...planProblems];

    if (rows.length === 0) {
        setStatus('Nothing was drawn.', false);
        showProblems(problems);
        return;
    }

    try {
        await removePreviousImport(calendar.entry);

        setStatus('Drawing vacation...', true);
        const shapes = await drawRows(calendar, rows);

        await updateCalendar(calendar.entry.calendarId, {
            vacationItemIds: shapes.map((shape) => shape.id),
            vacationRows: rows.length,
        });

        if (shapes.length > 1) await run(() => board.group({ items: shapes }));

        // The bars just changed how far the content reaches below the calendar,
        // and they were drawn after the indicator, so they cover its line. Both
        // are fixed by the same pass. Isolated: a decoration must not cost an
        // import that has already succeeded.
        try {
            await updateIndicators(dayjs(), { raise: true });
        } catch (error) {
            console.error('Could not update the TODAY indicator:', error);
        }

        logStats(calendar, shapes.length);

        if (problems.length > 0) {
            // Keep the panel open: a half-understood import is exactly the
            // thing you want to see rather than have vanish.
            setStatus(`${shapes.length} bars drawn, with notes:`, false);
            showProblems(problems);
            return;
        }

        await board.ui.closePanel();
    } catch (error) {
        setStatus(describeFailure(error), false);
        showProblems(problems);
        console.error(error);
    }
}

/**
 * Which calendar the bars belong to.
 *
 * sapvac.js reads nine months at a stretch, so the data regularly crosses a
 * year boundary. One import always writes into exactly one calendar; entries
 * outside its year are reported by planVacations and skipped. Import twice and
 * pick the other calendar to cover both years - each calendar keeps its own
 * list of bars, so the two do not overwrite each other.
 */
async function chooseCalendar(entries) {
    const years = yearsIn(entries);
    const candidates = (await findCalendars()).filter((calendar) => years.includes(calendar.year));

    const choice = document.getElementById('calendarChoice');
    const select = document.getElementById('targetCalendar');

    if (candidates.length <= 1) {
        choice.classList.add('hidden');
        return candidates[0] ?? null;
    }

    // Compare the candidate set by identity, not by length: a calendar deleted
    // and another drawn in the same session can leave the same count behind,
    // and rebuilding only on a count change would let the dropdown keep
    // showing stale entries while the code resolves against the new list.
    const currentIds = Array.from(select.options, (option) => option.value);
    const candidateIds = candidates.map((candidate) => candidate.entry.calendarId);
    const sameCandidates = currentIds.length === candidateIds.length
        && currentIds.every((id) => candidateIds.includes(id));

    if (!sameCandidates) {
        const previousSelection = select.value;
        select.innerHTML = '';
        for (const candidate of candidates) {
            const option = document.createElement('option');
            option.value = candidate.entry.calendarId;
            option.textContent = describeRange(candidate.range);
            select.appendChild(option);
        }
        // Keep the user's choice if it is still among the candidates; otherwise
        // the select falls back to its first option, same as before.
        if (candidateIds.includes(previousSelection)) {
            select.value = previousSelection;
        }
    }
    choice.classList.remove('hidden');

    return candidates.find((c) => c.entry.calendarId === select.value) ?? candidates[0];
}

async function removePreviousImport(entry) {
    const ids = entry.vacationItemIds ?? [];
    if (ids.length === 0) return;

    setStatus('Removing previous import...', true);

    // A per-id failure here is not one thing, and getById and remove must be
    // judged separately rather than caught together. For getById, a rate
    // limit means the call never completed - the bar's fate is unknown, not
    // decided - while any other throw means the bar is genuinely gone
    // (deleted by hand, by undo). But reaching remove means getById already
    // succeeded: the item demonstrably exists, so any failure there - not
    // only a rate limit - leaves a bar still on the board, and the id must be
    // kept regardless of what kind of failure it was. Collapsing both calls
    // into one try, as this used to, judged a failed remove by the same
    // "only a rate limit keeps it" rule as getById: a bar that failed to
    // remove for any other reason was left on the board with its one handle
    // discarded, so every later import stacked a duplicate on top of it.
    // Same distinction anchors.js's measure() makes for the equivalent
    // failure, and holidayDraw.js's own id-removal loop next door.
    const remaining = [];

    for (const id of ids) {
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
            // see, so a failed remove keeps the id regardless of what kind of
            // failure it was - unlike getById, no outcome here means "gone".
            remaining.push(id);
        }
    }

    // Only a removal that confirmed every bar is gone may shorten the line.
    // Bars we could not confirm might still be on the board, and a line that
    // stops above them would be a lie - the same caution holidayDraw.js applies
    // to markedColumns.
    await updateCalendar(entry.calendarId, {
        vacationItemIds: remaining,
        vacationRows: remaining.length === 0 ? 0 : (entry.vacationRows ?? 0),
    });
}

// Bars sit directly under the day row and take the calendar's own measured row
// height, so they line up with it by construction rather than by eye.
async function drawRows(calendar, rows) {
    const { grid, rowHeight, bottom, entry } = calendar;

    const results = await Promise.allSettled(rows.flatMap((row) =>
        row.blocks.map(async (block) => {
            const width = widthOfColumns(grid, block.colSpan);
            const x = xOfColumn(grid, block.colStart);
            const y = bottom + grid.padding + row.index * (rowHeight + grid.padding);

            // employee and label are interpolated into HTML unescaped. Accepted
            // deliberately, not an oversight: this data comes from the user's
            // own SAP export, not from a third party, and it lands in Miro's
            // rich-text renderer rather than this app's DOM, so there is no
            // injection surface to guard against here. It is a new pattern in
            // this codebase, though - treat it as a one-off exception, not a
            // precedent for the next place that interpolates user-facing text.
            const shape = await run(() => board.createShape({
                content: `<p><b>${row.employee}</b><br />${block.label}</p>`,
                shape: 'rectangle',
                x: x + width / 2,
                y: y + rowHeight / 2,
                width,
                height: rowHeight,
                style: {
                    fillColor: row.color,
                    fontFamily: 'open_sans',
                    fontSize: Math.round(rowHeight / 7),
                    borderWidth: 0,
                },
            }));

            try {
                await run(() => shape.setMetadata(METADATA_KEY, {
                    role: 'vacation',
                    calendarId: entry.calendarId,
                    employee: row.employee,
                }));
            } catch (error) {
                // createShape already put this one on the board, tagging it is
                // a separate call that can fail on its own (rate limit, say).
                // Carry the shape along on the rejection so it is not lost
                // below - a bar missing its tag is still a bar that needs to
                // be findable and removable by the next import.
                if (error && typeof error === 'object') error.createdShape = shape;
                throw error;
            }

            return shape;
        })
    ));

    // Every shape actually sitting on the board, whether or not its metadata
    // tag also made it - a rejected result can still carry one via
    // createdShape, attached above.
    const shapes = results
        .map((result) => (result.status === 'fulfilled' ? result.value : result.reason?.createdShape))
        .filter(Boolean);
    const failure = results.find((result) => result.status === 'rejected');

    if (failure) {
        // These ids are the only handle that will ever exist on the bars that
        // did land: there is deliberately no board-wide scan to recover them
        // afterwards (getMetadata is one call per item, so scanning a full
        // board would be hundreds of reads). AppData must describe what is
        // actually on the board before this throws, or a later import can
        // neither find nor remove them and every retry stacks more on top.
        await updateCalendar(entry.calendarId, {
            vacationItemIds: shapes.map((shape) => shape.id),
            vacationRows: rows.length,
        });
        throw failure.reason;
    }

    return shapes;
}

function logStats(calendar, count) {
    const stats = takeStats();
    if (!stats) return;

    console.log(
        `Timeline Builder - vacation import ${calendar.year}: ${count} bars in ` +
        `${(stats.wallClockMs / 1000).toFixed(1)} s, ${stats.credits.toLocaleString('en-US')} Credits`
    );
}

function describeFailure(error) {
    if (isRateLimitError(error)) {
        return 'Rate limit reached. Wait a minute and try again.';
    }
    return `Import failed: ${error?.message ?? error}`;
}

function setStatus(message, busy) {
    const button = document.getElementById('importSubmit');
    const status = document.getElementById('importStatus');

    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    status.textContent = message;
    status.classList.toggle('hidden', message === '');
}

function showProblems(problems) {
    const list = document.getElementById('importProblems');
    list.innerHTML = '';

    for (const problem of problems) {
        const item = document.createElement('li');
        item.textContent = problem;
        list.appendChild(item);
    }

    list.classList.toggle('hidden', problems.length === 0);
}
