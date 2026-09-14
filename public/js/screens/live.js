import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { clockFace, formatCount, initials } from '../core/format.js';
import { createGlobe } from '../components/globe.js';
import { createPlacePicker } from '../components/place-picker.js';
import { avatar, chipRow, emptyState, placeKind, screenHead } from '../components/ui.js';
import { buildGlobeCardData, drawGlobeCard, globeCardText } from '../components/globe-card.js';
import { createShareSheet } from '../components/share-sheet.js';

/**
 * Who else is waiting, on a real globe.
 *
 * The globe is given every person and dims the ones the filter excludes, rather
 * than removing them - the point of the screen is that the world is busy, and a
 * filter should narrow attention without emptying the planet.
 *
 * Rendering is split in two: `paint` rebuilds structure when the data or the
 * filter changes, and `tickClocks` only rewrites the running times once a
 * second. Rebuilding everything on the tick would reset the jump-to dropdown
 * under the user's finger.
 */

/** How often the presence snapshot is refetched while this screen is on top. */
const POLL_MS = 10_000;

/** Rows in the ticker below the globe. */
const TICKER_ROWS = 6;

const FILTERS = [
  { id: 'all', label: 'Everywhere' },
  { id: 'city', label: 'My city' },
  { id: 'country', label: 'My country' }
];

/**
 * Where the whole-globe and whole-country views sit. "My city" has no entry
 * here on purpose: a fixed zoom cannot frame both a small town and Shanghai,
 * so the globe works that one out from the city itself.
 */
const ZOOM = { all: 1, country: 6 };

/**
 * @param modalRoot Where the share sheet is mounted - the frame, not this
 *   screen. On a phone the carousel track is six frame-widths wide and slides
 *   sideways, so an overlay parented inside it is sized to all six.
 */
