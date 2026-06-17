# Family Grocery PWA

A simple installable grocery list app for families. The frontend is a static React + Vite app that can be hosted on GitHub Pages. All Google Sheets writes go through a Google Apps Script Web App, so the browser never needs Google API credentials.

## Features

- Shared grocery list stored in Google Sheets
- Add, edit, check, uncheck, delete, refresh, and clear checked items
- Filter active, checked, or all items
- Local family member display name saved in `localStorage`
- Shared family passcode saved in `localStorage` and sent to Apps Script
- Barcode scanning with `@zxing/browser`
- Product lookup through Open Food Facts
- Handwritten list OCR with OpenRouter AI through Apps Script
- Installable PWA with manifest and service worker

## Project Structure

```text
.
├── apps-script/
│   └── Code.js
├── public/
│   ├── icons/
│   │   └── icon.svg
│   ├── manifest.webmanifest
│   └── sw.js
├── src/
│   ├── api.js
│   ├── App.jsx
│   ├── config.js
│   ├── main.jsx
│   └── styles.css
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## Google Sheet Setup

1. Create a new Google Sheet.
2. Rename the first tab to `Items`.
3. Add this header row:

```text
id | name | quantity | category | notes | status | barcode | brand | addedBy | addedAt | updatedAt | checkedAt
```

The Apps Script backend also creates or repairs these headers when it starts, but adding them manually makes setup easier to verify.

Optional catalog import:

1. Add a second tab called `Catalog`.
2. Add this header row:

```text
category | name
```

3. Add one grocery-name option per row.

```text
Produce | Bananas
Produce | Apples
Dairy Eggs & Cheese | Milk
```

In the app, open Settings and tap `Import catalog from Google Sheets`. This imports the catalog into only that device's local name lists. The app does not auto-import on launch.

## Apps Script Setup

1. Open [Google Apps Script](https://script.google.com/).
2. Create a new project.
3. Replace the default code with `apps-script/Code.js`.
4. Open Project Settings.
5. Add these Script Properties:

```text
SPREADSHEET_ID = your Google Sheet ID
FAMILY_PASSCODE = your shared family passcode
REQUIRE_PASSCODE_FOR_READS = true
OPENROUTER_API_KEY = your OpenRouter API key
OPENROUTER_MODEL = openai/gpt-4o-mini
```

`REQUIRE_PASSCODE_FOR_READS` is optional. Set it to `false` or omit it if you want reads to work without a passcode. Writes always require the passcode when `FAMILY_PASSCODE` is set.

`OPENROUTER_API_KEY` is only needed for the AI OCR button on the handwritten-list screen. `OPENROUTER_MODEL` is optional; if omitted, Apps Script uses `openai/gpt-4o-mini`.

The Sheet ID is the long value in a Google Sheets URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

## Deploy Apps Script as a Web App

1. In Apps Script, click Deploy, then New deployment.
2. Select Web app.
3. Set Execute as to `Me`.
4. Set Who has access to `Anyone`.
5. Click Deploy.
6. Copy the Web App URL.

No Google credentials or service account keys belong in this frontend. The Web App URL is safe to configure in the frontend because the passcode and Apps Script logic protect writes.

## Configure the Frontend

Edit `src/config.js`:

```js
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start Vite:

```bash
npm run dev
```

Open the local URL Vite prints in the terminal. Camera barcode scanning requires HTTPS in production, but usually works on `localhost` during development.

## Deploy to GitHub Pages

Build the static app:

```bash
npm run build
```

The production files are generated in `dist/`.

One common GitHub Pages option is to publish from a `gh-pages` branch:

```bash
npm install --save-dev gh-pages
```

Add these scripts to `package.json` if you want that workflow:

```json
{
  "scripts": {
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist"
  }
}
```

Then deploy:

```bash
npm run deploy
```

The included `vite.config.js` uses `base: './'`, which keeps built asset paths friendly for GitHub Pages project sites.

## API Contract

Frontend calls the Apps Script Web App with:

```text
GET  ?action=listItems&passcode=...
GET  ?action=listCatalog&passcode=...
POST { "action": "addItem", "item": {...}, "passcode": "..." }
POST { "action": "updateItem", "id": "...", "updates": {...}, "passcode": "..." }
POST { "action": "deleteItem", "id": "...", "passcode": "..." }
POST { "action": "toggleItem", "id": "...", "status": "checked", "passcode": "..." }
POST { "action": "aiOcr", "imageDataUrl": "data:image/jpeg;base64,...", "passcode": "..." }
POST { "action": "identifyPhotoItem", "imageDataUrl": "data:image/jpeg;base64,...", "passcode": "..." }
```

POST requests are sent as `text/plain;charset=utf-8` with a JSON body to avoid unnecessary browser preflight complexity with Apps Script.

## Data Model

```js
{
  id: string,
  name: string,
  quantity: string,
  category: string,
  notes: string,
  status: 'active' | 'checked',
  barcode: string,
  brand: string,
  addedBy: string,
  addedAt: string,
  updatedAt: string,
  checkedAt: string
}
```

## Notes

- Barcode product data comes from `https://world.openfoodfacts.org/api/v0/product/{barcode}.json`.
- AI OCR and Photo item identification send a resized image to Apps Script, then Apps Script calls OpenRouter. The OpenRouter API key stays in Apps Script Script Properties and is never exposed to the frontend.
- The service worker caches the app shell and visited static files for installability and basic offline loading. Syncing the grocery list still requires a network connection.
