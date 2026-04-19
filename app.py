import streamlit as st
import psycopg2
import pandas as pd
import requests
import time
import pydeck as pdk
from geopy.geocoders import Nominatim

# --- 1. SETUP DATABASE ---
DB_URI = "postgresql://postgres.ifyryonjxnwozvicwfrz:dbmsridesharing@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

def run_query(query, params=None):
    with psycopg2.connect(DB_URI) as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            if query.strip().upper().startswith("SELECT"):
                columns = [desc[0] for desc in cur.description]
                return pd.DataFrame(cur.fetchall(), columns=columns)
            conn.commit()

# --- 2. HELPER FUNCTIONS ---
geolocator = Nominatim(user_agent="dbms_uber_clone")
SURAT_LOCATIONS = ["Surat Railway Station", "VR Mall", "SVNIT Campus", "Adajan", "Udhana", "Dumas Beach", "Vesu", "Custom (Type your own)"]

def get_coordinates(address):
    try:
        location = geolocator.geocode(address + ", Surat, India")
        if location: return location.latitude, location.longitude
    except: return None, None
    return None, None

def get_road_route(start_lat, start_lng, end_lat, end_lng):
    url = f"http://router.project-osrm.org/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}?overview=full&geometries=geojson"
    response = requests.get(url).json()
    if response.get("routes"):
        route_data = response["routes"][0]
        return route_data["geometry"]["coordinates"], route_data["duration"], route_data["distance"]
    return [], 0, 0

def calculate_fare(distance_m, duration_sec, vehicle_model):
    total = 45.0 + ((distance_m / 1000) * 12.0) + ((duration_sec / 60) * 1.5)
    model = vehicle_model.lower()
    if any(x in model for x in ["innova", "suv", "nexon"]): total *= 1.5
    elif any(x in model for x in ["city", "dzire", "sedan"]): total *= 1.2
    return total

# --- 3. SESSION STATE & PROFILES ---
if "step" not in st.session_state: st.session_state.step = "idle"
if "pickup_coords" not in st.session_state: st.session_state.pickup_coords = None
if "dropoff_coords" not in st.session_state: st.session_state.dropoff_coords = None
if "driver" not in st.session_state: st.session_state.driver = None
if "nearby_drivers" not in st.session_state: st.session_state.nearby_drivers = None
if "current_location" not in st.session_state: st.session_state.current_location = [21.1702, 72.8311]
if "simulating" not in st.session_state: st.session_state.simulating = False
if "route_index" not in st.session_state: st.session_state.route_index = 0
if "driver_arrived" not in st.session_state: st.session_state.driver_arrived = False
if "trip_finished" not in st.session_state: st.session_state.trip_finished = False
if "passenger_count" not in st.session_state: st.session_state.passenger_count = 1
if "pool_request_active" not in st.session_state: st.session_state.pool_request_active = False

if "passenger_profile" not in st.session_state:
    st.session_state.passenger_profile = {"name": "Aadish", "rating": 4.9, "history": []}
if "driver_profiles" not in st.session_state:
    st.session_state.driver_profiles = {}

def reset_trip_state():
    st.session_state.step = "idle"
    st.session_state.driver = None
    st.session_state.simulating = False
    st.session_state.driver_arrived = False
    st.session_state.trip_finished = False
    st.session_state.passenger_count = 1
    st.session_state.pool_request_active = False

# --- 4. PAGE CONFIG + FULL UI SKIN ---
st.set_page_config(layout="wide", page_title="RideX — Surat", page_icon="🚖")

