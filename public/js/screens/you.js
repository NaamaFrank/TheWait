import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { initials } from '../core/format.js';
import { createPairing } from '../components/pairing.js';
import { createPlacePicker } from '../components/place-picker.js';
import { screenHead } from '../components/ui.js';
import { createOwnTasks } from '../components/own-tasks.js';
import { createAgents } from '../components/agents.js';

/**
 * The profile card.
 *
 * Edits are held locally and only sent when "Save my card" is pressed, so a
 * half-typed name never reaches the globe.
 */

/** The eight pin colours, matching the server's accepted set. */
const TINTS = [
  '#FFC53D', '#9BE8FF', '#FF9E7A', '#3DDC84',
  '#00E5D0', '#FFB3E1', '#D6D0FF', '#E8E2D4'
];

const SAVED_MS = 1800;

export function createYouScreen({ store, onSaved }) {
  const element = el('section.screen', { 'data-screen': 'you' });

  /** Pending edits, flushed to the server on save. */
  let draft = null;
  let savedTimer = null;

  /* --- Structure --------------------------------------------------------- */

  /** The characters on offer. Kept in step with the server's list. */
  const AVATARS = [
    '🐻', '🦊', '🐼', '🐨', '🐸', '🐙', '🦉', '🐧',
    '🦄', '🐝', '🐢', '🦋', '🐳', '🌵', '🍄', '⭐'
  ];

  const avatarPreview = el('span.avatar-ring-face');
  const avatarRing = el('div.avatar-ring', {}, [avatarPreview]);
  const avatarPicker = el('div.avatar-picker');

  const nameInput = el('input.input', {
    type: 'text',
    placeholder: 'What should people call you?',
    maxlength: '40',
    oninput: (event) => edit({ displayName: event.target.value })
  });

  const statusInput = el('input.input', {
    type: 'text',
    placeholder: 'refilling water',
    maxlength: '40',
    oninput: (event) => edit({ status: event.target.value })
  });

  const cityPicker = createPlacePicker({
    placeholder: 'Search 31,000 cities…',
    // A country is not a home town.
    kinds: ['city'],
    onPick: (city) => edit({ cityId: city.id, locationMode: 'manual' })
  });

  const locateButton = el('button.btn.btn-outline.locate-button', {
    type: 'button',
    onclick: () => locate()
  }, ['Use my location']);

  const cityField = el('label.field', {}, [
    el('span.label', { text: 'Home city' }),
    cityPicker.element,
    locateButton
  ]);

  const swatches = el('div.swatches');

  const toggleNote = el('span.toggle-note', { text: '' });
  const toggleSwitch = el('span.switch', {}, [el('span.switch-knob')]);
  const visibilityRow = el('button.toggle-row', {
    type: 'button',
    'aria-pressed': 'true',
    onclick: () => edit({ visible: !current().visible })
  }, [
    el('span.toggle-copy', {}, [
      el('span.toggle-title', { text: 'Show me on the globe' }),
      toggleNote
    ]),
    toggleSwitch
  ]);

  const pairing = createPairing({
    // Linking replaces the whole profile, so take the one the server returns.
    onLinked: (device) => {
      draft = null;
      store.set({ device });
      paint();
    }
  });

  const saveButton = el('button.btn.btn-wide', {
    type: 'button',
    onclick: () => save()
  }, ['Save my card']);

  /*
   * Two panes, split where the subject changes: who you are, then how the card
   * looks and what this device is. `display: contents` on a phone, so that is
   * still the one flat stack it always was, in exactly this order.
   */
  const ownTasks = createOwnTasks();
  const agents = createAgents();

  render(element, [
    screenHead('Your pin', 'Set up your card'),

    el('div.pane.pane-identity', {}, [
      el('div.card.photo-card', {}, [
        avatarRing,
        el('div.photo-copy', {}, [
          el('span.photo-title', { text: 'Your avatar' }),
          el('span.photo-note', { text: 'Shown on the globe, the ticker and the board.' })
        ]),
        avatarPicker
      ]),

      el('div.fields', {}, [
        el('label.field', {}, [el('span.label', { text: 'Display name' }), nameInput]),
        el('label.field', {}, [
          el('span.label', { text: 'Status' }),
          statusInput,
          el('span.field-hint', { text: 'Shown under your name while you are waiting.' })
        ]),
        cityField
      ])
    ]),

    el('div.pane.pane-card-setup', {}, [
      el('div.card', {}, [el('span.label', { text: 'Pin color' }), swatches]),
      visibilityRow,
      saveButton,
      ownTasks.element,
      agents.element,
      pairing.element
    ])
  ]);

  /* --- State ------------------------------------------------------------- */

  /** The device as it would be after the pending edits. */
  function current() {
    return { ...(store.state.device ?? {}), ...(draft ?? {}) };
  }

  function edit(patch) {
    draft = { ...(draft ?? {}), ...patch };
    paint();
  }

  async function save() {
    if (!draft) return;

    try {
      const { device } = await api.updateMe(draft);
      draft = null;
      store.set({ device });
      onSaved?.(device);

      saveButton.textContent = "Saved — you're on the globe";
      saveButton.classList.add('is-done');

      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => {
        saveButton.textContent = 'Save my card';
        saveButton.classList.remove('is-done');
      }, SAVED_MS);
    } catch {
      saveButton.textContent = 'Could not save — try again';
    }

    paint();
  }

  /* --- Painting ---------------------------------------------------------- */

  function paintAvatar() {
    const device = current();
    const chosen = device.avatar ?? AVATARS[0];

    avatarPreview.textContent = chosen;
    avatarRing.style.borderColor = device.tint ?? TINTS[0];
    avatarRing.style.background = device.tint ?? TINTS[0];

    render(avatarPicker, AVATARS.map((face) =>
      el('button.avatar-option', {
        type: 'button',
        class: face === chosen ? 'is-active' : '',
        'aria-label': `Use ${face}`,
        'aria-pressed': face === chosen ? 'true' : 'false',
        onclick: () => edit({ avatar: face })
      }, [face])
    ));
  }

  /** Snaps the profile to wherever the browser says the device is. */
  async function locate() {
    if (!navigator.geolocation) {
      locateButton.textContent = 'Location is unavailable';
      return;
    }

    locateButton.textContent = 'Finding you…';

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { device, city } = await api.locate(coords.latitude, coords.longitude);
          draft = null;
          store.set({ device });
          cityPicker.setValue(city);
          locateButton.textContent = 'Use my location';
          paint();
        } catch {
          locateButton.textContent = 'Could not look that up';
        }
      },
      () => {
        locateButton.textContent = 'Location was declined';
      },
      { timeout: 10_000 }
    );
  }

  function paint() {
    const device = current();
    // Nothing to draw until the account has arrived from the server.
    if (!device.accountId) return;

    // Only write inputs the user is not currently typing into.
    if (document.activeElement !== nameInput) nameInput.value = device.displayName ?? '';
    if (document.activeElement !== statusInput) statusInput.value = device.status ?? '';
    if (device.city) cityPicker.setValue(device.city);

    render(swatches, TINTS.map((tint) =>
      el('button.swatch', {
        type: 'button',
        class: tint === device.tint ? 'is-active' : '',
        style: { background: tint },
        'aria-label': `Pin colour ${tint}`,
        'aria-pressed': tint === device.tint ? 'true' : 'false',
        onclick: () => edit({ tint })
      })
    ));

    const visible = device.visible !== false;
    toggleSwitch.classList.toggle('is-on', visible);
    visibilityRow.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggleNote.textContent = visible
      ? 'Others can see your pin and city'
      : "You'll wait anonymously";

    saveButton.disabled = !draft;
    paintAvatar();
  }

  store.subscribe(paint, ['device']);

  return {
    element,

    enter() {
      paint();
      // Another device may have added one since this screen was last looked at.
      ownTasks.refresh();
      agents.refresh();
    },

    /** Your own tasks or connections changed on another device. */
    refreshTasks() {
      ownTasks.refresh();
      agents.refresh();
    },

    destroy: () => pairing.destroy()
  };
}
