#!/usr/bin/env python3
"""Build hiking routes from Stanford Sierra Camp using OSM path network.

Loads Overpass `out geom` ways, builds a node graph keyed by rounded
coordinates, runs Dijkstra from the camp to each destination, and writes
GeoJSON routes + a trails.js for the app.
"""
import json, math, heapq, os

SP = os.path.dirname(os.path.abspath(__file__))
OUT = "/Users/jchen/AI/Ashish_Goel/sierra-trails/data"
os.makedirs(OUT, exist_ok=True)

def key(lat, lon):
    return (round(lat, 7), round(lon, 7))

def dist(a, b):
    # equirectangular approx, fine at this scale (meters)
    lat1, lon1 = a; lat2, lon2 = b
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return math.hypot(x, y) * 6371000

net = json.load(open(f"{SP}/network.json"))
graph = {}   # node -> list of (neighbor, weight)
def add_edge(a, b):
    w = dist(a, b)
    graph.setdefault(a, []).append((b, w))
    graph.setdefault(b, []).append((a, w))

way_names = {}  # edge (a,b) sorted -> name, for labeling
for e in net["elements"]:
    if e["type"] != "way" or "geometry" not in e:
        continue
    tags = e.get("tags", {})
    # skip private driveways etc. but keep everything walkable
    if tags.get("access") in ("private", "no") and tags.get("foot") not in ("yes", "designated"):
        continue
    pts = [key(g["lat"], g["lon"]) for g in e["geometry"]]
    name = tags.get("name", "")
    for a, b in zip(pts, pts[1:]):
        add_edge(a, b)
        if name:
            way_names[tuple(sorted((a, b)))] = name

nodes = list(graph.keys())
print("graph nodes:", len(nodes))

def nearest(lat, lon):
    p = (lat, lon)
    return min(nodes, key=lambda n: dist(n, p))