st.markdown("""
<style>
/* ── GOOGLE FONTS ── */
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

/* ══════════════════════════════════════════
   ROOT TOKENS
══════════════════════════════════════════ */
:root {
  --black:    #0a0a0a;
  --surface:  #111111;
  --card:     #1a1a1a;
  --border:   #2a2a2a;
  --accent:   #f5c518;   /* Golden-amber — premium */
  --accent2:  #e8f542;   /* Lime for live states  */
  --muted:    #888888;
  --text:     #f0f0f0;
  --danger:   #ff4d4d;
  --success:  #2ecc71;
  --info:     #5baff5;
  --font-h:   'Syne', sans-serif;
  --font-b:   'DM Sans', sans-serif;
  --radius:   14px;
  --radius-sm:8px;
  --shadow:   0 4px 32px rgba(0,0,0,0.55);
}

/* ══════════════════════════════════════════
   GLOBAL RESETS
══════════════════════════════════════════ */
html, body, [class*="css"] {
  background-color: var(--black) !important;
  color: var(--text) !important;
  font-family: var(--font-b) !important;
}

/* Hide Streamlit chrome but preserve sidebar toggle */
#MainMenu, footer, .stDeployButton { display: none !important; }
header[data-testid="stHeader"] {
  background: transparent !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: visible !important;
}
/* Always show the sidebar collapse / expand arrow */
[data-testid="collapsedControl"] {
  display: flex !important;
  visibility: visible !important;
  opacity: 1 !important;
  position: fixed !important;
  top: 0.6rem !important;
  left: 0.6rem !important;
  z-index: 99999 !important;
  background: var(--card) !important;
  border: 1px solid var(--border) !important;
  border-radius: 8px !important;
  padding: 4px !important;
}
[data-testid="stSidebarCollapseButton"] {
  display: flex !important;
  visibility: visible !important;
  opacity: 1 !important;
  z-index: 9999 !important;
  background: transparent !important;
}
[data-testid="collapsedControl"] svg,
[data-testid="stSidebarCollapseButton"] svg {
  fill: var(--text) !important;
  color: var(--text) !important;
  width: 18px !important;
  height: 18px !important;
}
.block-container { padding: 1.5rem 2rem 3rem !important; max-width: 100% !important; }

/* ══════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════ */
[data-testid="stSidebar"] {
  background: var(--surface) !important;
  border-right: 1px solid var(--border) !important;
}
[data-testid="stSidebar"] * { color: var(--text) !important; }
[data-testid="stSidebar"] .stRadio label {
  font-family: var(--font-b) !important;
  font-weight: 500 !important;
  font-size: 0.9rem !important;
  padding: 0.4rem 0.6rem !important;
  border-radius: var(--radius-sm) !important;
  transition: background 0.2s;
}
[data-testid="stSidebar"] .stRadio label:hover {
  background: var(--card) !important;
}

/* Sidebar title */
[data-testid="stSidebar"] h1,
[data-testid="stSidebar"] h2,
[data-testid="stSidebar"] h3 {
  font-family: var(--font-h) !important;
  color: var(--accent) !important;
  letter-spacing: -0.03em !important;
}

/* ══════════════════════════════════════════
   PAGE TITLE
══════════════════════════════════════════ */
h1 {
  font-family: var(--font-h) !important;
  font-weight: 800 !important;
  font-size: clamp(1.6rem, 3vw, 2.4rem) !important;
  letter-spacing: -0.04em !important;
  color: var(--text) !important;
  line-height: 1.1 !important;
}
h2, h3 {
  font-family: var(--font-h) !important;
  font-weight: 700 !important;
  letter-spacing: -0.03em !important;
  color: var(--text) !important;
}

/* Divider */
hr { border-color: var(--border) !important; margin: 0.75rem 0 !important; }

/* ══════════════════════════════════════════
   INPUTS & SELECTS
══════════════════════════════════════════ */
.stSelectbox > div > div,
.stTextInput > div > div > input,
.stSlider > div {
  background: var(--card) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm) !important;
  color: var(--text) !important;
  font-family: var(--font-b) !important;
  transition: border-color 0.2s;
}
.stSelectbox > div > div:focus-within,
.stTextInput > div > div > input:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 2px rgba(245,197,24,0.18) !important;
}
.stSelectbox svg { fill: var(--muted) !important; }
label, .stSelectbox label, .stTextInput label {
  font-family: var(--font-b) !important;
  font-size: 0.78rem !important;
  font-weight: 500 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  color: var(--muted) !important;
}

/* ══════════════════════════════════════════
   BUTTONS
══════════════════════════════════════════ */
.stButton > button {
  background: var(--accent) !important;
  color: var(--black) !important;
  border: none !important;
  border-radius: var(--radius-sm) !important;
  font-family: var(--font-h) !important;
  font-weight: 700 !important;
  font-size: 0.88rem !important;
  letter-spacing: 0.02em !important;
  padding: 0.55rem 1.2rem !important;
  transition: all 0.18s ease !important;
  box-shadow: 0 2px 10px rgba(245,197,24,0.25) !important;
}
.stButton > button:hover {
  background: #ffd332 !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 6px 18px rgba(245,197,24,0.35) !important;
}
.stButton > button:active {
  transform: translateY(0) !important;
}
/* Secondary / cancel buttons */
.stButton > button[kind="secondary"] {
  background: var(--card) !important;
  color: var(--text) !important;
  border: 1px solid var(--border) !important;
  box-shadow: none !important;
}
.stButton > button[kind="secondary"]:hover {
  background: #222 !important;
  border-color: var(--muted) !important;
  transform: none !important;
}

/* ══════════════════════════════════════════
   CONTAINERS / CARDS
══════════════════════════════════════════ */
[data-testid="stVerticalBlockBorderWrapper"] > div {
  background: var(--card) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  padding: 1rem 1.2rem !important;
  box-shadow: var(--shadow) !important;
}

/* ══════════════════════════════════════════
   ALERTS / STATUS BANNERS
══════════════════════════════════════════ */
/* SUCCESS */
[data-testid="stAlert"][data-baseweb="notification"][kind="success"],
.element-container .stSuccess {
  background: rgba(46,204,113,0.1) !important;
  border-left: 3px solid var(--success) !important;
  border-radius: var(--radius-sm) !important;
  color: #a8f0c4 !important;
}
/* WARNING */
[data-testid="stAlert"][data-baseweb="notification"][kind="warning"],
.element-container .stWarning {
  background: rgba(245,197,24,0.08) !important;
  border-left: 3px solid var(--accent) !important;
  border-radius: var(--radius-sm) !important;
  color: #ffe99a !important;
}
/* ERROR */
[data-testid="stAlert"][data-baseweb="notification"][kind="error"],
.element-container .stError {
  background: rgba(255,77,77,0.1) !important;
  border-left: 3px solid var(--danger) !important;
  border-radius: var(--radius-sm) !important;
  color: #ffaaaa !important;
}
/* INFO */
[data-testid="stAlert"][data-baseweb="notification"][kind="info"],
.element-container .stInfo {
  background: rgba(91,175,245,0.08) !important;
  border-left: 3px solid var(--info) !important;
  border-radius: var(--radius-sm) !important;
  color: #b3d9f7 !important;
}

/* ══════════════════════════════════════════
   METRICS
══════════════════════════════════════════ */
[data-testid="stMetric"] {
  background: var(--card) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  padding: 0.8rem 1rem !important;
}
[data-testid="stMetricLabel"] {
  font-family: var(--font-b) !important;
  font-size: 0.75rem !important;
  text-transform: uppercase !important;
  letter-spacing: 0.08em !important;
  color: var(--muted) !important;
}
[data-testid="stMetricValue"] {
  font-family: var(--font-h) !important;
  font-size: 1.8rem !important;
  font-weight: 800 !important;
  color: var(--accent) !important;
}

/* ══════════════════════════════════════════
   DATAFRAMES / TABLES
══════════════════════════════════════════ */
[data-testid="stDataFrame"] {
  border: 1px solid var(--border) !important;
  border-radius: var(--radius) !important;
  overflow: hidden !important;
}

/* ══════════════════════════════════════════
   SLIDERS
══════════════════════════════════════════ */
[data-testid="stSlider"] [data-baseweb="slider"] [role="slider"] {
  background: var(--accent) !important;
  border-color: var(--accent) !important;
}
[data-testid="stSlider"] [data-baseweb="slider"] [data-testid="stTickBar"] div {
  background: var(--accent) !important;
}

/* ══════════════════════════════════════════
   EXPANDER
══════════════════════════════════════════ */
[data-testid="stExpander"] {
  background: var(--card) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm) !important;
}
[data-testid="stExpander"] summary {
  font-family: var(--font-b) !important;
  font-weight: 500 !important;
  color: var(--text) !important;
}

/* ══════════════════════════════════════════
   SPINNER
══════════════════════════════════════════ */
[data-testid="stSpinner"] > div {
  border-top-color: var(--accent) !important;
}

/* ══════════════════════════════════════════
   CAPTION / SMALL TEXT
══════════════════════════════════════════ */
.stCaption, small, .stMarkdown small {
  color: var(--muted) !important;
  font-size: 0.78rem !important;
}

/* ══════════════════════════════════════════
   PYDECK MAP CONTAINER
══════════════════════════════════════════ */
[data-testid="stDeckGlJsonChart"] {
  border-radius: var(--radius) !important;
  overflow: hidden !important;
  border: 1px solid var(--border) !important;
  box-shadow: var(--shadow) !important;
}

/* ══════════════════════════════════════════
   COLUMN GAPS
══════════════════════════════════════════ */
[data-testid="stHorizontalBlock"] {
  gap: 1.5rem !important;
  align-items: flex-start !important;
}

/* ══════════════════════════════════════════
   SCROLLBAR
══════════════════════════════════════════ */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--black); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

/* ══════════════════════════════════════════
   RADIO BUTTONS (device router)
══════════════════════════════════════════ */
[data-testid="stRadio"] label {
  background: transparent !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-sm) !important;
  padding: 0.45rem 0.8rem !important;
  margin: 0.2rem 0 !important;
  cursor: pointer !important;
  transition: all 0.2s !important;
  display: flex !important;
  align-items: center !important;
}
[data-testid="stRadio"] label:hover {
  border-color: var(--accent) !important;
  background: rgba(245,197,24,0.06) !important;
}

/* ══════════════════════════════════════════
   CUSTOM BADGE CHIPS  (used via st.markdown)
══════════════════════════════════════════ */
.badge {
  display: inline-block;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 99px;
  padding: 2px 10px;
  font-size: 0.72rem;
  font-family: var(--font-b);
  font-weight: 500;
  color: var(--muted);
  letter-spacing: 0.04em;
}
.badge-accent {
  background: rgba(245,197,24,0.12);
  border-color: var(--accent);
  color: var(--accent);
}
.badge-success {
  background: rgba(46,204,113,0.1);
  border-color: var(--success);
  color: #2ecc71;
}
.badge-live {
  background: rgba(232,245,66,0.1);
  border-color: var(--accent2);
  color: var(--accent2);
  animation: pulse-badge 2s infinite;
}
@keyframes pulse-badge {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

/* ══════════════════════════════════════════
   HEADER BAR (injected HTML)
══════════════════════════════════════════ */
.ridex-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0 1.2rem 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1.5rem;
}
.ridex-logo {
  font-family: var(--font-h);
  font-weight: 800;
  font-size: 1.7rem;
  letter-spacing: -0.05em;
  color: var(--text);
}
.ridex-logo span { color: var(--accent); }
.ridex-pill {
  font-family: var(--font-b);
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.3rem 0.9rem;
  border-radius: 99px;
  border: 1px solid var(--border);
  color: var(--muted);
  letter-spacing: 0.05em;
}

/* ══════════════════════════════════════════
   STEP TRACKER BAR
══════════════════════════════════════════ */
.step-bar {
  display: flex;
  gap: 0.5rem;
  margin: 0.6rem 0 1.2rem 0;
  align-items: center;
}
.step-node {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--card);
  border: 2px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-h);
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--muted);
  transition: all 0.3s;
}
.step-node.done  { background: var(--success); border-color: var(--success); color: #fff; }
.step-node.active{ background: var(--accent);  border-color: var(--accent);  color: var(--black); }
.step-line {
  flex: 1;
  height: 2px;
  background: var(--border);
  border-radius: 2px;
  transition: background 0.3s;
}
.step-line.done { background: var(--success); }

/* ══════════════════════════════════════════
   DRIVER CARD (in selection list)
══════════════════════════════════════════ */
.d-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  margin-bottom: 0.75rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.d-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 4px 20px rgba(245,197,24,0.12);
}
.d-name {
  font-family: var(--font-h);
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
}
.d-sub {
  font-family: var(--font-b);
  font-size: 0.78rem;
  color: var(--muted);
  margin-top: 0.2rem;
}
.d-fare {
  font-family: var(--font-h);
  font-weight: 800;
  font-size: 1.5rem;
  color: var(--accent);
  text-align: right;
}

/* ══════════════════════════════════════════
   FARE RECEIPT CARD
══════════════════════════════════════════ */
.receipt-card {
  background: linear-gradient(135deg, #1a1a1a 0%, #141414 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  margin: 0.5rem 0;
  position: relative;
  overflow: hidden;
}
.receipt-card::before {
  content: '';
  position: absolute;
  top: -30px; right: -30px;
  width: 100px; height: 100px;
  background: radial-gradient(circle, rgba(245,197,24,0.15), transparent 70%);
  pointer-events: none;
}
.receipt-total {
  font-family: var(--font-h);
  font-weight: 800;
  font-size: 2.4rem;
  color: var(--accent);
  letter-spacing: -0.04em;
  line-height: 1;
}
.receipt-label {
  font-family: var(--font-b);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 0.25rem;
}

/* ══════════════════════════════════════════
   POOL SECTION
══════════════════════════════════════════ */
.pool-bar {
  display: flex;
  gap: 0.4rem;
  margin: 0.5rem 0;
}
.pool-seat {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.85rem;
  border: 2px solid var(--border);
  background: var(--card);
  transition: all 0.3s;
}
.pool-seat.filled { background: var(--accent); border-color: var(--accent); }
.pool-seat.empty  { opacity: 0.35; }

/* ══════════════════════════════════════════
   PING CARD (co-rider request)
══════════════════════════════════════════ */
.ping-card {
  background: rgba(245,197,24,0.06);
  border: 1px solid rgba(245,197,24,0.3);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  animation: ping-glow 2s infinite;
}
@keyframes ping-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245,197,24,0.15); }
  50%       { box-shadow: 0 0 0 6px rgba(245,197,24,0); }
}

/* ══════════════════════════════════════════
   SPINNER OVERRIDE
══════════════════════════════════════════ */
.stSpinner > div { border-top-color: var(--accent) !important; }

/* ══════════════════════════════════════════
   MAP LABEL PILL
══════════════════════════════════════════ */
.map-label {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 99px;
  padding: 0.3rem 0.9rem;
  font-family: var(--font-b);
  font-size: 0.78rem;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 4px 8px 0;
}
.dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
.dot-green  { background: #2ecc71; }
.dot-red    { background: #ff4d4d; }
.dot-blue   { background: #5baff5; }
.dot-orange { background: #f5a623; }
</style>
""", unsafe_allow_html=True)


