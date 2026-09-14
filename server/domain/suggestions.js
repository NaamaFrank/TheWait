import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { clampInt } from './validate.js';

/** Static content - read once at boot and treated as immutable. */
const catalogue = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'suggestions.json'), 'utf8'));

const bucketsById = new Map(catalogue.buckets.map((bucket) => [bucket.id, bucket]));
const categoriesById = new Map(catalogue.categories.map((category) => [category.id, category]));
const itemsById = new Map(catalogue.items.map((item) => [item.id, item]));

/**
 * Chains: a short routine for a long wait, as a list of small steps.
 *
 * The app cannot know how long a wait will be, so it must never hand over
 * something that only pays off if you finish it. Every step is a whole small
 * thing on its own, which makes an answer landing in the middle of one cost
 * nothing - you did the steps you did.
 *
 * The steps are registered individually so a cleared one resolves like any
 * other suggestion, but they are kept out of the shuffled pool: a chain is
 * offered as a chain, never as a loose step.
 */
const chains = (catalogue.chains ?? []).map((chain) => {
  const bucket = bucketsById.get(chain.bucket);
  const count = chain.steps.length;

  /*
   * The whole chain is worth what one task of that size is worth, so doing
   * four steps is not four times the pay of doing one long thing.
   *
   * The remainder goes to the earliest steps rather than being rounded away:
   * forty split three ways is thirteen each, which comes to thirty-nine, and
   * a routine that quietly pays a point less than the task it replaces is a
   * reason not to start one.
   */
  const total = bucket?.xp ?? 0;
  const each = Math.floor(total / count);
  const spare = total - each * count;

  return {
    ...chain,
    totalXp: total,
    steps: chain.steps.map((title, index) => ({
      id: `${chain.id}-${index + 1}`,
      title,
      index,
      count,
      xp: Math.max(1, each + (index < spare ? 1 : 0))
    }))
  };
});

const chainsById = new Map(chains.map((chain) => [chain.id, chain]));

const stepsById = new Map(
  chains.flatMap((chain) => chain.steps.map((step) => [step.id, { chain, step }]))
);

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
  if (item) return decorate(item);

  // A single step of a chain, which scores its share of the whole.
  const held = stepsById.get(id);
  if (!held) return null;

  return {
    id: held.step.id,
    bucket: held.chain.bucket,
    category: held.chain.category,
    title: held.step.title,
    sub: held.chain.title,
    tag: categoriesById.get(held.chain.category)?.label ?? held.chain.category,
    xp: held.step.xp,
    bucketLabel: bucketsById.get(held.chain.bucket)?.label ?? held.chain.bucket
  };
}

/** The chains that suit a size of wait, ready to offer as whole routines. */
export function listChains(bucketId, category = null) {
  return chains
    .filter((chain) => chain.bucket === bucketId)
    .filter((chain) => !category || chain.category === category)
    .map((chain) => ({
      id: chain.id,
      kind: 'chain',
      bucket: chain.bucket,
      category: chain.category,
      title: chain.title,
      sub: chain.sub,
      tag: categoriesById.get(chain.category)?.label ?? chain.category,
      // The routine's total; each step carries its own share.
      xp: chain.totalXp,
      bucketLabel: bucketsById.get(chain.bucket)?.label ?? chain.bucket,
      steps: chain.steps.map((step) => ({ id: step.id, title: step.title, xp: step.xp }))
    }));
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
