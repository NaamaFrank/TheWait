import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { formatCount } from '../core/format.js';
import { createGlobe } from '../components/globe.js';
import { icon } from '../components/icons.js';
import { emptyState, statusLine } from '../components/ui.js';

/**
 * Interactive Global Developer Map.
 *
 * Polling only runs while the screen is visible, and the canvas render loop is
 * started and stopped alongside it, so the globe costs nothing in the
 * background.
 */

const POLL_MS = 8000;
const VIEWS = [
  { id: 'global', label: 'Global View' },
  { id: 'local', label: 'Local Country' }
];

export function createGlobeScreen({ store }) {
  const canvas = el('canvas.globe-canvas', { 'aria-label': 'Interactive globe of developers waiting' });
  const totalCount = el('span.globe-count', { text: '—' });
  const regionList = el('div.region-list');
  const detailPanel = el('div.region-detail', { hidden: true });
  const status = statusLine();

  let view = 'global';
  let pollHandle = null;
  let selectedRegionId = null;

  const viewToggle = el('div.segmented', { role: 'group', 'aria-label': 'Map view' },
    VIEWS.map((option) =>
      el('button.segmented-option', {
        type: 'button',
        class: option.id === view ? 'is-active' : '',
        dataset: { view: option.id },
        onclick: () => setView(option.id)
      }, [option.label])
    )
  );

  const locateButton = el('button.button.button-ghost', {
    type: 'button',
    onclick: useDeviceLocation
  }, [icon('location', { size: 16 }), el('span.button-label', { text: 'Use my location' })]);

  const regionSelect = el('select.region-select', {
    'aria-label': 'Choose your region',
    onchange: (event) => chooseRegion(event.target.value)
  });

  const element = el('section.screen.screen-globe', { hidden: true }, [
    el('header.screen-head', {}, [
      el('div', {}, [
        el('p.eyebrow', { text: 'Live network' }),
        el('h1', { text: 'Who else is waiting' })
      ]),
      viewToggle
    ]),

    el('div.globe-stage', {}, [
      canvas,
      el('div.globe-overlay', {}, [
        el('div.globe-card', {}, [
          el('span.live-dot.large'),
          el('div.globe-card-body', {}, [
            el('span.globe-card-value', {}, [totalCount, ' Developers Waiting']),
            el('span.globe-card-label', { text: 'Right now' })
          ])
        ])
      ])
    ]),

    detailPanel,

    el('section.card', {}, [
      el('div.panel-head', {}, [
        el('div', {}, [
          el('span.panel-kicker', { text: 'Your region' }),
          el('h2', { text: 'Location' })
        ])
      ]),
      el('div.location-controls', {}, [regionSelect, locateButton]),
      status.node
    ]),

    el('section.card', {}, [
      el('div.panel-head', {}, [
        el('div', {}, [
          el('span.panel-kicker', { text: 'Activity clusters' }),
          el('h2', { text: 'By region' })
        ])
      ]),
      regionList
    ])
  ]);

  const globe = createGlobe(canvas, { onRegionSelect: selectRegion });

  function setView(next) {
    view = next;

    for (const button of viewToggle.children) {
      button.classList.toggle('is-active', button.dataset.view === view);
    }

    element.classList.toggle('is-local', view === 'local');

    if (view === 'local') {
      const region = store.state.device?.region;
      if (region) {
        selectRegion({ ...region, waiting: currentWaiting(region.id) });
        globe.focusRegion(region);
      }
    } else {
      selectRegion(null);
    }

    renderRegions();
  }

  function currentWaiting(regionId) {
    return store.state.presence?.regions?.find((region) => region.id === regionId)?.waiting ?? 0;
  }

  function selectRegion(region) {
    selectedRegionId = region?.id ?? null;
    globe.setSelected(selectedRegionId);

    if (!region) {
      detailPanel.hidden = true;
      render(detailPanel, []);
      return;
    }

    detailPanel.hidden = false;
    render(detailPanel, [
      el('div.region-detail-body', {}, [
        el('span.region-detail-flag', { text: region.flag }),
        el('div', {}, [
          el('span.region-detail-name', { text: region.label }),
          el('span.region-detail-country', { text: region.country })
        ])
      ]),
      el('div.region-detail-count', {}, [
        el('strong', { text: formatCount(currentWaiting(region.id)) }),
        el('span', { text: 'waiting' })
      ]),
      el('button.icon-button', {
        type: 'button',
        'aria-label': 'Close region detail',
        onclick: () => selectRegion(null)
      }, [icon('close', { size: 16 })])
    ]);
  }

  function renderRegions() {
    const snapshot = store.state.presence;
    if (!snapshot) return;

    const home = store.state.device?.regionId;
    const regions = view === 'local'
      ? snapshot.regions.filter((region) => region.country === store.state.device?.region?.country)
      : snapshot.regions.slice(0, 12);

    render(
      regionList,
      regions.length
        ? regions.map((region) =>
            el('button.region-row', {
              type: 'button',
              class: region.id === selectedRegionId ? 'is-selected' : '',
              onclick: () => {
                selectRegion(region);
                globe.focusRegion(region);
              }
            }, [
              el('span.region-dot', { style: { opacity: String(0.35 + 0.65 * intensity(region, snapshot)) } }),
              el('span.region-name', { text: region.label }),
              region.id === home ? el('span.region-badge', { text: 'You' }) : null,
              el('span.region-count', { text: formatCount(region.waiting) })
            ])
          )
        : emptyState('No activity in your country yet.')
    );
  }

  function intensity(region, snapshot) {
    const peak = Math.max(1, ...snapshot.regions.map((entry) => entry.waiting));
    return region.waiting / peak;
  }

  function renderRegionOptions() {
    const regions = store.state.regions ?? [];
    const selected = store.state.device?.regionId;

    render(
      regionSelect,
      regions.map((region) =>
        el('option', { value: region.id, selected: region.id === selected ? true : undefined },
          [`${region.label}, ${region.country}`])
      )
    );
  }

  async function chooseRegion(regionId) {
    try {
      const { device } = await api.updateMe({ regionId, locationMode: 'manual' });
      store.set({ device });
      status.set(`Region set to ${device.region.label}`, 'positive');
      await poll();
    } catch (error) {
      status.set(error.message, 'negative');
    }
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      status.set('This browser has no location services. Pick a region instead.', 'negative');
      return;
    }

    status.set('Asking your browser for a rough position…');

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { device } = await api.locate(coords.latitude, coords.longitude);
          store.set({ device });
          renderRegionOptions();
          status.set(`Matched to ${device.region.label}`, 'positive');
          globe.focusRegion(device.region);
          await poll();
        } catch (error) {
          status.set(error.message, 'negative');
        }
      },
      () => status.set('Location declined. Pick your region from the list.', 'neutral'),
      { maximumAge: 600_000, timeout: 8000 }
    );
  }

  async function poll() {
    try {
      const snapshot = await api.getPresence();
      store.set({ presence: snapshot });
    } catch {
      status.set('Live activity is unavailable right now.', 'negative');
    }
  }

  store.subscribe((state) => {
    const snapshot = state.presence;
    if (!snapshot) return;

    totalCount.textContent = formatCount(snapshot.totalWaiting);
    globe.setData(snapshot);
    renderRegions();
  }, ['presence']);

  store.subscribe(() => {
    renderRegionOptions();
    renderRegions();
  }, ['device', 'regions']);

  return {
    element,
    enter() {
      globe.start();
      renderRegionOptions();
      poll();
      pollHandle = setInterval(poll, POLL_MS);
    },
    leave() {
      globe.stop();
      clearInterval(pollHandle);
      pollHandle = null;
    }
  };
}
