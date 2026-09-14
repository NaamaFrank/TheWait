import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { clampInt } from './validate.js';

/** Static content - read once at boot and treated as immutable. */
const catalogue = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'suggestions.json'), 'utf8'));

const bucketsById = new Map(catalogue.buckets.map((bucket) => [bucket.id, bucket]));
const categoriesById = new Map(catalogue.categories.map((category) => [category.id, category]));
const itemsById = new Map(catalogue.items.map((item) => [item.id, item]));

/** The bucket whose range contains `seconds`; falls back to the longest bucket. */
export function bucketForSeconds(seconds) {
  const match = catalogue.buckets.find(
    (bucket) => seconds >= bucket.minSeconds && (bucket.maxSeconds === null || seconds < bucket.maxSeconds)
  );

  return match ?? catalogue.buckets[catalogue.buckets.length - 1];
}

/**
 * Adds everything the client shows but the catalogue does not repeat 190 times:
 * the pill label taken from the category, and the XP taken from the bucket, so
 * a longer wait is worth more than a twenty-second one.
 */
function decorate(item) {
  const bucket = bucketsById.get(item.bucket);

  return {
    id: item.id,
    bucket: item.bucket,
    category: item.category,
    title: item.title,
    sub: item.sub,
    tag: categoriesById.get(item.category)?.label ?? item.category,
    xp: bucket?.xp ?? 0,
    bucketLabel: bucket?.label ?? item.bucket
  };
}

/** Looks up one suggestion, for scoring a completion the client reports. */
export function getSuggestion(id) {
  const item = itemsById.get(id);
  return item ? decorate(item) : null;
}

/** Display label for a category id, so other domains need not reload the catalogue. */
/** Tasks people wrote themselves are not in the catalogue's categories. */
const OWN_CATEGORY = { id: 'yours', label: 'Your own' };

export function getCategoryLabel(categoryId) {
  if (categoryId === OWN_CATEGORY.id) return OWN_CATEGORY.label;
  return categoriesById.get(categoryId)?.label ?? categoryId;
}

export function getMeta() {
  return {
    version: catalogue.version,
    total: catalogue.items.length,
    buckets: catalogue.buckets,
    categories: catalogue.categories
  };
}

/**
 * Picks suggestions for the current wait.
 *
 * `seed` makes the selection stable for a given caller+tick, so a client can
 * poll without the list reshuffling underneath the user. `exclude` lets a
 * client ask for a different set without repeating what it just showed.
 */
export function pickSuggestions({
  seconds = 0,
  bucket: bucketId = null,
  category = null,
  count = 3,
  seed = null,
  exclude = [],
  weights = null,
  weight = 1
} = {}) {
  // The caller may have already decided the size - `queue.js` caps it by how
  // long this person's waits actually run, which this module cannot know.
  const bucket = bucketId
    ? bucketsById.get(bucketId) ?? bucketForSeconds(Math.max(0, Number(seconds) || 0))
    : bucketForSeconds(Math.max(0, Number(seconds) || 0));

  const excluded = new Set(exclude);

  let pool = catalogue.items.filter((item) => item.bucket === bucket.id && !excluded.has(item.id));
  if (category && categoriesById.has(category)) {
    pool = pool.filter((item) => item.category === category);
  }

  // Never return nothing just because the filters were narrow.
  if (!pool.length) {
    pool = catalogue.items.filter((item) => item.bucket === bucket.id);
  }

  const wanted = clampInt(count, 3, { min: 1, max: 12 });

  // The weighted pool holds an item more than once, so the shuffle is walked
  // rather than sliced - otherwise a favoured task fills the queue by itself.
  const seen = new Set();
  const picked = [];

  for (const item of shuffle(weighted(pool, weights, weight), seed)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    picked.push(decorate(item));
    if (picked.length === wanted) break;
  }

  return { bucket, category, items: picked };
}

/**
 * Tilts the pool towards categories this person actually clears.
 *
 * By repetition rather than by sorting: a weighted shuffle still turns up
 * something from a category they have never touched, which a ranked list
 * would never do. Clearing a few "craft" tasks should lean the queue, not
 * narrow it to one category for good.
 */
function weighted(pool, weights, weight) {
  if (!weights?.size || weight <= 1) return pool;

  const most = Math.max(...weights.values());
  if (!most) return pool;

  const out = [];
  for (const item of pool) {
    const share = (weights.get(item.category) ?? 0) / most;
    const copies = 1 + Math.round(share * (weight - 1));
    for (let i = 0; i < copies; i += 1) out.push(item);
  }

  return out;
}

/** The sizes of wait, for anything that needs to order or validate them. */
export function listBuckets() {
  return catalogue.buckets;
}

/** Deterministic Fisher-Yates when `seed` is supplied, random otherwise. */
function shuffle(items, seed) {
  const copy = items.slice();
  const random = seed === null || seed === undefined ? Math.random : mulberry32(hashSeed(String(seed)));

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
