/* ==========================================================
   RideX — Real Database Connection via Supabase API
   ========================================================== */

// Your Supabase URL and Publishable Key
const SUPABASE_URL = 'https://ifyryonjxnwozvicwfrz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jCBRyM_UZVh93va758xKXw_jGwvjY3k';

// Initialize Supabase Client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const CORIDER_NAMES = ["Priya", "Neha", "Rahul", "Sneha", "Aarav", "Isha", "Karan", "Meera"];

// Fetch the fleet live from the Supabase Database Function!
async function fetchFleetFromDB() {
  try {
    // Calling the SQL function we created in Supabase
    const { data, error } = await supabase.rpc('get_active_drivers');
    
    if (error) throw error;
    
    // Format the database rows to match what our frontend expects
    return data.map((driver, index) => {
      // Determine tier based on model
      let tier = "UberGo", multiplier = 1.0;
      const modelLower = driver.vehicle_model ? driver.vehicle_model.toLowerCase() : "";
      
      if (modelLower.includes("innova") || modelLower.includes("suv") || modelLower.includes("nexon") || modelLower.includes("creta")) {
        tier = "UberXL SUV"; multiplier = 1.5;
      } else if (modelLower.includes("city") || modelLower.includes("dzire") || modelLower.includes("sedan")) {
        tier = "UberX Sedan"; multiplier = 1.2;
      }

      return {
        id: driver.id,
        name: driver.name,
        // Generating mock phone numbers here since they aren't in the DB
        phone: `+91 98240 ${10000 + index}`, 
        rating: driver.rating || "4.8",
        plate: driver.plate,
        vehicle: { model: driver.vehicle_model, tier: tier, multiplier: multiplier },
        lat: driver.lat,
        lng: driver.lng,
        isActive: true
      };
    });
  } catch (error) {
    console.error("Error fetching from Supabase:", error);
    return []; // Return empty array if connection fails so the app doesn't crash
  }
}

// Utility to bounce drivers slightly so the map looks alive between rides
function randomNearby(center, radiusKm = 3) {
  const r = radiusKm / 111; 
  const u = Math.random();
  const v = Math.random();
  const w = r * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const dLat = w * Math.cos(t);
  const dLng = w * Math.sin(t) / Math.cos(center.lat * Math.PI / 180);
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

window.RX_DATA = {
  LOCATIONS,
  CORIDER_NAMES,
  fetchFleetFromDB,
  randomNearby
};