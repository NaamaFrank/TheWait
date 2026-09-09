import { qsa } from './dom.js';

/**
 * Hash-based screen router for the tab bar. Each screen may expose `enter` and
 * `leave` hooks so it can start and stop its own polling and animation work -
 * nothing off-screen keeps running.
 */
export function createRouter({ screens, defaultRoute, onChange }) {
  let current = null;

  function routeFromHash() {
    const name = location.hash.replace(/^#\/?/, '');
    return screens[name] ? name : defaultRoute;
  }

  function activate(name) {
    if (name === current) return;

    screens[current]?.leave?.();
    current = name;

    for (const [key, screen] of Object.entries(screens)) {
      screen.element.hidden = key !== name;
    }

    for (const tab of qsa('[data-route]')) {
      const active = tab.dataset.route === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    }

    screens[name].enter?.();
    onChange?.(name);
  }

  return {
    start() {
      addEventListener('hashchange', () => activate(routeFromHash()));
      activate(routeFromHash());
    },
    go(name) {
      location.hash = `#/${name}`;
    },
    get current() {
      return current;
    }
  };
}
