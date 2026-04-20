/* ==========================================================
   RideX — Map Module (Leaflet + dark theme + OSRM routes)
   Modes: explore | target | navigating
   ========================================================== */

let MAP = null;
let layerDrivers = null;
let layerUser = null;
let layerDest = null;
let layerRouteArrival = null;
let layerRouteTrip = null;
let markerMatched = null;

const SURAT_CENTER = [21.1702, 72.8311];

function initMap() {
  MAP = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView(SURAT_CENTER, 13);

  // Dark map tiles (CartoDB Dark Matter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(MAP);

  layerDrivers = L.layerGroup().addTo(MAP);
  layerUser = L.layerGroup().addTo(MAP);
  layerDest = L.layerGroup().addTo(MAP);
  layerRouteArrival = L.layerGroup().addTo(MAP);
  layerRouteTrip = L.layerGroup().addTo(MAP);
}

// ========= Icons =========
function carIcon(isMatched = false) {
  const cls = isMatched ? 'car-marker matched' : 'car-marker';
  return L.divIcon({
    className: cls,
    html: `<div class="car-body"><i class="fas fa-car-side"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}
function userIcon() {
  return L.divIcon({
    className: 'user-marker',
    html: `<div class="user-body"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}
function destIcon() {
  return L.divIcon({
    className: 'dest-marker',
    html: `<div class="dest-body"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 20],
  });
}

// ========= Mode: Explore =========
// Show user + all active drivers
function renderExplore(user, fleet) {
  clearAll();
  if (user) {
    L.marker([user.lat, user.lng], { icon: userIcon() }).addTo(layerUser);
  }
  fleet.filter(d => d.isActive).forEach(d => {
    const m = L.marker([d.lat, d.lng], { icon: carIcon(false) });
    m.bindTooltip(`${d.name} · ${d.vehicle.tier}`, { direction: 'top', offset: [0, -10] });
    m.addTo(layerDrivers);
  });
  fitExplore(user, fleet);
}

function fitExplore(user, fleet) {
  const pts = [];
  if (user) pts.push([user.lat, user.lng]);
  fleet.filter(d => d.isActive).forEach(d => pts.push([d.lat, d.lng]));
  if (pts.length > 1) {
    MAP.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  } else if (pts.length === 1) {
    MAP.setView(pts[0], 13);
  }
}

// ========= Mode: Target (candidate drivers highlighted) =========
function renderCandidates(user, drop, nearby) {
  clearAll();
  L.marker([user.lat, user.lng], { icon: userIcon() }).addTo(layerUser);
  if (drop) {
    L.marker([drop.lat, drop.lng], { icon: destIcon() }).addTo(layerDest);
  }
  nearby.forEach(d => {
    const m = L.marker([d.lat, d.lng], { icon: carIcon(false) });
    m.bindTooltip(`${d.name} · ${d.distanceKm.toFixed(1)} km away`, { direction: 'top', offset: [0, -10] });
    m.addTo(layerDrivers);
  });
  const pts = [[user.lat, user.lng], ...nearby.map(d => [d.lat, d.lng])];
  if (drop) pts.push([drop.lat, drop.lng]);
  MAP.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}

// ========= Mode: Matched (isolate driver, draw arrival route) =========
function renderMatched(user, drop, driver, arrivalCoords) {
  clearAll();
  L.marker([user.lat, user.lng], { icon: userIcon() }).addTo(layerUser);
  if (drop) {
    L.marker([drop.lat, drop.lng], { icon: destIcon() }).addTo(layerDest);
  }
  markerMatched = L.marker([driver.lat, driver.lng], { icon: carIcon(true) });
  markerMatched.bindTooltip(`${driver.name} · ${driver.plate}`, { direction: 'top', offset: [0, -14] });
  markerMatched.addTo(layerDrivers);

  if (arrivalCoords && arrivalCoords.length) {
    // Blue polyline for arrival leg
    const latlngs = arrivalCoords.map(c => [c[1], c[0]]);
    L.polyline(latlngs, {
      color: '#1fbad6',
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
    }).addTo(layerRouteArrival);
  }
  fitMatched(user, driver, drop);
}

function fitMatched(user, driver, drop) {
  const pts = [[user.lat, user.lng], [driver.lat, driver.lng]];
  if (drop) pts.push([drop.lat, drop.lng]);
  MAP.fitBounds(pts, { padding: [60, 60], maxZoom: 15 });
}

// ========= Mode: Trip in progress (purple polyline) =========
function renderTrip(user, drop, driver, tripCoords) {
  // Keep current markers; replace routes
  layerRouteArrival.clearLayers();
  layerRouteTrip.clearLayers();
  layerDrivers.clearLayers();
  layerUser.clearLayers();
  layerDest.clearLayers();

  if (drop) L.marker([drop.lat, drop.lng], { icon: destIcon() }).addTo(layerDest);
  // The "driver" marker now carries the passenger as the car travels
  markerMatched = L.marker([driver.lat, driver.lng], { icon: carIcon(true) });
  markerMatched.bindTooltip(`${driver.name} · ${driver.plate}`, { direction: 'top', offset: [0, -14] });
  markerMatched.addTo(layerDrivers);

  if (tripCoords && tripCoords.length) {
    const latlngs = tripCoords.map(c => [c[1], c[0]]);
    L.polyline(latlngs, {
      color: '#a78bfa',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
    }).addTo(layerRouteTrip);
  }
  const pts = [[driver.lat, driver.lng]];
  if (drop) pts.push([drop.lat, drop.lng]);
  MAP.fitBounds(pts, { padding: [70, 70], maxZoom: 15 });
}

// Move the matched marker to a new position (during animation)
function moveMatched(lat, lng) {
  if (markerMatched) {
    markerMatched.setLatLng([lat, lng]);
  }
}

function clearAll() {
  layerDrivers.clearLayers();
  layerUser.clearLayers();
  layerDest.clearLayers();
  layerRouteArrival.clearLayers();
  layerRouteTrip.clearLayers();
  markerMatched = null;
}

function showToast(msg, ms = 2500) {
  const el = document.getElementById('map-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

window.RX_MAP = {
  initMap,
  renderExplore,
  renderCandidates,
  renderMatched,
  renderTrip,
  moveMatched,
  showToast,
};
