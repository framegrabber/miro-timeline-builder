await import("https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js")
import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/isoWeeksInYear.js")
window.dayjs.extend(window.dayjs_plugin_isoWeeksInYear)
import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/isLeapYear.js")
window.dayjs.extend(window.dayjs_plugin_isLeapYear)
import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/quarterOfYear.js")
window.dayjs.extend(window.dayjs_plugin_quarterOfYear)
import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/isoWeek.js")
window.dayjs.extend(window.dayjs_plugin_isoWeek)
import("https://cdn.jsdelivr.net/npm/dayjs@1/plugin/weekday.js")
window.dayjs.extend(window.dayjs_plugin_weekday)


// run this to generate import end extend lines
// plugins = ["isoWeeksInYear", "isLeapYear", "quarterOfYear", "isoWeek", "weekday"]
// 
// plugins.forEach(plugin => {
//     console.log("import(\"https://cdn.jsdelivr.net/npm/dayjs@1/plugin/" + plugin + ".js\")");
//     console.log("window.dayjs.extend(window.dayjs_plugin_" + plugin + ")");
// });

