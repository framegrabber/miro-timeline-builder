const dayjs = require('dayjs')

var isoWeeksInYear = require('dayjs/plugin/isoWeeksInYear')
var isLeapYear = require('dayjs/plugin/isLeapYear')
var quarterOfYear = require('dayjs/plugin/quarterOfYear')
var isoWeek = require('dayjs/plugin/isoWeek')
var weekday = require('dayjs/plugin/weekday')

dayjs.extend(weekday)
dayjs.extend(isoWeek)
dayjs.extend(quarterOfYear)
dayjs.extend(isoWeeksInYear)
dayjs.extend(isLeapYear)







// function that returns the number of 
// weeks for a given year
function getWeeksInYear(year) {
    return dayjs(year, 'YYYY').isoWeeksInYear();
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