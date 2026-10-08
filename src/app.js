import './assets/style.css'

import {
    dayBlocks,
    monthBlocks,
    weekBlocks,
    iterationBlocks,
    quarterBlocks,
    xOfColumn,
    widthOfColumns,
    rangeFrom,
    clipBlocks,
    pitchOf,
} from './calendar.js';
import dayjs from 'dayjs';
import { board, run, takeStats, isRateLimitError } from './board.js';
import { tagCalendar } from './anchors.js';
import { updateIndicators, DIAMETER_FACTOR } from './today.js';
import { columnForToday, indicatorY, anchorY, indicatorEdges } from './indicatorGeometry.js';
import { createCalendarFrame, addToFrame, fitFrame } from './frame.js';
import { initImportView } from './import.js';
import { initHolidayView } from './holidayView.js';
import { dayColor } from './colors.js';

// Initialize year input with current year
document.addEventListener('DOMContentLoaded', () => {
    const yearInput = document.getElementById('year');
    yearInput.value = new Date().getFullYear();
    
    // Add validation for year input
    yearInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
        validateYear(e.target);
    });
});

async function getSettings() {
    const settings = {};

    const inputs = document.querySelectorAll("input");
    inputs.forEach(input => {
        settings[input.id] = getInputValue(input);
    });

    const selects = document.querySelectorAll("select");
    selects.forEach(select => {
        settings[select.id] = getSelectValue(select);
    });

    const toggles = document.querySelectorAll("input[type='checkbox']");
    toggles.forEach(toggle => {
        settings[toggle.id] = toggle.checked;
    });

    const viewport = await miro.board.viewport.get();
    settings.startX = viewport.x + viewport.width/2;
    settings.startY = viewport.y + viewport.height/2;

    return settings;
}

function getInputValue(input) {
  if(input.value === "") return "";
  if(!isNaN(input.value)) return parseInt(input.value);
  return input.value;
}

function getSelectValue(select) {
  return parseInt(select.value);
}


// The button is a submit button inside a form, so the default action reloads
// the iframe. That used to tear the app down while shapes were still being
// created, which looked like the panel closing on a half-drawn calendar.
document
  .getElementById("submit")
  .addEventListener("click", async (event) => {
    event.preventDefault();

    const yearInput = document.getElementById('year');
    if (!validateYear(yearInput)) return;
    if (!validateRange()) return;

    await drawCalendar();
});

const settingsMap = {
    'drawQuarters': 'quarterSettings',
    'drawIterations': 'iterationSettings',
    'drawWeeks': 'weekSettings'
};

Object.entries(settingsMap).forEach(([triggerId, targetId]) => {
    document.getElementById(triggerId).addEventListener('change', (event) => {
        document.getElementById(targetId).classList.toggle('hidden', !event.target.checked);
    });
});

// Quick sets, not a second source of truth: they only move the two selects, so
// there is exactly one place the range is read from.
const rangePresets = {
    rangeFullYear: [0, 11],
    rangeFirstHalf: [0, 5],
    rangeSecondHalf: [6, 11],
};

Object.entries(rangePresets).forEach(([buttonId, [fromMonth, toMonth]]) => {
    document.getElementById(buttonId).addEventListener('click', () => {
        document.getElementById('rangeFromMonth').value = String(fromMonth);
        document.getElementById('rangeToMonth').value = String(toMonth);
        validateRange();
    });
});
  
// Draws one row of the calendar from blocks produced by calendar.js.
// All geometry lives in calendar.js - this only turns blocks into Miro shapes.
// Resolves with the created shapes; the caller must await it, otherwise the
// calendar is still being drawn when we try to group it.
function drawRow(settings, row, onShapeDrawn) {
    const y = calculateYPosition(settings, row.position);

    return Promise.all(row.blocks.map((block, index) => drawRectangle(
        row.label(block, index),
        row.color(block, index),
        widthOfColumns(settings, block.colSpan),
        settings.shapeHeight,
        xOfColumn(settings, block.colStart),
        y
    ).then((shape) => {
        onShapeDrawn();
        return shape;
    })));
}

const colorMaps = {
  week: ["#8e8be1", "#7e7cc8"],
  month: ["#8ddebd", "#9df7d2"],
  iteration: ["#d37b97", "#ea88a8"],
  quarter: ["#82adc2", "#a0d5ef"]
};

