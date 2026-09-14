import { api, onReachability } from './core/api.js';
import { createCarousel } from './core/carousel.js';
import { el, qs, qsa, render } from './core/dom.js';
import { clockFace } from './core/format.js';
import { registerServiceWorker, watchInstallPrompt } from './core/pwa.js';
import { createStore } from './core/store.js';
import { createWelcome, shouldOffer } from './components/welcome.js';
import { createViewMode } from './core/view-mode.js';
import { createBoardScreen } from './screens/board.js';
import { createLiveScreen } from './screens/live.js';
import { createStatsScreen } from './screens/stats.js';
import { createStreaksScreen } from './screens/streaks.js';
import { createWaitScreen } from './screens/wait.js';
import { createYouScreen } from './screens/you.js';

/** The six screens, in swipe order. Labels are also the dock's captions. */
const LABELS = ['Wait', 'Live', 'Stats', 'Streaks', 'Board', 'You'];

/** Hash slugs, so a home-screen shortcut can open straight onto a screen. */
const SLUGS = ['wait', 'live', 'stats', 'streaks', 'board', 'you'];

function screenFromHash() {
  const index = SLUGS.indexOf(location.hash.replace(/^#\/?/, ''));
  return index === -1 ? 0 : index;
}

async function bootstrap() {
  const store = createStore({
    device: null,
    presence: null,
    analytics: null,
    progress: null,
    leaderboard: null,
    offline: false,
    screen: SLUGS[screenFromHash()]
  });

  const track = qs('#track');
  const dock = qs('#dock');
  const railNav = qs('#railNav');
  const frame = qs('#frame');

  const stats = createStatsScreen({ store });
  const streaks = createStreaksScreen({ store });
  const board = createBoardScreen({ store });
  const live = createLiveScreen({ store });
  // Declared before `wait` so the callback can reach it once both exist.
  let wait;
  const you = createYouScreen({
    store,
    // A new status or name should reach the globe immediately.
    onSaved: () => wait?.refreshPresence()
  });

  wait = createWaitScreen({
    store,
    // Finishing a wait changes every derived screen, so refresh them in place
    // rather than waiting for the user to swipe over and trigger a fetch.
    onWaitLogged: () => {
      stats.refresh();
      board.refresh();
    },
    onProgress: () => board.refresh()
  });

  const screens = [wait, live, stats, streaks, board, you];
  render(track, screens.map((screen) => screen.element));

  // Set before the carousel starts, so it never slides a shell that cannot.
  let carousel;
  const view = createViewMode({
    mount: qs('#viewSwitch'),
    onChange: (mode) => {
      carousel?.setSliding(mode === 'phone');
      // The globe is a fixed-size canvas: the new shell gives it a new card.
      live.resize();
    }
  });

  carousel = createCarousel({
    track,
    screens,
    initialIndex: screenFromHash(),
    sliding: view.isPhone(),
    onChange: (index) => {
      for (const nav of [dock, railNav]) {
        for (const [position, tab] of [...nav.children].entries()) {
          const active = position === index;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-current', active ? 'true' : 'false');
        }
      }

      store.set({ screen: SLUGS[index] });

      // Replaced rather than pushed: swiping should not fill the back stack.
      history.replaceState(null, '', `#/${SLUGS[index]}`);
    }
  });

  // Two navigations, one carousel: the phone's dock and the desktop rail.
  render(dock, LABELS.map((label, index) =>
    el('button.dock-tab', {
      type: 'button',
      'aria-label': `Go to ${label}`,
      onclick: () => carousel.go(index)
    }, [el('span.dock-pill'), el('span.dock-label', { text: label })])
  ));

  render(railNav, LABELS.map((label, index) =>
    el('button.rail-tab', {
      type: 'button',
      'aria-label': `Go to ${label}`,
      onclick: () => carousel.go(index)
    }, [el('span.rail-pill'), el('span.rail-label', { text: label })])
  ));

  carousel.start();
  startStatusBar(store);
  startWaitFlag(store, {
    waitTabs: [dock.children[0], railNav.children[0]],
    onOpen: () => carousel.go(SLUGS.indexOf('wait'))
  });

  // Identity and reference data first - every screen reads from these.
  try {
    const { device } = await api.getMe();
    store.set({ device });

    const [analytics, progress] = await Promise.all([api.getAnalytics(), api.getProgress()]);
    store.set({ analytics, progress });
  } catch (error) {
    store.set({ offline: true });
    console.error('[the-wait] could not reach the server:', error);
  }

  wait.ready();
  setupInstallBanner(frame);
  offerLinking(frame, store, wait);
}

/**
 * A real clock and whether the server is there.
 *
 * Both shells show it - the phone in its status strip, the desktop in the foot
 * of the rail - so these are collected by class and written to together.
 */
function startStatusBar(store) {
  const dots = qsa('.js-dot');
  const words = qsa('.js-word');

  const paint = (state) => {
    const online = !state.offline;
    for (const dot of dots) dot.classList.toggle('is-offline', !online);
    // This reports the connection, not the wait - "live" next to a paused
    // timer read as though the two were the same thing.
    for (const word of words) word.textContent = online ? 'online' : 'offline';
  };

  /*
   * Painted once here as well as on change. `subscribe` only fires when the
   * value moves, and in a session where nothing ever goes wrong it never
   * moves - so the markup's placeholder would otherwise stand all session.
   */
  store.subscribe(paint, ['offline']);
  paint(store.state);

  // Every request already learns whether the server answered. Before this,
  // the flag was set once on a failed boot and never cleared again.
  onReachability((reachable) => store.set({ offline: !reachable }));
}

/**
 * The wait itself, on every screen.
 *
 * The timer is on the Wait screen and the clock is only drawn there, so the
 * other five said nothing about a wait that was still running - the only thing
 * in the status strip was the server connection, which is a different fact.
 * The Wait screen publishes its phase to the store; this draws it, in both
 * shells, and doubles as the way back.
 */
function startWaitFlag(store, { waitTabs, onOpen }) {
  const flags = qsa('.js-waitflag');
  const times = qsa('.js-waittime');

  for (const flag of flags) flag.addEventListener('click', onOpen);

  const paint = (state) => {
    const phase = state.wait?.phase ?? 'idle';
    const running = phase === 'running';

    // On the Wait screen the real clock is already on screen, several times
    // the size of this. Repeating it in the strip is just noise.
    const onWaitScreen = state.screen === 'wait';

    for (const flag of flags) {
      // Nothing to report between waits, and an empty chip is just clutter.
      flag.hidden = phase === 'idle' || onWaitScreen;
      flag.dataset.phase = phase;
      flag.setAttribute('aria-label', `${running ? 'Wait running' : 'Wait paused'} - go to the Wait screen`);
    }

    for (const time of times) time.textContent = clockFace(state.wait?.elapsedSeconds ?? 0);

    // The strip is easy to miss; the tab you would go back to is not.
    for (const tab of waitTabs) tab?.classList.toggle('is-waiting', running);
  };

  store.subscribe(paint, ['wait', 'screen']);
  paint(store.state);
}

/**
 * Asks a brand-new device whether it belongs to an account that already exists.
 *
 * Without this the second device someone opens quietly becomes a second person,
 * and they find out when their streak is missing.
 */
function offerLinking(frame, store, wait) {
  // Decided from the account, so a refresh does not ask again.
  if (!shouldOffer(store.state.device)) return;

  const welcome = createWelcome({
    onLinked: async (device) => {
      store.set({ device });

      // Everything on screen belongs to the other account now.
      const [analytics, progress] = await Promise.all([api.getAnalytics(), api.getProgress()]);
      store.set({ analytics, progress });
      wait.refreshPresence?.();
      wait.ready();
    }
  });

  frame.append(welcome.element);
}

/** A dismissible prompt to add the app to the home screen. */
function setupInstallBanner(frame) {
  watchInstallPrompt({
    onAvailable(prompt) {
      const action = prompt.manual
        ? el('span.install-hint', { text: 'Share → Add to Home Screen' })
        : el('button.btn.btn-hero.install-action', {
            type: 'button',
            onclick: async () => {
              await prompt.install();
              banner.remove();
            }
          }, ['Install']);

      const banner = el('div.install-banner', { role: 'region', 'aria-label': 'Install The Wait' }, [
        el('div.install-copy', {}, [
          el('span.install-title', { text: 'Add to home screen' }),
          el('span.install-sub', { text: 'Launches like an app, works offline' })
        ]),
        action,
        el('button.install-close', {
          type: 'button',
          'aria-label': 'Dismiss',
          onclick: () => {
            prompt.dismiss();
            banner.remove();
          }
        }, ['✕'])
      ]);

      frame.append(banner);
    }
  });
}

registerServiceWorker();
bootstrap();
