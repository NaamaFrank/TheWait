import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { AVATARS, SAMPLE_NAMES, TINTS, defaultAvatar } from './people.js';
import { citiesInCountry, featuredCities, getCity, resolveCity, toPublicCity } from './cities.js';
import { optionalText, requireDeviceId } from './validate.js';

/**
 * Live "who is waiting right now" registry.
 *
 * Presence is ephemeral by design, so it lives in memory rather than the store:
 * a restart should show an empty world, not resurrect stale waiters. Entries
 * expire `config.presenceTtlMs` after their last heartbeat.
 *
 * The device id is this app's only credential, so it never appears in a
 * snapshot: `/api/presence` is public, and publishing it would hand every
 * viewer the means to act as anyone they can see. Rows carry an opaque id
 * instead, salted per process, which is stable for as long as the presence it
 * describes and meaningless to anyone else.
 *
 * Ambient activity is layered on top so a single-user install still shows a
 * living globe. It is generated, not observed, and every generated row carries
 * `simulated: true` alongside the separately reported `simulatedWaiting` count,
 * so nothing here can be mistaken for a real person.
 */

/**
 * How many cities carry generated activity. The catalogue has 31,000; a globe
 * needs a legible scatter, not a pin on every town.
 */
const AMBIENT_CITIES = 60;

/**
 * How many generated people stand in the viewer's own city.
 *
 * Elsewhere one pin per city is enough to show the world is busy. Your own city
 * is the one you will actually zoom into, and a single pin there makes "my
 * city" look empty, so it gets a small crowd instead.
 */
const HOME_CITY_PEOPLE = 5;

/** How many of a focused country's cities get generated activity. */
const FOCUS_COUNTRY_CITIES = 8;

/** Longest activity line. A task's opening sentence runs to 63 characters. */
const MAX_DOING = 70;

/**
 * Salt for the public row ids. Regenerated each start, which is fine: presence
 * is in-memory and does not outlive the process either.
 */
const ID_SALT = randomBytes(16).toString('hex');

/** An opaque, stable, non-reversible handle for a waiting device. */
function publicId(deviceId) {
  return `live:${createHash('sha256').update(`${ID_SALT}:${deviceId}`).digest('hex').slice(0, 12)}`;
}

const waiters = new Map();
const recentPulses = [];
const MAX_PULSES = 40;
const PULSE_TTL_MS = 12 * 1000;

const QUESTS = [
  'refilling water',
  'stretching',
  'reading the changelog',
  'loading the dishwasher',
  'on a balcony lap',
  'answering a text',
  'staring at the cursor',
  'doing push-ups'
];

function prune(now) {
  for (const [deviceId, entry] of waiters) {
    if (now - entry.lastSeen > config.presenceTtlMs) waiters.delete(deviceId);
  }

  while (recentPulses.length && now - recentPulses[0].at > PULSE_TTL_MS) {
    recentPulses.shift();
  }
}

function addPulse(cityId, now) {
  recentPulses.push({ cityId, at: now });
  if (recentPulses.length > MAX_PULSES) recentPulses.shift();
}

/**
 * Marks a device as waiting. The profile travels with the heartbeat rather than
 * being looked up here, so this module never touches the database.
 */
