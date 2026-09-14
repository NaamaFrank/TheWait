/**
 * Desktop shell vs. phone mockup.
 *
 * The app was drawn as a phone, and on a phone that is what it should be. On a
 * wide screen a 390px column marooned in the middle is not a desktop app, so
 * the same screens are re-laid out into a sidebar + multi-column shell. The
 * mode is one attribute on <html>; every layout difference is CSS keyed off it.
 *
 * The switch stays available on desktop so the phone build can be checked
 * without a second device - which matters most before the thing is deployed
 * anywhere a phone could reach it.
 */

import { el, render } from './dom.js';

const STORAGE_KEY = 'thewait.view';

/** Where the desktop shell earns its keep: a real pointer and room to use it. */
const DESKTOP_QUERY = '(min-width: 1024px) and (pointer: fine)';

const MODES = ['desktop', 'phone'];

export function defaultMode() {
  return matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'phone';
}

function stored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

function remember(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // A saved preference is a nicety; the session still honours the choice.
  }
}

/**
 * Applies a mode and returns it. Exported so the inline boot snippet in
 * index.html and this module can never disagree about the attribute name.
 */
export function applyMode(mode) {
  document.documentElement.dataset.view = mode;
  return mode;
}

/**
 * Owns the mode and renders the switch into `mount`.
 *
 * `onChange` runs after the attribute flips, on the next frame, so anything
 * that has to measure the new layout (the globe) reads settled boxes.
 */
export function createViewMode({ mount, onChange } = {}) {
  let mode = applyMode(stored() ?? defaultMode());

  const buttons = MODES.map((id) =>
    el('button.view-switch-button', {
      type: 'button',
      'aria-pressed': String(id === mode),
      onclick: () => set(id)
    }, [id === 'desktop' ? 'Desktop' : 'Phone'])
  );

  function paint() {
    for (const [index, button] of buttons.entries()) {
      const on = MODES[index] === mode;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function set(next) {
    if (next === mode || !MODES.includes(next)) return;

    mode = applyMode(next);
    remember(mode);
    paint();
    requestAnimationFrame(() => onChange?.(mode));
  }

  if (mount) {
    render(mount, [el('span.view-switch-label', { text: 'View' }), ...buttons]);
    mount.hidden = false;
  }

  paint();

  return {
    get mode() {
      return mode;
    },
    set,
    isPhone: () => mode === 'phone'
  };
}
