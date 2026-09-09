import { isLand } from './land.js';

/**
 * Canvas globe with a real orthographic projection.
 *
 * Points live on a unit sphere in world space, are rotated by the current
 * yaw/tilt, and are drawn only when facing the camera (`z > 0`). That gives
 * genuine depth - nodes travel behind the horizon and fade out - rather than
 * the flat CSS approximation this replaces.
 *
 * The renderer owns no application state: callers push data in with `setData`
 * and the loop is explicitly started and stopped by the screen.
 */

const DOT_LAT_STEP = 4;
const PULSE_DURATION_MS = 2600;
const AUTO_SPIN_RATE = 0.045; // radians/second

const PALETTE = {
  sphere: 'rgba(10, 22, 42, 0.92)',
  land: 'rgba(125, 200, 255, 0.34)',
  graticule: 'rgba(120, 190, 255, 0.10)',
  node: '#7dfaff',
  nodeCore: '#eafeff',
  pulse: '#8d6dff',
  ambientPulse: '#7dfaff',
  limb: 'rgba(125, 240, 255, 0.55)'
};

/** Even-area dot lattice over the land mask, computed once. */
function buildLandDots() {
  const dots = [];

  for (let lat = -88; lat <= 88; lat += DOT_LAT_STEP) {
    // Widen the longitude step near the poles so dot density stays even.
    const step = DOT_LAT_STEP / Math.max(0.18, Math.cos((lat * Math.PI) / 180));

    for (let lng = -180; lng < 180; lng += step) {
      if (isLand(lng, lat)) dots.push(toVector(lat, lng));
    }
  }

  return dots;
}

function toVector(lat, lng) {
  const phi = (lat * Math.PI) / 180;
  const theta = (lng * Math.PI) / 180;
  const cosPhi = Math.cos(phi);

  return { x: cosPhi * Math.sin(theta), y: Math.sin(phi), z: cosPhi * Math.cos(theta) };
}

/** Rotates a world-space vector by yaw (around Y) then tilt (around X). */
function project(vector, yaw, tilt) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x = vector.x * cosYaw + vector.z * sinYaw;
  const z1 = -vector.x * sinYaw + vector.z * cosYaw;

  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const y = vector.y * cosTilt - z1 * sinTilt;
  const z = vector.y * sinTilt + z1 * cosTilt;

  return { x, y, z };
}

