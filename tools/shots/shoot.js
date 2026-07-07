#!/usr/bin/env node
/**
 * wh40k-shots: dev-only headless-Chromium screenshot harness for wh40k-tabletop.html.
 *
 * WHY: the team's usual "headless Brave" verification path wedges whenever a GUI Brave
 * window is already open (shared user-data-dir collision). Playwright ships its own
 * Chromium binary and, launched with no user-data-dir, is a completely separate browser
 * process — it cannot collide with an open Brave window, GUI or otherwise.
 *
 * This script does NOT modify the app. It drives the already-shipped page by calling the
 * app's own global functions via page.evaluate() (loadLayout(), wpImportSelected(), draw(),
 * fitView(), ...) — the same functions the app's own onclick handlers call.
 *
 * Usage:  node shoot.js
 * Output: tools/shots/shots-out/*.png
 */

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const APP_PATH = path.resolve(__dirname, "..", "..", "wh40k-tabletop.html");
const OUT_DIR = path.resolve(__dirname, "shots-out");
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const PHONE_VIEWPORT = { width: 390, height: 844 };
const SETTLE_MS = 350;
const BOARD_WAIT_MS = 15000;

function log(...args) {
  console.log("[shoot]", ...args);
}

async function waitForBoard(page) {
  await page.waitForSelector("#board", { timeout: BOARD_WAIT_MS, state: "attached" });
  // Board is drawn on a canvas sized by resize()/fitView() at app init (bottom of the
  // inline <script>). Give it a beat past DOM-attach so init has actually run and the
  // canvas has non-zero backing-store dimensions.
  await page.waitForFunction(
    () => {
      const cv = document.getElementById("board");
      return !!(cv && cv.width > 0 && cv.height > 0);
    },
    { timeout: BOARD_WAIT_MS }
  );
}

async function settle(page, ms = SETTLE_MS) {
  await page.waitForTimeout(ms);
}

async function shoot(page, outDir, filename) {
  const file = path.join(outDir, filename);
  await page.screenshot({ path: file });
  const { size } = fs.statSync(file);
  log(`wrote ${filename} (${size} bytes)`);
  return { filename, path: file, size };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(APP_PATH)) {
    console.error(`[shoot] app HTML not found at ${APP_PATH}`);
    process.exit(1);
  }
  const fileUrl = "file://" + APP_PATH;

  // Launch a totally clean, isolated Chromium instance — no shared profile dir, so an
  // already-open GUI Brave (or any other browser) cannot wedge this launch.
  const browser = await chromium.launch({ headless: true });
  const written = [];
  let boardSeen = false;

  try {
    // ---------- Desktop pass ----------
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") log("page console error:", msg.text());
    });
    page.on("pageerror", (err) => log("page error:", err.message));

    log(`loading ${fileUrl}`);
    // waitUntil:'load' rather than 'networkidle' — the app pulls PeerJS from a CDN
    // (unpkg.com) and must still render the board fully offline; we don't want to block
    // on (or fail because of) that network request.
    await page.goto(fileUrl, { waitUntil: "load", timeout: 30000 }).catch((e) => {
      log("page.goto reported an error (continuing, app should still render offline):", e.message);
    });

    try {
      await waitForBoard(page);
      boardSeen = true;
    } catch (e) {
      log("ERROR: #board canvas never appeared/sized:", e.message);
    }

    if (boardSeen) {
      await settle(page);
      written.push(await shoot(page, OUT_DIR, "01-default.png"));

      // ---- (a) terrain layout loaded ----
      try {
        const loaded = await page.evaluate(() => {
          const sel = document.getElementById("terrLayout");
          const opt = sel && sel.querySelector("option");
          if (!opt) return { ok: false, reason: "no <option> in #terrLayout" };
          sel.value = opt.value;
          if (typeof loadLayout !== "function") return { ok: false, reason: "loadLayout() not found" };
          loadLayout();
          return { ok: true, name: opt.value };
        });
        if (loaded.ok) {
          log(`loadLayout() -> "${loaded.name}"`);
          await settle(page);
          written.push(await shoot(page, OUT_DIR, "02-layout.png"));
        } else {
          log("SKIP layout state:", loaded.reason);
        }
      } catch (e) {
        log("SKIP layout state (exception):", e.message);
      }

      // ---- (b) army mustered/deployed ----
      // wpImportSelected() is the app's own "Auto-import" dropdown handler: it feeds the
      // #metaListPick-selected meta list into the existing paste-box import pipeline
      // (importArmyList()), which — because #listDeploy is checked by default in the
      // markup — also deploys the tokens onto the board in one call.
      try {
        const deployed = await page.evaluate(() => {
          const sel = document.getElementById("metaListPick");
          if (!sel || !sel.options.length) return { ok: false, reason: "#metaListPick has no options" };
          if (typeof wpImportSelected !== "function") return { ok: false, reason: "wpImportSelected() not found" };
          wpImportSelected();
          // myArmy is a top-level `let` in the app's classic <script>, so it's not reachable
          // as window.myArmy — read the rendered #armySummary the app itself produced instead.
          const summary = document.getElementById("armySummary");
          return {
            ok: true,
            listName: sel.options[sel.selectedIndex]?.textContent,
            summary: summary ? summary.textContent.trim().replace(/\s+/g, " ") : null,
          };
        });
        if (deployed.ok) {
          log(`wpImportSelected() -> "${deployed.listName}" (${deployed.summary})`);
          await settle(page);
          written.push(await shoot(page, OUT_DIR, "03-army-deployed.png"));
        } else {
          log("SKIP army-deployed state:", deployed.reason);
        }
      } catch (e) {
        log("SKIP army-deployed state (exception):", e.message);
      }

      // ---- (c) current board after an explicit draw(), fit to content ----
      try {
        const drew = await page.evaluate(() => {
          if (typeof fitView === "function") fitView(); // recenter/zoom on whatever is now on the table
          if (typeof draw !== "function") return { ok: false, reason: "draw() not found" };
          draw();
          return { ok: true };
        });
        if (drew.ok) {
          await settle(page);
          written.push(await shoot(page, OUT_DIR, "04-fitview-draw.png"));
        } else {
          log("SKIP final draw() state:", drew.reason);
        }
      } catch (e) {
        log("SKIP final draw() state (exception):", e.message);
      }
    }

    await context.close();

    // ---------- Phone viewport pass ----------
    const phoneContext = await browser.newContext({ viewport: PHONE_VIEWPORT });
    const phonePage = await phoneContext.newPage();
    log(`loading ${fileUrl} (phone viewport)`);
    await phonePage.goto(fileUrl, { waitUntil: "load", timeout: 30000 }).catch((e) => {
      log("phone page.goto reported an error (continuing):", e.message);
    });
    try {
      await waitForBoard(phonePage);
      await settle(phonePage);
      written.push(await shoot(phonePage, OUT_DIR, "10-phone-default.png"));
    } catch (e) {
      log("ERROR: phone #board canvas never appeared/sized:", e.message);
    }
    await phoneContext.close();
  } finally {
    await browser.close();
  }

  log("done. files written:");
  written.forEach((w) => log(`  ${w.filename}  (${w.size} bytes)`));

  if (!boardSeen) {
    console.error("[shoot] FATAL: board canvas never appeared on desktop pass.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[shoot] unhandled error:", e);
  process.exit(1);
});
