import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { clockFace, formatCount, headlineDuration } from '../core/format.js';
import { createWaitTimer } from '../core/wait-timer.js';
import { chipRow, screenHead } from '../components/ui.js';
import { DEFAULT_SIZE, SIZES } from '../components/own-tasks.js';

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
 * What you are up for, said the way a person would say it.
 *
 * The server has always taken a category filter and no screen ever sent one.
 * Framed by where you are rather than by the catalogue's own taxonomy -
 * nobody waiting on a prompt thinks "I would like a reflect task".
 */
const MOODS = [
  { id: null, label: 'Anything' },
  { id: 'body', label: 'Get up' },
  { id: 'tidy', label: 'At my desk' },
  { id: 'craft', label: 'Keep working' },
  { id: 'reset', label: 'Wind down' }
];

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

export function createWaitScreen({ store, onWaitLogged, onProgress, onShowLive }) {
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

  /** A bigger size the wait has grown into, applied at the next task. */
  let pendingBucket = null;

  /** The last id reported as shown, so a repaint does not report it twice. */
  let reported = null;

  function reportShown(id) {
    if (!id || id === reported) return;
    reported = id;
    api.markShown(id).catch(() => {});
  }

  /**
   * How far into the routine on screen, if the current item is one.
   *
   * A chain is a handful of small steps rather than one long task, because
   * the app cannot know how long this wait will be: an answer arriving in the
   * middle of step two costs nothing, since step two was a whole small thing
   * on its own and the steps before it are already banked.
   */
  let step = 0;

  /** The task on screen: a step of the current chain, or the item itself. */
  function shown() {
    const item = activity();
    if (!item?.steps?.length) return item;

    const at = item.steps[Math.min(step, item.steps.length - 1)];
    // The step's own share, not the routine's total - that is what clearing
    // this one actually pays.
    return {
      ...item,
      id: at.id,
      title: at.title,
      sub: item.title,
      xp: at.xp ?? item.xp,
      stepOf: item.steps.length,
      stepNo: step + 1
    };
  }
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

  // Held rather than built inline: clearing a task animates the whole chip,
  // not just the digits inside it.
  const xpChip = el('div.xp-chip', {}, [el('span.xp-chip-label', { text: 'XP' }), score]);

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

  /*
   * The stale-wait question.
   *
   * A wait whose clock ran on with nobody watching is almost always a laptop
   * that was closed, not a six-hour wait. Rather than guess, this offers the
   * last moment somebody was demonstrably there and lets the answer be no.
   */
  const staleLine = el('p.rescue-line');

  const rescueEnd = el('button.btn.btn-hero.rescue-primary', {
    type: 'button',
    onclick: () => resolveStale(false)
  }, ['End it there']);

  const rescueKeep = el('button.btn.btn-outline-cream', {
    type: 'button',
    onclick: () => resolveStale(true)
  }, ["No, it's still running"]);

  const rescue = el('div.rescue', { hidden: true, role: 'group', 'aria-label': 'Unattended wait' }, [
    el('span.rescue-title', { text: 'Was this wait still going?' }),
    staleLine,
    el('div.rescue-actions', {}, [rescueEnd, rescueKeep])
  ]);

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

  /** Set by the chips; null means whatever the queue thinks best. */
  let mood = null;

  const moods = chipRow(MOODS.map((m) => ({ id: m.id ?? 'any', label: m.label })), 'any', (id) => {
    const next = id === 'any' ? null : id;

    /*
     * A filter, not a second Next.
     *
     * Every click used to reload the queue, so tapping the chip that was
     * already on - or any chip while the task on screen already suited it -
     * dealt a different task. Clicking through the row was just a slower way
     * of pressing Next, which is not what a filter is for.
     */
    if (next === mood) return;

    mood = next;
    // `chipRow` does not move the pill itself - the caller owns which is on.
    moods.select(id);

    // Already the kind of thing you asked for, so it stays put and the rest of
    // the queue is refilled behind it.
    const current = activity();
    loadQueue({ keep: !mood || current?.category === mood ? current : null });
  });

  /**
   * The one you never want to see again.
   *
   * Different from Next, which is "not right now" - so it is a separate
   * control rather than a long press nobody would find.
   */
  const banButton = el('button.task-ban', {
    type: 'button',
    'aria-label': 'Never show me this again',
    onclick: () => banTask()
  }, ['Don’t show me this again']);

  const taskActions = el('div.task-actions', {}, [doneButton, nextButton]);

  /*
   * Adding your own, from the screen you are actually on.
   *
   * It lived only on the You screen, several swipes away and under a heading
   * nobody had a reason to open - so the single thing that makes the queue
   * yours was the one thing nobody knew was there. The moment you want it is
   * the moment a suggestion is not what you needed, which is here.
   */
  let ownSize = DEFAULT_SIZE;

  const ownInput = el('input.input', {
    type: 'text',
    placeholder: 'Water the plants',
    maxlength: '80',
    onkeydown: (event) => { if (event.key === 'Enter') saveOwnTask(); }
  });

  const ownSizes = el('div.own-sizes', {}, SIZES.map((option) =>
    el('button.own-size', {
      type: 'button',
      class: option.id === DEFAULT_SIZE ? 'is-active' : '',
      onclick: () => pickOwnSize(option.id)
    }, [option.label])
  ));

  const ownNote = el('p.own-note');

  const ownPanel = el('div.own-inline', { hidden: true }, [
    el('span.label', { text: 'Something you would rather do' }),
    ownInput,
    ownSizes,
    el('div.task-actions', {}, [
      el('button.btn.btn-hero', { type: 'button', onclick: () => saveOwnTask() }, ['Add it']),
      el('button.btn.btn-outline', { type: 'button', onclick: () => toggleOwn(false) }, ['Cancel'])
    ]),
    ownNote
  ]);

  const ownButton = el('button.task-add', {
    type: 'button',
    onclick: () => toggleOwn(ownPanel.hidden)
  }, ['+ Add your own']);

  /*
   * Who else is in the same boat, on the screen where you are actually sat.
   *
   * Real waiters only. The globe pads a quiet hour with sample pins and says
   * so, but quoting a padded number here - where the claim is about you, now -
   * would just be a lie.
   */
  const company = el('button.company', {
    type: 'button',
    hidden: true,
    onclick: () => onShowLive?.()
  });

  const waitsToday = el('div.tile-value', { text: '0' });
  const reclaimed = el('div.tile-value', { text: '0m', style: { color: 'var(--green)' } });

  render(element, [
    // The brand reads as the kicker here, so this screen opens the same way
    // as the other five instead of being the one with no title.
    screenHead('The Wait', 'Your wait', {
      aside: xpChip
    }),

    el('div.card-cream', {}, [
      el('div.row-between', {}, [statusChip, estimate]),
      el('div.clock-row', {}, [el('div.clock-col', {}, [clock, caption]), press]),
      bar,
      endButton,
      rescue,
      hint
    ]),

    el('div.card.task-card', {}, [
      el('div.row-between', {}, [taskHeading, taskTag]),
      // The filter sits above what it filters.
      moods.element,
      el('div.task-body', {}, [taskTitle, taskSub]),
      taskActions,
      el('div.task-foot', {}, [ownButton, banButton]),
      ownPanel
    ]),

    el('div.grid-2', {}, [
      el('div.tile', {}, [el('div.label', { text: 'Waits today' }), waitsToday]),
      el('div.tile', {}, [el('div.label', { text: 'Reclaimed' }), reclaimed])
    ]),

    company
  ]);

  /* --- Suggestions ------------------------------------------------------- */

  const activity = () => queue[cursor] ?? null;

  /**
   * @param keep A task to leave on screen while the rest is replaced, for when
   *   the filter changed but what is showing already fits it.
   */
  async function loadQueue({ append = false, keep = null } = {}) {
    if (loadingQueue) return;
    loadingQueue = true;
    pendingBucket = null;
    step = 0;

    try {
      const seconds = timer.elapsedSeconds;
      const seen = append ? queue.map((item) => item.id) : [];
      const { bucket, items } = await api.getSuggestions({
        seconds,
        category: mood,
        count: BATCH,
        exclude: seen
      });

      queueBucket = bucket.id;

      const usable = items.filter(isRenderable);
      staleCatalogue = items.length > 0 && usable.length === 0;

      if (append) queue = [...queue, ...usable];
      else {
        queue = keep ? [keep, ...usable.filter((item) => item.id !== keep.id)] : usable;
        cursor = 0;
      }
    } catch {
      // Offline: keep whatever is already on screen rather than blanking it.
    } finally {
      loadingQueue = false;
      paint();
    }
  }

  /**
   * @param skip Whether the task being left behind was passed over. False when
   *   it was cleared or banned - both also move the queue on, and counting
   *   those as skips would teach the queue to stop offering the tasks people
   *   actually do.
   */
  function showNext({ skip = true } = {}) {
    /*
     * Tell the server what was passed over. This was the most-pressed button
     * in the app and it recorded nothing, so a suggestion turned down eleven
     * times looked exactly like one never seen before.
     */
    const passed = skip ? activity() : null;
    if (passed) api.skipSuggestion(passed.id).catch(() => {});

    // Next leaves the whole routine, not just the step you are on.
    step = 0;

    // Now is the moment to grow into the size the wait has reached: the task
    // on screen is being left behind anyway.
    if (pendingBucket) {
      pendingBucket = null;
      loadQueue();
      return;
    }

    if (cursor + 1 >= queue.length) loadQueue({ append: true });
    cursor = Math.min(cursor + 1, Math.max(0, queue.length - 1));
    paint();
  }

  /**
   * The moment the whole app exists for.
   *
   * It used to pass in silence: the number in the corner changed and the card
   * was replaced. A tick of haptic and the XP landing where it was earned cost
   * nothing and make clearing a task feel like it happened.
   */
  function celebrate(xp) {
    // Phones only, and never against someone who has asked for less motion.
    if (!reducedMotion()) navigator.vibrate?.(18);

    xpChip.classList.remove('is-earned');
    // Reading the layout restarts the animation rather than letting a second
    // tap inside the same second go unmarked.
    void xpChip.offsetWidth;
    xpChip.classList.add('is-earned');

    if (reducedMotion()) return;

    const pop = el('span.earned-pop', { text: `+${xp}` });
    taskActions.append(pop);
    setTimeout(() => pop.remove(), 900);
  }

  const reducedMotion = () =>
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  function pickOwnSize(next) {
    ownSize = next;
    for (const [index, button] of [...ownSizes.children].entries()) {
      button.classList.toggle('is-active', SIZES[index].id === next);
    }
  }

  function toggleOwn(open) {
    ownPanel.hidden = !open;
    ownNote.textContent = '';

    if (!open) return;

    // Defaulted to the size of wait you are actually in, which is nearly
    // always the one you mean.
    pickOwnSize(queueBucket ?? DEFAULT_SIZE);
    ownInput.focus?.();
  }

  async function saveOwnTask() {
    const title = ownInput.value.trim();
    if (!title || busy) return;

    busy = true;

    try {
      await api.addTask(title, ownSize);
      ownInput.value = '';
      toggleOwn(false);

      // Yours are offered first, so if it suits this wait it is next up.
      if (ownSize === queueBucket) loadQueue();
    } catch (error) {
      ownNote.textContent = error.message ?? 'That did not save.';
    } finally {
      busy = false;
      paint();
    }
  }

  async function banTask() {
    // The whole routine, not the step: you are turning down the thing offered.
    const current = activity();
    if (!current || busy) return;

    // Optimistic: the queue moves on either way, and a failed block is a task
    // that turns up once more rather than anything lost.
    api.blockSuggestion(current.id).catch(() => {});
    showNext({ skip: false });
  }

  async function completeTask() {
    const current = shown();
    if (!current || busy) return;

    busy = true;
    paint();

    try {
      const progress = await api.completeSuggestion(current.id, timer.waitId);
      store.set({ progress });
      onProgress?.(progress);
      // The tiles move on a cleared task too, and so do the other screens.
      refreshNumbers();
      // Only once it is actually banked - a failed request is not a win.
      celebrate(current.xp);
    } catch {
      // Nothing banked; the task stays on screen so it can be retried.
      busy = false;
      paint();
      return;
    }

    busy = false;

    // Part-way through a routine: on to the next step, not a different task.
    const item = activity();
    if (item?.steps?.length && step + 1 < item.steps.length) {
      step += 1;
      paint();
      return;
    }

    showNext({ skip: false });
  }

  /* --- The wait itself --------------------------------------------------- */

  /**
   * Re-reads the figures the screen shows and tells the other screens.
   *
   * Collapsed into one call per moment, because the same change arrives twice
   * over: once from the button that caused it, once from the server telling
   * every screen on the account - this one included.
   *
   * It used to try to tell those apart by asking whether a wait had been
   * running when the news arrived. On a turn shorter than a round trip, both
   * the start and the end landed before the first read came back, the clock
   * still said idle, and the tiles were never refreshed at all.
   */
  let numbersDue = null;

  function refreshNumbers() {
    if (numbersDue) return;

    numbersDue = setTimeout(async () => {
      numbersDue = null;
      onWaitLogged?.();

      try {
        store.set({ progress: await api.getProgress() });
      } catch {
        // Offline; the next read picks it up.
      }
    }, 250);
  }

  async function endWait() {
    stopHeartbeat();
    api.stopPresence().catch(() => {});

    try {
      // The server clears the wait and logs the session in one step, so there
      // is no moment where a wait is over but unrecorded.
      const session = await timer.end();
      if (!session) return;

      refreshNumbers();
    } catch {
      // The wait is over either way; the number just will not be banked.
    }

    paint();
  }

  async function resolveStale(keep) {
    if (busy) return;
    busy = true;
    paint();

    try {
      const session = await timer.resolveStale(keep);

      if (session) {
        stopHeartbeat();
        api.stopPresence().catch(() => {});
        onWaitLogged?.();
        store.set({ progress: await api.getProgress() });
      }
    } catch {
      // Left as it was; the next read asks again.
    } finally {
      busy = false;
      paint();
    }
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

    // The heartbeat has always come back with the whole live snapshot; it was
    // simply being dropped on the floor.
    api.heartbeat(device.cityId, activityLabel(activity()))
      .then((snapshot) => {
        others = Math.max(0, (snapshot?.realWaiting ?? 1) - 1);
        paintCompany();
      })
      .catch(() => {});
  }

  /** How many other real people are mid-wait; null until a beat comes back. */
  let others = null;

  function paintCompany() {
    const running = timer.phase === 'running';
    company.hidden = !running || others === null;
    if (company.hidden) return;

    company.textContent = others === 0
      ? 'Nobody else is waiting right now. See the map →'
      : `You and ${formatCount(others)} other${others === 1 ? '' : 's'} are waiting right now →`;
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

    /*
     * The question only exists while the wait does, and the elapsed time on
     * the clock above is the thing being disputed - so both numbers are shown.
     */
    paintCompany();

    const stale = timer.stale;
    rescue.hidden = !stale || phase === 'idle';

    if (stale) {
      const because = stale.basis === 'last-task'
        ? 'That is when you last cleared a task'
        : 'That is when this was last open';

      staleLine.textContent =
        `Nothing here for ${headlineDuration(stale.unwatchedSeconds)}, ` +
        `and the clock kept going. ${because} — ending it there logs ` +
        `${clockFace(stale.suggestedElapsedSeconds)} instead of ${clockFace(elapsed)}.`;

      rescueEnd.disabled = busy;
      rescueKeep.disabled = busy;
    }

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

    const current = shown();
    taskHeading.textContent = HEADINGS[phase];
    taskTag.textContent = current?.stepOf
      ? `${current.tag} · step ${current.stepNo} of ${current.stepOf}`
      : current?.tag ?? '—';
    taskTitle.textContent =
      current?.title ??
      (staleCatalogue ? 'The server is on an older build' : 'Finding you something to do…');
    taskSub.textContent =
      current?.sub ??
      (staleCatalogue ? 'It is serving a suggestion catalogue this app cannot read. Restart it.' : '');

    // Told once per task, so the queue can offer something else next time.
    reportShown(current?.id);
    /*
     * Nothing here is greyed out by the phase any more.
     *
     * It used to dim the task, the buttons and the hero colour whenever a wait
     * was not running - while leaving every one of them working. Clearing a
     * task with no wait going is allowed and scores; it simply belongs to no
     * wait. The heading already says which of the three states you are in, so
     * the grey was saying "you cannot" about things you can.
     */
    doneButton.textContent = current ? `Did it +${current.xp}` : 'Did it';
    doneButton.disabled = !current || busy;
    nextButton.disabled = !queue.length;

    score.textContent = formatCount(progress?.score ?? 0);
    waitsToday.textContent = String(progress?.waitsToday ?? 0);
    reclaimed.textContent = headlineDuration(progress?.reclaimedTodaySeconds ?? 0);
    hint.textContent = HINTS[phase];
  }

  /* --- Lifecycle --------------------------------------------------------- */

  // A running wait keeps ticking whichever screen is on top, so this interval
  // is tied to the app rather than to `enter`/`leave`.
  /*
   * A quarter-second tick, repainting only when the face would change.
   *
   * A one-second interval runs on its own phase, unrelated to when the wait
   * began, so the clock could sit on the old second for most of a second after
   * it had passed - together with the server rounding down, a wait an editor
   * hook had just opened read 0:00 for two seconds. Ticking faster and
   * comparing the text keeps it within a quarter second for the price of a
   * string compare.
   */
  let lastFace = '';
  let lastSync = Date.now();

  ticker = setInterval(() => {
    // The server pushes changes now, so this is only the backstop for a
    // stream that is down - and rare, since the common case is nothing new.
    const quiet = timer.phase === 'idle' ? 30_000 : 15_000;
    if (Date.now() - lastSync >= quiet) {
      lastSync = Date.now();
      timer.sync().then(paint);
    }

    if (timer.phase !== 'running') return;

    const face = clockFace(timer.elapsedSeconds);
    if (face === lastFace) return;
    lastFace = face;

    paint();

    /*
     * The suggestions should match how long the wait has actually become - a
     * two-second task is no use ten minutes in. But reloading the queue here
     * replaced it and reset the cursor, so crossing a boundary swapped out the
     * task being read mid-sentence. The new size is queued instead, and taken
     * up at the next task rather than snatched from under this one.
     */
    const bucket = bucketFor(timer.elapsedSeconds);
    if (bucket && queueBucket && bucket !== queueBucket) pendingBucket = bucket;
  }, 250);

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

    /**
     * The server says the wait changed somewhere else - another device, or an
     * editor hook - so read it again now rather than at the next poll.
     *
     * `logged` means a wait was banked, which moves the numbers as well as
     * the clock. Acted on only when this screen still thought a wait was
     * going: when it was this device that ended it, the numbers were already
     * refreshed on the way out and doing it again is just more requests.
     */
    async syncFromServer({ logged = false, numbers = false } = {}) {
      const wasIdle = timer.phase === 'idle';

      await timer.sync();
      syncPresence();

      // A wait that starts elsewhere is a new one here too: the tasks on
      // screen were sized for whatever this one was doing before.
      if (wasIdle && timer.phase === 'running') loadQueue();

      paint();

      if (logged || numbers) refreshNumbers();
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
