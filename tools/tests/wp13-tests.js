// WP13 nav & token-action-menu regression: run via  node harness.js wp13-tests.js
// Covers: reordered phone nav (Attack promoted, Setup demoted to ⚙, still 6 buttons),
// context auto-surfacing (wp13OnStage / wp13AfterRoll / wp13BoardFocus, phone vs
// desktop, AI/manual rolls leave the sheet alone), and the token action menu (open
// selects the token, wounds stepper, battle-shock, rotate, hidden, attach/detach,
// two-tap delete, Esc close), plus the desktop-DOM-untouched snapshot.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- desktop snapshot baseline (same trick as wp12-tests) ----------
  const topbarEl = document.getElementById("topbar"), sideEl = document.getElementById("side");
  const snap = () => [
    topbarEl.innerHTML, topbarEl.children.length,
    sideEl.innerHTML, sideEl.children.length,
  ].join("|");
  const baseline = snap();

  // ---------- build the injected chrome (functional classLists for assertions) ----------
  const mkClassList = () => { const s = new Set(); return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; },
    contains: c => s.has(c), _s: s };
  };
  document.documentElement = { classList: mkClassList() };
  document.body = { children: [], appendChild(c) { this.children.push(c); } };
  wp12Init();
  for (const k in wp12Els.btns) wp12Els.btns[k].classList = mkClassList();

  // ---------- WP13 step 1: nav order ----------
  assert(wp12Els.nav.children.length === 6, "nav still has 6 buttons (wp12 contract)");
  const order = wp12Els.nav.children.map(b => b.id).join(",");
  assert(order === "wp12nav-army,wp12nav-attack,wp12nav-cards,wp12nav-log,wp12nav-builder,wp12nav-setup",
    "nav order: Army, Attack, Cards, Log, Builder, Setup — Attack promoted, Setup last");
  assert(wp12Els.btns.setup.textContent === "⚙", "Setup button demoted to a ⚙ icon");
  wp12Apply("phone");
  wp12Nav("setup");
  assert(wp12SheetOpen === "setup" && wp12Els.title.textContent === "Setup", "⚙ still opens the Setup pane, titled Setup");
  wp12SheetSet(null);

  // ---------- WP13 step 2: context auto-surfacing ----------
  wp13OnStage();
  assert(wp12SheetOpen === "attack", "phone: wp13OnStage opens the Attack sheet directly");
  wp3Label = "⚔ Me → Them · Plasma gun";
  wp13AfterRoll();
  assert(wp12SheetOpen === null, "phone: staged roll closes the sheet (back to the board)");
  wp12Nav("attack");
  wp3Label = "";
  wp13AfterRoll();
  assert(wp12SheetOpen === "attack", "phone: a manual roll (no staged label) leaves the sheet open");
  wp3Label = "⚔ AI: Bot → Me · Gun";
  wp13AfterRoll();
  assert(wp12SheetOpen === "attack", "phone: an AI roll leaves the player's sheet alone");
  wp3Label = "";
  wp13BoardFocus();
  assert(wp12SheetOpen === null, "phone: wp13BoardFocus closes the open sheet for click-allocation");
  wp12Apply("desktop");
  wp13OnStage();
  assert(wp12SheetOpen === null, "desktop: wp13OnStage opens no sheet (falls back to the pulse)");
  wp13AfterRoll(); wp13BoardFocus(); // both must no-op quietly on desktop
  assert(wp12SheetOpen === null, "desktop: AfterRoll/BoardFocus are no-ops");

  // ---------- WP13 step 3: token action menu ----------
  state.tokens.length = 0; sel.clear(); mySide = 1;
  const T1 = {id:"t1",owner:1,unit:"u1",name:"Intercessor",shape:"c",dmm:32,x:10,y:10,rot:0,wounds:2,maxW:2,kw:["INFANTRY"]};
  const T2 = {id:"t2",owner:1,unit:"u1",name:"Intercessor",shape:"c",dmm:32,x:11.5,y:10,rot:0,wounds:2,maxW:2,kw:["INFANTRY"]};
  const CH = {id:"c1",owner:1,unit:"u2",name:"Captain",shape:"c",dmm:40,x:12,y:11,rot:0,wounds:5,maxW:5,kw:["CHARACTER","INFANTRY"]};
  const V1 = {id:"v1",owner:1,unit:"u3",name:"Dreadnought",shape:"r",wIn:3,hIn:2,x:20,y:20,rot:0,wounds:8,maxW:8,kw:["VEHICLE"]};
  state.tokens.push(T1, T2, CH, V1);

  wp13MenuOpen(T1, 100, 100);
  assert(wp13Tok === T1, "menu opens on the pressed token");
  assert(sel.has("t1") && sel.size === 1, "opening the menu selects that token");
  assert(/wounds/.test(wp13El.innerHTML) && /Hidden/.test(wp13El.innerHTML), "menu renders wounds stepper + actions");

  wp13Wound(-1);
  assert(T1.wounds === 1, "wounds − steps down via tok~");
  wp13Wound(1); wp13Wound(1);
  assert(T1.wounds === 2, "wounds + clamps at maxW");
  wp13Wound(-1); wp13Wound(-1); wp13Wound(-1);
  assert(T1.wounds === 0, "wounds − clamps at 0");
  wp13Wound(2 - 0); wp13Wound(1); // restore to maxW for later
  assert(T1.wounds === 2, "wounds restored");

  wp13MenuOpen(T1, 0, 0);
  wp13Shock();
  assert(T1.bs === true && T2.bs === true, "battle-shock marks the whole unit via tok~");
  assert(wp13Tok === null, "menu closes after battle-shock");
  sel.clear(); sel.add("t1"); wp13MenuOpen(T1, 0, 0); wp13Shock(); // rally back
  assert(!T1.bs && !T2.bs, "second use rallies the unit");

  wp13MenuOpen(T1, 0, 0);
  wp13Hidden();
  assert(T1.hid === true && T2.hid === true, "Hidden toggles the unit (same fn as the H key)");
  assert(wp13Tok === null, "menu closes after Hidden");
  sel.clear(); sel.add("t1"); toggleHidden(); // undo for cleanliness

  wp13MenuOpen(V1, 0, 0);
  wp13Rotate();
  assert(V1.rot === 15, "Rotate adds 15° to rect tokens via tok~");
  wp13Rotate();
  assert(V1.rot === 30, "menu stays open — Rotate repeats");
  wp13Close();

  // attach / detach through the menu (multi-select preserved when the token is already selected)
  sel.clear(); sel.add("c1"); sel.add("t1");
  wp13MenuOpen(CH, 0, 0);
  assert(sel.size === 2, "opening on an already-selected token keeps the multi-select");
  wp13Attach();
  assert(CH.unit === "u1" && CH.attachedFrom === "u2", "Attach merges the CHARACTER into the squad");
  sel.clear(); sel.add("c1");
  wp13MenuOpen(CH, 0, 0);
  wp13Detach();
  assert(CH.unit === "u2" && !CH.attachedFrom, "Detach restores the original unit");

  // role submenu handoff (full role behaviour tested in wp14-tests)
  sel.clear(); sel.add("t1");
  wp13MenuOpen(T1, 0, 0);
  wp13SubRole();
  assert(wp13Sub === "role" && /Mark as/.test(wp13El.innerHTML), "Role submenu renders the role families");

  // Esc closes
  winHandlers.keydown({ key: "Escape", target: { tagName: "DIV" } });
  assert(wp13Tok === null, "Esc closes the menu");

  // two-tap delete
  sel.clear();
  wp13MenuOpen(T2, 0, 0);
  wp13Delete();
  assert(state.tokens.includes(T2) && wp13DelArm === true && /Really delete/.test(wp13El.innerHTML), "first Delete tap only arms the confirm");
  wp13Delete();
  assert(!state.tokens.includes(T2), "second Delete tap removes the model via tok-");
  assert(wp13Tok === null && sel.size === 0, "menu closed and selection cleared after delete");

  // ---------- desktop DOM untouched ----------
  assert(snap() === baseline, "desktop DOM untouched: #topbar + #side snapshot identical after a full menu session");
  assert(document.body.children.some(c => c.id === "wp13Menu"), "#wp13Menu injected into <body>, never into #side");

  console.log(failed ? "WP13 TESTS: " + failed + " FAILURES" : "WP13 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
