import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';

/**
 * First run.
 *
 * A device that has never been used has no way of knowing it could belong to an
 * account that already exists - so it silently became a second person, and the
 * first anyone noticed was their streak missing on the other screen. This asks
 * once, before that can happen.
 *
 * Whether to ask is the server's answer, not this device's: a refresh clears
 * nothing on the server, and an account that has been named, used or already
 * paired is plainly not new. Local storage only records that the question was
 * asked, so nobody is asked twice on the same device.
 */

const SEEN_KEY = 'thewait.welcomed';

export function hasBeenWelcomed() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Without storage there is no way to remember; better to ask than to guess.
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Nothing to do - the worst case is being asked again next visit.
  }
}

/**
 * Whether to offer linking.
 *
 * `isNew` comes from the account: no history, no second device, and a name it
 * never changed. A device that has already been answered is left alone.
 */
export function shouldOffer(device) {
  return Boolean(device?.isNew) && !hasBeenWelcomed();
}

export function createWelcome({ onLinked, onDismissed } = {}) {
  let busy = false;

  const element = el('div.welcome', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome' });

  /*
   * Built once and kept. Re-rendering on every keystroke pulled the field out
   * of the document and put it back, which drops focus - and on a phone that
   * closes the keyboard after every character typed.
   */
  const input = el('input.input.welcome-input', {
    type: 'text',
    placeholder: 'ABCD-1234',
    maxlength: '9',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    oninput: () => {
      const cleaned = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
      const formatted = cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
      if (formatted !== input.value) input.value = formatted;

      note.textContent = '';
      refresh();
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') link();
    }
  });

  const note = el('p.welcome-note');

  const linkButton = el('button.btn.btn-wide.welcome-primary', {
    type: 'button',
    onclick: () => link()
  }, ['Link this device']);

  const chooseStep = el('div.welcome-card', {}, [
    el('div.welcome-kicker', { text: 'Welcome' }),
    el('h2.welcome-title', { text: 'Is this your first device?' }),
    el('p.welcome-lead', {
      text:
        'Your waits, XP and streak live on one account. If you already use ' +
        'The Wait somewhere else, link this device now so they stay together.'
    }),
    el('button.btn.btn-wide.welcome-primary', {
      type: 'button',
      onclick: () => show('link')
    }, ['I already use it elsewhere']),
    el('button.btn.btn-outline.welcome-secondary', {
      type: 'button',
      onclick: close
    }, ['Start fresh here'])
  ]);

  const linkStep = el('div.welcome-card', {}, [
    el('div.welcome-kicker', { text: 'Link this device' }),
    el('h2.welcome-title', { text: 'Enter the code' }),
    el('ol.welcome-steps', {}, [
      el('li', { text: 'Open The Wait on your other device.' }),
      el('li', { text: 'Go to the You screen and tap "Show a code".' }),
      el('li', { text: 'Type those eight characters here.' })
    ]),
    input,
    note,
    linkButton,
    el('button.btn.btn-outline.welcome-secondary', {
      type: 'button',
      onclick: () => {
        note.textContent = '';
        show('choose');
      }
    }, ['Back'])
  ]);

  function show(step) {
    render(element, [step === 'choose' ? chooseStep : linkStep]);
    refresh();
    if (step === 'link') input.focus?.();
  }

  /** Only the parts that change - never the field being typed into. */
  function refresh() {
    linkButton.disabled = busy || !input.value.trim();
    linkButton.textContent = busy ? 'Linking…' : 'Link this device';
    note.className = `welcome-note${note.textContent ? ' is-bad' : ''}`;
  }

  function close() {
    remember();
    element.remove();
    onDismissed?.();
  }

  async function link() {
    if (busy || !input.value.trim()) return;
    busy = true;
    note.textContent = '';
    refresh();

    try {
      const result = await api.claimPairingCode(input.value);
      remember();
      element.remove();
      onLinked?.(result.device);
    } catch (error) {
      note.textContent = error.message ?? 'That did not work.';
      busy = false;
      refresh();
    }
  }

  show('choose');
  return { element };
}
