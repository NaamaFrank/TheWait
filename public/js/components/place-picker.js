import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { placeKind } from './ui.js';

/**
 * Type-ahead search over places - cities, and optionally whole countries.
 *
 * The catalogues are 31,000 cities and 244 countries and live on the server, so
 * this asks for matches as you type rather than filtering a list it downloaded.
 * Results are rendered in the normal flow rather than floating above the page:
 * the screens are scroll containers, and an absolutely positioned menu would be
 * clipped by the first one it grew past.
 *
 * `kinds` narrows what can come back - the profile screen asks for cities only,
 * because a country is not a home town.
 */

/** Wait this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 180;

const MAX_RESULTS = 8;

export function createPlacePicker({ value = null, placeholder = 'Search for a place', kinds, onPick } = {}) {
  let selected = value;
  let results = [];
  let open = false;
  let active = -1;
  let timer = null;
  let sequence = 0;

  /** Queries already answered, so backspacing never refetches. */
  const cache = new Map();

  const input = el('input.input.picker-input', {
    type: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    oninput: () => schedule(input.value),
    onfocus: () => {
      // Show the whole name, ready to be replaced by a new search.
      input.select();
      schedule(input.value);
    },
    onblur: () => {
      // Late enough for a click on a result to land first.
      setTimeout(() => {
        if (!open) return;
        close();
        paint();
      }, 140);
    },
    onkeydown: onKeyDown
  });

  const list = el('div.picker-results', { role: 'listbox' });
  const element = el('div.picker', {}, [input, list]);

  /* --- Searching --------------------------------------------------------- */

  function schedule(query) {
    clearTimeout(timer);
    timer = setTimeout(() => search(query), DEBOUNCE_MS);
  }

  async function search(query) {
    const key = query.trim().toLowerCase();
    const ticket = ++sequence;

    if (cache.has(key)) {
      show(cache.get(key), ticket);
      return;
    }

    try {
      const { places } = await api.searchPlaces(key, { limit: MAX_RESULTS, kinds });
      cache.set(key, places);
      show(places, ticket);
    } catch {
      // Offline: leave whatever is on screen rather than blanking it.
    }
  }

  /** Ignores anything but the most recent query, so results cannot arrive out of order. */
  function show(places, ticket) {
    if (ticket !== sequence) return;

    results = places;
    open = places.length > 0;
    active = -1;
    paint();
  }

  function close() {
    open = false;
    active = -1;
    results = [];
  }

  function choose(place) {
    selected = place;
    input.value = place.label;
    close();
    paint();
    onPick?.(place);
  }

  /* --- Keyboard ---------------------------------------------------------- */

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      close();
      paint();
      input.blur();
      return;
    }

    if (!open || !results.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % results.length;
      paint();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active >= 0 ? active : 0]);
    }
  }

  /* --- Rendering --------------------------------------------------------- */

  function paint() {
    input.setAttribute('aria-expanded', open ? 'true' : 'false');

    render(list, open
      ? results.map((place, index) =>
          el('button.picker-result', {
            type: 'button',
            role: 'option',
            class: index === active ? 'is-active' : '',
            'aria-selected': index === active ? 'true' : 'false',
            // `mousedown` beats the input's blur; `click` would come too late.
            onmousedown: (event) => {
              event.preventDefault();
              choose(place);
            }
          }, [
            el('span.picker-row', {}, [
              el('span.picker-name', { text: place.name }),
              placeKind(place.kind)
            ]),
            el('span.picker-where', { text: whereOf(place) })
          ])
        )
      : []);
  }

  /** The line under the name: what a country contains, or where a city is. */
  function whereOf(place) {
    if (place.kind === 'country') {
      return `${place.cityCount.toLocaleString()} cities · ${place.population.toLocaleString()} people`;
    }

    return place.region && place.region !== place.name
      ? `${place.region} · ${place.country}`
      : place.country;
  }

  if (selected) input.value = selected.label;

  return {
    element,

    /** Sets the shown place without firing `onPick`. */
    setValue(place) {
      selected = place;
      if (place && document.activeElement !== input) input.value = place.label;
    },

    get value() {
      return selected;
    }
  };
}
