import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { clockFace, formatCount, headlineDuration } from '../core/format.js';
import { createWaitTimer } from '../core/wait-timer.js';
import { screenHead } from '../components/ui.js';

/**
 * The home screen: one clock, one task, two numbers.
 *
 * The timer owns its own persistence; this screen only renders it and reacts to
 * the phase. Suggestions are fetched a batch at a time and cycled locally, so
 * pressing "Next" is instant and does not spend a request per tap.
 */

/** How many suggestions to pull per request. */
const BATCH = 8;

/** Fallback for the progress bar before we know the user's typical wait. */
const DEFAULT_TARGET_SECONDS = 210;

/** Presence is refreshed on this cadence while a wait is running. */
const HEARTBEAT_MS = 30_000;

const CAPTIONS = {
  running: 'elapsed',
  paused: 'held — nothing is counting',
  idle: 'ready when you are'
};

const HEADINGS = { running: 'Do this now', paused: 'On hold', idle: 'Next time' };

/**
 * Everything a task card needs to render.
 *
 * Checked rather than assumed, because the catalogue is read once when the
 * server boots: a server left running across a deploy happily serves the
 * previous shape, and a missing field would otherwise be rendered at the user
 * as "Did it +undefined".
 */
export function isRenderable(item) {
  return Boolean(item?.id && item.title && item.tag) && Number.isFinite(item.xp);
}

/*
 * What the two buttons above this actually do.
 *
 * This used to sit at the foot of the screen - on desktop, in the other
 * column entirely - so it read as a footnote about the app rather than as the
 * label for the controls it describes. It lives under them now, and names
 * them both.
 */
const HINTS = {
  running: 'Pause holds the clock and keeps the wait. End banks the time and logs it.',
  paused: 'Resume picks up where you left off. End banks what you have so far.',
  idle: 'Tap start when you send something off, then fill the wait with the task below.'
};

