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
L.control.zoom({ position: 'topleft' }).addTo(map);

L.tileLayer('tiles/{z}/{x}/{y}.jpg', {
  minZoom: 10, maxZoom: 18, maxNativeZoom: 15,
  bounds: [[38.845, -120.175], [38.945, -120.035]],
}).addTo(map);

// camp marker
L.marker(CAMP, {
  icon: L.divIcon({ className: '', html: '<div style="font-size:22px">🏕️</div>', iconSize: [24, 24], iconAnchor: [12, 12] }),
}).addTo(map).bindPopup('<b>Stanford Sierra Camp</b>');

/* ---------- trails ---------- */
const layers = {};   // id -> polyline
let selected = null; // feature

const scroll = document.getElementById('trail-scroll');

function addTrailUI(f, custom) {
  const p = f.properties;
  const line = L.geoJSON(f, {
    style: { color: p.color, weight: 4, opacity: 0.85, dashArray: custom ? '6 6' : null },
  }).addTo(map);
  line.on('click', () => selectTrail(p.id));
  layers[p.id] = line;

  const card = document.createElement('div');
  card.className = 'trail-card';
  card.id = 'card-' + p.id;
  card.innerHTML = `<span class="dot" style="background:${p.color}"></span>` +
    `<span style="font-size:11px;opacity:.8">${p.miles} mi · ${p.difficulty}</span>` +
    `<h3>${p.name}</h3>` +
    (custom ? `<button class="card-del" title="Delete this trail">✕</button>` : '');
  card.onclick = () => selectTrail(p.id);
  if (custom) {
    card.querySelector('.card-del').onclick = ev => {
      ev.stopPropagation();
      if (confirm(`Delete "${p.name}"?`)) deleteCustomTrail(p.id);
    };
  }
  scroll.appendChild(card);
}

TRAILS.features.forEach(f => addTrailUI(f, false));

/* ---------- custom (recorded) trails ---------- */
const CUSTOM_KEY = 'sierra-custom-trails';
function loadCustomTrails() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; }
  catch (e) { return []; }
}
function saveCustomTrails(list) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
}
loadCustomTrails().forEach(f => { TRAILS.features.push(f); addTrailUI(f, true); });

function deleteCustomTrail(id) {
  saveCustomTrails(loadCustomTrails().filter(f => f.properties.id !== id));
  TRAILS.features = TRAILS.features.filter(f => f.properties.id !== id);
  map.removeLayer(layers[id]);
  delete layers[id];
  document.getElementById('card-' + id).remove();
  if (selected && selected.properties.id === id) {
    if (tracking) stopTracking();
    selected = null; routePts = null;
    document.getElementById('detail').classList.remove('on');
    Object.values(layers).forEach(l => l.setStyle({ weight: 4, opacity: 0.85 }));
  }
}

// initial view: the whole trail network
const allBounds = L.latLngBounds([]);
Object.values(layers).forEach(l => allBounds.extend(l.getBounds()));
map.fitBounds(allBounds, { padding: [20, 20] });

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

// follow mode: the map tracks your position until you pan away yourself;
// zooming never breaks follow — you choose the zoom level, we keep the center
let follow = true;
const fabRecenter = document.getElementById('fab-recenter');
map.on('dragstart', () => {
  if (tracking) { follow = false; fabRecenter.style.display = 'block'; }
});
fabRecenter.onclick = () => {
  follow = true;
  fabRecenter.style.display = 'none';
  if (userMarker) map.panTo(userMarker.getLatLng());
};

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
    if (!tracking || follow) map.setView(p, Math.max(map.getZoom(), 14));
  } else {
    userMarker.setLatLng(p);
    accCircle.setLatLng(p).setRadius(acc);
    if (tracking && follow) map.panTo(p, { animate: true });
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
  follow = true; fabRecenter.style.display = 'none';
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
  fabRecenter.style.display = 'none';
  setBanner('', '');
}

btnTrack.onclick = () => tracking ? stopTracking() : startTracking();

