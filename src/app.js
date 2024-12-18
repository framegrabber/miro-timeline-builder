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
  .addEventListener("click", () => drawCalendar());



// function that returns the number of 
  // weeks for a given year
  function getWeeksInYear(year) {
      return dayjs(year, 'YYYY').isoWeeksInYear();
  }
  
  // function that accepts a week and a year
  // and returns an array of the dates of month
  function getWorkingDayDatesPerWeek(week, year) {
      const weekDays = [];
      for (let day = 1; day <= 5; day++) {
          const date = dayjs().year(year).isoWeek(week).isoWeekday(day);
          weekDays.push(date.format('DD'));
      }
      return weekDays;
  }
  
  
  
  // function that iterates over all weeks of a given 
  // year and returns an array of objects
  // that show the weeknumber and the dates of the week days
  function getWeeks(year) {
      const weeks = [];
      for (let week = 1; week <= getWeeksInYear(year); week++) {
          weeks.push({ weekNumber: week, days: getWorkingDayDatesPerWeek(week, year) });
      }
      return weeks;
  }
  
  // function that calculates the number of working days per month for a given year
  // using dayjs.isoWeekday and returns an array of objects
  // that show the month and the number of working days
  function getWorkingDaysPerMonth(year) {
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
  day: ["#d8aa78", "#f0be86"], 
  month: ["#8ddebd", "#9df7d2"],
  iteration: ["#d37b97", "#ea88a8"],
  quarter: ["#82adc2", "#a0d5ef"]
};

function getColor(number, type) {
  const colors = colorMaps[type];

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
          let monthY = settings.startY - 2 * (shapeHeight + padding);
  
      const months = getWorkingDaysPerMonth(year);
      
      months.forEach(month => {
          let monthWidth = ((shapeWidth + padding) * month.workingDays - padding);
          drawRectangle(month.month, getColor(months.indexOf(month), "month"), monthWidth, shapeHeight, monthX, monthY);
          monthX += monthWidth + padding;
      });
  
  }
  
  //function to draw the weeks and days
  async function drawWeeks(year, settings) {
      const {
          shapeWidth,
          shapeHeight,
          padding
          } = settings;
  
      let weekX = settings.startX;
      let weekY = settings.startY;
      let dayX  = settings.startX;
      let dayY  = settings.startY + shapeHeight + padding;
  
      const weekWidth = shapeWidth * 5 + 4 * padding;
  
      const weeks = getWeeks(year);
  
      weeks.forEach(week => {
          drawRectangle("calendar week " + week.weekNumber.toString(), getColor(week.weekNumber, "week"), weekWidth, shapeHeight, weekX, weekY);
          weekX += weekWidth + padding;
          week.days.forEach(day => {
              drawRectangle(day.toString(), getColor(day, "day"), shapeWidth, shapeHeight, dayX, dayY);
              dayX += shapeWidth + padding;
          });
      });
  
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
  
      let iterationX = settings.startX + (IterationWeekOffset * 5 + IterationDayOffset) * (shapeWidth + padding);
      let iterationY = settings.startY - shapeHeight - padding;
  
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
      let quarterY = settings.startY - 3 * (shapeHeight + padding);
  
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

  async function drawCalendar() {
    const settings = await getSettings();
    const year = settings.year;

    Promise.all([
          drawQuarters(year, settings),
          drawMonths(year, settings),
          drawIterations(year, settings),
          drawWeeks(year, settings)
      ]).finally(() => {
            board.group({ items: allShapes });
            board.ui.closePanel();
      });

    
  }
  
