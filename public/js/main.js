import { api } from './core/api.js';
import { el, qs, render } from './core/dom.js';
import { shortDeviceId } from './core/identity.js';
import { createRouter } from './core/router.js';
import { createStore } from './core/store.js';
import { icon } from './components/icons.js';
import { createAnalyticsScreen } from './screens/analytics.js';
import { createGlobeScreen } from './screens/globe.js';
import { createTimerScreen } from './screens/timer.js';

const TABS = [
  { route: 'timer', label: 'Timer', iconName: 'timer' },
  { route: 'insights', label: 'Insights', iconName: 'bars' },
  { route: 'globe', label: 'Globe', iconName: 'globe' }
];

function buildTabBar(onNavigate) {
  return el('nav.tab-bar', { 'aria-label': 'Main navigation' },
    TABS.map((tab) =>
      el('button.tab', {
        type: 'button',
        dataset: { route: tab.route },
        onclick: () => onNavigate(tab.route)
      }, [icon(tab.iconName, { size: 22 }), el('span.tab-label', { text: tab.label })])
    )
  );
}

async function bootstrap() {
  const store = createStore({ device: null, regions: [], presence: null, analytics: null });

  const screensRoot = qs('#screens');
  const shell = qs('#shell');

  const analytics = createAnalyticsScreen({ store });
  const globe = createGlobeScreen({ store });
  const timer = createTimerScreen({
    store,
    // Logging a wait invalidates the insights screen; refresh it in place so
    // switching tabs shows fresh numbers immediately.
    onFinished: () => analytics.refresh(),
    onOpenGlobe: () => router.go('globe')
  });

  render(screensRoot, [timer.element, analytics.element, globe.element]);

  const router = createRouter({
    screens: { timer, insights: analytics, globe },
    defaultRoute: 'timer'
  });

  shell.append(buildTabBar((route) => router.go(route)));

  // Identity and reference data first - every screen reads from these.
  try {
    const [{ device }, { regions }] = await Promise.all([api.getMe(), api.getRegions()]);
    store.set({ device, regions });
    qs('#deviceTag').textContent = `anon-${shortDeviceId(device.deviceId)}`;
  } catch (error) {
    qs('#deviceTag').textContent = 'offline';
    console.error('[the-wait] could not reach the server:', error);
  }

  router.start();
}

bootstrap();