export function heartbeat(rawDeviceId, profile = {}) {
  const deviceId = requireDeviceId(rawDeviceId);
  const now = Date.now();
  const city = resolveCity(profile.cityId);
  const existing = waiters.get(deviceId);

  waiters.set(deviceId, {
    deviceId,
    cityId: city.id,
    displayName: profile.displayName ?? 'Anonymous Dev',
    avatar: profile.avatar ?? null,
    tint: profile.tint ?? TINTS[0],
    visible: profile.visible !== false,
    doing: optionalText(profile.doing, 'doing', MAX_DOING) ?? 'waiting it out',
    /*
     * How long the wait has actually run, taken from the account's own clock
     * rather than from when this presence entry appeared. Pausing removes the
     * entry and resuming makes a new one, so counting from its own start showed
     * the time since the last resume instead of the whole wait.
     */
    elapsedAtBeat: Math.max(0, Math.round(Number(profile.elapsedSeconds) || 0)),
    beatAt: now,
    running: profile.running !== false,
    lastSeen: now,
    startedAt: existing?.startedAt ?? now
  });

  if (!existing) addPulse(city.id, now);

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
function ambientCount(city, now) {
  const seed = city.id % 9973;
  const slow = Math.sin(now / 90_000 + seed);
  const fast = Math.sin(now / 21_000 + seed * 1.7);
  const base = 6 + (seed % 17);

  return Math.max(0, Math.round(base + slow * 5 + fast * 2.5));
}

/**
 * One generated stand-in per active region. The globe wants a readable handful
 * of pins, not one per simulated head, so the ambient count stays a number and
 * only the representative gets drawn.
 */
function ambientPerson(city, index, now, slot = 0) {
  const seed = (city.id % 9973) + slot * 619;
  const name = SAMPLE_NAMES[(index + slot * 7) % SAMPLE_NAMES.length];

  return {
    id: `sim:${city.id}:${slot}`,
    isYou: false,
    displayName: name,
    avatar: AVATARS[(index + slot * 5) % AVATARS.length],
    cityId: city.id,
    place: city.name,
    country: city.country,
    // Everyone in a city shares its coordinates. The globe fans them out on
    // screen rather than inventing a street address for each of them.
    lat: city.lat,
    lng: city.lng,
    // Lets the globe frame this person's city at a zoom that suits its size.
    cityPopulation: city.population,
    tint: TINTS[(index + slot * 3) % TINTS.length],
    doing: QUESTS[(seed + index) % QUESTS.length],
    // Drifts slowly so the ticker's clocks are not frozen between polls.
    waitingSeconds: 20 + ((seed * 37 + Math.floor(now / 1000)) % 280),
    simulated: true
  };
}

/**
 * The live picture.
 *
 * `viewerCityId` seeds generated activity in the caller's own city as well as
 * the featured ones, so filtering to "my city" lands somewhere populated even
 * when the viewer lives nowhere near a megacity. `focusCityId` and
 * `focusCountry` do the same for wherever they have jumped to, so searching
 * for a place and finding it deserted is not the normal outcome.
 */
export function snapshot({
  viewerDeviceId = null,
  viewerCityId = null,
  focusCityId = null,
  focusCountry = null
} = {}) {
  const now = Date.now();
  prune(now);

  const realByCity = new Map();
  for (const entry of waiters.values()) {
    realByCity.set(entry.cityId, (realByCity.get(entry.cityId) ?? 0) + 1);
  }

  const pulseByCity = new Map();
  for (const pulse of recentPulses) {
    const age = now - pulse.at;
    const existing = pulseByCity.get(pulse.cityId);
    if (!existing || age < existing) pulseByCity.set(pulse.cityId, age);
  }

  let simulatedWaiting = 0;
  const people = [];

  // Real waiters first, and only the ones who opted in to being seen.
  for (const entry of waiters.values()) {
    if (!entry.visible) continue;
    const city = resolveCity(entry.cityId);

    people.push({
      id: publicId(entry.deviceId),
      // Marked here rather than by comparing ids on the client, which would
      // mean publishing an id the client could recognise in the first place.
      isYou: entry.deviceId === viewerDeviceId,
      displayName: entry.displayName,
      avatar: entry.avatar ?? defaultAvatar(entry.deviceId),
      cityId: city.id,
      place: city.name,
      country: city.country,
      lat: city.lat,
      lng: city.lng,
      cityPopulation: city.population,
      tint: entry.tint,
      doing: entry.doing,
      // Advanced locally between beats, and only while the clock is running.
      waitingSeconds:
        entry.elapsedAtBeat + (entry.running ? Math.round((now - entry.beatAt) / 1000) : 0),
      simulated: false
    });
  }

  const featured = featuredCities(AMBIENT_CITIES);
  const home = viewerCityId ? resolveCity(viewerCityId) : null;

  // Wherever the viewer lives, and wherever they are currently looking.
  const extra = [
    home,
    focusCityId ? getCity(focusCityId) : null,
    ...citiesInCountry(focusCountry, FOCUS_COUNTRY_CITIES)
  ].filter(Boolean);

  const ambientCities = [...featured];
  const seen = new Set(featured.map((city) => city.id));

  for (const city of extra) {
    if (seen.has(city.id)) continue;
    seen.add(city.id);
    ambientCities.push(city);
  }

  const places = ambientCities.map((city, index) => {
    const real = realByCity.get(city.id) ?? 0;
    const ambient = ambientCount(city, now);
    simulatedWaiting += ambient;

    if (ambient > 0) {
      const crowded = city.id === home?.id || city.id === focusCityId;
      const crowd = crowded ? Math.min(HOME_CITY_PEOPLE, ambient) : 1;
      for (let slot = 0; slot < crowd; slot += 1) people.push(ambientPerson(city, index, now, slot));
    }

    return {
      ...toPublicCity(city),
      waiting: real + ambient,
      realWaiting: real,
      pulseAgeMs: pulseByCity.get(city.id) ?? null
    };
  });

  const realWaiting = waiters.size;

  return {
    totalWaiting: realWaiting + simulatedWaiting,
    realWaiting,
    simulatedWaiting,
    people,
    places: places.sort((a, b) => b.waiting - a.waiting),
    generatedAt: new Date(now).toISOString()
  };
}

/** Test seam - drops all live state. */
export function resetPresence() {
  waiters.clear();
  recentPulses.length = 0;
}
