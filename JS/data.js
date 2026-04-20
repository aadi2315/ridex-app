/* ==========================================================
   RideX — Mock Data
   Surat, Gujarat area with real coordinates
   ========================================================== */

// Popular Surat locations with real lat/lng
const LOCATIONS = [
  { name: "Surat Railway Station", lat: 21.2055, lng: 72.8397 },
  { name: "VR Mall Surat", lat: 21.1450, lng: 72.7766 },
  { name: "Dumas Beach", lat: 21.0796, lng: 72.7133 },
  { name: "Sarthana Zoo", lat: 21.2439, lng: 72.8851 },
  { name: "Adajan", lat: 21.1988, lng: 72.7887 },
  { name: "Vesu Main Road", lat: 21.1462, lng: 72.7796 },
  { name: "City Light", lat: 21.1625, lng: 72.7966 },
  { name: "Athwa Gate", lat: 21.1852, lng: 72.8113 },
  { name: "Piplod", lat: 21.1535, lng: 72.7895 },
  { name: "Udhna Darwaja", lat: 21.1746, lng: 72.8311 },
  { name: "Surat Airport", lat: 21.1141, lng: 72.7417 },
  { name: "Iscon Mall", lat: 21.1667, lng: 72.7889 },
];

// Vehicle models with tier multipliers
const VEHICLES = [
  // UberGo / UberX (hatchback) - 1.0x
  { model: "Maruti Swift", tier: "UberGo", capacity: 4, multiplier: 1.0 },
  { model: "Hyundai i20", tier: "UberGo", capacity: 4, multiplier: 1.0 },
  { model: "Tata Tiago", tier: "UberGo", capacity: 4, multiplier: 1.0 },
  { model: "Wagon R", tier: "UberGo", capacity: 4, multiplier: 1.0 },
  // Sedan - 1.2x
  { model: "Maruti Dzire", tier: "UberX Sedan", capacity: 4, multiplier: 1.2 },
  { model: "Honda City", tier: "UberX Sedan", capacity: 4, multiplier: 1.2 },
  { model: "Hyundai Aura", tier: "UberX Sedan", capacity: 4, multiplier: 1.2 },
  // SUV - 1.5x
  { model: "Toyota Innova", tier: "UberXL SUV", capacity: 6, multiplier: 1.5 },
  { model: "Tata Nexon", tier: "UberXL SUV", capacity: 5, multiplier: 1.5 },
  { model: "Mahindra XUV", tier: "UberXL SUV", capacity: 6, multiplier: 1.5 },
];

// Indian driver first names
const DRIVER_NAMES = [
  "Ramesh P.", "Suresh K.", "Mahesh S.", "Vijay R.", "Ajay M.",
  "Sanjay D.", "Rajesh T.", "Dinesh B.", "Kiran V.", "Nilesh G.",
  "Mukesh A.", "Bhavesh S.", "Hardik P.", "Jignesh K.", "Hitesh R.",
  "Kalpesh M.", "Parth D.", "Rohit J.", "Aniket P.", "Chirag V.",
];

// Co-rider names for UberPool
const CORIDER_NAMES = [
  "Priya", "Neha", "Rahul", "Sneha", "Aarav", "Isha", "Karan", "Meera"
];

// Generate a random GJ-05 (Surat) plate number
function randomPlate() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const l1 = letters[Math.floor(Math.random() * letters.length)];
  const l2 = letters[Math.floor(Math.random() * letters.length)];
  const num = String(Math.floor(1000 + Math.random() * 8999));
  return `GJ-05-${l1}${l2}-${num}`;
}

// Generate a realistic +91 phone number
function randomPhone() {
  const prefixes = ["98", "97", "99", "93", "94", "90"];
  const pref = prefixes[Math.floor(Math.random() * prefixes.length)];
  const rest = String(Math.floor(10000000 + Math.random() * 89999999));
  return `+91 ${pref}${rest.slice(0, 3)}-${rest.slice(3)}`;
}

// Random point within ~3km radius of center (Surat ~21.17, 72.83)
function randomNearby(center, radiusKm = 3) {
  const r = radiusKm / 111; // roughly degrees
  const u = Math.random();
  const v = Math.random();
  const w = r * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const dLat = w * Math.cos(t);
  const dLng = w * Math.sin(t) / Math.cos(center.lat * Math.PI / 180);
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

// Create fleet of drivers scattered around Surat
function generateFleet(count = 18) {
  const center = { lat: 21.1702, lng: 72.8311 };
  const fleet = [];
  const usedNames = new Set();
  for (let i = 0; i < count; i++) {
    let name;
    do { name = DRIVER_NAMES[Math.floor(Math.random() * DRIVER_NAMES.length)]; }
    while (usedNames.has(name) && usedNames.size < DRIVER_NAMES.length);
    usedNames.add(name);

    const vehicle = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];
    const pos = randomNearby(center, 4);
    fleet.push({
      id: `DRV-${1000 + i}`,
      name,
      phone: randomPhone(),
      rating: (4.5 + Math.random() * 0.49).toFixed(2),
      plate: randomPlate(),
      vehicle: { ...vehicle },
      lat: pos.lat,
      lng: pos.lng,
      isActive: true,
    });
  }
  return fleet;
}

// Export to window
window.RX_DATA = {
  LOCATIONS,
  VEHICLES,
  DRIVER_NAMES,
  CORIDER_NAMES,
  randomPlate,
  randomPhone,
  randomNearby,
  generateFleet,
};
