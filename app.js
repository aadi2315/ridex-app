/* ==========================================================
   RideX — App bootstrap & global controls
   ========================================================== */

(function () {
  const { RX_STATE } = window.RX_ENGINE;
  const { generateFleet } = window.RX_DATA;

  const HISTORY_KEY = 'ridex_history_v1';

  function boot() {
    // Generate fleet
    RX_STATE.fleet = generateFleet(18);

    // Init map first (needs DOM)
    window.RX_MAP.initMap();
    window.RX_MAP.renderExplore(RX_STATE.user, RX_STATE.fleet);

    // Controllers
    window.RX_PASSENGER.init();
    window.RX_DRIVER.init();

    // Device toggle
    document.querySelectorAll('.device-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Mobile sidebar
    const tog = document.getElementById('sidebar-toggle');
    tog.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Clear history
    document.getElementById('clear-history').addEventListener('click', clearHistory);

    // Load history
    loadHistory();

    // Make sure map resizes with viewport
    window.addEventListener('resize', () => {
      setTimeout(() => window.RX_MAP && window.RX_MAP.initMap && null, 50);
      // Leaflet needs invalidateSize on container changes
      if (window.L && document.querySelector('.leaflet-container')) {
        const map = document.querySelector('.leaflet-container')._leaflet_map;
        if (map) map.invalidateSize();
      }
    });
  }

  // ========== VIEW SWITCH ==========
  function switchView(view) {
    RX_STATE.view = view;
    document.querySelectorAll('.device-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    document.getElementById('passenger-view').classList.toggle('active', view === 'passenger');
    document.getElementById('driver-view').classList.toggle('active', view === 'driver');
    const title = document.getElementById('view-title');
    const sub = document.getElementById('view-sub');
    if (view === 'passenger') {
      title.textContent = 'Passenger';
      sub.textContent = 'Where to?';
    } else {
      title.textContent = 'Driver';
      sub.textContent = 'Your dashboard';
    }
    // Invalidate map size
    setTimeout(() => {
      const el = document.querySelector('.leaflet-container');
      if (el && el._leaflet_map) el._leaflet_map.invalidateSize();
    }, 50);
  }

  // ========== HISTORY ==========
  function loadHistory() {
    try {
      const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      renderHistory(items);
    } catch (e) {
      renderHistory([]);
    }
  }

  function addHistory(entry) {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    items.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
    renderHistory(items);
  }

  function clearHistory() {
    if (!confirm('Clear all ride history?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory([]);
  }

  function renderHistory(items) {
    const host = document.getElementById('ride-history');
    if (!items || !items.length) {
      host.innerHTML = `<div class="empty-state">No rides yet. Book your first trip!</div>`;
      return;
    }
    host.innerHTML = items.map(r => {
      const dt = new Date(r.date);
      const dStr = `${dt.getDate()}/${dt.getMonth() + 1} ${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      return `
        <div class="ride-item">
          <div class="r-top">
            <span>${dStr}</span>
            <span>${r.plate}</span>
          </div>
          <div class="r-route">${r.from} → ${r.to}</div>
          <div class="r-foot">
            <span>${r.driver} · ${r.distanceKm} km · ${r.paxCount}p</span>
            <span class="fare">₹${r.fare}</span>
          </div>
          <div class="r-foot" style="margin-top:2px">
            <span class="stars-sm">${stars}</span>
            <span style="color:var(--text-mute)">${r.vehicle}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ========== Utility: subtle fleet jitter between rides ==========
  function rejuvenateFleet() {
    const { randomNearby } = window.RX_DATA;
    const center = { lat: 21.1702, lng: 72.8311 };
    RX_STATE.fleet.forEach(d => {
      const p = randomNearby(center, 4);
      d.lat = p.lat;
      d.lng = p.lng;
    });
  }

  window.RX_APP = { addHistory, rejuvenateFleet, switchView };

  document.addEventListener('DOMContentLoaded', boot);
})();
