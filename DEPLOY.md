# Hosting on GitHub Pages (phones + iPads)

Live GPS in Drive mode only works on an `https://` page. GitHub Pages gives
you one for free at `https://patrick87656.github.io/nissan-guided-test-drive/`.
People open that link once, add it to their home screen, and it then
launches full-screen like an app.

This is a pilot setup on a personal GitHub account and a personal Mapbox
token. Before a wide dealer rollout, move it to Nissan-owned hosting and a
Nissan Mapbox account (see "Moving it later" below).

## Before you start

- **The repo must be public.** Free GitHub Pages needs it. Anyone can read
  the code (there are no secrets in it). Check with IT that a public repo and
  a public web page are OK for a dealer tool.
- **The page has no login.** Anyone who has the link can open it and use the
  Mapbox quota. The token should be URL-restricted (step 2) so other sites
  can't use it.
- **The token is not stored in git.** It goes in a GitHub secret, and the
  deploy workflow writes it into the published site. Anyone who opens the
  live page can still see it, as with every Mapbox web token.

## 1. Create the repo

On github.com: **New repository** → name `nissan-guided-test-drive` →
**Public** → leave it empty (no README or .gitignore) → **Create repository**.

## 2. Mapbox token

For the pilot, reuse the same hosted (URL-restricted) token as the KPR
planner. Its URL restriction is `https://patrick87656.github.io` with **no
path**, which already covers this site too (browsers only send the origin to
Mapbox, so a URL with a path would block the page).

If you ever make a separate token: account.mapbox.com → **Access tokens** →
**Create a token**, default public scopes only, URL restriction
`https://patrick87656.github.io` (or the new host's origin).

## 3. Add the token to the repo

In the repo: **Settings → Secrets and variables → Actions → New repository
secret**. Name it `MAPBOX_TOKEN` and paste the `pk.…` token as the value.

The deploy fails with a clear error if the secret is missing or isn't a
`pk.` token.

## 4. Turn on Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

## 5. Push the code

The push starts the **Deploy to GitHub Pages** workflow (Actions tab, about
1 minute). When it's green, the site is live at
`https://patrick87656.github.io/nissan-guided-test-drive/`.

After the first push, use the normal branch → PR → merge flow. Every merge
to `main` redeploys.

## 6. Install on devices

- **iPhone / iPad (Safari):** open the link → **Share** → **Add to Home
  Screen**. On iOS this only works in Safari.
- **Android (Chrome):** open the link → **⋮** menu → **Install app** (or
  **Add to Home screen**).

The first time someone taps **Start drive**, the device asks for location
access. Choose **Allow While Using App**.

- Keep the screen on during the drive (the app asks the browser to, but
  iOS doesn't always honor it for home-screen apps; set **Auto-Lock** to a
  long time on demo devices).
- GPS stops whenever the screen is off or another app is in front. That's a
  browser rule for all web apps.

## Sharing a route

**Share** makes a link and a QR code for the current route, on phones,
iPads and PCs. Opening the link loads the route on any device with nothing
installed. **Save** and **Load** (the JSON file) work too, and **Print route
card** in the Share dialog prints a one-page sheet with the route's QR code.
A printed card carries the same route data as the link: anyone who scans it
can open the route and read its notes.

- **The route lives inside the link, not on any server.** It is stored after
  the `#`, which browsers never send over the network.
- **Anyone who has the link can read the stops and highlight notes**, and can
  forward it. Treat it like the route file itself.
- **The QR code is drawn on the device.** Nothing is sent to a QR service.
- **Links over about 2000 characters may be cut off by some chat apps.** If a
  link arrives broken, use **Save** and send the file instead.
- On iPhone and iPad a link opens in Safari, not the installed app. To open
  it in the installed app: open the app, tap **Open a shared link**, paste the
  link, tap **Open**.

## Updating

Merge to `main` and the workflow redeploys. Devices pick up the new version
the next time the app is opened; sometimes it takes a second open, because
the cached copy loads first and then refreshes in the background.

## Moving it later

To move to Nissan hosting or a paid Mapbox account:

- **New token:** replace the `MAPBOX_TOKEN` secret (or the host's equivalent)
  and re-run the deploy. Restrict the token to the new site's origin.
- **New host:** the site is static. Publish `index.html`,
  `manifest.webmanifest`, `service-worker.js`, `css/`, `js/` and `icons/`, plus
  a `config.local.js` containing `window.KPR_MAPBOX_TOKEN = "pk.…";`. It must
  be served over `https://` for GPS.

## If something's wrong

| Symptom | Fix |
|---|---|
| Map is blank or shows a token error | Check the token's URL restriction is exactly `https://patrick87656.github.io` (no path, no trailing slash) |
| Workflow fails: "MAPBOX_TOKEN is not set" | Redo step 3. The secret name must match exactly |
| Site URL is a 404 | Set step 4 to **GitHub Actions**, then re-run the workflow (Actions tab → **Run workflow**) |
| "Location blocked" in Drive mode | Allow location for Safari / Chrome in the device settings. Some work PCs block browser location by policy. The simulated drive (▶) still works without GPS |
