// Full-screen day map popup (Leaflet + OpenStreetMap). Leaflet loads only when the map is first opened.
// Routes and points come from data/routes.json, so they draw offline; only the map tiles need the network.
import { escapeHtml } from './inline.js';
import { dayMapData, MODES } from './mapdata.js';
import { formatDayLabel } from './time.js';

const ROUTES_URL = 'data/routes.json';
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  + ' · trasy: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS OSRM</a>';
const OFFLINE_NOTE = 'Offline: trasy i punkty są widoczne, ale podkład mapy się nie wczyta.';
const LOCATE_ERRORS = {
  1: 'Brak zgody na lokalizację (sprawdźcie ustawienia przeglądarki).',
  2: 'Pozycja chwilowo niedostępna.',
  3: 'Nie udało się ustalić pozycji na czas.',
};

let L;
let routes;
let map;
let layers;
let youAreHere;
let currentPlan;
let statusTimer;

function loadLeafletCss() {
  if (document.querySelector('link[data-leaflet]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'vendor/leaflet/leaflet.css';
  link.dataset.leaflet = '';
  document.head.append(link);
}

async function ensureReady() {
  if (!L) {
    loadLeafletCss();
    L = await import('../vendor/leaflet/leaflet-src.esm.js');
  }
  if (!routes) {
    const res = await fetch(ROUTES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    routes = await res.json();
  }
}

// Transient messages disappear after a while; the offline note stays while offline.
function showStatus(dialog, message, { transient = false } = {}) {
  const status = dialog.querySelector('.map-dialog__status');
  clearTimeout(statusTimer);
  status.textContent = message || (navigator.onLine ? '' : OFFLINE_NOTE);
  if (transient) statusTimer = setTimeout(() => showStatus(dialog, ''), 5000);
}

const pinIcon = (text, className) => L.divIcon({
  className: `map-pin ${className}`, html: `<span>${text}</span>`, iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -16],
});

function planLink(itemId, label) {
  return `<a class="map-popup-link" href="#item-${itemId}" data-map-close>${escapeHtml(label)}</a>`;
}

function draw(dayKey) {
  const data = dayMapData(routes, currentPlan, dayKey);
  layers.clearLayers();

  // A there-and-back leg (e.g. metro Manzoni ↔ Barberini) is drawn once: overlapping dashes would merge into a solid line.
  const drawn = new Set();
  for (const leg of data.legs) {
    const ends = [leg.path[0], leg.path.at(-1)].map(String).sort().join('|');
    const key = `${leg.mode}|${ends}`;
    if (!drawn.has(key)) {
      drawn.add(key);
      L.polyline(leg.path, { className: `map-leg map-leg--${leg.mode}`, weight: leg.mode === 'metro' ? 4 : 5, interactive: false }).addTo(layers);
    }
    // A wide invisible twin makes the thin line easy to tap.
    L.polyline(leg.path, { className: 'map-hit', weight: 22, opacity: 0 }).bindPopup(planLink(leg.itemId, leg.label)).addTo(layers);
  }
  for (const point of data.waypoints) {
    L.circleMarker([point.lat, point.lon], { className: 'map-waypoint', radius: 7, interactive: false }).addTo(layers);
    L.circleMarker([point.lat, point.lon], { className: 'map-hit', radius: 22, opacity: 0, fillOpacity: 0 })
      .bindTooltip(escapeHtml(point.name))
      .addTo(layers);
  }
  L.marker([data.base.lat, data.base.lon], { icon: pinIcon('🏨', 'map-pin--base'), title: data.base.name })
    .bindPopup(escapeHtml(data.base.name))
    .addTo(layers);
  for (const stop of data.stops) {
    L.marker([stop.lat, stop.lon], { icon: pinIcon(stop.number, 'map-pin--stop'), title: stop.name, zIndexOffset: 1000 })
      .bindPopup(planLink(stop.itemId, `${stop.number}. ${stop.time} ${stop.name}`))
      .addTo(layers);
  }
  map.fitBounds(data.bounds, { padding: [16, 16] });
}

function selectDay(dialog, dayKey) {
  for (const button of dialog.querySelectorAll('[data-map-day]')) {
    const selected = button.dataset.mapDay === dayKey;
    button.setAttribute('aria-pressed', String(selected));
    if (selected) button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  draw(dayKey);
}

function locate(dialog) {
  if (!map) return; // the button is disabled until the map exists
  if (!navigator.geolocation) {
    showStatus(dialog, 'Lokalizacja niedostępna w tej przeglądarce.', { transient: true });
    return;
  }
  showStatus(dialog, 'Szukam Waszej pozycji…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const here = [coords.latitude, coords.longitude];
      youAreHere?.remove();
      youAreHere = L.circleMarker(here, { className: 'map-here', radius: 9 }).bindTooltip('Tu jesteście').addTo(map);
      map.setView(here, Math.max(map.getZoom(), 15));
      showStatus(dialog, '');
    },
    (err) => showStatus(dialog, LOCATE_ERRORS[err.code] ?? 'Nie udało się ustalić pozycji.', { transient: true }),
    { enableHighAccuracy: true, timeout: 15000 },
  );
}

function followPlanLink(link) {
  const target = document.getElementById(link.getAttribute('href').slice(1));
  if (!target) return;
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true }); // the default hash navigation does the scrolling
}

