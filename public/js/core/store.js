/**
 * Minimal observable state container.
 *
 * Screens subscribe to the slices they care about rather than reaching into
 * each other, which keeps the timer, analytics and globe screens independent.
 */
export function createStore(initialState = {}) {
  let state = { ...initialState };
  const listeners = new Set();

  function notify(changedKeys) {
    for (const listener of listeners) listener(state, changedKeys);
  }

  return {
    get state() {
      return state;
    },

    /** Shallow-merges `patch`; no-ops (and notifies nobody) when nothing changed. */
    set(patch) {
      const changed = Object.keys(patch).filter((key) => !Object.is(state[key], patch[key]));
      if (!changed.length) return state;

      state = { ...state, ...patch };
      notify(changed);
      return state;
    },

    /**
     * Subscribes to state changes. When `keys` is given the listener only runs
     * if one of those keys changed. Returns an unsubscribe function.
     */
    subscribe(listener, keys = null) {
      const wrapped = keys
        ? (next, changed) => {
            if (changed.some((key) => keys.includes(key))) listener(next, changed);
          }
        : listener;

      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    }
  };
}
