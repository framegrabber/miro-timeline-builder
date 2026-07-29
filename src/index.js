import dayjs from 'dayjs';

import { board } from './board.js';
import { findCalendars } from './anchors.js';
import { syncIndicator } from './today.js';

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

// Never throws. This runs in every board viewer's session; one broken calendar
// entry must not take somebody's board down with it.
async function tick() {
  let calendars;
  try {
    calendars = await findCalendars();
  } catch (error) {
    // Nothing to iterate, so this is one failure for the whole tick.
    console.error('Timeline Builder: could not update the TODAY indicator', error);
    return;
  }

  const today = dayjs();
  for (const calendar of calendars) {
    try {
      await syncIndicator(calendar, today);
    } catch (error) {
      // Isolated per calendar: if this one fails deterministically (a style
      // value Miro rejects, say), it must not starve every other calendar on
      // the board of its update, tick after tick, forever.
      console.error(`Timeline Builder: failed to update the TODAY indicator for calendar ${calendar.entry.calendarId}`, error);
    }
  }
}

init();