document.getElementById('fab-locate').onclick = () => {
  navigator.geolocation?.getCurrentPosition(
    pos => { onFix(pos); map.setView([pos.coords.latitude, pos.coords.longitude], 15); },
    onGpsError, { enableHighAccuracy: true, timeout: 15000 });
};

/* ---------- record a custom trail ---------- */
let recording = false, recWatchId = null, recPts = [], recDist = 0, recLine = null;
const fabRec = document.getElementById('fab-record');
const REC_MIN_STEP_M = 5;      // drop jittery fixes closer than this
const REC_MAX_ACC_M = 50;      // drop fixes with worse accuracy

function onRecFix(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  if (acc > REC_MAX_ACC_M) return;
  const p = [lat, lon];
  if (recPts.length) {
    const step = meters(recPts[recPts.length - 1], p);
    if (step < REC_MIN_STEP_M) return;
    recDist += step;
  }
  recPts.push(p);
  recLine.setLatLngs(recPts);
  setBanner('info', `⏺ Recording — ${(recDist / 1609.34).toFixed(2)} mi · ${recPts.length} pts · tap ⏺ to finish`);
}

async function startRecording() {
  if (recording) return;
  if (!('geolocation' in navigator)) { setBanner('warn', 'No GPS on this device/browser.'); return; }
  if (tracking) stopTracking(); // recording and trail-following are exclusive
  recording = true; recPts = []; recDist = 0;
  fabRec.textContent = '⏹';
  fabRec.style.background = '#d62828';
  recLine = L.polyline([], { color: '#d62828', weight: 4, dashArray: '2 8' }).addTo(map);
  setBanner('info', '⏺ Recording — waiting for GPS…');
  recWatchId = navigator.geolocation.watchPosition(
    pos => { onFix(pos); onRecFix(pos); }, onGpsError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  try { wakeLock = wakeLock || await navigator.wakeLock?.request('screen'); } catch (e) {}
}

function stopRecording() {
  recording = false;
  if (recWatchId !== null) navigator.geolocation.clearWatch(recWatchId);
  recWatchId = null;
  fabRec.textContent = '⏺';
  fabRec.style.background = '#fff';
  if (!tracking) { try { wakeLock?.release(); wakeLock = null; } catch (e) {} }
  map.removeLayer(recLine); recLine = null;
  setBanner('', '');

  if (recPts.length < 2 || recDist < 50) {
    setBanner('info', 'Recording too short to save — discarded.');
    setTimeout(() => { if (!tracking && !recording) setBanner('', ''); }, 4000);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const name = prompt(`Save recorded trail (${(recDist / 1609.34).toFixed(2)} mi)?\nGive it a name:`, `My trail ${today}`);
  if (!name) { setBanner('info', 'Recording discarded.'); setTimeout(() => setBanner('', ''), 3000); return; }
  const feature = {
    type: 'Feature',
    properties: {
      id: 'custom-' + Date.now(),
      name: name.trim(),
      miles: Math.round(recDist / 160.934) / 10,
      color: '#d62828',
      difficulty: 'Recorded',
      desc: `Recorded on ${today}.`,
      custom: true,
    },
    geometry: { type: 'LineString', coordinates: recPts.map(p => [Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6]) },
  };
  const list = loadCustomTrails(); list.push(feature); saveCustomTrails(list);
  TRAILS.features.push(feature);
  addTrailUI(feature, true);
  selectTrail(feature.properties.id);
}

fabRec.onclick = () => recording ? stopRecording() : startRecording();

/* ---------- GPX export of the selected trail ---------- */
document.getElementById('btn-gpx').onclick = () => {
  if (!selected) return;
  const p = selected.properties;
  const pts = selected.geometry.coordinates
    .map(c => `      <trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Sierra Camp Trails" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${p.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = p.id + '.gpx';
  document.body.appendChild(a); a.click(); a.remove();
};

// debug/testing hook: feed a fake GPS fix (drives both tracking and recording)
window.__simulatePosition = (lat, lon, accuracy = 10) => {
  onFix({ coords: { latitude: lat, longitude: lon, accuracy } });
  if (recording) onRecFix({ coords: { latitude: lat, longitude: lon, accuracy } });
};

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
