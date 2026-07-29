import './assets/style.css'

import {
    dayBlocks,
    monthBlocks,
    weekBlocks,
    iterationBlocks,
    quarterBlocks,
    xOfColumn,
    widthOfColumns,
} from './calendar.js';
import { board, run, takeStats, isRateLimitError } from './board.js';
import { tagCalendar } from './anchors.js';

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
  day: ["#FFE5CC", "#FFD1A3", "#FFBD7A", "#FFA952", "#FF9529"], // Mon-Fri orange gradient
  month: ["#8ddebd", "#9df7d2"],
  iteration: ["#d37b97", "#ea88a8"],
  quarter: ["#82adc2", "#a0d5ef"]
};
function getColor(number, type) {
    const colors = colorMaps[type];
    
    if (type === "day") {
      // Use weekday (1-5) directly as color index
      // Subtract 1 since array is 0-based but weekdays are 1-based
      return colors[number - 1];
    }
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

// Coarsest rows first. The board receives the calls in this order, so the
// shape of the year is visible within a second while the 261 day boxes - three
// quarters of all shapes - fill in behind it.
function planRows(year, settings) {
    const rows = [];

    if (settings.drawQuarters) rows.push(quarterRow(year, settings));
    rows.push(monthRow(year)); // Always draw months
    if (settings.drawIterations) rows.push(iterationRow(year, settings));
    if (settings.drawWeeks) rows.push(weekRow(year, settings));
    rows.push(dayRow(year)); // Always draw days

    return rows;
}

async function drawCalendar() {
    const settings = await getSettings();
    const year = settings.year;

    const rows = planRows(year, settings);
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

        // Tag the calendar for later lookup, but do not let a bookkeeping failure
        // cost the grouping. The calendar exists and is visible whether or not the
        // tagging succeeds; its findability later is important but not a precondition
        // for showing the user what they asked for now.
        try {
            await tagCalendar({ drawnRows, rows, year, indicatorEnabled: settings.drawTodayIndicator });
        } catch (error) {
            console.error('Calendar could not be tagged for later lookup:', error);
        }

        const drawing = takeStats();
        let groupingMs = 0;

        if (shapes.length > 1) {
            setBusy(true, 'Grouping the calendar...');

            const startedAt = performance.now();
            await run(() => board.group({ items: shapes }));
            groupingMs = performance.now() - startedAt;

            takeStats(); // Reported separately, so keep it out of the round trips.
        }

        logDrawStats(year, drawing, groupingMs);

        await board.ui.closePanel();
    } catch (error) {
        // Leave the panel open so the message is readable and the user can retry.
        setBusy(false, describeDrawFailure(error));
        console.error(error);
    }
}

function logDrawStats(year, stats, groupingMs) {
    if (!stats) return;

    const ms = (value) => `${Math.round(value)} ms`;
    const seconds = (value) => `${(value / 1000).toFixed(1)} s`;

    console.group(`Timeline Builder - ${year}: ${stats.calls} shapes in ${seconds(stats.wallClockMs + groupingMs)}`);

    console.table({
        'Shapes drawn':         { Value: stats.calls },
        'Parallel calls':       { Value: stats.concurrency },
        'Drawing':              { Value: seconds(stats.wallClockMs) },
        'Grouping':             { Value: seconds(groupingMs) },
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

// One panel, two views. Miro only ever hands the app a single icon:click, and
// the import needs the calendar context anyway.
document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
});

function showView(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('tab-active', tab.dataset.view === name);
    });
    document.getElementById('view-calendar').classList.toggle('hidden', name !== 'calendar');
    document.getElementById('view-import').classList.toggle('hidden', name !== 'import');
}

