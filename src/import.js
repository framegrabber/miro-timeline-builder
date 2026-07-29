import { board, run, takeStats, isRateLimitError } from './board.js';
import { findCalendars, updateCalendar } from './anchors.js';
import { xOfColumn, widthOfColumns } from './calendar.js';
import { parseVacations, planVacations, yearsIn } from './vacation.js';

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

    const { rows, problems: planProblems } = planVacations(entries, calendar.year);
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
        });

        if (shapes.length > 1) await run(() => board.group({ items: shapes }));

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

    if (select.options.length !== candidates.length) {
        select.innerHTML = '';
        for (const candidate of candidates) {
            const option = document.createElement('option');
            option.value = candidate.entry.calendarId;
            option.textContent = String(candidate.year);
            select.appendChild(option);
        }
    }
    choice.classList.remove('hidden');

    return candidates.find((c) => c.entry.calendarId === select.value) ?? candidates[0];
}

async function removePreviousImport(entry) {
    const ids = entry.vacationItemIds ?? [];
    if (ids.length === 0) return;

    setStatus('Removing previous import...', true);

    for (const id of ids) {
        try {
            const item = await run(() => board.getById(id));
            await run(() => board.remove(item));
        } catch {
            // Already gone, by hand or by undo.
        }
    }

    await updateCalendar(entry.calendarId, { vacationItemIds: [] });
}

// Bars sit directly under the day row and take the calendar's own measured row
// height, so they line up with it by construction rather than by eye.
async function drawRows(calendar, rows) {
    const { grid, rowHeight, bottom, entry } = calendar;

    const drawn = await Promise.all(rows.flatMap((row) =>
        row.blocks.map((block) => {
            const width = widthOfColumns(grid, block.colSpan);
            const x = xOfColumn(grid, block.colStart);
            const y = bottom + grid.padding + row.index * (rowHeight + grid.padding);

            return run(() => board.createShape({
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
            })).then(async (shape) => {
                await run(() => shape.setMetadata(METADATA_KEY, {
                    role: 'vacation',
                    calendarId: entry.calendarId,
                    employee: row.employee,
                }));
                return shape;
            });
        })
    ));

    return drawn;
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
