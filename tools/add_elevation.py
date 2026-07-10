#!/usr/bin/env python3
"""Add ascent + estimated time to trails.geojson / trails.js.

Elevations from USGS NED 10m via opentopodata.org. Time is Naismith's rule
calibrated to the user's measured pace: the 5.7 mi / ~1100 ft Angora loop
took 3 h (2026-07-09), giving a leisure factor of ~1.2.
"""
import json, math, time, urllib.request

DATA = "/Users/jchen/AI/Ashish_Goel/sierra-trails/data"
BASE_MPH = 3.0          # Naismith flat speed
FT_PER_HOUR = 2000      # Naismith climb rate
CALIBRATION = 1.22      # measured: 3 h actual / 2.45 h Naismith on the Angora loop

def meters(a, b):
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    y = math.radians(b[1] - a[1])
    return math.hypot(x, y) * 6371000

def sample(coords, step_m=60):
    out = [coords[0]]
    acc = 0
    for a, b in zip(coords, coords[1:]):
        acc += meters(a, b)
        if acc >= step_m:
            out.append(b)
            acc = 0
    if out[-1] != coords[-1]:
        out.append(coords[-1])
    return out

def elevations(pts):
    elevs = []
    for i in range(0, len(pts), 100):
        chunk = pts[i:i+100]
        locs = "|".join(f"{p[1]},{p[0]}" for p in chunk)
        req = urllib.request.Request(
            "https://api.opentopodata.org/v1/ned10m",
            data=json.dumps({"locations": locs}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.load(r)
        elevs += [x["elevation"] for x in res["results"]]
        time.sleep(1.1)  # public API: 1 req/sec
    return elevs

def ascent_m(elevs, threshold=5.0):
    """Sum climbs, ignoring bumps under `threshold` m (GPS/DEM noise)."""
    total = 0.0
    ref = elevs[0]
    for e in elevs[1:]:
        if e - ref >= threshold:
            total += e - ref
            ref = e
        elif e < ref:
            ref = e
    return total

# Measured overrides (user data beats the model):
# - angora-lakes: hiked 2026-07-09 in 3.0 h
# - grass-lake: camp->pond->camp (2.76 mi of 3.61 one-way) took 2.5 h on
#   2026-07-08; extrapolating that pace over the full route gives ~3.0 h
OVERRIDES = {"angora-lakes": 3.0, "grass-lake": 3.0}

fc = json.load(open(f"{DATA}/trails.geojson"))
for f in fc["features"]:
    p = f["properties"]
    coords = f["geometry"]["coordinates"]
    is_loop = coords[0] == coords[-1]
    pts = sample(coords)
    elevs = elevations(pts)
    up_ft = ascent_m(elevs) * 3.28084
    net_ft = (elevs[-1] - elevs[0]) * 3.28084
    if not is_loop:
        # out-and-back: full round trip. Return climbs whatever the way out descended.
        if not p.get("roundtrip"):  # don't double twice on re-runs
            p["miles"] = round(p["miles"] * 2, 1)
        up_ft = 2 * up_ft - net_ft
    hours = (p["miles"] / BASE_MPH + up_ft / FT_PER_HOUR) * CALIBRATION
    p["ascent"] = int(round(up_ft / 50) * 50)
    p["hours"] = OVERRIDES.get(p["id"], round(hours * 4) / 4)
    p["roundtrip"] = not is_loop
    print(f"{p['name']}: {p['miles']} mi {'loop' if is_loop else 'round trip'}, "
          f"+{p['ascent']} ft -> ~{p['hours']} h  ({len(pts)} samples)")

json.dump(fc, open(f"{DATA}/trails.geojson", "w"))
with open(f"{DATA}/trails.js", "w") as f:
    f.write("const TRAILS = ")
    json.dump(fc, f)
    f.write(";\n")
print("updated trails.js / trails.geojson")
