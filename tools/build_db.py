#!/usr/bin/env python3
"""
Build the embedded unit database for wh40k-tabletop.html from Wahapedia's
machine-readable CSV export (pipe-delimited), then inject it into the app.

Usage:
    python3 build_db.py            # download CSVs, build, inject into ../wh40k-tabletop.html
    python3 build_db.py --no-dl    # reuse ./csv/ from a previous run

POLICY (do not change): we embed game-functional data only — names, stat
numbers, points, base sizes, weapon profiles, ability *identifiers*, wargear
option lines, composition lines, detachment names, enhancement names+costs,
and a whitelist of keywords. We do NOT embed rules paragraphs, lore ("legend"),
or detachment/enhancement/stratagem rules text. That is the copyright line
this project holds.
"""
import csv, json, re, sys, os, html as H, subprocess

BASE = "https://wahapedia.ru/wh40k11ed/"
FILES = ["Factions", "Datasheets", "Datasheets_models", "Datasheets_wargear",
         "Datasheets_unit_composition", "Datasheets_models_cost",
         "Datasheets_options", "Datasheets_keywords",
         "Enhancements", "Detachment_abilities", "Last_update"]
HERE = os.path.dirname(os.path.abspath(__file__))
CSVDIR = os.path.join(HERE, "csv")
APP = os.path.join(HERE, "..", "wh40k-tabletop.html")

KW_WHITELIST = {"INFANTRY","VEHICLE","MONSTER","CHARACTER","EPIC HERO","BATTLELINE",
    "FLY","TITANIC","WALKER","TRANSPORT","DEDICATED TRANSPORT","BEASTS","SWARM",
    "MOUNTED","AIRCRAFT","FORTIFICATION","PSYKER","SMOKE","GRENADES","EXPLOSIVES",
    "TOWERING","FRAME","MOBILE"}

def download():
    os.makedirs(CSVDIR, exist_ok=True)
    for f in FILES:
        url = BASE + f + ".csv"
        dest = os.path.join(CSVDIR, f + ".csv")
        subprocess.run(["curl", "-sf", "-A", "Mozilla/5.0", "-o", dest, url], check=True)
        print("downloaded", f, os.path.getsize(dest), "bytes")

def rows(name):
    with open(os.path.join(CSVDIR, name + ".csv"), encoding="utf-8-sig") as fh:
        return [{k: (v or "").strip() for k, v in r.items() if k}
                for r in csv.DictReader(fh, delimiter="|")]

def strip_html(s):
    s = re.sub(r"<li[^>]*>", " • ", s)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", H.unescape(s)).strip()

def build():
    fac = {r["id"]: r["name"] for r in rows("Factions")}
    models, wargear, comp, cost, opts, kws = {}, {}, {}, {}, {}, {}
    for r in rows("Datasheets_models"): models.setdefault(r["datasheet_id"], []).append(r)
    for r in rows("Datasheets_wargear"): wargear.setdefault(r["datasheet_id"], []).append(r)
    for r in rows("Datasheets_unit_composition"): comp.setdefault(r["datasheet_id"], []).append(strip_html(r["description"]))
    for r in rows("Datasheets_models_cost"): cost.setdefault(r["datasheet_id"], []).append([r["description"], r["cost"]])
    for r in rows("Datasheets_options"): opts.setdefault(r["datasheet_id"], []).append(strip_html(r["description"]))
    for r in rows("Datasheets_keywords"):
        k = r["keyword"].upper()
        if k in KW_WHITELIST: kws.setdefault(r["datasheet_id"], set()).add(k)

    dets, enh = {}, {}
    for r in rows("Detachment_abilities"):
        if r.get("detachment"): dets.setdefault(r["faction_id"], set()).add(r["detachment"])
    for r in rows("Enhancements"):
        if r.get("detachment"): dets.setdefault(r["faction_id"], set()).add(r["detachment"])
        enh.setdefault(r["faction_id"], []).append(
            {"n": r["name"], "c": int(r["cost"] or 0), "d": r["detachment"]})

    db = {"factions": sorted(fac.items(), key=lambda x: x[1]), "units": {},
          "det": {f: sorted(s) for f, s in dets.items()},
          "enh": {f: sorted(v, key=lambda e: (e["d"], e["n"])) for f, v in enh.items()}}
    n = 0
    for r in rows("Datasheets"):
        if r.get("virtual", "").lower() == "true": continue
        did, fid = r["id"], r["faction_id"]
        if did not in models: continue
        ms = [{"n": m["name"], "M": m["M"], "T": m["T"], "Sv": m["Sv"], "iv": m["inv_sv"],
               "W": m["W"], "Ld": m["Ld"], "OC": m["OC"], "b": m["base_size"]} for m in models[did]]
        ws = [[w["name"], w["range"], w["type"][:1], w["A"], w["BS_WS"], w["S"], w["AP"], w["D"],
               w["description"]] for w in wargear.get(did, [])]
        u = {"n": r["name"], "r": r["role"], "m": ms, "w": ws,
             "c": comp.get(did, []), "p": cost.get(did, []), "o": opts.get(did, []),
             "k": sorted(kws.get(did, []))}
        db["units"].setdefault(fid, []).append(u)
        n += 1
    for fid in db["units"]: db["units"][fid].sort(key=lambda u: (u["r"], u["n"]))
    print(f"built: {len(db['units'])} factions, {n} units")
    return db

def inject(db):
    payload = json.dumps(db, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = open(APP, encoding="utf-8").read()
    marker = '<script id="db40k-data" type="application/json">'
    s = html.index(marker) + len(marker)
    e = html.index("</script>", s)
    open(APP, "w", encoding="utf-8").write(html[:s] + payload + html[e:])
    print(f"injected {len(payload)//1024} KB into {os.path.basename(APP)}")

if __name__ == "__main__":
    if "--no-dl" not in sys.argv: download()
    inject(build())
