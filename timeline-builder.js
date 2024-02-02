const dayjs = require('dayjs')

var isoWeeksInYear = require('dayjs/plugin/isoWeeksInYear')
var isLeapYear = require('dayjs/plugin/isLeapYear')
var isoWeek = require('dayjs/plugin/isoWeek')
var weekday = require('dayjs/plugin/weekday')

dayjs.extend(weekday)
dayjs.extend(isoWeek)
dayjs.extend(isoWeeksInYear)
dayjs.extend(isLeapYear)


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
    
        const month = dayjs().year(year).month(m);
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

    months = getWorkingDaysPerMonth(year);

    let sum = 0;
    for (let i = 0; i < months.length; i++) {
        sum += months[i].workingDays;
    }
    return sum;
}

function getColor(number, type) {
    const weekColors      = ["#ffc107", "#ff9800"];
    const dayColors       = ["#448aff", "#1565c0"];
    const monthColors     = ["#f44336", "#ad1457"];
    const iterationColors = ["#009688", "#8bc34a"];
    const quarterColors   = ["#119633", "#2bc74f"];

    if (type === "week") {
        return number % 2 === 0 ? weekColors[0] : weekColors[1];
    } else if (type === "day") {
        return number % 2 === 0 ? dayColors[0] : dayColors[1];
    } else if (type === "month") {  
        return number % 2 === 0 ? monthColors[0] : monthColors[1];
    } else if (type === "iteration") {  
        return number % 2 === 0 ? iterationColors[0] : iterationColors[1];
    } else if (type === "quarter") {
        return number % 2 === 0 ? quarterColors[0] : quarterColors[1];
    }
}

async function drawRectangle(content, color, width, height, x, y){
    await miro.board.createShape({
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
      })
    };

const settings = {
    shapeWidth: 100,
    shapeHeight: 100,
    padding: 2,
    startX: 500,
    startY: 500
    };



function drawMonths(months, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding
        } = settings;
    
        let monthX = settings.startX;
        let monthY = settings.startY - 2 * (shapeHeight + padding);
    
    months.forEach(month => {
        monthWidth = ((shapeWidth + padding) * month.workingDays - padding);
        drawRectangle(month.month, getColor(months.indexOf(month), "month"), monthWidth, shapeHeight, monthX, monthY);
        monthX += monthWidth + padding;
    });

}

//function to draw the weeks and days
// takes the output of getWorkingDaysPerMonth
function drawWeeks(weeks, settings) {
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

    weeks.forEach(week => {
        drawRectangle(week.weekNumber.toString(), getColor(week.weekNumber, "week"), weekWidth, shapeHeight, weekX, weekY);
        weekX += weekWidth + padding;
        week.days.forEach(day => {
            drawRectangle(day.toString(), getColor(day, "day"), shapeWidth, shapeHeight, dayX, dayY);
            dayX += shapeWidth + padding;
        });
    });

}

function drawIterations(year, weekOffset, DayOffset, daysPerIteration, startNumber, prefix, suffix, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding
      } = settings;

    let iterationX = settings.startX + (weekOffset * 5 + DayOffset) * (shapeWidth + padding);
    let iterationY = settings.startY - shapeHeight - padding;

    const numberOfIterations = Math.ceil((getTotalWorkingDaysPerYear(year) - weekOffset * 5 - DayOffset) / daysPerIteration);

    const iterationWidth = shapeWidth * daysPerIteration + (daysPerIteration - 1) * padding;

    for (let iteration = 0; iteration < numberOfIterations; iteration++) {
        drawRectangle(prefix + (iteration + startNumber).toString() + suffix,
                      getColor(iteration, "iteration"),
                      iterationWidth, shapeHeight,
                      iterationX, iterationY);
        iterationX += iterationWidth + padding;
    }

}

function drawQuarters(year, qOneStartMonth, settings) {
    const {
        shapeWidth,
        shapeHeight,
        padding
    } = settings;

    let quarterX = settings.startX;
    let quarterY = settings.startY - 3 * (shapeHeight + padding);

    const quarters = getWorkingDaysPerQuarter(year, qOneStartMonth);

    quarters.forEach(quarter => {
        quarterWidth = ((shapeWidth + padding) * quarter.workingDays - padding);
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

// drawWeeks(getWeeks(2024), settings)
// drawMonths(getWorkingDaysPerMonth(2024), settings)
// drawIterations(2024,1,2,10,1,"Sprint ", "/24", settings)
// drawQuarters(2024, 1, settings)