function getColor(number, type) {
    // The day row is keyed by weekday, not by alternating pairs, and it is
    // shared with the holiday import - see colors.js.
    if (type === "day") return dayColor(number);

    const colors = colorMaps[type];
    return number % 2 === 0 ? colors[0] : colors[1];
}

  
function drawRectangle(content, color, width, height, x, y){
    return run(() => board.createShape({
        content: content,
        type: "shape",
        shape: "rectangle",
        width: width,
        height: height,
        x: x + width / 2,
        y: y + height / 2,
        style: {
          fillColor: color,
          fontFamily: 'open_sans',
          fontSize: height / 2.5,
          borderWidth: 0,
        },
    }));
}

// Rows are described before anything is drawn: the total shape count is needed
// for the progress readout, and the order they are listed in is the order the
// board receives them in.
function monthRow(year) {
    return {
        position: 'drawMonths',
        blocks: monthBlocks(year),
        label: (month) => month.label,
        color: (month) => getColor(month.index, "month"),
    };
}

function weekRow(year, { weekPrefix }) {
    return {
        position: 'drawWeeks',
        blocks: weekBlocks(year),
        label: (week) => weekPrefix ? `${weekPrefix} ${week.week}` : `${week.week}`,
        color: (week) => getColor(week.week, "week"),
    };
}

function iterationRow(year, settings) {
    const {
        IterationWeekOffset,
        IterationDayOffset,
        daysPerIteration,
        IterationStartNumber,
        IterationPrefix,
        IterationSuffix
    } = settings;

    return {
        position: 'drawIterations',
        blocks: iterationBlocks(year, {
            weekdayIndex: IterationDayOffset,
            weekOffset: IterationWeekOffset,
            daysPerIteration,
            startNumber: IterationStartNumber,
        }),
        label: (iteration) => `${IterationPrefix}${iteration.number}${IterationSuffix}`,
        color: (iteration, index) => getColor(index, "iteration"),
    };
}

function quarterRow(year, settings) {
    return {
        position: 'drawQuarters',
        blocks: quarterBlocks(year, settings.qOneStartMonth),
        label: (quarter) => quarter.label,
        color: (quarter) => getColor(quarter.index, "quarter"),
    };
}

function dayRow(year) {
    return {
        position: 'drawDays',
        blocks: dayBlocks(year),
        label: (day) => day.label,
        color: (day) => getColor(day.weekday, "day"),
    };
}

// The panel offers months, not dates: a section of a year that starts mid-month
// is not a case anyone has, and month bounds cover halves and quarters. dayjs
// resolves the end of the month, so no table of month lengths is needed and a
// leap February is right by construction.
function rangeFromSettings(settings) {
    const year = settings.year;
    const fromMonth = settings.rangeFromMonth ?? 0;
    const toMonth = settings.rangeToMonth ?? 11;

    return rangeFrom({
        year,
        from: dayjs(`${year}-01-01`).month(fromMonth).startOf('month').format('YYYY-MM-DD'),
        to: dayjs(`${year}-01-01`).month(toMonth).endOf('month').format('YYYY-MM-DD'),
    });
}

// Coarsest rows first. The board receives the calls in this order, so the
// shape of the year is visible within a second while the day boxes - three
// quarters of all shapes - fill in behind it.
//
// Every row is built for the whole year and then cut to the drawn window. The
// builders stay window-blind on purpose: five builders clipping for themselves
// would be five copies of the same clamping arithmetic, and iteration numbers
// would restart at 1 instead of continuing from the start of the year.
function planRows(year, settings, range) {
    const rows = [];

    if (settings.drawQuarters) rows.push(quarterRow(year, settings));
    rows.push(monthRow(year)); // Always draw months
    if (settings.drawIterations) rows.push(iterationRow(year, settings));
    if (settings.drawWeeks) rows.push(weekRow(year, settings));
    rows.push(dayRow(year)); // Always draw days

    return rows.map((row) => ({ ...row, blocks: clipBlocks(row.blocks, range) }));
}

