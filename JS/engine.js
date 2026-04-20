/* ==========================================================
   RideX — Core Engine
   - Distance calc (Haversine as PostGIS fallback)
   - OSRM routing API
   - Fare algorithm
   - Global session state
   ========================================================== */

// ============ Distance (Haversine) ============
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ============ PostGIS-like: find N closest active drivers ============
function findClosestDrivers(point, fleet, n = 4) {
  return fleet
    .filter(d => d.isActive)
    .map(d => ({ ...d, distanceKm: haversineKm(point, d) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, n);
}

// ============ OSRM Routing ============
// Returns { coordinates: [[lng,lat], ...], distanceKm, durationMin }
async function getOSRMRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM request failed");
    const data = await res.json();
    if (!data.routes || !data.routes.length) throw new Error("No route");
    const r = data.routes[0];
    return {
      coordinates: r.geometry.coordinates, // [[lng,lat],...]
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
    };
  } catch (e) {
    // Fallback: straight-line with fake distance/time
    console.warn("OSRM failed, using fallback:", e.message);
    const distKm = haversineKm(from, to);
    // simple interpolated line
    const steps = 40;
    const coords = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      coords.push([
        from.lng + (to.lng - from.lng) * t,
        from.lat + (to.lat - from.lat) * t,
      ]);
    }
    return {
      coordinates: coords,
      distanceKm: distKm,
      durationMin: (distKm / 25) * 60, // assume 25 km/h average
      fallback: true,
    };
  }
}

// ============ Fare Algorithm ============
// Formula: 45 + (km * 12) + (mins * 1.5), then tier multiplier
function calcFare(distanceKm, durationMin, multiplier = 1.0) {
  const base = 45;
  const distFare = distanceKm * 12;
  const timeFare = durationMin * 1.5;
  const subtotal = base + distFare + timeFare;
  const total = subtotal * multiplier;
  return {
    base,
    distFare: Math.round(distFare),
    timeFare: Math.round(timeFare),
    multiplier,
    subtotal: Math.round(subtotal),
    total: Math.round(total),
  };
}

// ============ Global Session State ============
// State machine:
//   passenger: idle | selecting | pending | matched | accepted | complete
//   driver:    idle | pending | matched | accepted | complete
const RX_STATE = {
  view: "passenger",     // "passenger" | "driver"
  pState: "idle",
  dState: "idle",
  fleet: [],
  user: { lat: 21.1702, lng: 72.8311 }, // default Surat center, overridden by pickup
  pickup: null,          // {name, lat, lng}
  drop: null,            // {name, lat, lng}
  nearby: [],            // array of nearby drivers
  selectedDriver: null,
  // routes
  pickupRoute: null,     // driver -> pickup (blue)
  tripRoute: null,       // pickup -> drop (purple)
  // animation
  animFrame: 0,
  animTotal: 0,
  animTimer: null,
  animHalted: false,
  // fare calc
  fareBreakdown: null,
  tripDistanceKm: 0,
  tripDurationMin: 0,
  // pool
  paxCount: 1,
  poolPingActive: false,
  poolActiveCorider: null,
  // trip progress
  tripStartTime: null,
  tripElapsedMs: 0,
  // earnings
  dayEarnings: 0,
  dayTrips: 0,
};

window.RX_ENGINE = {
  haversineKm,
  findClosestDrivers,
  getOSRMRoute,
  calcFare,
  RX_STATE,
};