function buildDialog(plan) {
  const dialog = document.createElement('dialog');
  dialog.className = 'map-dialog';
  dialog.setAttribute('aria-label', 'Mapa dnia');
  const days = plan.days
    .map((day) => `<button type="button" class="map-dialog__tab" data-map-day="${day.key}" aria-pressed="false">`
      + `<span class="map-dialog__wd">${escapeHtml(formatDayLabel(day.key, { weekday: 'short' }))}</span> ${day.label}</button>`)
    .join('');
  const legend = Object.entries(MODES)
    .map(([mode, { label }]) => `<li><span class="map-legend__line map-legend__line--${mode}"></span>${label}</li>`)
    .join('');
  dialog.innerHTML = `<header class="map-dialog__bar">`
    + `<div class="map-dialog__tabs" role="group" aria-label="Dzień">${days}</div>`
    + `<button type="button" class="map-dialog__btn" data-map-locate aria-label="Pokaż moją pozycję" disabled>📍</button>`
    + `<button type="button" class="map-dialog__btn" data-map-close aria-label="Zamknij mapę">✕</button>`
    + `</header>`
    + `<div class="map-dialog__map"></div>`
    + `<ul class="map-legend">${legend}<li><span class="map-legend__dot"></span>metro / punkt przesiadki</li></ul>`
    + `<p class="map-dialog__status" role="status"></p>`;
  document.body.append(dialog);

  dialog.addEventListener('click', (event) => {
    const day = event.target.closest('[data-map-day]');
    if (day) selectDay(dialog, day.dataset.mapDay);
    if (event.target.closest('[data-map-locate]')) locate(dialog);
    const close = event.target.closest('[data-map-close]');
    if (close) {
      dialog.close();
      if (close.matches('a[href^="#"]')) followPlanLink(close);
    }
  });
  return dialog;
}

export async function openDayMap(plan, dayKey) {
  currentPlan = plan;
  const dialog = document.querySelector('.map-dialog') ?? buildDialog(plan);
  dialog.showModal();
  dialog.querySelector(`[data-map-day="${dayKey}"]`)?.focus();
  showStatus(dialog, '');
  try {
    await ensureReady();
  } catch (err) {
    showStatus(dialog, `Nie udało się wczytać mapy (${err.message}).`);
    return;
  }
  if (!map) {
    map = L.map(dialog.querySelector('.map-dialog__map'), { zoomControl: false, zoomSnap: 0.25 });
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Przybliż', zoomOutTitle: 'Oddal' }).addTo(map);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    layers = L.layerGroup().addTo(map);
    dialog.querySelector('[data-map-locate]').disabled = false;
  }
  // The container was hidden until showModal(): wait for layout, otherwise fitBounds uses a zero-size map.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  map.invalidateSize();
  selectDay(dialog, dayKey);
}
