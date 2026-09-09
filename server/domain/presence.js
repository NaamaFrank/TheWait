import { config } from '../config.js';
import { listRegions, resolveRegion } from './regions.js';
import { requireDeviceId } from './validate.js';

/**
 * Live "who is waiting right now" registry.
 *
 * Presence is ephemeral by design, so it lives in memory rather than the store:
 * a restart should show an empty world, not resurrect stale waiters. Entries
 * expire `config.presenceTtlMs` after their last heartbeat.
 *
 * Ambient activity is layered on top so a single-user install still shows a
 * living globe. It is generated, not observed, and is reported separately as
 * `simulatedWaiting` so the UI can label it honestly.
 */

const waiters = new Map();
const recentPulses = [];
const MAX_PULSES = 40;
const PULSE_TTL_MS = 12 * 1000;

function prune(now) {
  for (const [deviceId, entry] of waiters) {
    if (now - entry.lastSeen > config.presenceTtlMs) waiters.delete(deviceId);
  }

  while (recentPulses.length && now - recentPulses[0].at > PULSE_TTL_MS) {
    recentPulses.shift();
  }
}

function addPulse(regionId, now) {
  recentPulses.push({ regionId, at: now });
  if (recentPulses.length > MAX_PULSES) recentPulses.shift();
}

export function heartbeat(rawDeviceId, regionId) {
  const deviceId = requireDeviceId(rawDeviceId);
  const now = Date.now();
  const region = resolveRegion(regionId);
  const isNew = !waiters.has(deviceId);

  waiters.set(deviceId, { regionId: region.id, lastSeen: now, startedAt: waiters.get(deviceId)?.startedAt ?? now });
  if (isNew) addPulse(region.id, now);

  prune(now);
  return snapshot();
}

export function stopWaiting(rawDeviceId) {
  waiters.delete(requireDeviceId(rawDeviceId));
  prune(Date.now());
  return snapshot();
}

/**
 * Slow, smooth pseudo-activity per region. Deterministic in `now` so repeated
 * polls agree with each other instead of jittering.
 */
function ambientCount(region, now) {
  const seed = [...region.id].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const slow = Math.sin(now / 90_000 + seed);
  const fast = Math.sin(now / 21_000 + seed * 1.7);
  const base = 6 + (seed % 17);

  return Math.max(0, Math.round(base + slow * 5 + fast * 2.5));
}

export function snapshot() {
  const now = Date.now();
  prune(now);

  const realByRegion = new Map();
  for (const entry of waiters.values()) {
    realByRegion.set(entry.regionId, (realByRegion.get(entry.regionId) ?? 0) + 1);
  }

  const pulseByRegion = new Map();
  for (const pulse of recentPulses) {
    const age = now - pulse.at;
    const existing = pulseByRegion.get(pulse.regionId);
    if (!existing || age < existing) pulseByRegion.set(pulse.regionId, age);
  }

  let simulatedWaiting = 0;

  const regions = listRegions().map((region) => {
    const real = realByRegion.get(region.id) ?? 0;
    const ambient = ambientCount(region, now);
    simulatedWaiting += ambient;

    return {
      ...region,
      waiting: real + ambient,
      realWaiting: real,
      pulseAgeMs: pulseByRegion.get(region.id) ?? null
    };
  });

  const realWaiting = waiters.size;

  return {
    totalWaiting: realWaiting + simulatedWaiting,
    realWaiting,
    simulatedWaiting,
    regions: regions.sort((a, b) => b.waiting - a.waiting),
    generatedAt: new Date(now).toISOString()
  };
}

/** Test seam - drops all live state. */
export function resetPresence() {
  waiters.clear();
  recentPulses.length = 0;
}