# ══════════════════════════════════════════
#   HEADER BANNER
# ══════════════════════════════════════════
st.markdown("""
<div class="ridex-header">
  <div class="ridex-logo">Ride<span>X</span></div>
  <div style="display:flex;gap:0.5rem;align-items:center;">
    <span class="badge badge-live">● LIVE</span>
    <span class="ridex-pill">Surat, GJ</span>
  </div>
</div>
""", unsafe_allow_html=True)


# ══════════════════════════════════════════
#   SIDEBAR
# ══════════════════════════════════════════
st.sidebar.markdown("""
<div style="font-family:'Syne',sans-serif;font-weight:800;font-size:1.3rem;
            letter-spacing:-0.04em;color:#f5c518;margin-bottom:0.5rem;">
  RideX
</div>
""", unsafe_allow_html=True)
st.sidebar.markdown("**🔐 Device Simulator**")
app_mode = st.sidebar.radio("View App As:", ["🧍 Passenger (Aadish)", "🚖 Driver Dashboard"])
st.sidebar.markdown("<hr>", unsafe_allow_html=True)

if app_mode == "🧍 Passenger (Aadish)":
    st.sidebar.markdown("**👤 My Profile**")
    st.sidebar.markdown(f"""
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.5rem;">
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1rem;color:#f0f0f0;">
        {st.session_state.passenger_profile['name']}
      </div>
      <div style="font-size:0.78rem;color:#888;margin-top:0.2rem;">
        ⭐ {st.session_state.passenger_profile['rating']:.1f} &nbsp;·&nbsp;
        {len(st.session_state.passenger_profile['history'])} rides
      </div>
    </div>
    """, unsafe_allow_html=True)
    with st.sidebar.expander("📋 Ride History"):
        if not st.session_state.passenger_profile['history']:
            st.markdown("<div style='color:#888;font-size:0.82rem;'>No rides yet.</div>", unsafe_allow_html=True)
        for ride in reversed(st.session_state.passenger_profile['history']):
            plate = ride.get('plate_number', 'N/A')
            st.markdown(f"""
            <div style="margin-bottom:0.6rem;padding-bottom:0.6rem;border-bottom:1px solid #2a2a2a;">
              <div style="font-size:0.75rem;color:#888;">{ride['date']}</div>
              <div style="font-weight:500;font-size:0.85rem;">{ride['driver']}</div>
              <div style="font-size:0.78rem;color:#888;">🏷️ <code style='background:#111;padding:1px 5px;border-radius:4px;'>{plate}</code></div>
              <div style="display:flex;justify-content:space-between;margin-top:0.2rem;">
                <span style="color:#f5c518;font-weight:700;">₹{ride['fare']:.0f}</span>
                <span style="color:#f0f0f0;">{"⭐" * ride['given_rating']}</span>
              </div>
            </div>
            """, unsafe_allow_html=True)

