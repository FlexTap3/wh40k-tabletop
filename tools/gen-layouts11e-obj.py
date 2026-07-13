#!/usr/bin/env python3
"""Regenerate 11th-ed layouts with terrain ANCHORED ON OBJECTIVES.
Every objective gets a terrain-area footprint centred on it (the big pieces), then the
remaining pieces of the standard 16-piece set fill the board symmetrically. Preserves each
layout's objectives (o), deployment zones (dz) and mission (m). Reads the embedded layouts
from wh40k-tabletop.html; writes layouts11e-obj.json."""
import re, json, math, random, os

HTML = "/Users/paulstadick/dev/PNT/WH40k/Tabletop/wh40k-tabletop.html"
OUT  = os.path.join(os.path.dirname(__file__), "layouts11e-obj.json")
BW, BH = 60.0, 44.0
CX, CY = 30.0, 22.0
# 11th-ed piece set (w,h,kind[,shape]): 2 tri, 4 large, 4 medium, 2 long line, 4 short line
def corners(x, y, w, h, rot):
    cx, cy = x + w/2, y + h/2
    a = math.radians(rot); c, s = math.cos(a), math.sin(a)
    return [(cx + dx*c - dy*s, cy + dx*s + dy*c)
            for dx, dy in [(-w/2,-h/2),(w/2,-h/2),(w/2,h/2),(-w/2,h/2)]]
def in_bounds(x, y, w, h, rot, pad=0.0):
    return all(-pad <= px <= BW+pad and -pad <= py <= BH+pad for px, py in corners(x,y,w,h,rot))
def covers(px, py, x, y, w, h, rot):
    cx, cy = x + w/2, y + h/2
    a = math.radians(-rot); c, s = math.cos(a), math.sin(a)
    dx, dy = px-cx, py-cy
    lx, ly = dx*c - dy*s, dx*s + dy*c
    return abs(lx) <= w/2 and abs(ly) <= h/2
def place_on(ox, oy, w, h, rng):
    """Centre a (w,h) piece on (ox,oy); try rot 0/90; clamp to bounds while keeping (ox,oy) covered."""
    for rot in ([0,90] if rng.random()<0.5 else [90,0]):
        ew, eh = (w,h) if rot==0 else (h,w)
        cx = min(max(ox, ew/2), BW-ew/2); cy = min(max(oy, eh/2), BH-eh/2)
        x, y = cx - w/2, cy - h/2
        if in_bounds(x,y,w,h,rot,0.3) and covers(ox,oy,x,y,w,h,rot):
            return dict(kind="ruin", x=round(x,2), y=round(y,2), w=w, h=h, rot=rot)
    # fallback: rot 0 clamped
    ew, eh = w, h
    cx = min(max(ox, ew/2), BW-ew/2); cy = min(max(oy, eh/2), BH-eh/2)
    return dict(kind="ruin", x=round(cx-w/2,2), y=round(cy-h/2,2), w=w, h=h, rot=0)

def make_tri(ox, oy, tc, rng):
    p = place_on(ox, oy, 8, 11.5, rng); p["shape"]="tri"; p["tc"]=tc; return p

def defence_line(cx, cy, w, h, rng):
    horiz = rng.random() < 0.5
    ww, hh = (w, h) if horiz else (h, w)
    x = min(max(cx-ww/2, 0), BW-ww); y = min(max(cy-hh/2, 0), BH-hh)
    return dict(kind="wall", x=round(x,2), y=round(y,2), w=ww, h=hh, rot=0)

def regen(name, layout):
    rng = random.Random(name)
    objs = layout["o"]  # list of [x,y]
    t = []
    # order objectives: outermost first (they get the big rectangles), centre-most last
    order = sorted(range(len(objs)), key=lambda i: -math.hypot(objs[i][0]-CX, objs[i][1]-CY))
    # covering-piece plan for the objectives: up to 4 large rects, then triangles, then mediums
    tri_tc = [1, 0, 2, 3]
    used_tri = 0
    # Objectives are covered by RECTANGLES only (a rectangle fully covers its footprint; a
    # triangle would leave the objective in its empty corner). Triangles are midfield filler.
    for rank, oi in enumerate(order):
        ox, oy = objs[oi]
        if rank < 4:                      # outer objectives -> large 7x11.5 footprint
            t.append(place_on(ox, oy, 7, 11.5, rng))
        else:                             # inner objectives -> medium 6x4 footprint
            t.append(place_on(ox, oy, 6, 4, rng))
    # complete the standard 16-piece set. Count what we've placed:
    have = {"large":0, "tri":0, "medium":0}
    for p in t:
        if p.get("shape")=="tri": have["tri"]+=1
        elif (p["w"],p["h"]) in [(7,11.5),(11.5,7)]: have["large"]+=1
        elif (p["w"],p["h"]) in [(6,4),(4,6)]: have["medium"]+=1
    need_tri    = max(0, 2 - have["tri"])
    need_large  = max(0, 4 - have["large"])
    need_medium = max(0, 4 - have["medium"])
    # symmetric midfield filler slots (mirror pairs about centre)
    slots = [(15,11),(45,33),(15,33),(45,11),(30,8),(30,36),(9,22),(51,22),(22,22),(38,22),(30,15),(30,29)]
    si = 0
    def next_slot():
        nonlocal si
        s = slots[si % len(slots)]; si += 1; return s
    for _ in range(need_tri):
        sx, sy = next_slot(); t.append(make_tri(sx, sy, tri_tc[used_tri % 4], rng)); used_tri += 1
    for _ in range(need_large):
        sx, sy = next_slot(); t.append(place_on(sx, sy, 7, 11.5, rng))
    for _ in range(need_medium):
        sx, sy = next_slot(); t.append(place_on(sx, sy, 6, 4, rng))
    # 2 long + 4 short defence lines, spread out
    for cx, cy in [(30,13),(30,31)]:
        t.append(defence_line(cx, cy, 10, 2.5, rng))
    for cx, cy in [(12,6),(48,38),(12,38),(48,6)]:
        t.append(defence_line(cx, cy, 6, 2, rng))
    # ids
    slug = re.sub(r'[^a-z0-9]+','-',name.lower())
    for i,p in enumerate(t): p["id"] = f"{slug}-t{i}"
    return {"t": t, "o": layout["o"], "dz": layout["dz"], "m": layout.get("m","")}

def main():
    html = open(HTML).read()
    m = re.search(r'<script id="layouts40k-data" type="application/json">(.*?)</script>', html, re.S)
    data = json.loads(m.group(1))
    out = {}
    stats = {"covered":0, "total":0}
    for name, layout in data.items():
        if not name.startswith("Official"):
            out[name] = layout; continue
        out[name] = regen(name, layout)
        for ox, oy in layout["o"]:
            stats["total"] += 1
            if any(covers(ox, oy, p["x"], p["y"], p["w"], p["h"], p.get("rot",0)) for p in out[name]["t"]):
                stats["covered"] += 1
    json.dump(out, open(OUT,"w"), separators=(",",":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len([k for k in out if k.startswith('Official')])} official layouts")
    print(f"objective coverage: {stats['covered']}/{stats['total']}")

if __name__ == "__main__":
    main()