async function drawCalendar() {
    const settings = await getSettings();
    const year = settings.year;

    // Not reachable from this panel today: validateRange already guarantees
    // rangeFromMonth <= rangeToMonth, and every whole month has at least 18
    // working days, so rangeFromSettings cannot return null here. The guard
    // stays anyway - it is cheap, and rangeFromSettings is not written to
    // assume a caller that always validates first.
    const range = rangeFromSettings(settings);
    if (!range) {
        setBusy(false, 'That range has no working days to draw. Pick a wider one.');
        return;
    }

    // xOfColumn works in absolute columns - column 0 is the first working day
    // of the year, drawn or not - so a window would otherwise start as far
    // right of the viewport as its first column is into the year. Pulling the
    // origin back by exactly that much puts the first *drawn* column where the
    // user is looking.
    settings.startX -= range.firstColumn * pitchOf(settings);

    const rows = planRows(year, settings, range);
    const total = rows.reduce((count, row) => count + row.blocks.length, 0);

    let drawn = 0;
    const onShapeDrawn = () => setBusy(true, `Drawing the calendar... ${++drawn} / ${total}`);

    setBusy(true, `Drawing the calendar... 0 / ${total}`);

    try {
        // Nothing below may run before every shape actually exists on the
        // board: grouping an empty array fails, and closing the panel unloads
        // the app along with any calls still in flight.
        const drawnRows = await Promise.all(
            rows.map((row) => drawRow(settings, row, onShapeDrawn))
        );
        const shapes = drawnRows.flat();

        // Taken right after the shapes exist, so the round trips describe the
        // drawing alone - grouping, framing and bookkeeping are reported (or
        // dropped) separately below.
        const drawing = takeStats();

        // Grouping comes first now, because the frame takes the calendar as one
        // Group: a single frame.add for the whole calendar instead of one per
        // shape. board.group returns the Group, which is the only handle on it we
        // get without reading it back. A failing group no longer ends the flow on
        // the spot: tagging and the TODAY indicator used to run before grouping,
        // so a grouping failure still left a findable calendar behind. To keep
        // exactly that, the error is held, everything after it still runs, and
        // it is rethrown at the end so the panel reports it as before.
        let group = null;
        let groupingMs = 0;
        let groupingError = null;

        if (shapes.length > 1) {
            setBusy(true, 'Grouping the calendar...');

            const startedAt = performance.now();
            try {
                group = await run(() => board.group({ items: shapes }));
            } catch (error) {
                groupingError = error;
            }
            groupingMs = performance.now() - startedAt;

            takeStats(); // Reported separately, so keep it out of the round trips.
        }

        // The frame is a convenience, like the group: if any frame step fails,
        // the calendar is still on the board and everything below runs exactly
        // as it did before frames existed. frameId stays null after a failed
        // create, which is what tagCalendar stores for "no frame of ours" - so a
        // later import never tries to manage a frame that was never made.
        //
        // The frame is created around the planned content rather than the drawn
        // shapes: the geometry is already known here, and reading every shape
        // back would cost a call per shape for numbers we computed ourselves.
        // The planned TODAY indicator is included so the first createIndicator
        // finds itself inside the frame and does not have to grow it right away.
        const today = dayjs();
        let frameId = null;
        let framingMs = 0;

        setBusy(true, 'Framing the calendar...');
        const framingStartedAt = performance.now();

        try {
            const frame = await createCalendarFrame({
                edgesList: plannedEdges(settings, rows, range, today),
                range,
                rowHeight: settings.shapeHeight,
            });
            frameId = frame.id;
        } catch (error) {
            console.warn('Timeline Builder: could not create a frame for the calendar, drawing it without one.', error);
        }

        if (frameId) {
            try {
                // Without a group, each shape goes in on its own - slower, but a
                // calendar half in and half out of its frame would be worse.
                await addToFrame(frameId, group ? { group } : { items: shapes });
            } catch (error) {
                console.warn('Timeline Builder: could not move the calendar into its frame.', error);
            }
        }

        framingMs += performance.now() - framingStartedAt;

        // Tag the calendar for later lookup, but do not let a bookkeeping failure
        // cost the draw. The calendar exists and is visible whether or not the
        // tagging succeeds; its findability later is important but not a precondition
        // for showing the user what they asked for now. Tagging runs after the
        // frame because the entry records the frame's id.
        try {
            await tagCalendar({ drawnRows, rows, year, range, indicatorEnabled: settings.drawTodayIndicator, frameId });
        } catch (error) {
            console.error('Calendar could not be tagged for later lookup:', error);
        }

        // The headless updater (index.js) only ticks on load and every 10 minutes
        // after, so without this a calendar drawn into an already-open board would
        // show no TODAY indicator until the next tick, or a reload. Bringing every
        // calendar's indicator up to date now is the same work the next tick would
        // do; do not let a failure here cost the draw, for the same reason tagging
        // above is isolated. It runs after tagging, so the new calendar - and its
        // frameId - is among the calendars it finds; createIndicator then puts the
        // indicator into the frame itself.
        try {
            await updateIndicators(today, { raise: true });
        } catch (error) {
            console.error('Could not update the TODAY indicator:', error);
        }

        // Exactly one fit at the end: the frame was cut to planned content, and
        // this trims it to what actually ended up inside, indicator included.
        if (frameId) {
            const fitStartedAt = performance.now();
            try {
                await fitFrame(frameId, settings.shapeHeight);
            } catch (error) {
                console.warn('Timeline Builder: could not fit the frame to the calendar.', error);
            }
            framingMs += performance.now() - fitStartedAt;
        }

        takeStats(); // Tagging, indicator and framing calls are not drawing round trips.

        if (groupingError) throw groupingError;

        logDrawStats(year, drawing, groupingMs, { framed: frameId !== null, framingMs });

        await board.ui.closePanel();
    } catch (error) {
        // Leave the panel open so the message is readable and the user can retry.
        setBusy(false, describeDrawFailure(error));
        console.error(error);
    }
}