def dijkstra(src):
    d = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > d.get(u, float("inf")):
            continue
        for v, w in graph[u]:
            nd = du + w
            if nd < d.get(v, float("inf")):
                d[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    return d, prev

CAMP = (38.88325, -120.07233)

# west endpoint of the Glen Alpine Trail way = its junction with the PCT area trails
ga_way = next(e for e in net["elements"]
              if e.get("tags", {}).get("name") == "Glen Alpine Trail")
ga_ends = [key(ga_way["geometry"][0]["lat"], ga_way["geometry"][0]["lon"]),
           key(ga_way["geometry"][-1]["lat"], ga_way["geometry"][-1]["lon"])]
GA_JCT = min(ga_ends, key=lambda p: p[1])  # westernmost endpoint
GA_SPRINGS = (38.8758151, -120.0971044)    # Glen Alpine Springs, forces canyon route
print("Glen Alpine west junction:", GA_JCT)

dijkstra_cache = {}
def route_via(points):
    """Shortest path through an ordered list of (lat,lon) waypoints."""
    full = []
    total = 0.0
    snapped = [nearest(*p) for p in points]
    for a, b in zip(snapped, snapped[1:]):
        if a not in dijkstra_cache:
            dijkstra_cache[a] = dijkstra(a)
        d, prev = dijkstra_cache[a]
        if b not in d:
            return None, 0
        leg = [b]
        while leg[-1] != a:
            leg.append(prev[leg[-1]])
        leg.reverse()
        total += d[b]
        full.extend(leg if not full else leg[1:])
    return full, total

ROUTES = [
    # id, name, waypoints (camp first), color, difficulty, blurb
    ("grass-lake", "Grass Lake via Glen Alpine",
     [CAMP, (38.87259, -120.11326)], "#e6194b", "Moderate",
     "Follows Fallen Leaf Road past Lily Lake, then the Glen Alpine Trail to the Grass Lake turnoff. Great waterfall views at Glen Alpine Falls."),
    ("susie-lake", "Susie Lake via Glen Alpine & PCT",
     [CAMP, GA_SPRINGS, GA_JCT, (38.8817, -120.12734)], "#f58231", "Strenuous",
     "Glen Alpine Trail to the Pacific Crest Trail junction, then on to rocky-shored Susie Lake in Desolation Wilderness."),
    ("gilmore-lake", "Gilmore Lake via Glen Alpine",
     [CAMP, GA_SPRINGS, GA_JCT, (38.89583, -120.11593)], "#3cb44b", "Strenuous",
     "Glen Alpine Trail then the Gilmore Lake spur - the classic route toward Mt. Tallac from the south."),
    ("lake-aloha", "Lake Aloha via Heather Lake",
     [CAMP, GA_SPRINGS, GA_JCT, (38.8817, -120.12734), (38.87593, -120.13756), (38.8672, -120.1420)], "#4363d8", "Strenuous",
     "The long haul: Glen Alpine Trail to the PCT, past Susie and Heather Lakes to the granite shores of Lake Aloha."),
    ("mid-tallac", "Mt. Tallac via Mid-Tallac Trail",
     [CAMP, (38.8869, -120.1018), (38.90597, -120.09902)], "#9a6324", "Very strenuous",
     "The unmarked Mid-Tallac route from the Lily Lake parking lot - climbs the southern scree side of Cathedral Ridge straight to the summit."),
    ("angora-lakes", "Angora Lakes Loop (Church & Clark Trails)",
     [CAMP,
      (38.87962, -120.0710),   # Church Trail head at the Fire House
      (38.87136, -120.06325),  # Angora Lakes parking lot
      (38.86266, -120.06788),  # Angora Lakes Resort (upper lake) - lemonade stop
      (38.87136, -120.06325),  # back to the parking lot
      (38.8777511, -120.0583661),  # on Angora Ridge Road (not the parallel ridge trail)
      (38.88219, -120.05466),  # Fire Lookout (Clark Trail junction on Angora Ridge Rd)
      (38.87889, -120.06363),  # bottom of Clark Trail near Fallen Leaf Marina
      CAMP], "#911eb4", "Moderate",
     "Steep Church Trail from the Fire House to the Angora Lakes parking lot, on to the resort for fresh lemonade, then back via Angora Ridge Road to the Fire Lookout and down the Clark Trail to Fallen Leaf Marina and camp."),
    ("angora-out-back", "Angora Lakes out & back (Church Trail)",
     [CAMP,
      (38.87962, -120.0710),   # Church Trail head at the Fire House
      (38.87136, -120.06325),  # Angora Lakes parking lot
      (38.86266, -120.06788)], "#e377c2", "Short & steep",
     "The direct option: Church Trail from the Fire House to the Angora Lakes parking lot and on to the resort for lemonade, then straight back down the way you came."),
    ("mt-tallac", "Mt. Tallac via Cathedral Lake",
     [CAMP, (38.89374, -120.08179), (38.90597, -120.09902)], "#008080", "Very strenuous",
     "Scales the western shore of Fallen Leaf Lake past Floating Island Lake and Cathedral Lake to the 9,735 ft summit of Mt. Tallac."),
]

features = []
for rid, name, waypoints, color, diff, blurb in ROUTES:
    path, length_m = route_via(waypoints)
    if path is None:
        print(f"!! {name}: unreachable")
        continue
    miles = length_m / 1609.344
    # names of ways used (for sanity check)
    used = []
    for a, b in zip(path, path[1:]):
        n = way_names.get(tuple(sorted((a, b))))
        if n and (not used or used[-1] != n):
            used.append(n)
    print(f"{name}: {miles:.2f} mi, {len(path)} pts, via: {' > '.join(dict.fromkeys(used))}")
    features.append({
        "type": "Feature",
        "properties": {
            "id": rid, "name": name, "miles": round(miles, 1),
            "color": color, "difficulty": diff, "desc": blurb,
        },
        "geometry": {
            "type": "LineString",
            "coordinates": [[round(p[1], 6), round(p[0], 6)] for p in path],
        },
    })

fc = {"type": "FeatureCollection", "features": features}
with open(f"{OUT}/trails.geojson", "w") as f:
    json.dump(fc, f)
with open(f"{OUT}/trails.js", "w") as f:
    f.write("const TRAILS = ")
    json.dump(fc, f)
    f.write(";\n")
print("wrote", f"{OUT}/trails.js")
