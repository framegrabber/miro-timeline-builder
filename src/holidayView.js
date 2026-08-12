import dayjs from 'dayjs';

import { board, takeStats, isRateLimitError } from './board.js';
import { findCalendars } from './anchors.js';
import { dayCellsOf } from './dayCells.js';
import { fetchHolidays, fetchSubdivisions } from './openHolidays.js';
import {
    parseSubdivisions,
    parsePublicHolidays,
    parseSchoolHolidays,
    planStickies,
    planBands,
} from './holidays.js';
import { describeRange } from './calendar.js';
import { drawHolidays, removeHolidays, recordHolidays } from './holidayDraw.js';
import { updateIndicators } from './today.js';

// Fetched once per panel load and kept: the list of German states does not
// change while somebody has a board open.
let names = null;

export function initHolidayView() {
    document.getElementById('holidaySubmit').addEventListener('click', runHolidays);
    document
        .querySelector('.tab[data-view="holidays"]')
        .addEventListener('click', fillStatesOnce);
    // Delegated, because the checkboxes do not exist until the first tab click.
    document.getElementById('subdivisions').addEventListener('change', showSelectionCount);
}

async function fillStatesOnce() {
    if (names) return;

    const list = document.getElementById('subdivisions');
    setStatus('Loading the list of states...', true);

    try {
        names = parseSubdivisions(await fetchSubdivisions());
    } catch (error) {
        setStatus(error?.message ?? String(error), false);
        return;
    }

    // Only the top-level states are pickable. Augsburg is reachable through
    // Bavaria; offering it on its own would suggest you could have the Peace
    // Festival without the rest of Bavaria's holidays.
    const states = [...names.entries()]
        .filter(([code]) => code.split('-').length === 2)
        .sort((a, b) => (a[1].name < b[1].name ? -1 : 1));

    // <label class="checkbox"><input><span>…</span></label> is the structure
    // Mirotone styles: the input is transparent and the box is drawn by
    // .checkbox span:before, so the span is not optional.
    list.innerHTML = '';
    for (const [code, state] of states) {
        const label = document.createElement('label');
        label.className = 'checkbox';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = code;

        const span = document.createElement('span');
        span.textContent = state.name;

        label.append(input, span);
        list.appendChild(label);
    }

    setStatus('', false);
    await preselectFromLastRun(list);
    showSelectionCount();
}

/** Whatever was drawn last time, so a redraw is one click. */
async function preselectFromLastRun(list) {
    try {
        const calendars = await findCalendars();
        const previous = calendars.find((calendar) => calendar.entry.holidays?.subdivisions?.length);
        if (!previous) return;

        const chosen = new Set(previous.entry.holidays.subdivisions);
        for (const input of list.querySelectorAll('input')) {
            input.checked = chosen.has(input.value);
        }
    } catch {
        // A convenience, not a requirement. An empty selection is a fine
        // starting state, and the draw below reports its own failures.
    }
}

/**
 * The list scrolls, so a state checked above the fold is otherwise invisible -
 * and the common case is redrawing with last time's selection still ticked.
 */
function showSelectionCount() {
    const count = pickedStates().length;

    document.getElementById('subdivisionCount').textContent =
        count === 0 ? 'No state picked yet.'
        : count === 1 ? '1 state picked.'
        : `${count} states picked.`;
}

function pickedStates() {
    return [...document.querySelectorAll('#subdivisions input:checked')].map((input) => input.value);
}