function logDrawStats(year, stats, groupingMs, { framed = false, framingMs = 0 } = {}) {
    if (!stats) return;

    const ms = (value) => `${Math.round(value)} ms`;
    const seconds = (value) => `${(value / 1000).toFixed(1)} s`;

    console.group(`Timeline Builder - ${year}: ${stats.calls} shapes in ${seconds(stats.wallClockMs + groupingMs)}`);

    console.table({
        'Shapes drawn':         { Value: stats.calls },
        'Parallel calls':       { Value: stats.concurrency },
        'Drawing':              { Value: seconds(stats.wallClockMs) },
        'Grouping':             { Value: seconds(groupingMs) },
        'Framing':              { Value: framed ? seconds(framingMs) : 'no frame' },
        'Throughput':           { Value: `${stats.callsPerSecond.toFixed(1)} shapes/s` },
        'Round trip, fastest':  { Value: ms(stats.fastestMs) },
        'Round trip, median':   { Value: ms(stats.medianMs) },
        'Round trip, p95':      { Value: ms(stats.p95Ms) },
        'Round trip, slowest':  { Value: ms(stats.slowestMs) },
        'Waited on rate limit': { Value: seconds(stats.throttledMs) },
        'Retries':              { Value: stats.retries },
        'Credits this draw':    { Value: stats.credits.toLocaleString('en-US') },
        'Credits last minute':  { Value: `${stats.creditsLastMinute.toLocaleString('en-US')} / 100,000` },
    });

    // If the wall clock is roughly (shapes / parallel calls) x median round
    // trip, we spent the time waiting on latency and more parallelism buys
    // time back. If it is well above that, Miro itself is the bottleneck.
    const latencyBound = (stats.calls / stats.concurrency) * stats.medianMs;
    const share = stats.wallClockMs > 0 ? latencyBound / stats.wallClockMs : 0;

    console.log(
        `Latency accounts for ${seconds(latencyBound)} of ${seconds(stats.wallClockMs)} (${Math.round(share * 100)}%). ` +
        (share > 0.7
            ? 'Raising `concurrency` in rateLimit.js should make this faster.'
            : 'Miro is the bottleneck here - more parallelism will not help much.')
    );

    console.groupEnd();
}

