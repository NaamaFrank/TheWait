/**
 * Telling open screens that something changed.
 *
 * The app used to find out about a wait only by asking - every fifteen seconds
 * while one ran, every thirty while idle. That was fine while the only thing
 * that could start a wait was the app itself. Now an editor hook starts one
 * the moment a prompt is sent and ends it when the turn comes back, and a turn
 * is often over before the next poll, so the screen never showed it at all
 * until someone refreshed.
 *
 * So the server says so instead. Every open screen holds one stream, and a
 * change to an account's wait is sent to that account's streams as it happens.
 *
 * In-process, like presence: a second instance would not see the first one's
 * listeners. That is the same limit already recorded in BACKLOG.md.
 */

/** Open streams, by account. */
const listeners = new Map();

/**
 * Enough for every device a person could reasonably have open at once. Past
 * it, the oldest is dropped - a stale tab should not be able to hold a slot.
 */
const MAX_PER_ACCOUNT = 12;

export function subscribe(accountId, send) {
  let set = listeners.get(accountId);
  if (!set) {
    set = new Set();
    listeners.set(accountId, set);
  }

  if (set.size >= MAX_PER_ACCOUNT) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    oldest.close?.();
  }

  const entry = { send, close: null };
  set.add(entry);

  return {
    entry,
    unsubscribe() {
      set.delete(entry);
      if (!set.size) listeners.delete(accountId);
    }
  };
}

/**
 * Sends an event to every open screen on the account.
 *
 * Never throws: a change to a wait must not fail because a phone somewhere
 * dropped its connection a moment ago.
 */
export function publish(accountId, event) {
  const set = listeners.get(accountId);
  if (!set) return 0;

  for (const entry of set) {
    try {
      entry.send(event);
    } catch {
      set.delete(entry);
    }
  }

  return set.size;
}

/** How many are listening, for tests and nothing else. */
export function listenerCount(accountId) {
  return listeners.get(accountId)?.size ?? 0;
}
