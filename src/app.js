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
import { CREDITS_PER_ITEM, createLimiter, isRateLimitError } from './rateLimit.js';

const { board } = window.miro;

// Every call to the board goes through here so we stay inside Miro's credit
// budget - see rateLimit.js for why that budget runs out faster than it looks.
const limiter = createLimiter();

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
function drawRow(settings, position, blocks, label, color) {
    const y = calculateYPosition(settings, position);

    return Promise.all(blocks.map((block, index) => drawRectangle(
        label(block, index),
        color(block, index),
        widthOfColumns(settings, block.colSpan),
        settings.shapeHeight,
        xOfColumn(settings, block.colStart),
        y
    )));
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
    return limiter.run(CREDITS_PER_ITEM, () => board.createShape({
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

async function drawMonths(year, settings) {
    return drawRow(settings, 'drawMonths', monthBlocks(year),
        (month) => month.label,
        (month) => getColor(month.index, "month"));
}

async function drawWeeks(year, settings) {
    const { weekPrefix } = settings;

    return drawRow(settings, 'drawWeeks', weekBlocks(year),
        (week) => weekPrefix ? `${weekPrefix} ${week.week}` : `${week.week}`,
        (week) => getColor(week.week, "week"));
}

async function drawIterations(year, settings) {
    const {
        IterationWeekOffset,
        IterationDayOffset,
        daysPerIteration,
        IterationStartNumber,
        IterationPrefix,
        IterationSuffix
    } = settings;

    const iterations = iterationBlocks(year, {
        weekdayIndex: IterationDayOffset,
        weekOffset: IterationWeekOffset,
        daysPerIteration,
        startNumber: IterationStartNumber,
    });

    return drawRow(settings, 'drawIterations', iterations,
        (iteration) => `${IterationPrefix}${iteration.number}${IterationSuffix}`,
        (iteration, index) => getColor(index, "iteration"));
}

async function drawQuarters(year, settings) {
    return drawRow(settings, 'drawQuarters', quarterBlocks(year, settings.qOneStartMonth),
        (quarter) => quarter.label,
        (quarter) => getColor(quarter.index, "quarter"));
}

async function drawDays(year, settings) {
    return drawRow(settings, 'drawDays', dayBlocks(year),
        (day) => day.label,
        (day) => getColor(day.weekday, "day"));
}

async function drawCalendar() {
    const settings = await getSettings();
    const year = settings.year;

    setBusy(true, 'Drawing the calendar...');

    const rows = [
        drawMonths(year, settings), // Always draw months
        drawDays(year, settings) // Always draw days
    ];

    if (settings.drawQuarters) {
        rows.push(drawQuarters(year, settings));
    }
    if (settings.drawIterations) {
        rows.push(drawIterations(year, settings));
    }
    if (settings.drawWeeks) {
        rows.push(drawWeeks(year, settings));
    }

    try {
        // Nothing below may run before every shape actually exists on the
        // board: grouping an empty array fails, and closing the panel unloads
        // the app along with any calls still in flight.
        const shapes = (await Promise.all(rows)).flat();

        if (shapes.length > 1) {
            setBusy(true, 'Grouping the calendar...');
            await limiter.run(CREDITS_PER_ITEM, () => board.group({ items: shapes }));
        }

        await board.ui.closePanel();
    } catch (error) {
        // Leave the panel open so the message is readable and the user can retry.
        setBusy(false, describeDrawFailure(error));
        console.error(error);
    }
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

