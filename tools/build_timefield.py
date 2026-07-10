#!/usr/bin/env python3
"""Precompute a 'time field': trail-network distance + climb from camp to
every reachable point, so the app can estimate round-trip hike times to an
arbitrary tapped location, offline.

Output: data/timefield.js  ->  const TIMEFIELD = { campElev, nodes: [
  [lat, lon, dist_m, climb_out_ft, elev_ft], ... ] }
"""
import json, math, heapq, time, urllib.request, os

SP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
NETWORK = "/private/tmp/claude-501/-Users-jchen-AI-Ashish-Goel/77fcab7f-3df4-4cc0-96b6-67feedf07d2a/scratchpad/osm/network.json"
OUT = "/Users/jchen/AI/Ashish_Goel/sierra-trails/data/timefield.js"
CAMP = (38.88325, -120.07233)
MAX_DIST_M = 14000            # ignore points >14 km of trail from camp
BBOX = (38.83, -120.19, 38.96, -120.02)
GRID = 0.0004                 # ~40 m thinning grid

def key(lat, lon): return (round(lat, 7), round(lon, 7))
def dist(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    y = math.radians(b[0] - a[0])
    return math.hypot(x, y) * 6371000

net = json.load(open(NETWORK))
graph = {}
for e in net["elements"]:
    if "geometry" not in e: continue
    t = e.get("tags", {})
    if t.get("access") in ("private", "no") and t.get("foot") not in ("yes", "designated"):
        continue
    # prefer named/maintained trails: unnamed paths (like the Mid-Tallac scree
    # connector) get a cost penalty so estimates follow the routes people walk,
    # while true walking distance is still accounted separately
    penalty = 2.0 if (t.get("highway") in ("path", "footway", "track") and not t.get("name")) else 1.0
    pts = [key(g["lat"], g["lon"]) for g in e["geometry"]]
    for a, b in zip(pts, pts[1:]):
        w = dist(a, b)
        graph.setdefault(a, []).append((b, w * penalty, w))
        graph.setdefault(b, []).append((a, w * penalty, w))

src = min(graph, key=lambda n: dist(n, CAMP))
print("graph:", len(graph), "nodes; camp snap:", src)

cost = {src: 0.0}; d = {src: 0.0}; prev = {}
pq = [(0.0, src)]
while pq:
    cu, u = heapq.heappop(pq)
    if cu > cost.get(u, 1e18) or cu > MAX_DIST_M * 2.0: continue
    for v, w, tl in graph[u]:
        nc = cu + w
        if nc < cost.get(v, 1e18):
            cost[v] = nc; d[v] = d[u] + tl; prev[v] = u
            heapq.heappush(pq, (nc, v))
# from here on, d holds true walking distance along the preferred route

# thin to a ~40 m grid, keeping the closest-to-camp node per cell
cells = {}
for n, dn in d.items():
    if dn > MAX_DIST_M: continue
    if not (BBOX[0] < n[0] < BBOX[2] and BBOX[1] < n[1] < BBOX[3]): continue
    c = (round(n[0] / GRID), round(n[1] / GRID))
    if c not in cells or dn < d[cells[c]]:
        cells[c] = n
kept = set(cells.values()) | {src}
print("kept nodes:", len(kept))

# elevations for kept nodes (USGS NED 10m, 100/request, 1 req/s)
kept_list = sorted(kept, key=lambda n: d[n])
elev = {}
for i in range(0, len(kept_list), 100):
    chunk = kept_list[i:i+100]
    locs = "|".join(f"{n[0]},{n[1]}" for n in chunk)
    req = urllib.request.Request("https://api.opentopodata.org/v1/ned10m",
        data=json.dumps({"locations": locs}).encode(),
        headers={"Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                res = json.load(r)
            break
        except Exception as ex:
            if attempt == 2: raise
            time.sleep(5)
    for n, x in zip(chunk, res["results"]):
        elev[n] = (x["elevation"] or 0) * 3.28084
    time.sleep(1.1)
    if (i // 100) % 10 == 0: print(f"elevations {i+len(chunk)}/{len(kept_list)}")

# climb from camp along the shortest-path tree, counted at kept nodes only.
# state[n] = (climb_ft_so_far, elevation_of_last_kept_node_on_path)
state = {src: (0.0, elev[src])}
for n in kept_list:
    chain = []
    u = n
    while u not in state:
        chain.append(u)
        u = prev[u]
    c, base_elev = state[u]
    for x in reversed(chain):
        if x in kept:
            c += max(0.0, elev[x] - base_elev)
            base_elev = elev[x]
        state[x] = (c, base_elev)
climb = {n: state[n][0] for n in kept_list}

rows = [[round(n[0], 5), round(n[1], 5), int(d[n]), int(climb[n]), int(elev[n])]
        for n in kept_list]
with open(OUT, "w") as f:
    f.write("const TIMEFIELD = ")
    json.dump({"campElev": int(elev[src]), "nodes": rows}, f, separators=(",", ":"))
    f.write(";\n")
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB,", len(rows), "nodes")
