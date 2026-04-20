/* ==========================================================
   RideX — Driver Controller
   States: idle | pending | matched | accepted | complete
   ========================================================== */

const DRV = (() => {
  const { RX_STATE, calcFare } = window.RX_ENGINE;

  function init() {
    document.getElementById('d-accept').addEventListener('click', onAccept);
    document.getElementById('d-decline').addEventListener('click', onDecline);
    // Initial idle state
    syncIdle();
  }

  function showState(name) {
    document.querySelectorAll('#driver-view [data-d-state]').forEach(el => {
      el.classList.toggle('hidden', el.dataset.dState !== name);
    });
    RX_STATE.dState = name;
  }

  // ========== Populate header with current "selected" driver ==========
  function paintHeader() {
    const d = RX_STATE.selectedDriver;
    if (d) {
      document.getElementById('d-name').textContent = d.name;
      document.getElementById('d-avatar').textContent = (d.name.split(' ')[0][0] + (d.name.split(' ')[1]?.[0] || '')).toUpperCase();
      document.getElementById('d-vehicle').textContent = `${d.vehicle.model} · ${d.vehicle.tier}`;
      document.getElementById('d-plate').textContent = d.plate;
      document.getElementById('d-rating').textContent = d.rating;
      document.getElementById('active-driver-name').textContent = d.name.split(' ')[0];
    } else {
      // Pick first driver from fleet as default "you"
      const d0 = RX_STATE.fleet[0];
      if (d0) {
        document.getElementById('d-name').textContent = d0.name;
        document.getElementById('d-avatar').textContent = (d0.name.split(' ')[0][0] + (d0.name.split(' ')[1]?.[0] || '')).toUpperCase();
        document.getElementById('d-vehicle').textContent = `${d0.vehicle.model} · ${d0.vehicle.tier}`;
        document.getElementById('d-plate').textContent = d0.plate;
        document.getElementById('d-rating').textContent = d0.rating;
        document.getElementById('active-driver-name').textContent = d0.name.split(' ')[0];
      }
    }
    document.getElementById('d-earn').textContent = `₹${RX_STATE.dayEarnings}`;
    document.getElementById('d-trips').textContent = RX_STATE.dayTrips;
  }

  // ========== State syncs ==========
  function syncIdle() {
    paintHeader();
    showState('idle');
  }

  function syncPending() {
    const d = RX_STATE.selectedDriver;
    paintHeader();
    if (!d) return;
    const fare = RX_STATE.fareBreakdown;
    document.getElementById('d-pax-dist').textContent = `${d.distanceKm.toFixed(1)} km`;
    document.getElementById('d-trip-dist').textContent = `${RX_STATE.tripDistanceKm.toFixed(1)} km`;
    document.getElementById('d-earnings').textContent = `₹${fare.total}`;
    showState('pending');
  }

  function syncMatched() {
    paintHeader();
    document.getElementById('d-pickup-name').textContent = RX_STATE.pickup?.name || '—';
    document.getElementById('d-pax-count').textContent = RX_STATE.paxCount;
    showState('matched');
  }

  function syncMatchedProgress(etaMin, distKm) {
    if (RX_STATE.dState !== 'matched') return;
    document.getElementById('d-eta').textContent = `${etaMin} min`;
    document.getElementById('d-dist-left').textContent = `${distKm.toFixed(1)} km`;
    document.getElementById('d-pax-count').textContent = RX_STATE.paxCount;
  }

  function onArrivedAtPickup() {
    if (RX_STATE.dState !== 'matched') return;
    document.getElementById('d-eta').textContent = `Arrived`;
    document.getElementById('d-dist-left').textContent = `0.0 km`;
  }

  function syncAccepted() {
    paintHeader();
    document.getElementById('d-drop-name').textContent = RX_STATE.drop?.name || '—';
    document.getElementById('d-trip-pax').textContent = RX_STATE.paxCount;
    document.getElementById('d-trip-earn').textContent = `₹${RX_STATE.fareBreakdown.total}`;
    showState('accepted');
  }

  function syncTripProgress(minLeft, kmLeft) {
    if (RX_STATE.dState !== 'accepted') return;
    document.getElementById('d-time-left').textContent = `${Math.max(1, Math.ceil(minLeft))} min`;
    document.getElementById('d-trip-left').textContent = `${kmLeft.toFixed(1)} km`;
    document.getElementById('d-trip-pax').textContent = RX_STATE.paxCount;
  }

  function syncPaxCount(n) {
    document.getElementById('d-trip-pax').textContent = n;
    document.getElementById('d-pax-count').textContent = n;
  }

  function syncComplete(totalFare) {
    RX_STATE.dayEarnings += totalFare;
    RX_STATE.dayTrips += 1;
    document.getElementById('d-complete-earn').textContent = `₹${totalFare}`;
    document.getElementById('d-complete-dist').textContent = `${RX_STATE.tripDistanceKm.toFixed(1)} km`;
    showState('complete');
  }

  // ========== Actions ==========
  function onAccept() {
    if (!RX_STATE.selectedDriver) return;
    RX_STATE.dState = 'matched';
    syncMatched();
    window.RX_MAP.showToast("Ride accepted — navigating to pickup");
    // Trigger passenger "matched" + arrival animation
    window.RX_PASSENGER.onDriverAccepted();
  }

  function onDecline() {
    window.RX_MAP.showToast("Ride declined");
    RX_STATE.dState = 'idle';
    syncIdle();
    // Passenger: back to selecting (keep candidates)
    if (RX_STATE.pState === 'pending') {
      window.RX_PASSENGER.showState('selecting');
      window.RX_PASSENGER.updateSessionStatus();
    }
    RX_STATE.selectedDriver = null;
  }

  return {
    init,
    syncIdle,
    syncPending,
    syncMatched,
    syncMatchedProgress,
    onArrivedAtPickup,
    syncAccepted,
    syncTripProgress,
    syncPaxCount,
    syncComplete,
  };
})();

window.RX_DRIVER = DRV;