elif app_mode == "🚖 Driver Dashboard":
    d_name = st.session_state.driver['name'] if st.session_state.driver else "Awaiting Match..."
    d_rating = st.session_state.driver_profiles.get(d_name, 4.8) if st.session_state.driver else "-"
    st.sidebar.markdown(f"""
    <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:0.8rem 1rem;">
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1rem;color:#f0f0f0;">{d_name}</div>
      <div style="font-size:0.78rem;color:#888;margin-top:0.2rem;">⭐ {d_rating} &nbsp;·&nbsp;
        <span style="color:#2ecc71;font-weight:600;">● Online</span>
      </div>
    </div>
    """, unsafe_allow_html=True)


# ══════════════════════════════════════════
#   STEP PROGRESS BAR HELPER
# ══════════════════════════════════════════
def render_step_bar(current_step):
    steps = ["idle", "selecting", "driver_pending", "matched", "accepted"]
    labels = ["📍", "🔍", "⏳", "🚗", "✅"]
    idx = steps.index(current_step) if current_step in steps else 0
    nodes = ""
    for i, (s, l) in enumerate(zip(steps, labels)):
        if i < idx:
            cls = "done"; lbl = "✓"
        elif i == idx:
            cls = "active"; lbl = l
        else:
            cls = ""; lbl = l
        nodes += f'<div class="step-node {cls}">{lbl}</div>'
        if i < len(steps) - 1:
            line_cls = "done" if i < idx else ""
            nodes += f'<div class="step-line {line_cls}"></div>'
    st.markdown(f'<div class="step-bar">{nodes}</div>', unsafe_allow_html=True)


