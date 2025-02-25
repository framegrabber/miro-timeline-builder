import './assets/style.css'

import dayjs, { Dayjs } from 'dayjs';

import isoWeeksInYear from 'dayjs/plugin/isoWeeksInYear'
import isLeapYear from 'dayjs/plugin/isLeapYear'
import isoWeek from 'dayjs/plugin/isoWeek'
import weekday from 'dayjs/plugin/weekday'

dayjs.extend(weekday)
dayjs.extend(isoWeek)
dayjs.extend(isoWeeksInYear)
dayjs.extend(isLeapYear)

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
  
  // function that calculates the number of working days per month for a given year
  // using dayjs.isoWeekday and returns an array of objects
  // that show the month and the number of working days
  const memoizedWorkingDays = new Map();
  function getWorkingDaysPerMonth(year) {
      const key = `${year}`;
      if (memoizedWorkingDays.has(key)) {
          return memoizedWorkingDays.get(key);
      }
      const months = [];
      
      for (let m = 0; m <= 11; m++) {
          let workingDays = 0;
    
          const month = dayjs().set('year',year).month(m);
          const totalDays = month.daysInMonth();

          for (let day = 1; day <= totalDays; day++) {
              if (month.date(day).isoWeekday() <= 5) {
                  workingDays++;
              }
          }
       
          months.push({ month: month.format('MMMM'), workingDays });
      }
      memoizedWorkingDays.set(key, months);
      return months;
  }  
  
  // function that sums up all working days per year and returns the sum
  // takes the output of getWorkingDaysPerMonth as input
  function getTotalWorkingDaysPerYear(year) {
  
      const months = getWorkingDaysPerMonth(year);
  
      let sum = 0;
      for (let i = 0; i < months.length; i++) {
          sum += months[i].workingDays;
      }
      return sum;
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
    const {
        shapeWidth,
        shapeHeight,
        padding
    } = settings;
    
    let monthX = settings.startX;
    let monthY = calculateYPosition(settings, 'drawMonths');

    const months = getWorkingDaysPerMonth(year);
    
    months.forEach(month => {
        let monthWidth = ((shapeWidth + padding) * month.workingDays - padding);
        drawRectangle(month.month, getColor(months.indexOf(month), "month"), monthWidth, shapeHeight, monthX, monthY);
        monthX += monthWidth + padding;
    });
}

//function to draw the weeks of the year
async function drawWeeks(year, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding,
        weekPrefix
    } = settings;

    let weekX = settings.startX;
    let weekY = calculateYPosition(settings, 'drawWeeks');

    // Get first day of the year and its week properties
    const firstDay = dayjs(`${year}-01-01`);
    const firstWeek = firstDay.isoWeek();
    const lastDay = dayjs(`${year}-12-31`);
    const lastWeek = lastDay.isoWeek();

    // Adjust starting position based on what weekday Jan 1st is
    const initialOffset = (firstDay.isoWeekday() - 1) * (shapeWidth + padding);
    weekX -= initialOffset;

    // Handle year boundary cases
    const startWeek = (firstWeek === 1) ? 1 : firstWeek;
    const endWeek = (lastWeek === 1) ? 52 : lastWeek;

    for (let week = startWeek; week <= endWeek; week++) {
        const weekWidth = shapeWidth * 5 + 4 * padding;
        const weekLabel = weekPrefix ? `${weekPrefix} ${week}` : `${week}`;
        drawRectangle(weekLabel, getColor(week, "week"), weekWidth, shapeHeight, weekX, weekY);
        weekX += weekWidth + padding;
    }
}
  