// Where the calendar and its TODAY indicator will sit, in board coordinates,
// computed from the same geometry the rows were drawn from. The rows all span
// the drawn window, so one box from the first drawn column to the last and
// from the top row to the bottom row covers every shape.
function plannedEdges(settings, rows, range, today) {
    const { shapeWidth, shapeHeight, padding } = settings;
    const lastColumn = range.firstColumn + range.columns - 1;
    const top = calculateYPosition(settings, rows[0].position);
    const bottom = calculateYPosition(settings, rows[rows.length - 1].position) + shapeHeight;

    const edges = [{
        left: xOfColumn(settings, range.firstColumn),
        top,
        right: xOfColumn(settings, lastColumn) + shapeWidth,
        bottom,
    }];

    // Same inputs createIndicator will see on a calendar that has no holidays
    // and no vacation yet: reservedRows and contentRows are both zero.
    const column = columnForToday(range, today);
    if (settings.drawTodayIndicator && column !== null) {
        const diameter = shapeHeight * DIAMETER_FACTOR;
        edges.push(indicatorEdges({
            x: xOfColumn(settings, column) + shapeWidth / 2,
            circleY: indicatorY({ top, rowHeight: shapeHeight, diameter, reservedRows: 0 }),
            anchorY: anchorY({ bottom, rowHeight: shapeHeight, padding, contentRows: 0 }),
            diameter,
        }));
    }

    return edges;
}

function describeDrawFailure(error) {
    if (isRateLimitError(error)) {
        return 'Miro\'s rate limit is exhausted. Please wait a minute and try again.';
    }
    return `Could not draw the calendar: ${error?.message ?? error}`;
}

function setBusy(busy, message = '') {
    const button = document.getElementById('submit');
    const status = document.getElementById('drawStatus');

    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    status.textContent = message;
    status.classList.toggle('hidden', message === '');
}

function calculateYPosition(settings, position) {
    const { shapeHeight, padding } = settings;
    const elementHeight = shapeHeight + padding;
    let yOffset = settings.startY;
    
    // Define draw order from top to bottom
    const elements = [
        { id: 'drawQuarters', active: settings.drawQuarters },
        { id: 'drawMonths', active: true },      // months always drawn
        { id: 'drawIterations', active: settings.drawIterations },
        { id: 'drawWeeks', active: settings.drawWeeks },
        { id: 'drawDays', active: true }         // days always drawn
    ];
    
    // Count active elements up to the requested position
    let activeCount = 0;
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].active) {
            if (elements[i].id === position) {
                return yOffset + (activeCount * elementHeight);
            }
            activeCount++;
        }
    }
    return yOffset;
}

function validateYear(yearInput) {
    const year = yearInput.value;
    const yearGroup = yearInput.closest('.form-group');
    const isValid = /^\d{4}$/.test(year);
    
    yearGroup.classList.toggle('error', !isValid);
    yearGroup.querySelector('.status-text').style.display = isValid ? 'none' : 'block';
    
    if (!isValid) {
        yearInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return isValid;
}

// The two month selects are the only pair in the panel that can contradict each
// other, so this is the one cross-field check.
//
// Unlike validateYear this does not mark the fields themselves. Mirotone styles
// an errored field with `.error .input`, and these are `.select` - marking them
// changed nothing on screen, so the message is the whole signal.
//
// The message sits on its own full-width row below both selects, not inside the
// "From" group where it started. In the grid it added height to one column only,
// so the "To" select sat lower than the "From" select until something hid the
// text again - which is why pressing a preset appeared to fix the alignment. Its
// own row cannot push a neighbour around, whether it is shown or hidden. The row
// starts hidden in the markup, because mirotone's `.status-text` has no display
// rule of its own and would otherwise be visible before this ever runs.
function validateRange() {
    const from = document.getElementById('rangeFromMonth');
    const to = document.getElementById('rangeToMonth');
    const error = document.getElementById('rangeError');
    if (!from || !to || !error) return true;

    const isValid = parseInt(to.value) >= parseInt(from.value);

    error.style.display = isValid ? 'none' : 'block';

    if (!isValid) error.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return isValid;
}

// One panel, three views. Miro only ever hands the app a single icon:click, and
// the import needs the calendar context anyway.
document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
});

const VIEWS = ['calendar', 'import', 'holidays'];

function showView(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('tab-active', tab.dataset.view === name);
    });
    for (const view of VIEWS) {
        document.getElementById(`view-${view}`).classList.toggle('hidden', view !== name);
    }
}

initImportView();
initHolidayView();

