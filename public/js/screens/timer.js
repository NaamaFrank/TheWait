import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { clockFace, formatCount, humanDuration } from '../core/format.js';
import { categoryIcon, icon } from '../components/icons.js';
import { emptyState, statusLine } from '../components/ui.js';

/**
 * The Wait Timer screen - one tap starts, one tap stops and logs.
 *
 * While a wait is running the screen does two things on an interval: it
 * heartbeats presence so the globe knows someone here is waiting, and it
 * refreshes suggestions as the wait crosses into a longer duration bucket.
 */

const TICK_MS = 250;
const HEARTBEAT_MS = 30_000;
const SUGGESTION_COUNT = 3;

/** Elapsed seconds at which the suggestion bucket changes. */
const BUCKET_BOUNDARIES = [60, 300, 900];

export function createTimerScreen({ store, onFinished, onOpenGlobe }) {
  const timerFace = el('span.timer-face', { text: clockFace(0) });
  const timerCaption = el('span.timer-caption', { text: 'Tap to start waiting' });

  const timerButton = el('button.timer-button', {
    type: 'button',
    'aria-label': 'Start wait timer'
  }, [
    el('span.timer-ring'),
    el('span.timer-inner', {}, [timerFace, timerCaption])
  ]);

  const primaryAction = el('button.button.button-primary', { type: 'button' }, [
    icon('play', { size: 18 }),
    el('span.button-label', { text: 'Start Wait' })
  ]);

  const globeAction = el('button.button.button-ghost', {
    type: 'button',
    onclick: () => onOpenGlobe?.()
  }, [icon('globe', { size: 18 }), el('span.button-label', { text: 'Global Activity' })]);

  const labelInput = el('input.label-input', {
    type: 'text',
    maxlength: '80',
    placeholder: 'What are you waiting on?',
    'aria-label': 'Label for this wait'
  });

  const suggestionList = el('div.suggestion-list');
  const suggestionBucket = el('span.suggestion-bucket', { text: '' });
  const shuffleButton = el('button.icon-button', {
    type: 'button',
    'aria-label': 'Show different suggestions',
    onclick: () => loadSuggestions({ reshuffle: true })
  }, [icon('shuffle', { size: 16 })]);

  const livePill = el('span.live-pill', {}, [
    el('span.live-dot'),
    el('span.live-count', { text: '—' }),
    el('span.live-label', { text: 'waiting now' })
  ]);

  const status = statusLine();

  const element = el('section.screen.screen-timer', { hidden: true }, [
    el('header.screen-head', {}, [
      el('div', {}, [
        el('p.eyebrow', { text: 'Things to do while Claude is running' }),
        el('h1', { text: 'The Wait' })
      ]),
      livePill
    ]),

    el('div.timer-stage', {}, [timerButton]),

    el('div.timer-actions', {}, [primaryAction, globeAction]),
    labelInput,
    status.node,

    el('section.card.suggestions-card', {}, [
      el('div.panel-head', {}, [
        el('div', {}, [
          el('span.panel-kicker', { text: 'While you wait' }),
          el('h2', { text: 'Something to do' })
        ]),
        el('div.panel-head-actions', {}, [suggestionBucket, shuffleButton])
      ]),
      suggestionList
    ])
  ]);

  // --- timer state -------------------------------------------------------

  let running = false;
  let startedAt = null;
  let elapsedSeconds = 0;
  let lastBucketIndex = -1;
  let tickHandle = null;
  let heartbeatHandle = null;
  let shownSuggestionIds = [];
  let busy = false;

  function bucketIndexFor(seconds) {
    return BUCKET_BOUNDARIES.filter((boundary) => seconds >= boundary).length;
  }

  function setRunningUi(isRunning) {
    element.classList.toggle('is-running', isRunning);
    timerButton.classList.toggle('is-running', isRunning);
    timerButton.setAttribute('aria-label', isRunning ? 'Stop wait timer and log it' : 'Start wait timer');
    timerCaption.textContent = isRunning ? 'Waiting for Claude…' : 'Tap to start waiting';

    render(primaryAction, [
      icon(isRunning ? 'stop' : 'play', { size: 18 }),
      el('span.button-label', { text: isRunning ? 'Stop & Log' : 'Start Wait' })
    ]);
  }

  function tick() {
    elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    timerFace.textContent = clockFace(elapsedSeconds);

    const bucketIndex = bucketIndexFor(elapsedSeconds);
    if (bucketIndex !== lastBucketIndex) {
      lastBucketIndex = bucketIndex;
      loadSuggestions();
    }
  }

  async function sendHeartbeat() {
    try {
      const snapshot = await api.heartbeat(store.state.device?.regionId);
      store.set({ presence: snapshot });
    } catch {
      // Presence is best-effort; a failed beat must never interrupt the timer.
    }
  }

  function start() {
    if (running) return;

    running = true;
    startedAt = Date.now();
    elapsedSeconds = 0;
    lastBucketIndex = -1;
    shownSuggestionIds = [];

    setRunningUi(true);
    status.set('');
    tick();

    tickHandle = setInterval(tick, TICK_MS);
    heartbeatHandle = setInterval(sendHeartbeat, HEARTBEAT_MS);
    sendHeartbeat();
  }

  async function stop() {
    if (!running || busy) return;

    clearInterval(tickHandle);
    clearInterval(heartbeatHandle);
    tickHandle = heartbeatHandle = null;

    const durationSeconds = Math.max(1, elapsedSeconds);
    running = false;
    busy = true;
    setRunningUi(false);

    try {
      const { session } = await api.createSession({
        durationSeconds,
        startedAt: new Date(startedAt).toISOString(),
        label: labelInput.value.trim() || undefined,
        regionId: store.state.device?.regionId
      });

      status.set(`Logged ${humanDuration(session.durationSeconds)}`, 'positive');
      labelInput.value = '';
      onFinished?.(session);
    } catch (error) {
      status.set(`Could not save that wait: ${error.message}`, 'negative');
    } finally {
      busy = false;
      startedAt = null;
      refreshPresence();
    }
  }

  function toggle() {
    if (running) stop();
    else start();
  }

  // --- suggestions -------------------------------------------------------

  async function loadSuggestions({ reshuffle = false } = {}) {
    try {
      const result = await api.getSuggestions({
        seconds: elapsedSeconds,
        count: SUGGESTION_COUNT,
        // A stable seed per bucket keeps the list still while you read it;
        // the shuffle button deliberately breaks that.
        seed: reshuffle ? Date.now() : `${lastBucketIndex}-${startedAt ?? 'idle'}`,
        exclude: reshuffle ? shownSuggestionIds : []
      });

      shownSuggestionIds = result.items.map((item) => item.id);
      suggestionBucket.textContent = result.bucket.label;

      render(
        suggestionList,
        result.items.length
          ? result.items.map((item) =>
              el('article.suggestion', { dataset: { accent: item.accent } }, [
                el('span.suggestion-mark', {}, [categoryIcon(item.iconName, { size: 16 })]),
                el('div.suggestion-body', {}, [
                  el('p.suggestion-text', { text: item.text }),
                  el('span.suggestion-tag', { text: item.categoryLabel })
                ])
              ])
            )
          : emptyState('Nothing to suggest right now.')
      );
    } catch {
      render(suggestionList, emptyState('Suggestions are offline.', 'The timer still works.'));
    }
  }

  async function refreshPresence() {
    try {
      const snapshot = await api.getPresence();
      store.set({ presence: snapshot });
    } catch {
      // Leave the last known count on screen.
    }
  }

  store.subscribe((state) => {
    const total = state.presence?.totalWaiting;
    livePill.querySelector('.live-count').textContent = total === undefined ? '—' : formatCount(total);
  }, ['presence']);

  timerButton.addEventListener('click', toggle);
  primaryAction.addEventListener('click', toggle);

  // Spacebar is the natural shortcut on a desktop browser.
  function onKeydown(event) {
    if (event.code !== 'Space' || element.hidden) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;

    event.preventDefault();
    toggle();
  }

  addEventListener('keydown', onKeydown);

  // A running wait must survive a backgrounded tab: recompute from wall clock.
  addEventListener('visibilitychange', () => {
    if (!document.hidden && running) tick();
  });

  return {
    element,
    enter() {
      loadSuggestions();
      refreshPresence();
    },
    leave() {
      // The timer keeps running across screens by design - only stop polling
      // that the other screens will do for themselves.
    },
    get isRunning() {
      return running;
    }
  };
}