async function drawIterations(year, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding,
        IterationWeekOffset,
        IterationDayOffset,
        daysPerIteration,
        IterationStartNumber,
        IterationPrefix,
        IterationSuffix
      } = settings;

    const firstDayOfYear = dayjs(`${year}-01-01`).isoWeekday(); // 1-5 (Mon-Fri)
    const desiredStartDay = IterationDayOffset + 1; // Convert 0-based to 1-5 (Mon-Fri)
    
    // Calculate initial offset, allowing for negative values to start in previous year
    let dayOffset = (desiredStartDay - firstDayOfYear);
    
    let iterationX = settings.startX + 
        (IterationWeekOffset * 5 + dayOffset) * (shapeWidth + padding);
    let iterationY = calculateYPosition(settings, 'drawIterations');

    const numberOfIterations = Math.ceil((getTotalWorkingDaysPerYear(year) - IterationWeekOffset * 5 - IterationDayOffset) / daysPerIteration);

    const iterationWidth = shapeWidth * daysPerIteration + (daysPerIteration - 1) * padding;

    for (let iteration = 0; iteration < numberOfIterations; iteration++) {
        drawRectangle(IterationPrefix + (iteration + IterationStartNumber).toString() + IterationSuffix,
                      getColor(iteration, "iteration"),
                      iterationWidth, shapeHeight,
                      iterationX, iterationY);
        iterationX += iterationWidth + padding;
    }

}
async function drawQuarters(year, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding,
        qOneStartMonth
    } = settings;

    let quarterX = settings.startX;
    let quarterY = calculateYPosition(settings, 'drawQuarters');

    const quarters = getWorkingDaysPerQuarter(year, qOneStartMonth);

    quarters.forEach(quarter => {
        let quarterWidth = ((shapeWidth + padding) * quarter.workingDays - padding);
        drawRectangle(quarter.quarter, getColor(quarters.indexOf(quarter), "quarter"), quarterWidth, shapeHeight, quarterX, quarterY);
        quarterX += quarterWidth + padding;
    });
}

function getWorkingDaysBetweenMonths(year, startMonth, endMonth) {

  const months = getWorkingDaysPerMonth(year);

  return months.reduce((total, month, index) => {
    if(index >= startMonth && index < endMonth){
      return total + month.workingDays;
    }
    return total;
  }, 0);

}


function getWorkingDaysPerQuarter(year, qOneStartMonth) {
    const quarters = [];
    
    const startMonths = [];
    startMonths.push(qOneStartMonth);

    for (let q = 1; q <= 3; q++) {
        startMonths.push( q * 3 + qOneStartMonth );
    }

    const months = getWorkingDaysPerMonth(year);

    if (qOneStartMonth > 0) {
        quarters.push({
          quarter: "Q4/" + (year - 1).toString(),  
          workingDays: getWorkingDaysBetweenMonths(year, 0, qOneStartMonth)
        });
      };
    
    startMonths.forEach((startMonthOfCurrentQuarter, indexOfCurrentStartMonth) => {
        let startMonthOfNextQuarter = indexOfCurrentStartMonth + 1 < startMonths.length 
            ? startMonths[indexOfCurrentStartMonth + 1]
            : 12;
  
        quarters.push({
            quarter: "Q" + (startMonths.indexOf(startMonthOfCurrentQuarter) + 1).toString() + "/" + year.toString(),
            workingDays: getWorkingDaysBetweenMonths(year, startMonthOfCurrentQuarter, startMonthOfNextQuarter) 
        });
    });

    return quarters;
}



async function drawDays(year, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding
    } = settings;

    let dayX = settings.startX;
    let dayY = calculateYPosition(settings, 'drawDays');

    const startDate = dayjs(`${year}-01-01`);
    const endDate = dayjs(`${year}-12-31`);
    let currentDate = startDate;

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate)) {
        const weekday = currentDate.isoWeekday();
        if (weekday <= 5) {
            drawRectangle(
                currentDate.format('DD'), 
                getColor(weekday, "day"),  // Pass weekday instead of date
                shapeWidth, 
                shapeHeight, 
                dayX, 
                dayY
            );
            dayX += shapeWidth + padding;
        }
        currentDate = currentDate.add(1, 'day');
    }
}async function drawCalendar() {
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

