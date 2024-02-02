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
        drawRectangle(week.week.toString(), getColor(week.week, "week"), weekWidth, shapeHeight, weekX, weekY);
        weekX += weekWidth + padding;
        week.days.forEach(day => {
            drawRectangle(day.toString(), getColor(day, "day"), shapeWidth, shapeHeight, dayX, dayY);
            dayX += shapeWidth + padding;
        });
    });
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

function getNumberOfCalendarWeeks(year) {

    const isoCalendar = new Intl.DateTimeFormat('en-US', {calendar: 'iso8601'})

    const jan1 = new Date(year, 0, 1)
    const dec31 = new Date(year, 11, 31)

    const startWeek = isoCalendar.getWeekOfYear(jan1) 
    const endWeek = isoCalendar.getWeekOfYear(dec31)

    return endWeek;
}

console.log(getNumberOfCalendarWeeks(2022));
console.log(getNumberOfCalendarWeeks(2023));
console.log(getNumberOfCalendarWeeks(2024));
console.log(getNumberOfCalendarWeeks(2025));



function weeks(year) {
    var weeks = [];
    for (var i = 1; i <= 53; i++) {
        weeks.push({
            week: i,
            days: workingDaysPerWeek(i, year)
        });
    }
    return weeks;
}

function workingDaysPerWeek(week, year) {
    var date = new Date(year, 0, 1 + (week - 1) * 7);
    var days = [];
    while (isWeekday(date)) {
        days.push(new Date(date).getDate());
        date.setDate(date.getDate() + 1);
    }
    return days;
}

function isWeekday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}