## Timeline Builder

**&nbsp;ℹ&nbsp;Note**:

- We recommend a Chromium-based web browser for local development with HTTP. \
  Safari enforces HTTPS; therefore, it doesn't allow localhost through HTTP.
- For more information, visit our [developer documentation](https://developers.miro.com).

### How to start locally

- Run `npm i` to install dependencies.
- Run `npm start` to start developing. \
  Your URL should be similar to this example:
 ```
 http://localhost:3000
 ```
- Paste the URL under **App URL** in your
  [app settings](https://developers.miro.com/docs/build-your-first-hello-world-app#step-3-configure-your-app-in-miro).
- Open a board; you should see your app in the app toolbar or in the **Apps**
  panel.

### How to build the app

- Run `npm run build`. \
  This generates a static output inside [`dist/`](./dist), which you can host on a static hosting
  service.

### Vacation data (SAPVac)

The **Vacation** tab draws absence bars from JSON that this app does not fetch
itself — the data lives in an SAP Fiori team calendar, which a Miro plugin
inside an iframe cannot read. That extraction is a bookmarklet in a separate
repo: [SAPVac](https://github.com/framegrabber/SAPVac).

To get the data:

1. Build the bookmarklet once: in the SAPVac repo run
   `./create_bookmarklet.sh -c sapvac.js` (needs `uglify-js` globally) and save
   the clipboard contents as a browser bookmark.
2. Open the SAP Fiori team calendar and run the bookmark. It pages through nine
   months and copies the result to the clipboard.
3. Paste it into **Vacation Data** here and press **Draw Vacation**.

Each entry looks like this — the field names are the contract between the two
repos, so do not rename them on either side:

```json
{
  "employeeName": "Erika Mustermann",
  "vacationPeriod": "2026-03-02 – 2026-03-06",
  "vacationStartDate": "2026-03-02",
  "vacationEndDate": "2026-03-06",
  "vacationDuration": 5
}
```

- `vacationStartDate` / `vacationEndDate` (ISO) position the bar. A missing
  `vacationEndDate` is read as a same-day absence, not as an error.
- `vacationPeriod` is the label SAP rendered, passed through verbatim and
  printed on the bar under the employee name — so whatever wording the calendar
  uses ends up visible on the board. `sapvac.js` splits it on an en dash.
- `vacationDuration` counts working days (Mon–Fri) between the two dates.

Drawing used to live in SAPVac as `drawshapes.js` and moved here on purpose: as
a bookmarklet it could not read the plugin's shape metadata and had to align
bars relative to each other instead of to calendar dates, which brought the same
off-by-one back three times. There is now one column calculation, in
[`src/calendar.js`](./src/calendar.js), and it is covered by tests.

### Folder structure

<!-- The following tree structure is just an example -->

```
.
├── src
│  ├── assets
│  │  └── style.css
│  ├── app.js      // The code for the app lives here
│  └── index.js    // The code for the app entry point lives here
├── app.html       // The app itself. It's loaded on the board inside the 'appContainer'
└── index.html     // The app entry point. This is what you specify in the 'App URL' box in the Miro app settings
```

### About the app

This sample app provides you with boilerplate setup and configuration that you can further customize to build your own app.

<!-- describe shortly the purpose of the sample app -->

Built using [`create-miro-app`](https://www.npmjs.com/package/create-miro-app).

This app uses [Vite](https://vitejs.dev/). \
If you want to modify the `vite.config.js` configuration, see the [Vite documentation](https://vitejs.dev/guide/).
