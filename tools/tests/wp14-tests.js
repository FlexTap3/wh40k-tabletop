// WP14 per-model role regression: run via  node harness.js wp14-tests.js
// Covers: the weapon-name → role classifier, the free-text loadout parser (counts,
// fuzzy match, garbage in → nothing out, never throws), deployCard stamping (SGT on
// the minority profile, counted weapon pips on non-leaders, SPC never auto-pipped),
// tok~ role merge/clear, migrateCard preserving card.wg, the role-map contract the
// renderer and legend rely on, and a draw() smoke test with every badge stacked.
{
  let passed = 0, failed = 0;
  const assert = (ok, name) => { if (ok) { passed++; console.log("ok - " + name); } else { failed++; console.log("FAIL: " + name); } };

  // ---------- wp14RoleFor classifier ----------
  const table = [
    ["Plasma gun", "PLA"], ["Plasma pistol", "PLA"],
    ["Meltagun", "MLT"], ["Multi-melta", "MLT"], ["Fusion blaster", "MLT"],
    ["Flamer", "FLM"], ["Heavy flamer", "FLM"], ["Burna", "FLM"],
    ["Missile launcher", "HVY"], ["Lascannon", "HVY"], ["Heavy bolter", "HVY"], ["Autocannon", "HVY"],
    ["Sniper rifle", "SNP"], ["Bolt sniper rifle", "SNP"],
    ["Astartes grenade launcher", "GRN"],
    ["Icon of Khorne", "BAN"], ["Waaagh! banner", "BAN"],
    ["Power fist", "SPC"], ["Chainsword", "SPC"], ["Bolt rifle", "SPC"],
  ];
  table.forEach(([n, want]) => assert(wp14RoleFor(n) === want, `classifier: ${n} → ${want}`));

  // ---------- wp14ParseLoadout ----------
  const names = ["Bolt rifle", "Plasma gun", "Power fist", "Meltagun"];
  const p1 = wp14ParseLoadout("3x Plasma gun, 1 Meltagun, Power fist", names);
  assert(p1.length === 3, "parser: three fragments parsed");
  assert(p1[0].role === "PLA" && p1[0].count === 3, "parser: '3x Plasma gun' → PLA ×3");
  assert(p1[1].role === "MLT" && p1[1].count === 1, "parser: '1 Meltagun' → MLT ×1");
  assert(p1[2].role === "SPC" && p1[2].name === "Power fist", "parser: bare known weapon matches (SPC family)");
  assert(wp14ParseLoadout("!!!@## random mumbling notes", names).length === 0, "parser: garbage in → nothing out");
  assert(wp14ParseLoadout(null, names).length === 0 && wp14ParseLoadout("2x Meltagun", null).length === 1, "parser: null-safe both ways");
  let threw = false; try { wp14ParseLoadout({}, "not an array"); } catch (e) { threw = true; }
  assert(!threw, "parser never throws");

  // ---------- deployCard stamping ----------
  mySide = 1; state.tokens.length = 0;
  const card = {
    name: "Test Squad", pts: "100", kw: ["INFANTRY"], notes: "",
    weapons: "Bolt rifle | 24\" | 2 | 3+ | 4 | -1 | 1\nPlasma gun | 24\" | 1 | 3+ | 7 | -2 | 2",
    wg: "2x Plasma gun",
    profiles: [
      { n: "Test Sergeant", count: 1, base: "32mm", M: '6"', T: 4, Sv: "3+", W: 2, Ld: "6+", OC: 2 },
      { n: "Test Marine",   count: 4, base: "32mm", M: '6"', T: 4, Sv: "3+", W: 2, Ld: "6+", OC: 2 },
    ],
  };
  deployCard(card);
  assert(state.tokens.length === 5, "deploy: 5 models on the table");
  const sgt = state.tokens.find(t => t.sgt);
  assert(!!sgt && sgt.role === "SGT", "deploy: minority profile stamped sgt + role SGT");
  assert(state.tokens.filter(t => t.role === "PLA").length === 2, "deploy: '2x Plasma gun' → exactly 2 PLA pips");
  assert(state.tokens.filter(t => t.sgt && t.role === "PLA").length === 0, "deploy: the leader never takes a weapon pip");
  assert(state.tokens.filter(t => !t.role).length === 2, "deploy: remaining models unmarked");

  // SPC-family gear is never auto-pipped (too noisy — manual via the menu only)
  state.tokens.length = 0;
  deployCard(Object.assign({}, card, { wg: "5x Bolt rifle", name: "Boring Squad" }));
  assert(state.tokens.filter(t => t.role && t.role !== "SGT").length === 0, "deploy: '5x Bolt rifle' (SPC) auto-pips nothing");

  // a card with no wg deploys exactly as before
  state.tokens.length = 0;
  const plain = Object.assign({}, card); delete plain.wg;
  deployCard(plain);
  assert(state.tokens.filter(t => t.role && t.role !== "SGT").length === 0 && state.tokens.length === 5, "deploy: no loadout text → no pips, no errors");

  // ---------- role sync via tok~ ----------
  const m0 = state.tokens.find(t => !t.sgt);
  applyOp({ k: "tok~", toks: [{ id: m0.id, role: "MLT" }] });
  assert(m0.role === "MLT", "tok~ merges a role edit (guest-visible path)");
  const other = state.tokens.find(t => !t.sgt && t.id !== m0.id);
  applyOp({ k: "tok~", toks: [{ id: m0.id, role: null }] });
  assert(!m0.role, "tok~ role:null clears the pip");
  assert(other && other.role === undefined, "merging one model's role leaves its squadmates untouched");

  // ---------- migrateCard preserves wg ----------
  const mig = migrateCard({ name: "X", kw: [], wg: "2x Meltagun", profiles: [{ n: "X", count: 1, W: 1 }] });
  assert(mig.wg === "2x Meltagun", "migrateCard passes card.wg through untouched");

  // ---------- role map contract (renderer + legend + menu rely on these) ----------
  assert(Object.keys(WP14_ROLES).length >= 8, "role map has the full family set");
  assert(Object.keys(WP14_ROLES).every(k => WP14_ROLES[k].c && WP14_ROLES[k].tc && WP14_ROLES[k].l && k.length === 3),
    "every role: 3-letter code, pip colour, letter colour, legend label");
  assert(WP14_ROLES.SGT.c === "#e8b23a", "SGT keeps the established gold");
  assert(/w13pip/.test(wp14Pip("PLA")) && /#56b4e9/.test(wp14Pip("PLA")), "wp14Pip renders the coloured legend/menu swatch");

  // ---------- draw() smoke with every badge stacked ----------
  state.tokens.push({ id: "z1", owner: 2, unit: "zz", name: "Zoanthrope", shape: "c", dmm: 40, x: 5, y: 5,
    wounds: 1, maxW: 3, sgt: true, role: "HVY", tag: "PK", hid: true, lvl: 2, kw: ["INFANTRY"] });
  state.tokens.push({ id: "z2", owner: 2, unit: "zz2", name: "Rhino", shape: "r", wIn: 3, hIn: 2, x: 8, y: 8, rot: 45,
    wounds: 5, maxW: 10, sgt: true, role: "MLT", kw: ["VEHICLE"] });
  threw = false; try { draw(); } catch (e) { threw = true; console.log("   draw threw: " + e.message); }
  assert(!threw, "draw(): gold rim + chevron + role pip + tag + hidden + floor + wounds all stack without throwing");

  console.log(failed ? "WP14 TESTS: " + failed + " FAILURES" : "WP14 TESTS: ALL PASSED (" + passed + ")");
  process.exitCode = failed ? 1 : 0;
}
