// WP19 waypoint-ruler regression: run via  node harness.js wp19-tests.js
// Covers: click-chained waypoints (pts grows, cursor leg follows hover), cumulative
// distance = leg sum, x0..y1 mirroring the LAST leg (old-peer compat), plain drag
// still the classic {x0,y0,x1,y1} measure with no pts, Esc / dblclick / tool-switch
// ending the chain (dblclick never wound-prompts with the ruler tool), send()
// payloads captured via a conn stub, throttled hover sends, touch taps chaining,
// and drawRuler smoke with + without pts.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // ---------- capture the wire ----------
  const sent = [];
  conn = { open: true, send: m => sent.push(m) };
  const lastRuler = () => { for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === "ruler") return sent[i]; return null; };

  const cvEl = document.getElementById("board");
  view.x = 0; view.y = 0; view.s = 10; // 10 px per inch
  state.tokens.length = 0; sel.clear();

  // ---------- 1. three waypoint clicks → pts length 4 with a live cursor leg ----------
  setTool("ruler");
  assert(tool === "ruler" && wp19Chain === false, "ruler tool armed, no chain yet");
  cvEl.handlers.pointerdown({ offsetX: 100, offsetY: 100 });           // click 1 at (10,10)
  assert(drag && drag.mode === "ruler", "pointerdown arms the ruler drag exactly as today");
  winHandlers.pointerup({ clientX: 100, clientY: 100 });
  assert(wp19Chain === true && ruler && ruler.pts && ruler.pts.length === 2, "first click starts the chain: anchor + cursor leg");
  wp19LastSend = 0;
  winHandlers.pointermove({ clientX: 140, clientY: 100 });             // hover, no button held
  assert(near(ruler.pts[1][0], 14) && near(ruler.pts[1][1], 10), "hover (no button) moves the cursor leg");
  cvEl.handlers.pointerdown({ offsetX: 140, offsetY: 100 });           // click 2 at (14,10)
  winHandlers.pointerup({ clientX: 140, clientY: 100 });
  winHandlers.pointermove({ clientX: 140, clientY: 130 });             // hover to (14,13)
  cvEl.handlers.pointerdown({ offsetX: 140, offsetY: 130 });           // click 3 at (14,13)
  winHandlers.pointerup({ clientX: 140, clientY: 130 });
  assert(ruler.pts.length === 4, "three clicks -> pts length 4 (3 waypoints + cursor leg)");
  wp19LastSend = 0;
  winHandlers.pointermove({ clientX: 100, clientY: 130 });             // cursor leg to (10,13)
  assert(near(ruler.pts[3][0], 10) && near(ruler.pts[3][1], 13), "cursor leg tracks the hover after each click");

  // ---------- 2. cumulative distance = sum of the legs (4 + 3 + 4 on known coords) ----------
  assert(near(wp19Total(ruler), 11), 'cumulative distance 11.0" = 4 + 3 + 4 (got ' + wp19Total(ruler).toFixed(3) + ")");

  // ---------- 3. x0..y1 mirror the LAST leg (old-peer back-compat) ----------
  assert(near(ruler.x0, 14) && near(ruler.y0, 13) && near(ruler.x1, 10) && near(ruler.y1, 13),
    "x0..y1 mirror the last leg — an older build's drawRuler still shows it");
  const wire = lastRuler();
  assert(wire && wire.r && wire.r.pts && wire.r.pts.length === 4 && near(wire.r.x1, 10) && near(wire.r.y1, 13),
    "send() carried the full chain payload (pts + mirrored last leg)");

  // ---------- 4. hover sends are throttled to ≤ every 80ms ----------
  wp19LastSend = Date.now();
  const n0 = sent.length;
  winHandlers.pointermove({ clientX: 105, clientY: 130 });
  assert(sent.length === n0, "hover within 80ms of the last send is not re-sent");
  wp19LastSend = 0;
  winHandlers.pointermove({ clientX: 110, clientY: 130 });
  assert(sent.length === n0 + 1, "hover after the throttle window sends again");

  // ---------- 5. Esc clears chain + ruler and sends one final message ----------
  winHandlers.keydown({ key: "Escape", target: { tagName: "DIV" } });
  assert(wp19Chain === false && ruler === null, "Esc ends the chain and clears the ruler");
  assert(lastRuler().r === null, "Esc sends one final {t:'ruler',r:null} so the opponent's copy blanks");

  // ---------- 6. plain drag (no chain) = today's classic straight measure, no pts ----------
  cvEl.handlers.pointerdown({ offsetX: 200, offsetY: 200 });           // (20,20)
  winHandlers.pointermove({ clientX: 260, clientY: 200 });             // drag 6" -> (26,20)
  winHandlers.pointerup({ clientX: 260, clientY: 200 });
  assert(ruler && !ruler.pts && near(ruler.x0, 20) && near(ruler.y0, 20) && near(ruler.x1, 26) && near(ruler.y1, 20),
    "plain drag produces the classic {x0,y0,x1,y1} ruler with NO pts");
  assert(wp19Chain === false && drag === null, "a real drag never starts a chain; pointerup ends it as today");
  const dragWire = lastRuler();
  assert(dragWire.r.pts === undefined, "drag-measure wire payload has no pts (byte-compatible with old peers)");
  winHandlers.keydown({ key: "Escape", target: { tagName: "DIV" } });
  assert(ruler === null, "Esc still clears the classic ruler");

  // ---------- 7. a real drag while a chain is live ends the chain, becomes a plain measure ----------
  cvEl.handlers.pointerdown({ offsetX: 100, offsetY: 100 });
  winHandlers.pointerup({ clientX: 100, clientY: 100 });               // chain live at (10,10)
  assert(wp19Chain === true, "chain re-armed for the drag-cancels-chain case");
  cvEl.handlers.pointerdown({ offsetX: 100, offsetY: 100 });
  winHandlers.pointermove({ clientX: 150, clientY: 100 });             // 5" pull = a real drag
  assert(wp19Chain === false && ruler && !ruler.pts && near(ruler.x1, 15),
    "starting a plain drag measure ends the chain and measures from the press point");
  winHandlers.pointerup({ clientX: 150, clientY: 100 });
  ruler = null;

  // ---------- 8. dblclick with the ruler tool ends the chain, never wound-prompts ----------
  state.tokens.push({ id: "w1", owner: 1, unit: "u1", name: "Boy", shape: "c", dmm: 32, x: 10, y: 10, rot: 0, wounds: 1, maxW: 1 });
  let prompts = 0; const oldPrompt = global.prompt; global.prompt = () => { prompts++; return null; };
  cvEl.handlers.pointerdown({ offsetX: 100, offsetY: 100 });           // waypoint click ON the token's spot
  winHandlers.pointerup({ clientX: 100, clientY: 100 });
  assert(wp19Chain === true, "chain live before the dblclick");
  cvEl.handlers.dblclick({ offsetX: 100, offsetY: 100 });
  assert(wp19Chain === false && ruler === null, "dblclick with the ruler tool ends the chain");
  assert(prompts === 0, "…and the wound prompt never fired");
  setTool("select");
  cvEl.handlers.dblclick({ offsetX: 100, offsetY: 100 });
  assert(prompts === 1, "select-tool dblclick on a token still wound-prompts (regression)");
  global.prompt = oldPrompt;

  // ---------- 9. tool switch ends the chain ----------
  setTool("ruler");
  cvEl.handlers.pointerdown({ offsetX: 300, offsetY: 300 });
  winHandlers.pointerup({ clientX: 300, clientY: 300 });
  assert(wp19Chain === true, "chain live before the tool switch");
  setTool("select");
  assert(wp19Chain === false && ruler === null, "setTool away from the ruler ends + clears the chain");
  assert(lastRuler().r === null, "tool switch also sends the final blanking message");

  // ---------- 10. touch: taps chain waypoints; double-tap ends the chain (wp8 layer) ----------
  setTool("ruler");
  wp8LastTap = null;
  cvEl.handlers.pointerdown({ offsetX: 400, offsetY: 100, pointerType: "touch", pointerId: 7 });
  assert(drag && drag.mode === "ruler", "single touch with the ruler tool reaches the normal pointerdown path (wp8 doesn't eat it)");
  winHandlers.pointerup({ clientX: 400, clientY: 100, pointerType: "touch", pointerId: 7 });
  assert(wp19Chain === true && ruler.pts.length === 2, "a touch tap is a waypoint click");
  cvEl.handlers.pointerdown({ offsetX: 400, offsetY: 100, pointerType: "touch", pointerId: 7 }); // second tap, same spot
  winHandlers.pointerup({ clientX: 400, clientY: 100, pointerType: "touch", pointerId: 7 });
  assert(wp19Chain === false && ruler === null, "touch double-tap ends the chain (wp8WoundPrompt mirror, no prompt)");

  // ---------- 11. drawRuler smoke: with and without pts ----------
  let threw = false;
  try {
    drawRuler({ x0: 0, y0: 0, x1: 5, y1: 0 }, "#e8b23a");
    drawRuler({ x0: 3, y0: 0, x1: 3, y1: 4, pts: [[0, 0], [3, 0], [3, 4]] }, "#7ec8ff");
    drawRuler(null, "#e8b23a");
  } catch (e) { threw = true; console.log("   threw: " + e.message); }
  assert(!threw, "drawRuler smoke: classic, chained, and null all render without throwing");
  assert(near(wp19Total({ pts: [[0, 0], [3, 0], [3, 4]] }), 7), "wp19Total: 3-4-5 triangle legs sum to 7");

  console.log(failed ? "WP19 TESTS: " + failed + " FAILURES" : "WP19 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
