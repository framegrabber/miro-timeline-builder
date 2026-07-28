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

const { board } = window.miro;

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

let allShapes = [];

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


document
  .getElementById("submit")
  .addEventListener("click", (event) => {
    const yearInput = document.getElementById('year');
    if (!validateYear(yearInput)) {
        event.preventDefault();
        return;
    }
    drawCalendar();
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
function drawRow(settings, position, blocks, label, color) {
    const y = calculateYPosition(settings, position);

    blocks.forEach((block, index) => {
        drawRectangle(
            label(block, index),
            color(block, index),
            widthOfColumns(settings, block.colSpan),
            settings.shapeHeight,
            xOfColumn(settings, block.colStart),
            y
        );
    });
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

  
async function drawRectangle(content, color, width, height, x, y){
    const shape = await board.createShape({
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
    });

    allShapes.push(shape);
    return shape;
}

async function drawMonths(year, settings) {
    drawRow(settings, 'drawMonths', monthBlocks(year),
        (month) => month.label,
        (month) => getColor(month.index, "month"));
}

async function drawWeeks(year, settings) {
    const { weekPrefix } = settings;

    drawRow(settings, 'drawWeeks', weekBlocks(year),
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

    drawRow(settings, 'drawIterations', iterations,
        (iteration) => `${IterationPrefix}${iteration.number}${IterationSuffix}`,
        (iteration, index) => getColor(index, "iteration"));
}

async function drawQuarters(year, settings) {
    drawRow(settings, 'drawQuarters', quarterBlocks(year, settings.qOneStartMonth),
        (quarter) => quarter.label,
        (quarter) => getColor(quarter.index, "quarter"));
}

async function drawDays(year, settings) {
    drawRow(settings, 'drawDays', dayBlocks(year),
        (day) => day.label,
        (day) => getColor(day.weekday, "day"));
}

async function drawCalendar() {
    const settings = await getSettings();
    const year = settings.year;

    const drawPromises = [
        drawMonths(year, settings), // Always draw months
        drawDays(year, settings) // Always draw days
    ];

    if (settings.drawQuarters) {
        drawPromises.push(drawQuarters(year, settings));
    }
    if (settings.drawIterations) {
        drawPromises.push(drawIterations(year, settings));
    }
    if (settings.drawWeeks) {
        drawPromises.push(drawWeeks(year, settings));
    }

    Promise.all(drawPromises).finally(() => {
        board.group({ items: allShapes });
        board.ui.closePanel();
    });
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

