# Sierra Camp Trails

Offline hiking-map PWA for Stanford Sierra Camp (Fallen Leaf Lake, CA).
Works on iPhone and Android with **no cell signal**: the topo map, all trail
routes, and GPS tracking run entirely on the phone once installed.

## Trails (from whatzappening.com/recreation, geometry from OpenStreetMap)

| Trail | One-way | Difficulty |
|---|---|---|
| Angora Lakes out & back (Church Trail) | 2.1 mi | Short & steep |
| Angora Lakes Loop (Church & Lily Lake Trails) | 5.7 mi | Moderate |
| Grass Lake via Glen Alpine | 3.5 mi | Moderate |
| Mt. Tallac via Cathedral Lake | 3.7 mi | Very strenuous |
| Mt. Tallac via Mid-Tallac Trail | 4.3 mi | Very strenuous |
| Gilmore Lake via Glen Alpine | 5.0 mi | Strenuous |
| Susie Lake via Glen Alpine & PCT | 5.1 mi | Strenuous |
| Lake Aloha via Heather Lake | 7.6 mi | Strenuous |

All routes start at the camp itself (38.88325, -120.07233).

## Features

- **Offline topo map** — 262 USGS Topo tiles (z11–15, ~5.7 MB) auto-downloaded
  into the browser cache on first visit; the ⬇️ button re-checks/retries.
- **GPS tracking** — pick a trail, tap *Start hike*: live position, miles
  done/left, distance from trail, GPS accuracy. Screen wake-lock while hiking.
- **Off-course warning** — if you drift > 60 m from the route (adaptive to GPS
  accuracy, 3 consecutive fixes to avoid false alarms) you get a flashing red
  banner with the compass direction back to the trail, vibration (Android) and
  a beep (all platforms). Clears with a confirmation chirp when you're back on.
- **Record your own trails** — tap ⏺ to log your path as you walk (5 m
  breadcrumb spacing, bad fixes filtered). Stop, name it, and it's saved on the
  phone (localStorage), drawn dashed red, and works exactly like a built-in
  trail: selectable, trackable, off-course warnings included. Delete via the ✕
  on its card. Any trail (built-in or recorded) exports as GPX with one tap.

## Install on a phone

Must be served over **HTTPS** (GPS + service workers require it) — GitHub Pages
works. Then:

- **iPhone**: open in Safari → Share → *Add to Home Screen*.
- **Android**: open in Chrome → menu → *Install app* (or the install prompt).

Open the app once while online so it can cache the map tiles ("maps ✓" pill),
after that it is fully offline-capable.

## Rebuilding data

- `tools/build_routes.py` — recomputes routes by Dijkstra over the OSM path
  network (needs `network.json` from Overpass; query inside the script's
  history). Edit the `ROUTES` list to add trails/waypoints.
- `tools/download_tiles.py` — re-downloads USGS tiles and regenerates
  `data/tile-manifest.js`. Edit the bbox/zooms at the top.

After changing data, bump the cache names in `sw.js` (`sierra-shell-v2`, …)
so installed phones pick up the new version.

## Local preview

```
python3 -m http.server 8742 --directory sierra-trails
```

Note: geolocation works on `localhost` but on a phone you need HTTPS.
