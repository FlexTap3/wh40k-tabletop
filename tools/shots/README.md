# wh40k-shots

**Dev-only** headless-browser screenshot harness for `wh40k-tabletop.html`. Not part of the
shipped product — the app stays a zero-dependency single file; this tooling lives entirely
under `tools/shots/` and is isolated from it.

## Why this exists

Visual verification of the board was effectively blind: the team's usual "headless Brave"
path wedges whenever a GUI Brave window is already open (it shares Brave's user-data-dir,
so a second headless launch collides with the running instance).

This harness uses [Playwright](https://playwright.dev/)'s own bundled Chromium instead.
Launched with `headless: true` and no shared `user-data-dir`, it is a completely separate
browser process/profile from Brave — **it cannot collide with an open GUI Brave window**,
so screenshots work regardless of what else is open on the machine.

It does **not** modify the app. It drives the page the same way a user would, by calling
the app's own globally-scoped functions from `page.evaluate()` (e.g. `loadLayout()`,
`wpImportSelected()`, `draw()`, `fitView()`) — the same functions the app's own `onclick`
handlers call.

## Setup (one-time)

```
cd tools/shots
npm install
npx playwright install chromium
```

`npm install` pulls Playwright into `tools/shots/node_modules/` (gitignored — never
committed). `playwright install chromium` downloads Playwright's own Chromium build into
Playwright's global cache (`~/Library/Caches/ms-playwright` on macOS), separate from any
system/GUI browser.

## Run

```
cd tools/shots
node shoot.js
```

Screenshots are written to `tools/shots/shots-out/` (gitignored):

- `01-default.png` — the app on first load, empty board, desktop viewport (1440x900).
- `02-layout.png` — after selecting the first option in `#terrLayout` and calling the
  app's `loadLayout()`.
- `03-army-deployed.png` — after calling the app's `wpImportSelected()`, which feeds the
  currently-selected `#metaListPick` meta army list into the existing paste-box import
  pipeline (`importArmyList()`); since `#listDeploy` is checked by default in the markup,
  this also deploys the army's tokens onto the board in one call.
- `04-fitview-draw.png` — the board after an explicit `fitView()` + `draw()`, camera
  re-fit to whatever is now on the table.
- `10-phone-default.png` — first load at a phone viewport (390x844), so the mobile
  layout can be eyeballed.

The script exits non-zero (and prints an error) if the `#board` canvas never appears/sizes
on the desktop pass — that's the hard failure signal for "the app didn't render."

## Notes

- The app loads PeerJS from a CDN (`unpkg.com`); the harness uses
  `page.goto(url, {waitUntil:'load'})` rather than `networkidle` and waits for `#board` to
  have non-zero width/height (set by the app's own `resize()`/`fitView()` at init) rather
  than for network activity to settle — the board must render fully offline, and it does.
- `node_modules/` and `shots-out/` are both gitignored; nothing here should ever be
  committed except `shoot.js`, `package.json`, `.gitignore`, and this README.
- If `npx playwright install chromium` fails (no network / sandboxed environment), that's
  a hard blocker to report — there is no fallback browser bundled with this harness.
