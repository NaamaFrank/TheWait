import { api } from './api.js';

/**
 * The wait clock.
 *
 * The wait belongs to the account, not to this browser, so the server holds it
 * and every linked device reads the same one. Starting a wait on a phone and
 * opening the laptop shows one running clock rather than two disagreeing ones.
 *
 * Between syncs the clock is advanced locally so it ticks smoothly without a
 * request per second. It counts from the elapsed figure the server last
 * reported and the local time that arrived, never from the server's own
 * timestamps - which keeps a device with a wrong system clock from displaying
 * the wrong number.
 */

const IDLE = { phase: 'idle', waitId: null, baseMs: 0, since: 0, stale: null };

export function createWaitTimer({ onChange } = {}) {
  let state = { ...IDLE };
  let inFlight = null;

  /** The session the server logged when the wait ended, carried out of `change`. */
  let finished = null;

  /** Adopts whatever the server just said, and restarts the local count. */
  function adopt(wait) {
    state = {
      phase: wait?.phase ?? 'idle',
      waitId: wait?.waitId ?? null,
      // The exact figure where the server sends one; whole seconds from an
      // older server, which is only ever up to a second behind.
      baseMs: Number.isFinite(wait?.elapsedMs) ? wait.elapsedMs : (wait?.elapsedSeconds ?? 0) * 1000,
      since: Date.now(),
      // Set when the clock ran on with nobody looking; the screen asks about it.
      stale: wait?.stale ?? null
    };

    onChange?.();
    return state;
  }

  const elapsedMs = () =>
    state.baseMs + (state.phase === 'running' ? Date.now() - state.since : 0);

  /**
   * Serialises the calls that change the wait. Two taps in quick succession
   * would otherwise race, and the loser's answer would overwrite the winner's.
   */
  async function change(work) {
    inFlight = (inFlight ?? Promise.resolve())
      .catch(() => {})
      .then(work)
      .then(adopt);

    return inFlight;
  }

  return {
    get phase() {
      return state.phase;
    },

    get waitId() {
      return state.waitId;
    },

    /** Non-null when this wait looks like one nobody was there to end. */
    get stale() {
      return state.stale;
    },

    get elapsedSeconds() {
      return Math.floor(elapsedMs() / 1000);
    },

    /** Reads the account's wait. Called on load, and whenever the screen returns. */
    async sync() {
      try {
        return adopt(await api.getWait());
      } catch {
        // Offline: keep counting from what was last known rather than resetting.
        return state;
      }
    },

    start() {
      return change(() => api.startWait());
    },

    pause() {
      return change(() => api.pauseWait());
    },

    resume() {
      return change(() => api.resumeWait());
    },

    /** Start, pause or resume, depending on where the wait currently is. */
    toggle() {
      if (state.phase === 'idle') return this.start();
      if (state.phase === 'running') return this.pause();
      return this.resume();
    },

    /**
     * Ends the wait. The server logs the session in the same step, so there is
     * no window in which a wait is over but unrecorded.
     */
    async end() {
      if (state.phase === 'idle') return null;

      await change(async () => {
        const ended = await api.endWait();
        finished = ended.session;
        return ended.wait;
      });

      const session = finished;
      finished = null;
      return session;
    },

    /**
     * Answers the stale-wait question.
     *
     * Ending returns the session the server logged, exactly as `end` does, so
     * the screen can bank it the same way. Keeping returns null and the clock
     * carries on - the read alone is what stops it being asked again.
     */
    async resolveStale(keep) {
      await change(async () => {
        const resolved = await api.resolveStaleWait(keep);
        finished = resolved.session;
        return resolved.wait;
      });

      const session = finished;
      finished = null;
      return session;
    }
  };
}
