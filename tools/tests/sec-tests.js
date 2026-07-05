// SEC regression: remote-input hardening. Run via  node harness.js sec-tests.js
// (harness has no real <template>, so secSanLog's escape-everything fallback is
// what's under test there; shape coercion and codes are environment-independent.)
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // --- secStr: coerce + cap ---
  assert(secStr(null, 10) === "", "secStr(null) -> empty string");
  assert(secStr(12345, 3) === "123", "secStr caps length");
  assert(secStr({}, 20).length <= 20, "secStr coerces objects");

  // --- secSanLog: never lets script through (fallback path escapes everything) ---
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script><b onclick=alert(3)>hi</b>';
  const out = secSanLog(evil);
  assert(!/<script/i.test(out), "secSanLog: no <script> survives");
  assert(!/onerror|onclick/i.test(out) || !/</.test(out.replace(/&lt;/g, "")), "secSanLog: no live event-handler attributes survive");
  assert(secSanLog("x".repeat(9000)).length <= 4100, "secSanLog caps payload size");

  // --- remote log path uses the sanitizer ---
  const before = logEl.children.length;
  onMsg({ t: "log", html: '<script>window.__pwned=1</script><b>legit</b>', cls: "sys" });
  assert(!global.__pwned && !window.__pwned, "remote log op cannot execute script");
  assert(logEl.children.length === before + 1, "remote log op still logs");

  // --- chat / hello / name coercion ---
  onMsg({ t: "chat", name: "<x>".repeat(100), text: "y".repeat(9999) });
  onMsg({ t: "hello", side: 2, name: "z".repeat(500) });
  assert(state.names[2].length <= 40, "hello name capped");
  applyOp({ k: "name", side: 2, name: 12345 }, false);
  assert(state.names[2] === "12345", "name op coerced to string");
  applyOp({ k: "name", side: 2, name: "" }, false);
  assert(state.names[2] === "Player", "empty remote name falls back");

  // --- sec+ shape coercion ---
  applyOp({ k: "sec+", card: { id: { evil: 1 }, owner: 99, name: "n".repeat(500), extra: "dropped" } }, false);
  const c = state.sec[state.sec.length - 1];
  assert(typeof c.id === "string" && typeof c.name === "string" && c.name.length <= 120, "sec+ coerces id/name");
  assert(c.owner === 1 && !("extra" in c), "sec+ normalizes owner and drops unknown fields");

  // --- cardtext prototype-pollution guard ---
  applyOp({ k: "cardtext", name: "__proto__", text: "evil" }, false);
  assert(({}).evil === undefined && cardText.__proto__ !== "evil", "cardtext __proto__ key rejected");
  applyOp({ k: "cardtext", name: "Assassination", text: "t".repeat(9999) }, false);
  assert(cardText["Assassination"].length <= 4000, "cardtext length capped");

  // --- room codes: length, charset, uniqueness ---
  const codes = new Set();
  for (let i = 0; i < 50; i++) codes.add(secCode(10));
  assert(codes.size === 50, "secCode: 50 draws, 50 unique");
  assert([...codes].every(x => /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/.test(x)), "secCode: 10 chars, safe charset");

  console.log(failed ? "SEC TESTS: " + failed + " FAILURES" : "SEC TESTS: ALL PASSED");
  if (failed) process.exit(1);
}
