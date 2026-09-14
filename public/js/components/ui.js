import { el } from '../core/dom.js';
import { initials } from '../core/format.js';

/** Presentational pieces shared by more than one screen. */

/** The kicker + title pair every screen except Wait opens with. */
/**
 * The band every screen opens with: a kicker, a title, and whatever that
 * screen keeps up there beside it.
 *
 * `aside` is the thing on the right - the XP chip, the live dot. `sub` sits
 * under the title. Both are optional, and screens that want neither read
 * exactly as they did before.
 */
export function screenHead(kicker, title, { aside = null, sub = null } = {}) {
  return el('div.screen-head', {}, [
    el('div.screen-head-text', {}, [
      kicker ? el('div.kicker', { text: kicker }) : null,
      el('h1.title', { text: title }),
      sub
    ]),
    aside
  ]);
}

/**
 * A round avatar: the character someone chose, on their pin colour.
 *
 * Characters rather than photographs - nothing is uploaded, so there is no face
 * on the server and nothing to moderate. Initials are the fallback for anyone
 * from before there were avatars.
 */
export function avatar(person, { size = 'md' } = {}) {
  const node = el(`span.avatar.avatar-${size}`, {
    style: { background: person.tint ?? 'var(--tint-1)' }
  });

  if (person.avatar) node.append(el('span.avatar-face', { text: person.avatar }));
  else node.textContent = initials(person.displayName);

  return node;
}

/**
 * What kind of place something is.
 *
 * Shown on every result and on the focused place alike - Singapore, Mexico and
 * Luxembourg are each both a city and a country, so the row has to say which
 * one it is. Countries carry the louder badge because they are the rarer answer.
 */
export function placeKind(kind) {
  return el(`span.place-kind.is-${kind === 'country' ? 'country' : 'city'}`, {
    text: kind === 'country' ? 'country' : 'city'
  });
}

export function labelled(text, { wide = false } = {}) {
  return el(`span.label${wide ? '.label-wide' : ''}`, { text });
}

export function emptyState(message) {
  return el('p.empty', { text: message });
}

/**
 * A row of mutually exclusive pills.
 *
 * `options` are `{ id, label }`; `onPick` receives the chosen id. Returns the
 * row plus a `select` that moves the highlight, because re-rendering the row to
 * change which pill is lit would destroy the button under the user's finger and
 * drop keyboard focus.
 */
export function chipRow(options, active, onPick) {
  const buttons = options.map((option) =>
    el('button.chip', {
      type: 'button',
      onclick: () => onPick(option.id)
    }, [option.label])
  );

  const element = el('div.chip-row', { role: 'group' }, buttons);

  /** `null` clears every pill, for when something else is driving the view. */
  function select(id) {
    for (const [index, button] of buttons.entries()) {
      const on = id !== null && options[index].id === id;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  select(active);
  return { element, select };
}

/** A `<select>` that renders its own options from `{ value, label }` pairs. */
export function select(options, value, onChange, { className = 'select-bare', ariaLabel } = {}) {
  const node = el(`select.${className}`, {
    'aria-label': ariaLabel,
    onchange: (event) => onChange(event.target.value)
  }, options.map((option) =>
    el('option', { value: option.value, selected: option.value === value }, [option.label])
  ));

  node.value = value ?? '';
  return node;
}
