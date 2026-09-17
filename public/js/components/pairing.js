import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';

/**
 * Linking a second device.
 *
 * One side shows a code, the other types it in, and they become one person.
 * Both halves live here because they are the same conversation from opposite
 * ends, and the screen only cares that something changed afterwards.
 */

/** A code is short-lived; the countdown says how short. */
function remaining(expiresAt) {
  const seconds = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function createPairing({ onLinked } = {}) {
  let code = null;
  let busy = false;
  let message = null;
  let tone = 'neutral';
  let ticker = null;

  const codeSlot = el('div.pair-code-slot');
  const note = el('p.pair-note');

  const showButton = el('button.btn.btn-outline.pair-show', {
    type: 'button',
    onclick: () => showCode()
  }, ['Show a code']);

  /**
   * Types the code back the way the other device shows it.
   *
   * Upper case, and the dash inserted after four characters - without this the
   * two screens disagree about what the same code looks like, which is enough
   * to make someone think they typed it wrong.
   */
  function formatAsTyped() {
    const cleaned = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
    const formatted = cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;

    if (formatted === input.value) return;

    // Keep the caret at the end, which is where typing leaves it anyway.
    input.value = formatted;
  }

  const input = el('input.input.pair-input', {
    type: 'text',
    placeholder: 'ABCD-1234',
    maxlength: '9',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    // A numeric-ish keyboard on a phone, without losing the letters.
    inputmode: 'text',
    oninput: () => {
      formatAsTyped();
      message = null;
      paint();
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') claim();
    }
  });

  const claimButton = el('button.btn.btn-hero.pair-claim', {
    type: 'button',
    onclick: () => claim()
  }, ['Link this device']);

  const element = el('div.card.pair-card', {}, [
    el('span.label', { text: 'Use on another device' }),
    el('p.pair-lead', {
      text: 'Your waits, XP and streak live on one account. Show a code here, type it on the other device, and they become the same person.'
    }),
    showButton,
    codeSlot,
    el('div.pair-divider', {}, [el('span', { text: 'or enter a code from your other device' })]),
    el('div.pair-claim-row', {}, [input, claimButton]),
    note
  ]);

  /* --- Showing ----------------------------------------------------------- */

  async function showCode() {
    if (busy) return;
    busy = true;
    paint();

    try {
      code = await api.createPairingCode();
      message = null;
      startTicking();
    } catch {
      message = 'Could not reach the server.';
      tone = 'bad';
    } finally {
      busy = false;
      paint();
    }
  }

  async function hideCode() {
    code = null;
    stopTicking();
    paint();
    api.cancelPairingCode().catch(() => {});
  }

  function startTicking() {
    stopTicking();
    ticker = setInterval(() => {
      // The code stops working on its own; stop showing it at the same moment.
      if (code && Date.parse(code.expiresAt) <= Date.now()) {
        code = null;
        stopTicking();
      }
      paint();
    }, 1000);
  }

  function stopTicking() {
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
  }

  /* --- Claiming ---------------------------------------------------------- */

  async function claim() {
    if (busy || !input.value.trim()) return;
    busy = true;
    message = null;
    paint();

    try {
      const result = await api.claimPairingCode(input.value);
      const moved = result.moved.sessions + result.moved.completions;

      input.value = '';
      message = moved
        ? `Linked. Brought ${moved} of this device's ${moved === 1 ? 'record' : 'records'} across.`
        : 'Linked. This device now shares that account.';
      tone = 'good';

      onLinked?.(result.device);
    } catch (error) {
      message = error.message ?? 'That did not work.';
      tone = 'bad';
    } finally {
      busy = false;
      paint();
    }
  }

  /* --- Rendering --------------------------------------------------------- */

  function paint() {
    showButton.hidden = Boolean(code);
    showButton.textContent = busy && !code ? 'Just a moment…' : 'Show a code';
    showButton.disabled = busy;

    render(codeSlot, code
      ? [
          el('div.pair-code', { text: code.code }),
          el('div.pair-expiry', { text: `Expires in ${remaining(code.expiresAt)} · works once` }),
          el('button.btn.btn-outline.pair-hide', { type: 'button', onclick: () => hideCode() }, ['Hide it'])
        ]
      : []);

    claimButton.disabled = busy || !input.value.trim();

    note.textContent = message ?? '';
    note.className = `pair-note${message ? ` is-${tone}` : ''}`;
  }

  paint();

  return {
    element,
    /** Stops the countdown when the screen goes away. */
    destroy: stopTicking
  };
}
