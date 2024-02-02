await import("https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js")
await import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/isoWeeksInYear.js")
await import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/weekday.js")
await import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/isLeapYear.js")
await import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/isoWeek.js")
window.dayjs.extend(window.dayjs_plugin_isoWeeksInYear)
window.dayjs.extend(window.dayjs_plugin_isLeapYear)
window.dayjs.extend(window.dayjs_plugin_isoWeek)
window.dayjs.extend(window.dayjs_plugin_weekday)




const settings = {
  shapeWidth: 100,
  shapeHeight: 100,
  padding: 2,
  startX: 500,
  startY: 500,
  IterationWeekOffset: 1,
  IterationDayOffset: 2,
  daysPerIteration: 10,
  IterationStartNumber: 1,
  IterationPrefix: "Iteration ",
  IterationSuffix: "/24",
  qOneStartMonth: 1
  };

drawWeeks(2024, settings)
drawMonths(2024, settings)
drawIterations(2024, settings)
drawQuarters(2024, settings)


// run this to generate import end extend lines
// plugins = ["isoWeeksInYear", "isLeapYear", "quarterOfYear", "isoWeek", "weekday"]
// 
// plugins.forEach(plugin => {
//     console.log("import(\"https://cdn.jsdelivr.net/npm/dayjs@1/plugin/" + plugin + ".js\")");
//     console.log("window.dayjs.extend(window.dayjs_plugin_" + plugin + ")");
// });
