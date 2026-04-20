/* ==========================================================
   RideX — Passenger Controller
   Handles: idle → selecting → pending → matched → accepted → complete
   ========================================================== */

const PASS = (() => {
  const { RX_STATE, findClosestDrivers, getOSRMRoute, calcFare, haversineKm } = window.RX_ENGINE;
  const { LOCATIONS, CORIDER_NAMES } = window.RX_DATA;

  // ========== INIT ==========
  function init() {
    // Populate location selects
    const puSel = document.getElementById('pickup-select');
    const drSel = document.getElementById('drop-select');
    LOCATIONS.forEach(loc => {
      puSel.appendChild(new Option(loc.name, loc.name));
      drSel.appendChild(new Option(loc.name, loc.name));
    });
    // Add "Custom" option
    puSel.appendChild(new Option("📍 Custom address…", "__custom__"));
    drSel.appendChild(new Option("📍 Custom address…", "__custom__"));

    puSel.addEventListener('change', onPickupChange);
    drSel.addEventListener('change', onDropChange);
    document.getElementById('pickup-custom').addEventListener('input', onCustomChange);
    document.getElementById('drop-custom').addEventListener('input', onCustomChange);

    document.getElementById('find-drivers-btn').addEventListener('click', onFindDrivers);
    document.getElementById('cancel-pending').addEventListener('click', onCancelPending);
    document.getElementById('hop-in-btn').addEventListener('click', onHopIn);

    // Carpool
    document.getElementById('sim-pool-btn').addEventListener('click', triggerPoolPing);
    document.getElementById('accept-pool').addEventListener('click', () => resolvePool(true));
    document.getElementById('decline-pool').addEventListener('click', () => resolvePool(false));

    // Rating + done
    initStarRate();
    document.getElementById('done-btn').addEventListener('click', finishAndLog);
  }

  // ========== LOCATION INPUTS ==========
  function onPickupChange(e) {
    const val = e.target.value;
    const custom = document.getElementById('pickup-custom');
    if (val === "__custom__") {
      custom.classList.remove('hidden');
      custom.focus();
    } else {
      custom.classList.add('hidden');
      const loc = LOCATIONS.find(l => l.name === val);
      if (loc) {
        RX_STATE.pickup = { ...loc };
        RX_STATE.user = { lat: loc.lat, lng: loc.lng };
        // Re-render explore map with new user pos
        window.RX_MAP.renderExplore(RX_STATE.user, RX_STATE.fleet);
      }
    }
    maybePreviewRoute();
  }
  function onDropChange(e) {
    const val = e.target.value;
    const custom = document.getElementById('drop-custom');
    if (val === "__custom__") {
      custom.classList.remove('hidden');
      custom.focus();
    } else {
      custom.classList.add('hidden');
      const loc = LOCATIONS.find(l => l.name === val);
      if (loc) RX_STATE.drop = { ...loc };
    }
    maybePreviewRoute();
  }
  function onCustomChange() {
    // Offsets custom addresses near Surat center w/ a seeded offset
    const puInput = document.getElementById('pickup-custom');
    const drInput = document.getElementById('drop-custom');
    const puSel = document.getElementById('pickup-select').value;
    const drSel = document.getElementById('drop-select').value;

    if (puSel === "__custom__" && puInput.value.trim().length > 2) {
      const seed = strHash(puInput.value);
      RX_STATE.pickup = {
        name: puInput.value.trim(),
        lat: 21.17 + ((seed % 60) - 30) / 1000,
        lng: 72.83 + (((seed >> 3) % 80) - 40) / 1000,
      };
      RX_STATE.user = { lat: RX_STATE.pickup.lat, lng: RX_STATE.pickup.lng };
    }
    if (drSel === "__custom__" && drInput.value.trim().length > 2) {
      const seed = strHash(drInput.value);
      RX_STATE.drop = {
        name: drInput.value.trim(),
        lat: 21.17 + ((seed % 80) - 40) / 1000,
        lng: 72.83 + (((seed >> 3) % 100) - 50) / 1000,
      };
    }
    maybePreviewRoute();
  }

  function strHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    return Math.abs(h);
  }

  async function maybePreviewRoute() {
    const btn = document.getElementById('find-drivers-btn');
    const preview = document.getElementById('route-preview');
    if (RX_STATE.pickup && RX_STATE.drop) {
      btn.disabled = false;
      // Pre-fetch route for preview (OSRM)
      try {
        const route = await getOSRMRoute(RX_STATE.pickup, RX_STATE.drop);
        RX_STATE.tripRoute = route;
        RX_STATE.tripDistanceKm = route.distanceKm;
        RX_STATE.tripDurationMin = route.durationMin;
        document.getElementById('prev-distance').textContent = `${route.distanceKm.toFixed(1)} km`;
        document.getElementById('prev-time').textContent = `${Math.round(route.durationMin)} min`;
        preview.classList.remove('hidden');
      } catch (e) {
        console.warn(e);
      }
    } else {
      btn.disabled = true;
      preview.classList.add('hidden');
    }
  }

  // ========== STATE TRANSITIONS ==========
  function showState(name) {
    document.querySelectorAll('#passenger-view [data-state]').forEach(el => {
      el.classList.toggle('hidden', el.dataset.state !== name);
    });
    RX_STATE.pState = name;
    updateSessionStatus();
  }

  function updateSessionStatus() {
    const el = document.getElementById('session-status');
    const meta = document.getElementById('session-meta');
    const label = el.querySelector('span');
    el.classList.remove('active', 'trip');
    switch (RX_STATE.pState) {
      case "idle":
        label.textContent = "Idle — awaiting request"; meta.textContent = ""; break;
      case "selecting":
        label.textContent = "Selecting driver"; el.classList.add('active');
        meta.textContent = `${RX_STATE.nearby.length} drivers nearby`; break;
      case "pending":
        label.textContent = "Awaiting driver response"; el.classList.add('active');
        meta.textContent = `${RX_STATE.selectedDriver?.name || ''}`; break;
      case "matched":
        label.textContent = "Driver en route"; el.classList.add('active');
        meta.textContent = `${RX_STATE.selectedDriver?.vehicle.model} · ${RX_STATE.selectedDriver?.plate}`; break;
      case "accepted":
        label.textContent = "In transit"; el.classList.add('trip');
        meta.textContent = `→ ${RX_STATE.drop?.name || ''} · ${RX_STATE.paxCount} rider(s)`; break;
      case "complete":
        label.textContent = "Trip complete"; meta.textContent = ""; break;
    }
  }

  // ========== STEP 1: Find drivers ==========
  async function onFindDrivers() {
    if (!RX_STATE.pickup || !RX_STATE.drop) return;
    const btn = document.getElementById('find-drivers-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching nearby drivers…';

    // Make sure we have trip route
    if (!RX_STATE.tripRoute) {
      RX_STATE.tripRoute = await getOSRMRoute(RX_STATE.pickup, RX_STATE.drop);
      RX_STATE.tripDistanceKm = RX_STATE.tripRoute.distanceKm;
      RX_STATE.tripDurationMin = RX_STATE.tripRoute.durationMin;
    }

    // Simulate PostGIS query: 4 closest active drivers
    const nearby = findClosestDrivers(RX_STATE.pickup, RX_STATE.fleet, 4);
    RX_STATE.nearby = nearby;

    // Build driver cards (with fare for each tier)
    renderDriverCards(nearby);

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-magnifying-glass"></i> Find nearby drivers';

    showState('selecting');
    window.RX_MAP.renderCandidates(RX_STATE.user, RX_STATE.drop, nearby);
    window.RX_MAP.showToast(`Found ${nearby.length} drivers nearby`);
  }

  function renderDriverCards(drivers) {
    const host = document.getElementById('driver-cards');
    host.innerHTML = '';
    document.getElementById('selecting-sub').textContent = `${drivers.length} drivers nearby · To ${RX_STATE.drop.name}`;

    drivers.forEach(d => {
      // Fare includes pickup leg approx (driver → user ~ use haversine) + trip
      const pickupKm = d.distanceKm;
      const pickupMin = (pickupKm / 30) * 60;
      const totalKm = RX_STATE.tripDistanceKm;
      const totalMin = RX_STATE.tripDurationMin;
      const fare = calcFare(totalKm, totalMin, d.vehicle.multiplier);
      const eta = Math.max(2, Math.round(pickupMin));

      const card = document.createElement('div');
      card.className = 'driver-card';
      card.innerHTML = `
        <div class="avatar">${initials(d.name)}</div>
        <div class="dc-info">
          <div class="dc-name">${d.name} <span class="dc-meta"><i class="fas fa-star" style="color:#ffc043"></i> ${d.rating}</span></div>
          <div class="dc-meta">
            <span class="tier">${d.vehicle.tier}</span>
            <span>${d.vehicle.model}</span>
            <span>${d.plate}</span>
          </div>
        </div>
        <div class="dc-right">
          <div class="dc-fare">₹${fare.total}</div>
          <div class="dc-eta">${eta} min away · ${pickupKm.toFixed(1)} km</div>
        </div>
      `;
      card.addEventListener('click', () => selectDriver(d, fare, eta));
      host.appendChild(card);
    });
  }

  function initials(name) {
    const parts = name.split(' ');
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  // ========== STEP 2: Select driver → pending ==========
  function selectDriver(driver, fare, etaMin) {
    RX_STATE.selectedDriver = { ...driver, etaMin, currentEta: etaMin };
    RX_STATE.fareBreakdown = fare;

    document.getElementById('pending-driver-name').textContent = driver.name;

    // Driver side gets the incoming ping
    RX_STATE.dState = "pending";
    window.RX_DRIVER.syncPending();

    showState('pending');
    window.RX_MAP.renderMatched(RX_STATE.user, RX_STATE.drop, driver, null);
    window.RX_MAP.showToast(`Requesting ${driver.name}… switch to Driver to accept`);
  }

  function onCancelPending() {
    RX_STATE.selectedDriver = null;
    RX_STATE.dState = "idle";
    window.RX_DRIVER.syncIdle();
    showState('idle');
    window.RX_MAP.renderExplore(RX_STATE.user, RX_STATE.fleet);
    window.RX_MAP.showToast("Request cancelled");
  }

  // ========== STEP 3: Driver accepted → matched (passenger view) ==========
  // Called from driver.js
  async function onDriverAccepted() {
    const drv = RX_STATE.selectedDriver;
    if (!drv) return;

    // Fetch the arrival route (driver → pickup)
    const arrival = await getOSRMRoute({ lat: drv.lat, lng: drv.lng }, RX_STATE.pickup);
    RX_STATE.pickupRoute = arrival;

    // Populate matched card
    document.getElementById('matched-name').textContent = drv.name;
    document.getElementById('matched-avatar').textContent = initials(drv.name);
    document.getElementById('matched-rating').innerHTML = `<i class="fas fa-star"></i> ${drv.rating}`;
    document.getElementById('matched-phone').textContent = drv.phone;
    document.getElementById('matched-plate').textContent = drv.plate;
    document.getElementById('matched-vehicle').textContent = `${drv.vehicle.model} · ${drv.vehicle.tier}`;
    document.getElementById('matched-tier').textContent = drv.vehicle.tier;
    document.getElementById('eta-mins').textContent = Math.max(1, Math.round(arrival.durationMin));
    document.getElementById('hop-in-wrap').classList.add('hidden');

    showState('matched');
    window.RX_MAP.renderMatched(RX_STATE.user, RX_STATE.drop, drv, arrival.coordinates);

    // Start arrival animation
    startArrivalAnimation(arrival);
  }

  // ========== ANIMATION: driver → pickup ==========
  function startArrivalAnimation(arrival) {
    stopAnimation();
    const coords = arrival.coordinates;
    // We'll animate the matched marker along coords in ~15 seconds
    const totalFrames = Math.max(40, coords.length);
    let frame = 0;
    const totalMin = arrival.durationMin;

    RX_STATE.animTimer = setInterval(() => {
      if (RX_STATE.animHalted) return;
      frame++;
      const t = frame / totalFrames;
      if (t >= 1) {
        // Arrived!
        const last = coords[coords.length - 1];
        window.RX_MAP.moveMatched(last[1], last[0]);
        RX_STATE.selectedDriver.lat = last[1];
        RX_STATE.selectedDriver.lng = last[0];
        document.getElementById('eta-mins').textContent = 0;
        document.getElementById('hop-in-wrap').classList.remove('hidden');
        stopAnimation();
        window.RX_MAP.showToast("Your driver has arrived! 🎉");
        // Driver screen - show arrived
        window.RX_DRIVER.onArrivedAtPickup();
        return;
      }
      // Interpolate position along the polyline
      const pt = interpolateOnPath(coords, t);
      window.RX_MAP.moveMatched(pt[1], pt[0]);
      RX_STATE.selectedDriver.lat = pt[1];
      RX_STATE.selectedDriver.lng = pt[0];
      const etaRemain = Math.max(0, Math.round(totalMin * (1 - t)));
      document.getElementById('eta-mins').textContent = etaRemain;
      // Sync driver screen
      window.RX_DRIVER.syncMatchedProgress(etaRemain, (1 - t) * arrival.distanceKm);
    }, 250);
  }

  function interpolateOnPath(coords, t) {
    // coords: [[lng,lat],...]
    // t: 0..1. Find segment
    const idxF = t * (coords.length - 1);
    const idx = Math.floor(idxF);
    const frac = idxF - idx;
    const a = coords[idx];
    const b = coords[Math.min(coords.length - 1, idx + 1)];
    return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
  }

  function stopAnimation() {
    if (RX_STATE.animTimer) {
      clearInterval(RX_STATE.animTimer);
      RX_STATE.animTimer = null;
    }
  }

  // ========== STEP 4: Hop In → start trip ==========
  function onHopIn() {
    startTrip();
  }

  async function startTrip() {
    const drv = RX_STATE.selectedDriver;
    // Use pre-computed trip route (pickup → drop)
    const tripRoute = RX_STATE.tripRoute || await getOSRMRoute(RX_STATE.pickup, RX_STATE.drop);
    RX_STATE.tripRoute = tripRoute;
    RX_STATE.tripStartTime = Date.now();
    RX_STATE.paxCount = 1;
    RX_STATE.poolPingActive = false;

    // UI
    document.getElementById('trip-dest').textContent = RX_STATE.drop.name;
    document.getElementById('pax-count').textContent = "1";
    updateLiveFareDisplay();

    // Driver side
    RX_STATE.dState = "accepted";
    window.RX_DRIVER.syncAccepted();

    showState('accepted');
    window.RX_MAP.renderTrip(RX_STATE.pickup, RX_STATE.drop, drv, tripRoute.coordinates);

    // Animate along trip
    startTripAnimation(tripRoute);
  }

  function startTripAnimation(tripRoute) {
    stopAnimation();
    const coords = tripRoute.coordinates;
    const totalFrames = Math.max(60, Math.min(coords.length, 160));
    const totalMin = tripRoute.durationMin;
    const totalKm = tripRoute.distanceKm;
    let frame = 0;
    // Each frame represents ~0.3s. Trip runs ~18-25s total.
    const frameMs = 250;

    RX_STATE.animTimer = setInterval(() => {
      if (RX_STATE.animHalted) return; // paused for pool ping
      frame++;
      const t = frame / totalFrames;
      if (t >= 1) {
        const last = coords[coords.length - 1];
        window.RX_MAP.moveMatched(last[1], last[0]);
        RX_STATE.selectedDriver.lat = last[1];
        RX_STATE.selectedDriver.lng = last[0];
        document.getElementById('trip-mins-left').textContent = 0;
        document.getElementById('trip-km-left').textContent = "0.0 km left";
        document.getElementById('trip-progress').style.width = "100%";
        stopAnimation();
        completeTrip();
        return;
      }
      const pt = interpolateOnPath(coords, t);
      window.RX_MAP.moveMatched(pt[1], pt[0]);
      RX_STATE.selectedDriver.lat = pt[1];
      RX_STATE.selectedDriver.lng = pt[0];

      const remainMin = Math.max(0, totalMin * (1 - t));
      const remainKm = Math.max(0, totalKm * (1 - t));
      document.getElementById('trip-mins-left').textContent = Math.max(1, Math.ceil(remainMin));
      document.getElementById('trip-km-left').textContent = `${remainKm.toFixed(1)} km left`;
      document.getElementById('trip-progress').style.width = `${Math.min(100, t * 100)}%`;
      updateLiveFareDisplay();

      // Sync driver
      window.RX_DRIVER.syncTripProgress(remainMin, remainKm);

      // Possible random pool ping (only once, only for UberPool-eligible ride before 60% progress)
      maybeAutoPoolPing(t);
    }, frameMs);
  }

  function updateLiveFareDisplay() {
    const fare = RX_STATE.fareBreakdown;
    if (!fare) return;
    const share = Math.round(fare.total / RX_STATE.paxCount);
    document.getElementById('trip-fare-live').textContent = `₹${share} / rider`;
    document.getElementById('trip-your-fare').textContent = `₹${share}`;
  }

  // ========== UberPool Mechanics ==========
  function maybeAutoPoolPing(t) {
    // Automatically trigger one random ping between t=0.2 and t=0.4 if pax < 4
    if (RX_STATE._autoPoolTried) return;
    if (t > 0.25 && t < 0.5 && RX_STATE.paxCount < 4 && Math.random() < 0.08) {
      RX_STATE._autoPoolTried = true;
      triggerPoolPing();
    }
  }

  function triggerPoolPing() {
    if (RX_STATE.pState !== 'accepted') return;
    if (RX_STATE.paxCount >= 4) {
      window.RX_MAP.showToast("Vehicle at capacity (4/4)");
      return;
    }
    if (RX_STATE.poolPingActive) return;
    RX_STATE.poolPingActive = true;
    RX_STATE.animHalted = true; // pause animation for attention

    const name = CORIDER_NAMES[Math.floor(Math.random() * CORIDER_NAMES.length)];
    RX_STATE.poolActiveCorider = name;
    const newFare = Math.round(RX_STATE.fareBreakdown.total / (RX_STATE.paxCount + 1));

    document.getElementById('ping-name').textContent = name;
    document.getElementById('ping-avatar').textContent = name[0];
    document.getElementById('ping-new-fare').textContent = `₹${newFare}`;
    document.getElementById('carpool-ping').classList.remove('hidden');
    window.RX_MAP.showToast(`🚘 ${name} wants to share your ride`);
  }

  function resolvePool(accept) {
    if (!RX_STATE.poolPingActive) return;
    if (accept) {
      RX_STATE.paxCount++;
      document.getElementById('pax-count').textContent = RX_STATE.paxCount;
      window.RX_MAP.showToast(`${RX_STATE.poolActiveCorider} joined! Fare split ${RX_STATE.paxCount} ways`);
      window.RX_DRIVER.syncPaxCount(RX_STATE.paxCount);
      updateLiveFareDisplay();
    } else {
      window.RX_MAP.showToast("Co-rider declined");
    }
    RX_STATE.poolPingActive = false;
    RX_STATE.poolActiveCorider = null;
    RX_STATE.animHalted = false;
    document.getElementById('carpool-ping').classList.add('hidden');
  }

  // ========== STEP 5: Complete ==========
  function completeTrip() {
    const drv = RX_STATE.selectedDriver;
    const fare = RX_STATE.fareBreakdown;
    const share = Math.round(fare.total / RX_STATE.paxCount);

    // Populate receipt
    document.getElementById('r-distance').textContent = `${RX_STATE.tripDistanceKm.toFixed(1)} km`;
    document.getElementById('r-duration').textContent = `${Math.round(RX_STATE.tripDurationMin)} min`;
    document.getElementById('r-riders').textContent = `${RX_STATE.paxCount} rider(s)`;
    document.getElementById('r-vehicle').textContent = drv.vehicle.model;
    document.getElementById('r-dist-fare').textContent = `₹${fare.distFare}`;
    document.getElementById('r-time-fare').textContent = `₹${fare.timeFare}`;
    document.getElementById('r-premium').textContent = `×${fare.multiplier.toFixed(1)}`;
    document.getElementById('r-total').textContent = `₹${share}`;
    document.getElementById('r-driver-name').textContent = drv.name;

    // reset stars to 5
    setStars(5);

    // Driver: complete
    RX_STATE.dState = "complete";
    window.RX_DRIVER.syncComplete(fare.total);

    showState('complete');
    window.RX_MAP.showToast("You've arrived! 🏁");
  }

  // ========== RATING ==========
  let currentRating = 5;
  function initStarRate() {
    const stars = document.querySelectorAll('#star-rate i');
    stars.forEach(s => {
      s.addEventListener('click', () => {
        currentRating = parseInt(s.dataset.v);
        setStars(currentRating);
      });
      s.addEventListener('mouseenter', () => setStars(parseInt(s.dataset.v)));
    });
    document.getElementById('star-rate').addEventListener('mouseleave', () => setStars(currentRating));
    setStars(5);
  }
  function setStars(n) {
    document.querySelectorAll('#star-rate i').forEach(s => {
      s.classList.toggle('filled', parseInt(s.dataset.v) <= n);
    });
    const el = document.getElementById('star-rate');
    el.setAttribute('aria-valuenow', n);
  }

  function finishAndLog() {
    const drv = RX_STATE.selectedDriver;
    const fare = RX_STATE.fareBreakdown;
    const share = Math.round(fare.total / RX_STATE.paxCount);
    const entry = {
      id: Date.now(),
      date: new Date().toISOString(),
      driver: drv.name,
      plate: drv.plate,
      vehicle: drv.vehicle.model,
      from: RX_STATE.pickup.name,
      to: RX_STATE.drop.name,
      distanceKm: +RX_STATE.tripDistanceKm.toFixed(2),
      durationMin: Math.round(RX_STATE.tripDurationMin),
      fare: share,
      totalFare: fare.total,
      paxCount: RX_STATE.paxCount,
      rating: currentRating,
    };
    window.RX_APP.addHistory(entry);

    // reset
    resetForNextRide();
  }

  function resetForNextRide() {
    RX_STATE.selectedDriver = null;
    RX_STATE.pickupRoute = null;
    RX_STATE.tripRoute = null;
    RX_STATE.paxCount = 1;
    RX_STATE.poolPingActive = false;
    RX_STATE._autoPoolTried = false;
    RX_STATE.animHalted = false;
    RX_STATE.fareBreakdown = null;
    // Re-randomize fleet positions a touch
    window.RX_APP.rejuvenateFleet();

    // Driver back to idle
    RX_STATE.dState = "idle";
    window.RX_DRIVER.syncIdle();

    showState('idle');
    // Reset selects
    document.getElementById('pickup-select').value = "";
    document.getElementById('drop-select').value = "";
    document.getElementById('pickup-custom').classList.add('hidden');
    document.getElementById('drop-custom').classList.add('hidden');
    document.getElementById('pickup-custom').value = "";
    document.getElementById('drop-custom').value = "";
    document.getElementById('route-preview').classList.add('hidden');
    document.getElementById('find-drivers-btn').disabled = true;

    RX_STATE.pickup = null;
    RX_STATE.drop = null;
    window.RX_MAP.renderExplore(RX_STATE.user, RX_STATE.fleet);
  }

  return {
    init,
    showState,
    onDriverAccepted,
    resetForNextRide,
    updateSessionStatus,
  };
})();

window.RX_PASSENGER = PASS;
