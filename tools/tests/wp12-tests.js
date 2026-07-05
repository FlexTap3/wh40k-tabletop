// WP12 phone-layout regression: run via  node harness.js wp12-tests.js
// Covers: detection matrix (narrow+coarse -> phone, wide+fine -> desktop, override
// wins, rotation keeps phone, iPad stays desktop), harness-stub safety, injected
// nav gating, sheet open/close class toggling, peek ticker on logEntry, attack
// pulse, and the desktop-DOM-untouched snapshot (#topbar + #side).
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- desktop-DOM-untouched snapshot, part 1: capture the baseline ----------
  // harness init already ran wp12Init() with detection forced off (no screen /
  // matchMedia / document.body under the stubs) — snapshot what desktop mode sees.
  const topbarEl = document.getElementById("topbar"), sideEl = document.getElementById("side");
  const snap = () => [
    topbarEl.innerHTML, topbarEl.children.length,
    sideEl.innerHTML, sideEl.children.length,
  ].join("|");
  const baseline = snap();

  // ---------- harness-stub safety ----------
  assert(typeof screen === "undefined" && wp12Detect() === "desktop", "no screen/matchMedia -> detection no-ops to desktop");
  assert(wp12Mode === "desktop", "harness init resolved to desktop layout");
  assert(wp12Built === false, "no document.body under stubs -> nothing injected at init");

  // ---------- detection matrix ----------
  global.window.matchMedia = q => ({ matches: /pointer:\s*coarse/.test(q) ? global.__coarse : false });
  // node ≥21 ships a read-only global navigator — swap in a writable stub
  Object.defineProperty(global, "navigator", { value: { userAgent: "", maxTouchPoints: 0 }, configurable: true, writable: true });

  global.screen = { width: 390, height: 844 }; global.__coarse = true;
  assert(wp12Detect() === "phone", "narrow (390x844) + coarse -> phone");

  global.screen = { width: 844, height: 390 };
  assert(wp12Detect() === "phone", "rotated phone (844x390, min dim 390) is still a phone");

  global.screen = { width: 1680, height: 1050 }; global.__coarse = false;
  assert(wp12Detect() === "desktop", "wide (1680x1050) + fine -> desktop");

  global.screen = { width: 390, height: 844 }; global.__coarse = false;
  assert(wp12Detect() === "desktop", "narrow but fine pointer -> desktop");

  global.screen = { width: 1680, height: 1050 }; global.__coarse = true;
  assert(wp12Detect() === "desktop", "wide + coarse (touch laptop) -> desktop");

  // iPads deliberately stay desktop — both UA shapes
  global.screen = { width: 768, height: 1024 }; global.__coarse = true;
  global.navigator.userAgent = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)";
  assert(wp12Detect() === "desktop", "iPad UA stays desktop despite narrow+coarse");
  global.navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
  global.navigator.maxTouchPoints = 5;
  assert(wp12Detect() === "desktop", "iPadOS 'Macintosh' UA + touch stays desktop");
  global.navigator.maxTouchPoints = 0;

  // phone UA wins even when screen/pointer look desktop-ish
  global.screen = { width: 1000, height: 2000 }; global.__coarse = false;
  global.navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
  assert(wp12Detect() === "phone", "iPhone UA -> phone regardless of pointer query");
  global.navigator.userAgent = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari";
  assert(wp12Detect() === "phone", "Android Mobile UA -> phone");
  global.navigator.userAgent = "Mozilla/5.0 (Linux; Android 14; Tablet)";
  global.screen = { width: 1280, height: 800 };
  assert(wp12Detect() === "desktop", "Android non-Mobile (tablet) UA -> desktop");
  global.navigator.userAgent = "";

  // ---------- override wins ----------
  let store = {};
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  global.screen = { width: 390, height: 844 }; global.__coarse = true;   // phone-y device...
  store.wh40k_layout = "desktop";
  assert(wp12Resolve() === "desktop", "override 'desktop' beats phone auto-detection");
  global.screen = { width: 1680, height: 1050 }; global.__coarse = false; // desktop-y device...
  store.wh40k_layout = "phone";
  assert(wp12Resolve() === "phone", "override 'phone' beats desktop auto-detection");
  delete store.wh40k_layout;
  assert(wp12Resolve() === "desktop", "no override -> auto detection");
  wp12SetPref("phone");
  assert(store.wh40k_layout === "phone", "wp12SetPref persists to wh40k_layout");
  assert(wp12Mode === "phone", "wp12SetPref applies immediately (no reload)");
  wp12SetPref("auto");
  assert(!("wh40k_layout" in store), "wp12SetPref('auto') clears the override");
  assert(wp12Mode === "desktop", "back on auto -> desktop for this environment");

  // ---------- injected chrome: build + phone-class gating ----------
  const mkClassList = () => { const s = new Set(); return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; },
    contains: c => s.has(c), _s: s };
  };
  document.documentElement = { classList: mkClassList() };
  document.body = { children: [], appendChild(c) { this.children.push(c); } };
  wp12Init(); // second run: body now exists, so the chrome gets built (once)
  assert(wp12Built === true, "chrome built once document.body exists");
  assert(document.body.children.some(c => c.id === "phoneNav"), "#phoneNav injected into <body>");
  assert(document.body.children.some(c => c.id === "wp12Peek"), "#wp12Peek injected into <body>");
  assert(document.body.children.some(c => c.id === "wp12SheetHead"), "#wp12SheetHead injected into <body>");
  assert(wp12Els.nav.children.length === 6, "nav has 6 buttons (Army/Cards/Attack/Setup/Log/Builder)");
  assert(els["bHead"].children.some(c => c.id === "wp12RosterBtn"), "roster toggle button injected into #bHead");
  const builtOnce = document.body.children.length;
  wp12Build();
  assert(document.body.children.length === builtOnce, "wp12Build is idempotent — created once at init");
  assert(!document.documentElement.classList.contains("phone"), "desktop mode: html.phone absent (nav display:none via CSS)");

  wp12Apply("phone");
  assert(document.documentElement.classList.contains("phone"), "wp12Apply('phone') sets html.phone (nav becomes visible)");
  wp12Apply("desktop");
  assert(!document.documentElement.classList.contains("phone"), "wp12Apply('desktop') removes html.phone");

  // ---------- sheet open/close toggles classes ----------
  wp12Apply("phone");
  for (const k in wp12Els.btns) wp12Els.btns[k].classList = mkClassList(); // functional classList for active/pulse assertions
  const html = document.documentElement.classList;
  wp12Nav("army");
  assert(html.contains("wp12-open-side") && !html.contains("wp12-open-log"), "Army nav opens the side sheet");
  assert(wp12SheetOpen === "army" && wp12Els.btns.army.classList.contains("active"), "Army nav button active");
  assert(wp12Els.title.textContent === "Army", "sheet title follows the tab");
  wp12Nav("army");
  assert(!html.contains("wp12-open-side") && wp12SheetOpen === null, "tapping the active tab again closes the sheet");
  assert(!wp12Els.btns.army.classList.contains("active"), "no active nav button once closed");
  wp12Nav("cards"); wp12Nav("setup");
  assert(html.contains("wp12-open-side") && wp12SheetOpen === "setup" && wp12Els.btns.setup.classList.contains("active") && !wp12Els.btns.cards.classList.contains("active"), "switching tabs keeps one sheet + one active button");
  wp12Nav("log");
  assert(html.contains("wp12-open-log") && !html.contains("wp12-open-side"), "Log nav swaps to the log sheet");
  wp12SheetSet(null);
  assert(!html.contains("wp12-open-log") && !html.contains("wp12-open-side"), "wp12SheetSet(null) closes everything");
  wp12Apply("desktop"); wp12Apply("phone"); // leaving phone must clear sheet classes
  wp12Nav("army"); wp12Apply("desktop");
  assert(!html.contains("wp12-open-side") && !html.contains("wp12-open-log"), "switching to desktop clears sheet classes");
  wp12Apply("phone");

  // ---------- peek ticker updates on logEntry ----------
  logEntry("· <b>Ragnar</b> deployed Blood Claws ×10", "sys");
  assert(/Ragnar.*deployed Blood Claws/.test(wp12Els.peek.textContent) && !/<b>/.test(wp12Els.peek.textContent), "peek ticker mirrors the latest log entry, tags stripped");
  logEntry("second entry", "sys");
  assert(/second entry/.test(wp12Els.peek.textContent), "peek ticker tracks the newest entry");

  // ---------- attack pulse (wp3Stage hook) ----------
  wp12SheetSet(null);
  wp12AttackPulse();
  assert(wp12Els.btns.attack.classList.contains("wp12pulse"), "wp12AttackPulse pulses the Attack nav button");
  wp12Nav("attack");
  assert(!wp12Els.btns.attack.classList.contains("wp12pulse"), "opening the Attack sheet clears the pulse");
  wp12SheetSet(null);
  wp12Apply("desktop");
  wp12AttackPulse();
  assert(!wp12Els.btns.attack.classList.contains("wp12pulse"), "no pulse in desktop mode");

  // ---------- desktop-DOM-untouched snapshot, part 2 ----------
  // After a whole phone session, with detection forced off, #topbar and #side are
  // byte-identical to the pre-WP12 baseline (WP12 never writes into them).
  assert(snap() === baseline, "desktop DOM untouched: #topbar + #side snapshot identical after phone session");
  assert(!document.documentElement.classList.contains("phone"), "no .phone class left behind");

  console.log(failed ? "WP12 TESTS: " + failed + " FAILURES" : "WP12 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