export function createWaitScreen({ store, onWaitLogged, onProgress }) {
  const element = el('section.screen', { 'data-screen': 'wait' });

  const timer = createWaitTimer({
    onChange: () => {
      paint();
      syncPresence();
    }
  });

  let queue = [];
  let cursor = 0;
  let queueBucket = null;
  let loadingQueue = false;
  let staleCatalogue = false;
  let busy = false;
  let ticker = null;
  let heartbeat = null;

  /*
   * Bucket boundaries come from the server so the rule for "this wait is now a
   * medium one" lives in exactly one place. Until they arrive, the queue simply
   * is not refreshed on a crossing.
   */
  let bucketBounds = [];

  /* --- Static structure, painted rather than rebuilt ---------------------- */

  const score = el('span.xp-chip-value', { text: '0' });

  const statusText = el('span.status-chip-text', { text: 'No wait running' });
  const statusChip = el('div.status-chip', {}, [el('span.status-chip-dot'), statusText]);
  const estimate = el('span.est');

  const clock = el('div.clock', { text: '0:00' });
  const caption = el('div.clock-caption', { text: CAPTIONS.idle });

  const pressGlyph = el('span.btn-press-glyph', { text: '▶' });
  const pressLabel = el('span.btn-press-label', { text: 'Start' });
  const press = el('button.btn-press', {
    type: 'button',
    onclick: () => timer.toggle()
  }, [pressGlyph, pressLabel]);

  const barFill = el('div.bar-fill');
  const bar = el('div.bar', { role: 'presentation' }, [barFill]);

  const hint = el('p.hint', { text: HINTS.idle });

  const endButton = el('button.btn.btn-outline-cream', {
    type: 'button',
    onclick: () => endWait()
  }, ["It's back — end the wait"]);

  const taskHeading = el('span.label.label-wide', { text: HEADINGS.idle });
  const taskTag = el('span.tag', { text: '—' });
  const taskTitle = el('div.task-title', { text: 'Finding you something to do…' });
  const taskSub = el('div.task-sub', { text: '' });

  const doneButton = el('button.btn.btn-hero', {
    type: 'button',
    onclick: () => completeTask()
  }, ['Did it']);

  const nextButton = el('button.btn.btn-outline', {
    type: 'button',
    onclick: () => showNext()
  }, ['Next']);

  const taskActions = el('div.task-actions', {}, [doneButton, nextButton]);

  const waitsToday = el('div.tile-value', { text: '0' });
  const reclaimed = el('div.tile-value', { text: '0m', style: { color: 'var(--green)' } });

  render(element, [
    // The brand reads as the kicker here, so this screen opens the same way
    // as the other five instead of being the one with no title.
    screenHead('The Wait', 'Your wait', {
      aside: el('div.xp-chip', {}, [el('span.xp-chip-label', { text: 'XP' }), score])
    }),

    el('div.card-cream', {}, [
      el('div.row-between', {}, [statusChip, estimate]),
      el('div.clock-row', {}, [el('div.clock-col', {}, [clock, caption]), press]),
      bar,
      endButton,
      hint
    ]),

    el('div.card', {}, [
      el('div.row-between', {}, [taskHeading, taskTag]),
      taskTitle,
      taskSub,
      taskActions
    ]),

    el('div.grid-2', {}, [
      el('div.tile', {}, [el('div.label', { text: 'Waits today' }), waitsToday]),
      el('div.tile', {}, [el('div.label', { text: 'Reclaimed' }), reclaimed])
    ])
  ]);

  /* --- Suggestions ------------------------------------------------------- */

  const activity = () => queue[cursor] ?? null;

  async function loadQueue({ append = false } = {}) {
    if (loadingQueue) return;
    loadingQueue = true;

    try {
      const seconds = timer.elapsedSeconds;
      const seen = append ? queue.map((item) => item.id) : [];
      const { bucket, items } = await api.getSuggestions({ seconds, count: BATCH, exclude: seen });

      queueBucket = bucket.id;

      const usable = items.filter(isRenderable);
      staleCatalogue = items.length > 0 && usable.length === 0;

      if (append) queue = [...queue, ...usable];
      else {
        queue = usable;
        cursor = 0;
      }
    } catch {
      // Offline: keep whatever is already on screen rather than blanking it.
    } finally {
      loadingQueue = false;
      paint();
    }
  }

  function showNext() {
    if (cursor + 1 >= queue.length) loadQueue({ append: true });
    cursor = Math.min(cursor + 1, Math.max(0, queue.length - 1));
    paint();
  }

  async function completeTask() {
    const current = activity();
    if (!current || busy) return;

    busy = true;
    paint();

    try {
      const progress = await api.completeSuggestion(current.id, timer.waitId);
      store.set({ progress });
      onProgress?.(progress);
    } catch {
      // Nothing banked; the task stays on screen so it can be retried.
    } finally {
      busy = false;
      showNext();
    }
  }

  /* --- The wait itself --------------------------------------------------- */

  async function endWait() {
    stopHeartbeat();
    api.stopPresence().catch(() => {});

    try {
      // The server clears the wait and logs the session in one step, so there
      // is no moment where a wait is over but unrecorded.
      const session = await timer.end();
      if (!session) return;

      onWaitLogged?.();
      store.set({ progress: await api.getProgress() });
    } catch {
      // The wait is over either way; the number just will not be banked.
    }

    paint();
  }

  /**
   * What other people see under your name on the globe.
   *
   * The task's opening sentence, lowercased - "roll your shoulders back five
   * times". This used to send the category tag, which put the word "body" on
   * the globe and told nobody anything.
   */
  function activityLabel(item) {
    if (!item?.title) return undefined;

    const sentence = item.title.split(/(?<=\.)\s/)[0].replace(/\.$/, '');
    return sentence[0].toLowerCase() + sentence.slice(1);
  }

  function sendHeartbeat() {
    const device = store.state.device;
    if (!device) return;

    api.heartbeat(device.cityId, activityLabel(activity())).catch(() => {});
  }

  function startHeartbeat() {
    if (heartbeat !== null) return;
    sendHeartbeat();
    heartbeat = setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  }

  /** A paused or finished wait is not a wait, so the pin comes off the globe. */
  function syncPresence() {
    if (timer.phase === 'running') {
      startHeartbeat();
      return;
    }

    const wasBeating = heartbeat !== null;
    stopHeartbeat();
    if (wasBeating) api.stopPresence().catch(() => {});
  }

  /** Which bucket a wait of `seconds` falls into, per the catalogue. */
  function bucketFor(seconds) {
    const match = bucketBounds.find(
      (bucket) => seconds >= bucket.minSeconds && (bucket.maxSeconds === null || seconds < bucket.maxSeconds)
    );

    return match?.id ?? null;
  }

  /* --- Painting ---------------------------------------------------------- */

  function paint() {
    const phase = timer.phase;
    const elapsed = timer.elapsedSeconds;
    const progress = store.state.progress;
    const analytics = store.state.analytics;

    /*
     * The timer is private to this screen, but a wait carries on while any of
     * the other five is on top. Publishing it is what lets them say so.
     */
    store.set({ wait: { phase, elapsedSeconds: elapsed } });

    statusChip.dataset.phase = phase;
    statusText.textContent =
      phase === 'running' ? 'Wait in progress' : phase === 'paused' ? 'Paused' : 'No wait running';

    const typical = analytics?.averageSessionSeconds || 0;
    const target = Math.max(60, typical || DEFAULT_TARGET_SECONDS);
    estimate.textContent = phase === 'idle' || !typical ? '' : `usually done by ~${clockFace(typical)}`;

    clock.textContent = clockFace(elapsed);
    clock.classList.toggle('is-idle', phase === 'idle');
    caption.textContent = CAPTIONS[phase];

    pressGlyph.textContent = phase === 'running' ? '❚❚' : '▶';
    pressGlyph.style.letterSpacing = phase === 'running' ? '2px' : '0';
    pressLabel.textContent = phase === 'running' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Start';
    press.setAttribute(
      'aria-label',
      phase === 'running' ? 'Pause the wait' : phase === 'paused' ? 'Resume the wait' : 'Start a wait'
    );
    press.style.setProperty('--press-bg', phase === 'running' ? 'var(--frame-edge)' : 'var(--hero)');
    press.style.setProperty('--press-fg', phase === 'running' ? 'var(--cream)' : 'var(--on-cream)');
    press.style.setProperty(
      '--press-shadow',
      phase === 'running' ? 'var(--card-line-soft)' : 'var(--hero-shadow)'
    );

    bar.dataset.phase = phase;
    barFill.style.width = `${Math.min(100, (elapsed / target) * 100).toFixed(1)}%`;

    endButton.hidden = phase === 'idle';

    const current = activity();
    taskHeading.textContent = HEADINGS[phase];
    taskTag.textContent = current?.tag ?? '—';
    taskTitle.textContent =
      current?.title ??
      (staleCatalogue ? 'The server is on an older build' : 'Finding you something to do…');
    taskTitle.classList.toggle('is-off', phase !== 'running');
    taskSub.textContent =
      current?.sub ??
      (staleCatalogue ? 'It is serving a suggestion catalogue this app cannot read. Restart it.' : '');
    taskActions.classList.toggle('is-off', phase !== 'running');

    doneButton.textContent = current ? `Did it +${current.xp}` : 'Did it';
    doneButton.disabled = !current || busy;
    doneButton.classList.toggle('is-muted', phase !== 'running');
    nextButton.disabled = !queue.length;

    score.textContent = formatCount(progress?.score ?? 0);
    waitsToday.textContent = String(progress?.waitsToday ?? 0);
    reclaimed.textContent = headlineDuration(progress?.reclaimedTodaySeconds ?? 0);
    hint.textContent = HINTS[phase];
  }

  /* --- Lifecycle --------------------------------------------------------- */

  // A running wait keeps ticking whichever screen is on top, so this interval
  // is tied to the app rather than to `enter`/`leave`.
  let sinceSync = 0;

  ticker = setInterval(() => {
    // A wait can be started or ended elsewhere, so check even while idle -
    // just rarely, since the common case is nothing having changed.
    sinceSync += 1;
    if (sinceSync >= (timer.phase === 'idle' ? 30 : 15)) {
      sinceSync = 0;
      timer.sync().then(paint);
    }

    if (timer.phase !== 'running') return;

    paint();
    // The suggestion should match how long the wait has actually become.
    const bucket = bucketFor(timer.elapsedSeconds);
    if (bucket && queueBucket && bucket !== queueBucket) loadQueue();
  }, 1000);

  store.subscribe(() => paint(), ['progress', 'analytics', 'device']);

  return {
    element,

    enter() {
      paint();
      // Another device may have started, paused or ended it since we looked.
      timer.sync().then(() => {
        syncPresence();
        paint();
      });
    },

    async refresh() {
      await loadQueue();
      paint();
    },

    /** Called once the device and reference data are in the store. */
    async ready() {
      await timer.sync();
      syncPresence();
      loadQueue();

      try {
        const meta = await api.getSuggestionMeta();
        bucketBounds = meta.buckets;
      } catch {
        // Without the boundaries the queue just does not refresh mid-wait.
      }
    },

    /** Pushes the profile to the globe now, rather than at the next beat. */
    refreshPresence() {
      if (timer.phase === 'running') sendHeartbeat();
    },

    destroy() {
      clearInterval(ticker);
      stopHeartbeat();
    }
  };
}