async function runHolidays() {
    showProblems([]);

    // The subdivision list is fetched once, on the first click of the tab
    // (fillStatesOnce). If that fetch is still in flight, failed, or somehow
    // never ran, `names` is null and planStickies/planBands would fail in a
    // way that means nothing to whoever reads the message. In practice the
    // list only ever gets checkboxes once `names` is set, so this mostly
    // guards a case the "pick a state" check below would already catch - but
    // it says so plainly instead of relying on that ordering by accident.
    if (!names) {
        setStatus('The list of federal states has not finished loading yet. Wait a moment and try again.', false);
        return;
    }

    const selected = pickedStates();

    if (selected.length === 0) {
        setStatus('Pick at least one federal state.', false);
        return;
    }

    setStatus('Looking for a calendar...', true);

    const calendar = await chooseCalendar();
    if (!calendar) {
        setStatus('This board has no calendar to draw on.', false);
        return;
    }

    setStatus('Reading the day cells...', true);
    const { cells, reason } = await dayCellsOf(calendar);
    if (!cells) {
        setStatus(describeCellFailure(reason), false);
        return;
    }

    setStatus('Fetching holidays...', true);

    let raw;
    try {
        raw = await fetchHolidays(calendar.year);
    } catch (error) {
        setStatus(error?.message ?? String(error), false);
        return;
    }

    const publicHolidays = parsePublicHolidays(raw.publicHolidays);
    const schoolHolidays = parseSchoolHolidays(raw.schoolHolidays);
    const planned = planStickies(publicHolidays.entries, calendar.range, { selected, names });
    const banded = planBands(schoolHolidays.entries, calendar.range, { selected, names });

    const problems = [
        ...publicHolidays.problems,
        ...schoolHolidays.problems,
        ...planned.problems,
        ...banded.problems,
    ];

    if (planned.stickies.length === 0 && banded.rows.length === 0) {
        setStatus('Nothing was drawn.', false);
        showProblems(problems);
        return;
    }

    try {
        setStatus('Removing the previous holidays...', true);
        await removeHolidays(calendar, cells);

        setStatus('Drawing holidays...', true);
        const drawn = await drawHolidays(calendar, cells, {
            stickies: planned.stickies,
            rows: banded.rows,
        });

        await recordHolidays(calendar.entry.calendarId, { subdivisions: selected });

        // The circle sits above this block, so it has to move now rather than
        // at the next tick - same reason drawCalendar kicks it.
        try {
            await updateIndicators(dayjs(), { raise: true });
        } catch (error) {
            console.error('Could not update the TODAY indicator:', error);
        }

        logStats(calendar, planned.stickies.length, drawn.createdCount);

        if (problems.length > 0) {
            setStatus(`${drawn.createdCount} items drawn, with notes:`, false);
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
 * Which calendar the holidays belong to.
 *
 * Unlike the vacation import there is no data to derive a year from, so every
 * calendar on the board is a candidate and the year comes from whichever one is
 * picked.
 */
async function chooseCalendar() {
    const candidates = await findCalendars();

    const choice = document.getElementById('holidayCalendarChoice');
    const select = document.getElementById('targetHolidayCalendar');

    if (candidates.length <= 1) {
        choice.classList.add('hidden');
        return candidates[0] ?? null;
    }

    // Compare the candidate set by identity, not by length: a calendar deleted
    // and another drawn in the same session can leave the same count behind.
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
        if (candidateIds.includes(previousSelection)) select.value = previousSelection;
    }
    choice.classList.remove('hidden');

    return candidates.find((c) => c.entry.calendarId === select.value) ?? candidates[0];
}

function describeCellFailure(reason) {
    if (reason === 'ungrouped') {
        return 'That calendar is not grouped, so its day cells cannot be found. Redraw it, or group it by hand.';
    }
    if (reason === 'rate-limited') {
        return 'Rate limit reached. Wait a minute and try again.';
    }
    return 'That calendar\'s day row is incomplete - a cell was moved or deleted. Redraw it.';
}

function describeFailure(error) {
    if (isRateLimitError(error)) {
        return 'Rate limit reached. Wait a minute and try again.';
    }
    return `Drawing holidays failed: ${error?.message ?? error}`;
}

function logStats(calendar, stickyCount, itemCount) {
    const stats = takeStats();
    if (!stats) return;

    console.log(
        `Timeline Builder - holidays ${calendar.year}: ${stickyCount} public holidays, ` +
        `${itemCount} items in ${(stats.wallClockMs / 1000).toFixed(1)} s, ` +
        `${stats.credits.toLocaleString('en-US')} Credits`
    );
}

function setStatus(message, busy) {
    const button = document.getElementById('holidaySubmit');
    const status = document.getElementById('holidayStatus');

    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    status.textContent = message;
    status.classList.toggle('hidden', message === '');
}

function showProblems(problems) {
    const list = document.getElementById('holidayProblems');
    list.innerHTML = '';

    for (const problem of problems) {
        const item = document.createElement('li');
        item.textContent = problem;
        list.appendChild(item);
    }

    list.classList.toggle('hidden', problems.length === 0);
}