export function createGlobe(canvas, { onRegionSelect } = {}) {
  const context = canvas.getContext('2d');
  const landDots = buildLandDots();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let markers = [];
  let pulses = [];
  let selectedRegionId = null;
  let nextAmbientRipple = 0;

  let yaw = 2.4;
  let tilt = -0.38;
  let frameId = null;
  let lastFrame = 0;
  let size = { width: 0, height: 0, radius: 0, centerX: 0, centerY: 0 };

  const drag = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    size = {
      width,
      height,
      radius: Math.min(width, height) * 0.44,
      centerX: width / 2,
      centerY: height / 2
    };
  }

  /** Feeds a presence snapshot in. Newly-pulsing regions start a wave. */
  function setData(snapshot) {
    const regions = snapshot.regions ?? [];
    const peak = Math.max(1, ...regions.map((region) => region.waiting));

    markers = regions.map((region) => ({
      ...region,
      vector: toVector(region.lat, region.lng),
      intensity: region.waiting / peak
    }));

    const now = performance.now();
    for (const region of regions) {
      if (region.pulseAgeMs === null || region.pulseAgeMs > 2000) continue;
      if (pulses.some((pulse) => pulse.regionId === region.id && now - pulse.start < 900)) continue;

      pulses.push({ regionId: region.id, vector: toVector(region.lat, region.lng), start: now, real: true });
    }
  }

  /**
   * Ambient ripples stand in for the wider network's activity, which the
   * presence layer reports as simulated. They are drawn in a dimmer colour than
   * real pulses so the two are never confused.
   */
  function maybeAmbientRipple(now) {
    if (reduceMotion || !markers.length || now < nextAmbientRipple) return;

    // Weight the pick by how busy each region is.
    const total = markers.reduce((sum, marker) => sum + marker.intensity, 0);
    let target = Math.random() * total;
    const marker = markers.find((entry) => (target -= entry.intensity) <= 0) ?? markers[0];

    pulses.push({ regionId: marker.id, vector: marker.vector, start: now, real: false });
    nextAmbientRipple = now + 700 + Math.random() * 1400;
  }

  function setSelected(regionId) {
    selectedRegionId = regionId;
  }

  function toScreen(point) {
    return {
      x: size.centerX + point.x * size.radius,
      y: size.centerY - point.y * size.radius,
      z: point.z
    };
  }

  function drawSphere() {
    const { centerX, centerY, radius } = size;

    const glow = context.createRadialGradient(centerX, centerY, radius * 0.7, centerX, centerY, radius * 1.35);
    glow.addColorStop(0, 'rgba(80, 190, 255, 0.20)');
    glow.addColorStop(1, 'rgba(80, 190, 255, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, size.width, size.height);

    // Off-centre shading gives the sphere its lit side.
    const body = context.createRadialGradient(
      centerX - radius * 0.35, centerY - radius * 0.4, radius * 0.1,
      centerX, centerY, radius
    );
    body.addColorStop(0, 'rgba(24, 48, 84, 0.95)');
    body.addColorStop(1, PALETTE.sphere);

    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = body;
    context.fill();

    context.lineWidth = 1;
    context.strokeStyle = PALETTE.limb;
    context.stroke();
  }

  function drawGraticule() {
    context.strokeStyle = PALETTE.graticule;
    context.lineWidth = 1;

    for (let lat = -60; lat <= 60; lat += 30) {
      drawArc((t) => toVector(lat, -180 + t * 360));
    }

    for (let lng = -180; lng < 180; lng += 30) {
      drawArc((t) => toVector(-90 + t * 180, lng));
    }
  }

  /** Traces a parametric great/small circle, breaking the path at the horizon. */
  function drawArc(pointAt) {
    const steps = 72;
    let drawing = false;
    context.beginPath();

    for (let i = 0; i <= steps; i += 1) {
      const point = toScreen(project(pointAt(i / steps), yaw, tilt));

      if (point.z <= 0) {
        drawing = false;
        continue;
      }

      if (drawing) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
      drawing = true;
    }

    context.stroke();
  }

  function drawLand() {
    context.fillStyle = PALETTE.land;

    for (const dot of landDots) {
      const point = toScreen(project(dot, yaw, tilt));
      if (point.z <= 0.02) continue;

      // Fade toward the limb so the sphere reads as curved.
      context.globalAlpha = Math.min(1, point.z * 1.5);
      context.fillRect(point.x - 0.9, point.y - 0.9, 1.8, 1.8);
    }

    context.globalAlpha = 1;
  }

  function drawPulses(now) {
    pulses = pulses.filter((pulse) => now - pulse.start < PULSE_DURATION_MS);

    for (const pulse of pulses) {
      const point = toScreen(project(pulse.vector, yaw, tilt));
      if (point.z <= 0) continue;

      const progress = (now - pulse.start) / PULSE_DURATION_MS;
      context.beginPath();
      context.arc(point.x, point.y, 6 + progress * size.radius * 0.32, 0, Math.PI * 2);
      context.strokeStyle = pulse.real ? PALETTE.pulse : PALETTE.ambientPulse;
      context.globalAlpha = (1 - progress) * (pulse.real ? 0.6 : 0.26) * point.z;
      context.lineWidth = pulse.real ? 1.8 : 1;
      context.stroke();
    }

    context.globalAlpha = 1;
  }

  function drawMarkers(now) {
    const breathe = reduceMotion ? 1 : 0.85 + Math.sin(now / 620) * 0.15;

    for (const marker of markers) {
      const point = toScreen(project(marker.vector, yaw, tilt));
      if (point.z <= 0) continue;

      const selected = marker.id === selectedRegionId;
      const radius = (2.2 + marker.intensity * 4) * (selected ? 1.5 : 1) * breathe;
      const depth = 0.35 + point.z * 0.65;

      context.globalAlpha = depth;
      context.beginPath();
      context.arc(point.x, point.y, radius * 3.2, 0, Math.PI * 2);
      const halo = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3.2);
      halo.addColorStop(0, 'rgba(125, 250, 255, 0.45)');
      halo.addColorStop(1, 'rgba(125, 250, 255, 0)');
      context.fillStyle = halo;
      context.fill();

      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = selected ? PALETTE.nodeCore : PALETTE.node;
      context.fill();

      // Keep the marker's screen position for hit-testing on tap.
      marker.screen = point;
    }

    context.globalAlpha = 1;
  }

  function frame(now) {
    const delta = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;

    if (!drag.active && !reduceMotion) yaw += AUTO_SPIN_RATE * delta;

    maybeAmbientRipple(now);

    context.clearRect(0, 0, size.width, size.height);
    drawSphere();
    drawGraticule();
    drawLand();
    drawPulses(now);
    drawMarkers(now);

    frameId = requestAnimationFrame(frame);
  }

  function start() {
    if (frameId !== null) return;
    resize();
    lastFrame = 0;
    frameId = requestAnimationFrame(frame);
  }

  function stop() {
    if (frameId === null) return;
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  function nearestMarker(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let best = null;
    let bestDistance = 26;

    for (const marker of markers) {
      if (!marker.screen || marker.screen.z <= 0) continue;

      const distance = Math.hypot(marker.screen.x - x, marker.screen.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = marker;
      }
    }

    return best;
  }

  function onPointerDown(event) {
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved = 0;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.moved += Math.abs(deltaX) + Math.abs(deltaY);

    yaw += deltaX * 0.006;
    tilt = Math.max(-1.1, Math.min(1.1, tilt + deltaY * 0.006));
  }

  function onPointerUp(event) {
    if (event.pointerId !== drag.pointerId) return;

    drag.active = false;
    canvas.releasePointerCapture?.(event.pointerId);

    // A tap, not a drag - treat it as a selection.
    if (drag.moved < 6) {
      const marker = nearestMarker(event.clientX, event.clientY);
      if (marker) onRegionSelect?.(marker);
    }
  }

  /** Spins the given region to face the camera. */
  function focusRegion(region, { animate = true } = {}) {
    const targetYaw = -(region.lng * Math.PI) / 180;
    const targetTilt = -(region.lat * Math.PI) / 180 * 0.6;

    if (!animate || reduceMotion) {
      yaw = targetYaw;
      tilt = targetTilt;
      return;
    }

    // Take the shorter way round rather than unwinding a full turn.
    const twoPi = Math.PI * 2;
    const startYaw = yaw;
    const shortest = ((targetYaw - startYaw + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    const startTilt = tilt;
    const startedAt = performance.now();
    const duration = 700;

    function step(now) {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - t) ** 3;

      yaw = startYaw + shortest * eased;
      tilt = startTilt + (targetTilt - startTilt) * eased;

      if (t < 1 && !drag.active) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  function destroy() {
    stop();
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  }

  return { start, stop, setData, setSelected, focusRegion, resize, destroy };
}
