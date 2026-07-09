/* Sierra Camp Trails — offline hiking map + GPS trail tracking */
'use strict';

const CAMP = [38.88325, -120.07233];
const OFF_TRAIL_M = 60;          // warn beyond this distance from the route
const OFF_TRAIL_CLEAR_M = 40;    // hysteresis: back on trail below this
const OFF_FIX_COUNT = 3;         // consecutive off-route fixes before warning
const MAX_ACC_M = 50;            // ignore fixes with worse GPS accuracy
const TILE_CACHE = 'sierra-tiles-v1';

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, attributionControl: false })
  .setView(CAMP, 13);
L.control.attribution({ prefix: false })
  .addAttribution('USGS Topo | Trails © OpenStreetMap contributors').addTo(map);

L.tileLayer('tiles/{z}/{x}/{y}.jpg', {
  minZoom: 11, maxZoom: 17, maxNativeZoom: 15,
  bounds: [[38.845, -120.175], [38.945, -120.035]],
}).addTo(map);

// camp marker
L.marker(CAMP, {
  icon: L.divIcon({ className: '', html: '<div style="font-size:22px">🏕️</div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
}).addTo(map).bindPopup('<b>Stanford Sierra Camp</b>');

/* ---------- trails ---------- */
const layers = {};   // id -> polyline
let selected = null; // feature

TRAILS.features.forEach(f => {
  const line = L.geoJSON(f, {
    style: { color: f.properties.color, weight: 4, opacity: 0.85 },
  }).addTo(map);
  line.on('click', () => selectTrail(f.properties.id));
  layers[f.properties.id] = line;
});

const scroll = document.getElementById('trail-scroll');
TRAILS.features.forEach(f => {
  const p = f.properties;
  const card = document.createElement('div');
  card.className = 'trail-card';
  card.id = 'card-' + p.id;
  card.innerHTML = `<span class="dot" style="background:${p.color}"></span>` +
    `<span style="font-size:11px;opacity:.8">${p.miles} mi · ${p.difficulty}</span>` +
    `<h3>${p.name}</h3>`;
  card.onclick = () => selectTrail(p.id);
  scroll.appendChild(card);
});

function selectTrail(id) {
  selected = TRAILS.features.find(f => f.properties.id === id);
  routePts = selected.geometry.coordinates.map(c => [c[1], c[0]]); // [lat,lon]
  routeCum = cumulative(routePts);
  document.querySelectorAll('.trail-card').forEach(c => c.classList.remove('sel'));
  document.getElementById('card-' + id).classList.add('sel');
  Object.entries(layers).forEach(([k, l]) =>
    l.setStyle({ weight: k === id ? 7 : 3, opacity: k === id ? 1 : 0.5 }));
  document.getElementById('detail').classList.add('on');
  const isLoop = routePts.length > 1 &&
    routePts[0][0] === routePts[routePts.length - 1][0] &&
    routePts[0][1] === routePts[routePts.length - 1][1];
  document.getElementById('detail-desc').textContent =
    `${selected.properties.miles} mi ${isLoop ? 'loop' : 'one-way'} · ${selected.properties.difficulty}. ${selected.properties.desc}`;
  document.getElementById('card-' + id).scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  if (!tracking) map.fitBounds(layers[id].getBounds(), { padding: [30, 30] });
}

document.getElementById('btn-fit').onclick = () => {
  if (selected) map.fitBounds(layers[selected.properties.id].getBounds(), { padding: [30, 30] });
};

/* ---------- geometry helpers (meters, equirectangular) ---------- */
const R = 6371000;
function meters(a, b) { // a,b = [lat,lon]
  const x = (b[1] - a[1]) * Math.PI / 180 * Math.cos((a[0] + b[0]) * Math.PI / 360);
  const y = (b[0] - a[0]) * Math.PI / 180;
  return Math.hypot(x, y) * R;
}
function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
  return cum;
}
// nearest point on route: returns {dist m, along m}
function nearestOnRoute(p, pts, cum) {
  let best = { dist: Infinity, along: 0 };
  const cosLat = Math.cos(p[0] * Math.PI / 180), k = Math.PI / 180 * R;
  const px = p[1] * cosLat * k, py = p[0] * k;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][1] * cosLat * k, ay = pts[i - 1][0] * k;
    const bx = pts[i][1] * cosLat * k, by = pts[i][0] * k;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.dist) best = { dist: d, along: cum[i - 1] + Math.sqrt(len2) * t };
  }
  return best;
}
function bearingTo(a, b) {
  const y = Math.sin((b[1] - a[1]) * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180);
  const x = Math.cos(a[0] * Math.PI / 180) * Math.sin(b[0] * Math.PI / 180) -
    Math.sin(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.cos((b[1] - a[1]) * Math.PI / 180);
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

/* ---------- GPS tracking ---------- */
let tracking = false, watchId = null, routePts = null, routeCum = null;
let userMarker = null, accCircle = null, offCount = 0, warned = false, lastBeep = 0;
let wakeLock = null, audioCtx = null;

const banner = document.getElementById('banner');
const btnTrack = document.getElementById('btn-track');

function beep(times) {
  if (!audioCtx) return;
  for (let i = 0; i < times; i++) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; o.type = 'square';
    g.gain.setValueAtTime(0.4, audioCtx.currentTime + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.35 + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start(audioCtx.currentTime + i * 0.35);
    o.stop(audioCtx.currentTime + i * 0.35 + 0.3);
  }
}

function setBanner(cls, msg) {
  banner.className = cls || '';
  banner.textContent = msg || '';
}

function onFix(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  const p = [lat, lon];
  if (!userMarker) {
    userMarker = L.marker(p, {
      icon: L.divIcon({ className: 'user-dot', iconSize: [18, 18] }), zIndexOffset: 1000,
    }).addTo(map);
    accCircle = L.circle(p, { radius: acc, weight: 1, color: '#1a73e8', fillOpacity: 0.12 }).addTo(map);
    map.setView(p, Math.max(map.getZoom(), 15));
  } else {
    userMarker.setLatLng(p);
    accCircle.setLatLng(p).setRadius(acc);
    if (tracking) map.panTo(p, { animate: true });
  }
  document.getElementById('st-acc').textContent = Math.round(acc) + 'm';
  if (!tracking || !routePts) return;

  if (acc > MAX_ACC_M) {
    setBanner('info', `Waiting for better GPS signal (±${Math.round(acc)} m)…`);
    return;
  }
  const near = nearestOnRoute(p, routePts, routeCum);
  const total = routeCum[routeCum.length - 1];
  document.getElementById('st-done').textContent = (near.along / 1609.34).toFixed(2);
  document.getElementById('st-left').textContent = ((total - near.along) / 1609.34).toFixed(2);
  document.getElementById('st-off').textContent = Math.round(near.dist) + 'm';

  const limit = Math.max(OFF_TRAIL_M, acc * 1.2);
  if (near.dist > limit) {
    offCount++;
    if (offCount >= OFF_FIX_COUNT) {
      // find direction back to the nearest route vertex
      let bi = 0, bd = Infinity;
      routePts.forEach((rp, i) => { const d = meters(p, rp); if (d < bd) { bd = d; bi = i; } });
      setBanner('warn', `⚠️ OFF TRAIL — ${Math.round(near.dist)} m from route. Head ${bearingTo(p, routePts[bi])} to return.`);
      if (!warned || Date.now() - lastBeep > 10000) {
        if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
        beep(3);
        lastBeep = Date.now();
      }
      warned = true;
    }
  } else if (near.dist < Math.min(OFF_TRAIL_CLEAR_M, limit)) {
    offCount = 0;
    if (warned) { beep(1); }
    warned = false;
    setBanner('info', `On trail ✓ — ${((total - near.along) / 1609.34).toFixed(1)} mi to go`);
  }
}

function onGpsError(err) {
  setBanner('warn', err.code === 1
    ? '⚠️ Location permission denied. Enable it in Settings to track your hike.'
    : '⚠️ GPS unavailable: ' + err.message);
}

async function startTracking() {
  if (tracking) return;
  if (!selected) { setBanner('info', 'Pick a trail below first'); return; }
  if (!('geolocation' in navigator)) { setBanner('warn', 'No GPS on this device/browser.'); return; }
  // flip state synchronously so a double-tap can't start two sessions
  tracking = true; offCount = 0; warned = false;
  btnTrack.textContent = '■ End hike';
  btnTrack.classList.add('stop');
  document.getElementById('stats').classList.add('on');
  setBanner('info', 'Acquiring GPS…');
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) {}
  if (!tracking) { try { wakeLock?.release(); } catch (e) {} } // ended while awaiting
}

function stopTracking() {
  tracking = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  try { wakeLock?.release(); } catch (e) {}
  btnTrack.textContent = '▶ Start hike';
  btnTrack.classList.remove('stop');
  document.getElementById('stats').classList.remove('on');
  setBanner('', '');
}

btnTrack.onclick = () => tracking ? stopTracking() : startTracking();

document.getElementById('fab-locate').onclick = () => {
  navigator.geolocation?.getCurrentPosition(
    pos => { onFix(pos); map.setView([pos.coords.latitude, pos.coords.longitude], 15); },
    onGpsError, { enableHighAccuracy: true, timeout: 15000 });
};

// debug/testing hook: feed a fake GPS fix
window.__simulatePosition = (lat, lon, accuracy = 10) =>
  onFix({ coords: { latitude: lat, longitude: lon, accuracy } });

/* ---------- offline: service worker + tile pre-download ---------- */
const netPill = document.getElementById('net-pill');
const mapsPill = document.getElementById('maps-pill');
function updNet() { netPill.textContent = navigator.onLine ? 'online' : 'offline'; netPill.classList.toggle('ok', !navigator.onLine); }
addEventListener('online', updNet); addEventListener('offline', updNet); updNet();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function tilesCached() {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(TILE_CACHE);
  return (await cache.keys()).length;
}

async function updMapsPill() {
  const n = await tilesCached().catch(() => 0);
  const done = n >= TILE_MANIFEST.length;
  mapsPill.textContent = done ? 'maps ✓' : `maps: ${n}/${TILE_MANIFEST.length}`;
  mapsPill.classList.toggle('ok', done);
  return done;
}

async function downloadTiles() {
  const prog = document.getElementById('dl-progress');
  prog.style.display = 'block';
  const cache = await caches.open(TILE_CACHE);
  const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
  const base = new URL('.', location.href).pathname;
  const todo = TILE_MANIFEST.filter(t => !have.has(base + t));
  let n = TILE_MANIFEST.length - todo.length, fail = 0;
  const CHUNK = 8;
  for (let i = 0; i < todo.length; i += CHUNK) {
    await Promise.all(todo.slice(i, i + CHUNK).map(async t => {
      try { await cache.add(t); n++; } catch (e) { fail++; }
    }));
    prog.textContent = `Downloading offline maps… ${n}/${TILE_MANIFEST.length}`;
  }
  prog.textContent = fail ? `Map download incomplete (${fail} tiles failed) — tap ⬇️ to retry`
    : 'Offline maps saved ✓ — this app now works with no signal';
  setTimeout(() => { prog.style.display = 'none'; }, 4000);
  updMapsPill();
}
document.getElementById('fab-dl').onclick = downloadTiles;

// auto-download tiles on first visit when online
updMapsPill().then(done => {
  if (!done && navigator.onLine) downloadTiles();
});

// iOS install hint (once, when not already installed)
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (isIOS && !standalone && !localStorage.getItem('ios-tip-shown')) {
  document.getElementById('ios-tip').style.display = 'block';
  localStorage.setItem('ios-tip-shown', '1');
}
