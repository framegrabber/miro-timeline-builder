import dayjs from 'dayjs';

import { board } from './board.js';
import { updateIndicators } from './today.js';

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

// Scheduling wrapper only; the actual per-calendar work lives in today.js so
// drawCalendar (src/app.js) can share it instead of running a second copy.
async function tick() {
  await updateIndicators(dayjs());
}

init();