# ══════════════════════════════════════════
#   MAIN COLUMNS
# ══════════════════════════════════════════
col1, col2 = st.columns([1, 2])

# ══════════════════════════════════════════════════
#   INTERFACE 1: PASSENGER APP
# ══════════════════════════════════════════════════
if app_mode == "🧍 Passenger (Aadish)":
    with col1:
        render_step_bar(st.session_state.step)

        # ── IDLE: pick locations ──
        if st.session_state.step == "idle":
            st.markdown("""
            <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:1.3rem;
                        letter-spacing:-0.03em;margin-bottom:1rem;">
              Where to? 🗺️
            </div>
            """, unsafe_allow_html=True)

            pickup_choice = st.selectbox("Pickup Location", SURAT_LOCATIONS)
            pickup = st.text_input("Enter custom pickup", label_visibility="collapsed") if pickup_choice == "Custom (Type your own)" else pickup_choice
            dropoff_choice = st.selectbox("Dropoff Location", SURAT_LOCATIONS, index=1)
            dropoff = st.text_input("Enter custom dropoff", label_visibility="collapsed") if dropoff_choice == "Custom (Type your own)" else dropoff_choice

            if st.button("🔍 Search Nearby Drivers", use_container_width=True):
                with st.spinner("Locating drivers & calculating fares..."):
                    p_lat, p_lng = get_coordinates(pickup)
                    d_lat, d_lng = get_coordinates(dropoff)
                    if p_lat and d_lat:
                        st.session_state.pickup_coords  = (p_lat, p_lng)
                        st.session_state.dropoff_coords = (d_lat, d_lng)
                        st.session_state.p_text = pickup
                        st.session_state.d_text = dropoff
                        r_dropoff, t_dropoff, d_dropoff = get_road_route(p_lat, p_lng, d_lat, d_lng)
                        st.session_state.route_to_dropoff   = r_dropoff
                        st.session_state.time_to_dropoff    = t_dropoff
                        st.session_state.distance_to_dropoff = d_dropoff

                        df_drivers = run_query(
                            "SELECT d.driver_id, d.name, v.model, v.plate_number, "
                            "ST_Distance(dl.location, ST_MakePoint(%s, %s)::geography) AS dist_m, "
                            "ST_Y(dl.location::geometry) as driver_lat, "
                            "ST_X(dl.location::geometry) as driver_lng "
                            "FROM Driver_Locations dl JOIN Drivers d ON dl.driver_id = d.driver_id "
                            "JOIN Vehicles v ON d.vehicle_id = v.vehicle_id "
                            "WHERE d.is_active = TRUE ORDER BY dist_m ASC LIMIT 4;",
                            (p_lng, p_lat)
                        )
                        if not df_drivers.empty:
                            df_drivers['est_fare'] = [
                                calculate_fare(d_dropoff, t_dropoff, row['model'])
                                for _, row in df_drivers.iterrows()
                            ]
                            df_drivers['phone_number'] = [
                                f"+91 98240 {10000 + i}" for i in range(len(df_drivers))
                            ]
                            st.session_state.nearby_drivers = df_drivers
                            st.session_state.step = "selecting"
                            st.rerun()
                        else:
                            st.error("No drivers available nearby.")
                    else:
                        st.error("Could not geocode one or both addresses.")

        # ── SELECTING: pick a driver ──
        elif st.session_state.step == "selecting":
            st.markdown("""
            <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1.1rem;
                        letter-spacing:-0.02em;margin-bottom:0.8rem;">
              Select a Ride 🚘
            </div>
            """, unsafe_allow_html=True)

            for index, row in st.session_state.nearby_drivers.iterrows():
                driver_rating = st.session_state.driver_profiles.get(row['name'], 4.8)
                tier = "🏎️ Premium" if any(x in row['model'].lower() for x in ["innova","suv","nexon"]) else \
                       "🚗 Comfort"  if any(x in row['model'].lower() for x in ["city","dzire","sedan"]) else \
                       "🛵 Standard"
                st.markdown(f"""
                <div class="d-card">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                      <div class="d-name">{row['name']}</div>
                      <div class="d-sub">
                        ⭐ {driver_rating:.1f} &nbsp;·&nbsp;
                        📞 <code style="background:#111;padding:1px 4px;border-radius:3px;font-size:0.75rem;">{row['phone_number']}</code>
                      </div>
                      <div style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
                        <span class="badge">{row['model']}</span>
                        <span class="badge badge-accent">🏷️ {row['plate_number']}</span>
                        <span class="badge">{row['dist_m']:.0f}m away</span>
                        <span class="badge">{tier}</span>
                      </div>
                    </div>
                    <div class="d-fare">₹{row['est_fare']:.0f}</div>
                  </div>
                </div>
                """, unsafe_allow_html=True)

                if st.button(f"Request {row['name']}", key=f"btn_{row['driver_id']}", use_container_width=True):
                    st.session_state.driver = row.to_dict()
                    dr_lat, dr_lng = st.session_state.driver['driver_lat'], st.session_state.driver['driver_lng']
                    st.session_state.route_to_pickup, st.session_state.time_to_pickup, _ = \
                        get_road_route(dr_lat, dr_lng,
                                       st.session_state.pickup_coords[0], st.session_state.pickup_coords[1])
                    st.session_state.step = "driver_pending"
                    st.rerun()

            if st.button("← Cancel", type="secondary", use_container_width=True):
                reset_trip_state(); st.rerun()

        # ── PENDING: waiting for driver ──
        elif st.session_state.step == "driver_pending":
            st.warning("⏳ Waiting for driver to accept your request…")
            st.markdown("""
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;
                        padding:1rem 1.1rem;margin:0.5rem 0;">
              <div style="font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:0.06em;">
                Next step
              </div>
              <div style="font-size:0.9rem;color:#f0f0f0;margin-top:0.3rem;">
                Switch to <strong style="color:#f5c518;">Driver Dashboard</strong> in the sidebar to accept this ride.
              </div>
            </div>
            """, unsafe_allow_html=True)
            if st.button("Cancel Request", type="secondary", use_container_width=True):
                reset_trip_state(); st.rerun()

        # ── MATCHED: driver en route ──
        elif st.session_state.step == "matched":
            eta = max(1, int(
                (st.session_state.time_to_pickup *
                 (1.0 - st.session_state.route_index / max(1, len(st.session_state.route_to_pickup))))
                // 60
            )) if st.session_state.simulating else max(1, int(st.session_state.time_to_pickup // 60))

            d = st.session_state.driver
            driver_rating = st.session_state.driver_profiles.get(d['name'], 4.8)
            st.markdown(f"""
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:1rem 1.1rem;margin-bottom:0.8rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1rem;">{d['name']}</div>
                  <div style="font-size:0.78rem;color:#888;margin-top:0.15rem;">
                    ⭐ {driver_rating:.1f} &nbsp;·&nbsp; {d['model']}
                  </div>
                  <div style="margin-top:0.4rem;">
                    <span class="badge badge-accent">🏷️ {d['plate_number']}</span>
                    <span class="badge" style="margin-left:4px;">📞 {d['phone_number']}</span>
                  </div>
                </div>
                <div style="text-align:right;">
                  <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:1.8rem;color:#f5c518;line-height:1;">
                    {eta}
                  </div>
                  <div style="font-size:0.7rem;color:#888;text-transform:uppercase;letter-spacing:0.06em;">mins away</div>
                </div>
              </div>
            </div>
            """, unsafe_allow_html=True)

            if st.session_state.driver_arrived:
                st.success("✅ Driver has arrived at your pickup!")
                if st.button("🚀 Hop In & Start Trip", type="primary", use_container_width=True):
                    st.session_state.step = "accepted"
                    st.session_state.simulating = True
                    st.session_state.active_route = st.session_state.route_to_dropoff
                    st.session_state.route_index = 0
                    st.rerun()

        # ── ACCEPTED: trip in progress ──
        elif st.session_state.step == "accepted":
            if not st.session_state.trip_finished:
                eta = max(1, int(
                    (st.session_state.time_to_dropoff *
                     (1.0 - st.session_state.route_index / max(1, len(st.session_state.route_to_dropoff))))
                    // 60
                )) if st.session_state.simulating else max(1, int(st.session_state.time_to_dropoff // 60))

                st.info(f"📍 Estimated Time Remaining: **{eta} min{'s' if eta != 1 else ''}**")

                # UberPool section
                st.markdown("<hr>", unsafe_allow_html=True)
                st.markdown("""
                <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1rem;
                            letter-spacing:-0.02em;margin-bottom:0.6rem;">👥 RideX Pool</div>
                """, unsafe_allow_html=True)

                seats_html = "".join([
                    f'<div class="pool-seat filled">🧍</div>' if i < st.session_state.passenger_count
                    else f'<div class="pool-seat empty">🧍</div>'
                    for i in range(4)
                ])
                fare_share = st.session_state.driver['est_fare'] / st.session_state.passenger_count
                st.markdown(f"""
                <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:0.8rem 1rem;margin-bottom:0.6rem;">
                  <div class="pool-bar">{seats_html}</div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.5rem;">
                    <div style="font-size:0.78rem;color:#888;">
                      {st.session_state.passenger_count}/4 riders
                    </div>
                    <div style="font-family:'Syne',sans-serif;font-weight:700;color:#f5c518;">
                      Your share: ₹{fare_share:.2f}
                    </div>
                  </div>
                </div>
                """, unsafe_allow_html=True)

                if st.session_state.passenger_count < 4:
                    if not st.session_state.pool_request_active:
                        if st.button("🔔 Simulate Co-Rider Ping", use_container_width=True):
                            st.session_state.pool_request_active = True; st.rerun()
                    else:
                        st.markdown("""
                        <div class="ping-card">
                          <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:0.95rem;color:#f5c518;">
                            Someone wants to join your ride!
                          </div>
                          <div style="font-size:0.8rem;color:#888;margin-top:0.2rem;">
                            Accepting will split the fare further.
                          </div>
                        </div>
                        """, unsafe_allow_html=True)
                        c1, c2 = st.columns(2)
                        with c1:
                            if st.button("✅ Accept", use_container_width=True):
                                st.session_state.passenger_count += 1
                                st.session_state.pool_request_active = False; st.rerun()
                        with c2:
                            if st.button("❌ Decline", use_container_width=True, type="secondary"):
                                st.session_state.pool_request_active = False; st.rerun()
            else:
                # ── RECEIPT ──
                final_fare = st.session_state.driver['est_fare'] / st.session_state.passenger_count
                dist_km = st.session_state.distance_to_dropoff / 1000
                st.markdown(f"""
                <div class="receipt-card">
                  <div class="receipt-label">Your Total</div>
                  <div class="receipt-total">₹{final_fare:.2f}</div>
                  <div style="margin-top:1rem;display:flex;gap:1.5rem;">
                    <div>
                      <div class="receipt-label">Distance</div>
                      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1.1rem;">
                        {dist_km:.1f} km
                      </div>
                    </div>
                    <div>
                      <div class="receipt-label">Riders</div>
                      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1.1rem;">
                        {st.session_state.passenger_count}
                      </div>
                    </div>
                    <div>
                      <div class="receipt-label">From</div>
                      <div style="font-size:0.82rem;color:#888;">{st.session_state.p_text}</div>
                    </div>
                    <div>
                      <div class="receipt-label">To</div>
                      <div style="font-size:0.82rem;color:#888;">{st.session_state.d_text}</div>
                    </div>
                  </div>
                </div>
                """, unsafe_allow_html=True)

                st.markdown("**⭐ Rate your driver**")
                rating = st.slider("Stars", 1, 5, 5, key="driver_rating",
                                   help="Drag to rate your experience")

                if st.button("💵 Pay & Complete Ride", type="primary", use_container_width=True):
                    d_name = st.session_state.driver['name']
                    current_driver_rating = st.session_state.driver_profiles.get(d_name, 4.8)
                    st.session_state.driver_profiles[d_name] = round((current_driver_rating + rating) / 2, 1)
                    st.session_state.passenger_profile['history'].append({
                        "date": time.strftime("%Y-%m-%d %H:%M"),
                        "driver": d_name,
                        "plate_number": st.session_state.driver['plate_number'],
                        "pickup": st.session_state.p_text,
                        "dropoff": st.session_state.d_text,
                        "fare": final_fare,
                        "given_rating": rating
                    })
                    reset_trip_state(); st.rerun()


# ══════════════════════════════════════════════════
#   INTERFACE 2: DRIVER DASHBOARD
# ══════════════════════════════════════════════════
elif app_mode == "🚖 Driver Dashboard":
    with col1:
        if st.session_state.step in ["idle", "selecting"]:
            st.markdown("""
            <div style="background:rgba(46,204,113,0.07);border:1px solid rgba(46,204,113,0.3);
                        border-radius:12px;padding:1.1rem 1.2rem;margin-bottom:0.8rem;">
              <div style="display:flex;align-items:center;gap:0.6rem;">
                <span style="font-size:1.2rem;">📡</span>
                <div>
                  <div style="font-family:'Syne',sans-serif;font-weight:700;color:#2ecc71;">Online</div>
                  <div style="font-size:0.78rem;color:#888;">Looking for ride requests…</div>
                </div>
              </div>
            </div>
            """, unsafe_allow_html=True)

        elif st.session_state.step == "driver_pending":
            d = st.session_state.driver
            pickup_eta = max(1, int(st.session_state.time_to_pickup // 60))
            dist_km    = st.session_state.distance_to_dropoff / 1000

            st.markdown(f"""
            <div style="background:rgba(255,77,77,0.08);border:1px solid rgba(255,77,77,0.35);
                        border-radius:12px;padding:1.2rem 1.3rem;margin-bottom:1rem;
                        animation:ping-glow 1.5s infinite;">
              <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:1.1rem;
                          color:#ff4d4d;letter-spacing:-0.02em;margin-bottom:0.8rem;">
                🚨 INCOMING RIDE REQUEST
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;">
                <div style="background:#111;border-radius:8px;padding:0.7rem 0.9rem;">
                  <div class="receipt-label">Pickup ETA</div>
                  <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1.4rem;color:#f0f0f0;">
                    {pickup_eta} min
                  </div>
                </div>
                <div style="background:#111;border-radius:8px;padding:0.7rem 0.9rem;">
                  <div class="receipt-label">Trip Distance</div>
                  <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:1.4rem;color:#f0f0f0;">
                    {dist_km:.1f} km
                  </div>
                </div>
                <div style="background:rgba(245,197,24,0.08);border:1px solid rgba(245,197,24,0.25);
                            border-radius:8px;padding:0.7rem 0.9rem;grid-column:1/-1;">
                  <div class="receipt-label">Your Earnings</div>
                  <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:2rem;
                              color:#f5c518;letter-spacing:-0.04em;">
                    ₹{d['est_fare']:.0f}
                  </div>
                </div>
              </div>
            </div>
            """, unsafe_allow_html=True)

            cA, cB = st.columns(2)
            with cA:
                if st.button("✅ Accept & Navigate", use_container_width=True, type="primary"):
                    st.session_state.step = "matched"
                    st.session_state.simulating = True
                    st.session_state.active_route = st.session_state.route_to_pickup
                    st.session_state.route_index = 0
                    st.rerun()
            with cB:
                if st.button("❌ Decline", use_container_width=True, type="secondary"):
                    reset_trip_state(); st.rerun()

        elif st.session_state.step == "matched":
            st.info("🗺️ Navigating to passenger pickup point…")
            st.markdown("""
            <div style="font-size:0.85rem;color:#888;margin-top:0.4rem;">
              Switch to <strong style="color:#f5c518;">Passenger App</strong> to watch the live animation on the map.
            </div>
            """, unsafe_allow_html=True)

        elif st.session_state.step == "accepted":
            st.info("🚦 Trip in progress.")
            st.markdown(f"""
            <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;
                        padding:0.8rem 1rem;margin-top:0.6rem;">
              <span style="font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:0.06em;">
                Active Riders
              </span>
              <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:1.6rem;
                          color:#f0f0f0;margin-top:0.2rem;">
                {st.session_state.passenger_count} / 4
              </div>
            </div>
            <div style="font-size:0.82rem;color:#888;margin-top:0.7rem;">
              Switch to <strong style="color:#f5c518;">Passenger App</strong> to process payment.
            </div>
            """, unsafe_allow_html=True)


# ══════════════════════════════════════════════════
#   SHARED MAP VISUALIZATION
# ══════════════════════════════════════════════════
with col2:
    # Legend
    if st.session_state.step not in ["idle", "selecting", "driver_pending"]:
        st.markdown("""
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.7rem;">
          <span class="map-label"><span class="dot dot-green"></span> Pickup</span>
          <span class="map-label"><span class="dot dot-red"></span> Dropoff</span>
          <span class="map-label"><span class="dot dot-blue"></span> Driver</span>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.7rem;">
          <span class="map-label"><span class="dot dot-blue"></span> Available Drivers</span>
          <span class="map-label"><span class="dot dot-green"></span> Your Location</span>
          <span class="map-label"><span class="dot dot-orange"></span> Selected Driver</span>
        </div>
        """, unsafe_allow_html=True)

    layers = []

    if st.session_state.step in ["idle", "selecting", "driver_pending"]:
        curr_lat, curr_lng = st.session_state.current_location
        all_drivers_df = run_query(
            "SELECT ST_Y(dl.location::geometry) as driver_lat, "
            "ST_X(dl.location::geometry) as driver_lng "
            "FROM Driver_Locations dl JOIN Drivers d ON dl.driver_id = d.driver_id "
            "WHERE d.is_active = TRUE;"
        )
        center_lat, center_lng = st.session_state.pickup_coords if st.session_state.pickup_coords else (curr_lat, curr_lng)

        if st.session_state.pickup_coords:
            layers.append(pdk.Layer("ScatterplotLayer",
                data=[{"pos": [center_lng, center_lat]}],
                get_position="pos", get_fill_color=[0, 200, 0, 255],
                get_radius=150, radius_min_pixels=8))

        if all_drivers_df is not None:
            layers.append(pdk.Layer("ScatterplotLayer",
                data=[{"pos": [row['driver_lng'], row['driver_lat']]} for _, row in all_drivers_df.iterrows()],
                get_position="pos", get_fill_color=[0, 150, 255, 255],
                get_line_color=[255, 255, 255, 255], stroked=True,
                line_width_min_pixels=2, get_radius=120, radius_min_pixels=6))

        if st.session_state.step == "driver_pending" and st.session_state.driver:
            layers.append(pdk.Layer("ScatterplotLayer",
                data=[{"pos": [st.session_state.driver['driver_lng'], st.session_state.driver['driver_lat']]}],
                get_position="pos", get_fill_color=[255, 165, 0, 255],
                get_radius=200, radius_min_pixels=10))

        st.pydeck_chart(pdk.Deck(
            layers=layers,
            initial_view_state=pdk.ViewState(latitude=center_lat, longitude=center_lng, zoom=12, pitch=30),
            map_style="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        ))

    else:
        p_lat, p_lng   = st.session_state.pickup_coords
        d_lat, d_lng   = st.session_state.dropoff_coords
        dr_lat, dr_lng = st.session_state.driver['driver_lat'], st.session_state.driver['driver_lng']

        route   = st.session_state.route_to_pickup if st.session_state.step == "matched" else st.session_state.route_to_dropoff
        r_color = [0, 140, 255, 180] if st.session_state.step == "matched" else [245, 197, 24, 180]

        layers.append(pdk.Layer("PathLayer",
            data=[{"path": route}], get_path="path",
            get_color=r_color, width_min_pixels=4))
        layers.append(pdk.Layer("ScatterplotLayer",
            data=[{"pos": [p_lng, p_lat]}], get_position="pos",
            get_fill_color=[0, 200, 0, 255], get_radius=80, radius_min_pixels=6))
        layers.append(pdk.Layer("ScatterplotLayer",
            data=[{"pos": [d_lng, d_lat]}], get_position="pos",
            get_fill_color=[200, 0, 0, 255], get_radius=80, radius_min_pixels=6))
        layers.append(pdk.Layer("ScatterplotLayer",
            data=[{"pos": [dr_lng, dr_lat]}], get_position="pos",
            get_fill_color=[0, 150, 255, 255], get_line_color=[255, 255, 255, 255],
            stroked=True, line_width_min_pixels=2, get_radius=120, radius_min_pixels=10))

        st.pydeck_chart(pdk.Deck(
            layers=layers,
            initial_view_state=pdk.ViewState(latitude=dr_lat, longitude=dr_lng, zoom=13.5, pitch=45),
            map_style="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        ))


# ══════════════════════════════════════════════════
#   AUTO SIMULATION LOOP  (unchanged logic)
# ══════════════════════════════════════════════════
if st.session_state.get("simulating", False) and not st.session_state.get("pool_request_active", False):
    if st.session_state.route_index < len(st.session_state.active_route):
        st.session_state.driver['driver_lng'], st.session_state.driver['driver_lat'] = \
            st.session_state.active_route[st.session_state.route_index]
        st.session_state.route_index += max(1, len(st.session_state.active_route) // 40)
        time.sleep(0.1); st.rerun()
    else:
        st.session_state.simulating = False
        if st.session_state.step == "matched":
            st.session_state.driver['driver_lat'], st.session_state.driver['driver_lng'] = st.session_state.pickup_coords
            st.session_state.driver_arrived = True
        elif st.session_state.step == "accepted":
            st.session_state.driver['driver_lat'], st.session_state.driver['driver_lng'] = st.session_state.dropoff_coords
            st.session_state.trip_finished = True
        st.rerun()
