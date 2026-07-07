#!/usr/bin/env python3
"""Download USGS Topo tiles for offline use, and emit a tile manifest."""
import math, os, sys, time, json
from concurrent.futures import ThreadPoolExecutor
import urllib.request

OUT = "/Users/jchen/AI/Ashish_Goel/sierra-trails/tiles"
URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"
# bbox covering all routes with margin
LAT_MIN, LAT_MAX = 38.845, 38.945
LON_MIN, LON_MAX = -120.175, -120.035
ZOOMS = range(11, 16)  # z11..z15

def tile_xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    lr = math.radians(lat)
    y = int((1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n)
    return x, y

jobs = []
for z in ZOOMS:
    x0, y0 = tile_xy(LAT_MAX, LON_MIN, z)
    x1, y1 = tile_xy(LAT_MIN, LON_MAX, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            jobs.append((z, x, y))
print("tiles to fetch:", len(jobs))

def fetch(job):
    z, x, y = job
    path = f"{OUT}/{z}/{x}/{y}.jpg"
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path, 0
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = URL.format(z=z, x=x, y=y)
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "sierra-trails-offline-hiking-app/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return path, len(data)
        except Exception as e:
            if attempt == 2:
                print("FAIL", z, x, y, e)
                return None, 0
            time.sleep(1 + attempt)

total = 0
ok = 0
with ThreadPoolExecutor(max_workers=6) as ex:
    for i, (path, size) in enumerate(ex.map(fetch, jobs)):
        if path:
            ok += 1
            total += size
        if (i + 1) % 100 == 0:
            print(f"{i+1}/{len(jobs)} ({total/1e6:.1f} MB)")
print(f"done: {ok}/{len(jobs)} tiles, {total/1e6:.1f} MB new")

# manifest of every tile file for the service worker precache
paths = []
for z in ZOOMS:
    zdir = f"{OUT}/{z}"
    if not os.path.isdir(zdir):
        continue
    for x in sorted(os.listdir(zdir)):
        xdir = f"{zdir}/{x}"
        if not os.path.isdir(xdir):
            continue
        for y in sorted(os.listdir(xdir)):
            paths.append(f"tiles/{z}/{x}/{y}")
with open("/Users/jchen/AI/Ashish_Goel/sierra-trails/data/tile-manifest.js", "w") as f:
    f.write("const TILE_MANIFEST = ")
    json.dump(paths, f)
    f.write(";\n")
print("manifest:", len(paths), "tiles")
