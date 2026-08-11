import dayjs from 'dayjs';

import { board, takeStats } from './board.js';
import { updateIndicators } from './today.js';
import { shouldPass } from './indicatorGeometry.js';

// Miro loads this file in a headless iframe when the board opens and keeps it
// running for as long as the board stays open. That is the only clock we get:
// nothing runs while nobody has the board open, and nothing needs to.
const TICK_MS = 10 * 60 * 1000;

export async function init() {
  // Not a credited board call, just an event subscription, so it does not go
  // through run(). It still goes through the shared `board` export rather
  // than the bare `miro` global, so this file has exactly one way of reaching
  // the SDK, same as every other module here.
  board.ui.on('icon:click', async () => {
    await board.ui.openPanel({url: 'app.html'});
  });

  await tick();
  setInterval(tick, TICK_MS);
}

// The date of the last pass we ran, kept in memory rather than in AppData:
// asking the board what we did last would cost the very call this guard exists
// to avoid, and every session having its own answer is correct - a session that
// just opened a board should run a pass regardless of what other sessions did.
let lastPassDate = null;

// Scheduling wrapper only; the actual per-calendar work lives in today.js so
// drawCalendar (src/app.js) can share it instead of running a second copy.
//
// A pass is skipped outright when the date has not changed since the last one:
// its outcome would be identical, and skipping it before the first board call
// is what makes an unchanged board free. The cost is that damage done by
// *other* sessions (someone deleting the circle) is no longer repaired within
// ten minutes but on the next board open - everything this app changes itself
// triggers a pass explicitly.
async function tick() {
  const today = dayjs();
  const dateKey = today.format('YYYY-MM-DD');

  if (!shouldPass(dateKey, lastPassDate)) return;

  // Set before the pass, not after: updateIndicators never throws, so there is
  // no failure for a retry to react to, and a pass that logged its errors and
  // moved on must not be repeated every ten minutes for the rest of the day.
  lastPassDate = dateKey;

  await updateIndicators(today);
  logPassStats(dateKey);
}

// The tick used to be invisible, which is why issue #4 could only ever be a
// hunch. takeStats() already knows what every call cost; this is the one line
// that makes it readable. Silent when the pass made no calls, so a board nobody
// touches keeps a clean console.
function logPassStats(dateKey) {
  const stats = takeStats();
  if (!stats || stats.calls === 0) return;

  console.log(
    `Timeline Builder - indicator pass ${dateKey}: ${stats.calls} calls, ` +
    `${stats.credits.toLocaleString('en-US')} credits, ${Math.round(stats.wallClockMs)} ms`
  );
}

init();
