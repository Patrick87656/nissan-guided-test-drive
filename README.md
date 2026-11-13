# Nissan Guided Test Drive

A route planner for Nissan dealers. A dealer plans a customer test drive
route once, tags **highlights** along it (the things to point out:
acceleration on an on-ramp, Driver Assist on the highway, a quiet stretch,
etc.), and shares it with the sales team. On the drive, the app gives
turn-by-turn guidance and announces each highlight with the salesperson's
notes, so every test drive covers the same talking points.

It is a simplified copy of the internal KPR Route Planner. Compared with
that tool it has **no** route library / Browse panel, **no** evaluation setup
or vehicle list, and **no** Good/Bad scene ratings, Send results, or results
view. Route files and route links are the same format, so a KPR route opens
here (its vehicle list is ignored).

## What it uses

- Mapbox GL JS for the map (Night / Day toggle)
- Mapbox **Directions API** for road-snapped routing in fixed stop order
- Mapbox **Geocoding API** for place and address search

## Using it

1. **Plan** (PC or iPad): search or click the map to add stops in order.
   Switch to **Add Highlight** and click two points on the route to mark a
   stretch, then pick a type, a label and notes for the salesperson.
2. **Share** (any device, phones included): **Share** gives a QR code and a
   link; **Save** downloads the route file. **Load** opens a saved file.
   **Print route card** (in the Share dialog) prints a one-page sheet for the
   sales desk: map, numbered stops, highlights with notes, and the route's
   QR code. It uses the browser's print dialog, so "Save as PDF" works too.
3. **Drive** (phone or iPad in the car): open the route, tap **Start drive**.
   The app follows GPS, gives turn-by-turn directions, and shows and speaks
   each highlight as it comes up. **▶** simulates the drive without GPS.
   Untick **Read highlight notes aloud** (above Start drive) to have the app
   say only the highlight's name; the notes stay on screen for the
   salesperson to say in their own words. The choice is remembered on that
   device. The round speaker button in Drive mode still mutes all voice.

On iPhone and iPad a link or scanned QR code opens in Safari, not the
installed home-screen app. To open a route in the installed app, tap **Open a
shared link**, paste the link and tap **Open**.

The route travels inside the link itself (the part after `#`), so no server
receives it, and the QR code is drawn on the device. Anyone holding the link
can read the stops and notes. See [DEPLOY.md](DEPLOY.md#sharing-a-route).

## Setup for local development

1. Copy `config.local.js.example` to `config.local.js`.
2. Paste a Mapbox public token into it: `window.KPR_MAPBOX_TOKEN = "pk.…";`
   (`config.local.js` is gitignored and never committed.)
3. Serve the folder (Mapbox GL won't run from a `file://` page):

```powershell
python -m http.server 8000
# then open http://localhost:8000
```

Hosting on GitHub Pages (needed for live GPS, which requires `https://`) is
covered in **[DEPLOY.md](DEPLOY.md)**. The workflow in
`.github/workflows/deploy-pages.yml` publishes the site on every push to `main`.

## Project layout

- `js/map.js`, `js/waypoints.js`, `js/routing.js`, `js/search.js` — map,
  stops, Directions routing, place search
- `js/scenes.js` — highlights (called "scenes" in the code)
- `js/drive.js` — Drive mode: GPS, guidance, highlight alerts, simulator
- `js/storage.js` — Save / Load route files
- `js/route-codec.js`, `js/share.js`, `js/open-link.js` — share links and QR
- `js/geo-permission.js`, `js/geo-dialog.js`, `js/enable-location-strip.js`
  — location permission prompts
- `js/print-card.js` — the printable route card (print styles at the end of
  `css/style.css`)
- `js/voice-prefs.js` — the "Read highlight notes aloud" setting
- `js/sheet.js` — phone bottom-sheet panel; `js/app.js` — wiring

The JavaScript namespace is still `KPR.*` (inherited from the internal tool);
it is not shown to users. Saved settings use their own `ngtd*` storage keys
and the service worker uses `ngtd-` caches, so this app and the KPR planner
don't interfere when both are hosted on the same `github.io` address.

The QR code comes from a vendored copy of Project Nayuki's QR Code generator
(no CDN): `js/vendor/qrcodegen-v1.8.0-es5.js`, from
https://github.com/nayuki/QR-Code-generator/releases/tag/v1.8.0 (v1.8.0,
commit `720f62bddb7226106071d4728c292cb1df519ceb`), MIT License.

## Running the tests

No install needed. From this folder:

```powershell
powershell -NoProfile -File tests\run-tests.ps1
```

It opens `tests/run.html` in headless Edge (or Chrome) and prints
`RESULT: PASS` or `RESULT: FAIL`. The tests don't use Mapbox or the network.
They cover the link codec, route files, sharing, the open-link dialog,
location permission UI, and a DOM-safety audit.