export function createLiveScreen({ store, modalRoot = null }) {
  const element = el('section.screen', { 'data-screen': 'live' });

  let people = [];
  let filter = 'all';

  /*
   * Somewhere the viewer searched for. While set it overrides the chips: the
   * globe frames it and the ticker lists only who is there, which is the point
   * of looking a place up in the first place.
   */
  let focus = null;
  let selected = null;
  let fetchedAt = 0;
  let poll = null;
  let ticker = null;

  /** `{ person, node }` pairs whose text the per-second tick rewrites. */
  let clocks = [];

  const globe = createGlobe({
    onSelect: (index) => {
      if (index === null) return;
      pick(index);
    },
    // The globe asks for the cities under its own camera as it is moved.
    onNeedCities: async ({ lat, lng, radiusKm }) => {
      try {
        const { cities } = await api.citiesNear(lat, lng, { radiusKm, limit: 160 });
        globe.setCities(cities);
      } catch {
        // The globe simply keeps whatever it last drew.
      }
    }
  });

  const jumpPicker = createPlacePicker({
    placeholder: 'Jump to any city or country…',
    onPick: (place) => setFocus(place)
  });

  /* --- Structure --------------------------------------------------------- */

  const headCount = el('div.live-count', { text: 'counting…' });
  const filters = chipRow(FILTERS, filter, (id) => setFilter(id));

  const zoomHint = el('span.globe-hint', { text: 'tap a pin' });

  const globeCard = el('div.globe-card', {}, [
    globe.element,
    el('div.globe-zoom', {}, [
      el('button.globe-zoom-button', {
        type: 'button',
        'aria-label': 'Zoom in',
        onclick: () => globe.zoomBy(1.8)
      }, ['+']),
      el('button.globe-zoom-button', {
        type: 'button',
        'aria-label': 'Zoom out',
        onclick: () => globe.zoomBy(1 / 1.8)
      }, ['−'])
    ]),
    zoomHint
  ]);

  const focusPill = el('div.focus-pill', { hidden: true });
  const personCard = el('div.person-card');
  const matchCount = el('span.ticker-count', { text: '0 shown' });
  const tickerList = el('div.ticker');
  const sourceNote = el('p.note');

  /*
   * The three panes are `display: contents` on a phone, so this is still the
   * flat stack it always was, in the same order. The desktop shell turns them
   * into real boxes and puts the globe beside the filters and the ticker.
   */
  const shareSheet = createShareSheet();

  const shareButton = el('button.head-action', {
    type: 'button',
    'aria-label': 'Share the map',
    onclick: () => openShare()
  }, ['Share']);

  /**
   * The card is the globe exactly as it is on screen - whatever the reader
   * has spun it to, at whatever zoom - so the thing they share is the thing
   * they were looking at.
   */
  function openShare() {
    shareSheet.open({
      title: 'Postcard',
      filename: 'the-wait-globe.png',
      draw: drawGlobeCard,
      toText: globeCardText,
      data: buildGlobeCardData({
        globe: globe.element,
        device: store.state.device,
        presence: store.state.presence,
        place: focus?.name ?? null
      })
    });
  }

  render(element, [
    screenHead('Around the world', "Who's waiting?", {
      sub: headCount,
      aside: el('div.head-aside', {}, [
        el('span.pulse-dot', { style: { width: '12px', height: '12px' } }),
        shareButton
      ])
    }),

    el('div.pane.pane-filters', {}, [filters.element, jumpPicker.element]),

    el('div.pane.pane-globe', {}, [focusPill, globeCard, personCard]),

    el('div.pane.pane-ticker', {}, [
      el('div.ticker-head', {}, [
        el('span.label.label-wide', { text: 'Live ticker' }),
        matchCount
      ]),
      tickerList,
      sourceNote
    ])
  ]);

  // Outside the screen, and outside the sliding track with it.
  (modalRoot ?? element).append(shareSheet.element);

  /* --- Filtering --------------------------------------------------------- */

  const home = () => store.state.device?.city ?? null;

  function matches(person) {
    if (focus) {
      return focus.kind === 'country'
        ? person.country === focus.name
        : person.cityId === focus.id;
    }

    const city = home();
    if (!city || filter === 'all') return true;
    if (filter === 'city') return person.cityId === city.id;
    return person.country === city.country;
  }

  function setFilter(next) {
    focus = null;
    filter = next;
    const city = home();

    if (next === 'all' || !city) globe.flyTo({ lon: -30, lat: 18, zoom: ZOOM.all });
    else if (next === 'city') globe.flyToCity(city);
    else globe.flyTo({ lon: city.lng, lat: city.lat, zoom: ZOOM.country });

    filters.select(next);
    load();
  }

  /** Points everything at a searched-for place until the chips take over again. */
  function setFocus(place) {
    focus = place;
    selected = null;
    filters.select(null);

    if (place.kind === 'country') globe.flyToCountry(place);
    else globe.flyToCity(place);

    // Refetch, because the server seeds activity around wherever we are looking.
    load();
  }

  function pick(index) {
    const person = people[index];
    if (!person) return;

    selected = index;
    // Frame the city they are in, at whatever zoom suits its size.
    globe.flyToCity({ lng: person.lng, lat: person.lat, population: person.cityPopulation });
    paint();
  }

  /**
   * Clocks keep running between polls. The snapshot's `waitingSeconds` is a
   * measurement taken at `fetchedAt`, so display adds the time since.
   */
  function waitedNow(person) {
    return person.waitingSeconds + Math.floor((Date.now() - fetchedAt) / 1000);
  }

  /* --- Data -------------------------------------------------------------- */

  async function load() {
    try {
      const snapshot = await api.getPresence(
        focus ? (focus.kind === 'country' ? { focusCountry: focus.name } : { focusCityId: focus.id }) : {}
      );

      people = snapshot.people;
      fetchedAt = Date.now();
      store.set({ presence: snapshot });

      if (selected !== null && selected >= people.length) selected = null;
      if (selected === null) {
        const first = people.findIndex(matches);
        selected = first >= 0 ? first : null;
      }

      paint();
    } catch {
      headCount.textContent = 'could not reach the server';
    }
  }

  /* --- Rendering --------------------------------------------------------- */

  function paint() {
    const snapshot = store.state.presence;
    const matched = people.filter(matches);

    if (snapshot) {
      if (focus) {
        headCount.textContent = `${matched.length} waiting in ${focus.name}`;
      } else {
        headCount.textContent =
          filter === 'all'
            ? `${formatCount(snapshot.totalWaiting)} people are stuck with you`
            : `${matched.length} of them are near you`;
      }
    }

    focusPill.hidden = !focus;
    if (focus) {
      render(focusPill, [
        placeKind(focus.kind),
        el('span.focus-name.truncate', { text: focus.label }),
        el('button.focus-clear', {
          type: 'button',
          'aria-label': `Stop viewing ${focus.name}`,
          onclick: () => setFilter('all')
        }, ['✕'])
      ]);
    }

    globe.setPeople(
      people.map((person) => ({
        lon: person.lng,
        lat: person.lat,
        initials: initials(person.displayName),
        avatar: person.avatar,
        tint: person.tint,
        dim: !matches(person)
      }))
    );
    globe.setSelected(selected);

    clocks = [];

    const person = selected === null ? null : people[selected];

    if (person) {
      const time = el('span.person-time', { text: clockFace(waitedNow(person)) });
      clocks.push({ person, node: time });

      render(personCard, [
        avatar(person, { size: 'lg' }),
        el('div.person-body', {}, [
          el('div.person-name.truncate', {
            text: person.isYou ? `${person.displayName} · you` : person.displayName
          }),
          el('div.person-meta.truncate', {
            text: `${person.place} · ${person.doing}${person.simulated ? ' · sample' : ''}`
          })
        ]),
        time
      ]);
    } else {
      render(personCard, [
        el('div.person-body', {}, [el('div.person-meta', { text: 'Tap a pin to see who it is.' })])
      ]);
    }

    matchCount.textContent = `${matched.length} shown`;

    const shown = focus ? matched : people;
    const realPins = shown.filter((person) => !person.simulated).length;
    const youArePinned = shown.some((person) => person.isYou);

    const crowd = realPins
      ? `${realPins} of these pins ${realPins === 1 ? 'is a real person' : 'are real people'} waiting right now. ` +
        'The rest are sample pins in major cities, so a quiet hour still shows a living map.'
      : 'Every pin here is a sample placed in a major city. Real waits appear the moment anyone starts one.';

    // The commonest question about this screen is "where am I?".
    const you = youArePinned
      ? ' Your own pin is here because a wait is running.'
      : store.state.device?.visible === false
        ? ' You are hidden, so nobody sees your pin - including you.'
        : ' You appear here while a wait is running.';

    sourceNote.textContent = crowd + you;

    render(tickerList, matched.length
      ? matched.slice(0, TICKER_ROWS).map((row) => {
          const index = people.indexOf(row);
          const time = el('span.ticker-time', { text: clockFace(waitedNow(row)) });
          clocks.push({ person: row, node: time });

          return el('button.ticker-row', {
            type: 'button',
            class: index === selected ? 'is-selected' : '',
            onclick: () => pick(index)
          }, [
            avatar(row, { size: 'sm' }),
            el('span.ticker-name.truncate', {
              class: row.isYou ? 'is-you' : '',
              text: row.isYou ? `${row.displayName} · you` : row.displayName
            }),
            el('span.ticker-place', { text: row.place }),
            time
          ]);
        })
      : [emptyState('Nobody in that filter right now. Try Everywhere.')]);
  }

  function tickClocks() {
    for (const { person, node } of clocks) node.textContent = clockFace(waitedNow(person));

    // Tells you what the globe is showing you now, and what is one step away.
    zoomHint.textContent =
      globe.zoom < 1.5 ? 'pinch or scroll to zoom' : globe.zoom < 6 ? 'keep going for cities' : 'city level';
  }

  /* --- Lifecycle --------------------------------------------------------- */


  /**
   * The globe is a fixed-size canvas, so it has to be told how much room it
   * has: the whole frame width on a phone, one column of the shell on desktop.
   * A hidden screen measures zero - `enter` sizes it again when it is shown.
   */
  function resize() {
    const padding = Number.parseFloat(getComputedStyle(globeCard).paddingLeft) || 0;
    const inner = globeCard.clientWidth - padding * 2 - 6;
    if (inner <= 0) return;

    const widest = document.documentElement.dataset.view === 'desktop' ? 460 : 360;
    globe.setSize(Math.max(220, Math.min(widest, inner)));
  }

  /*
   * The card is the authority on how much room there is, so watch it rather
   * than waiting to be told. This covers the window being dragged, which
   * nothing asked about before - the globe kept the size it had on entry.
   * `setSize` ignores a value it already has, so this does not thrash.
   */
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(resize).observe(globeCard);
  }

  return {
    element,

    resize,

    enter() {
      resize();
      globe.start();
      load();

      poll ??= setInterval(load, POLL_MS);
      ticker ??= setInterval(tickClocks, 1000);
    },

    leave() {
      globe.stop();
      if (poll !== null) clearInterval(poll);
      if (ticker !== null) clearInterval(ticker);
      poll = null;
      ticker = null;
    }
  };
}
