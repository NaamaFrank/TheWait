import { buildGraticule, capVisible, createProjector, decodeCountries } from './geo.js';

/**
 * The avatar globe: a real orthographic projection of Earth on a canvas, with
 * one lifted pin per person who is waiting.
 *
 * Land comes from a Natural Earth 110m country topology served from `/data`,
 * decoded once and reused. The canvas is driven by an imperative handle rather
 * than re-rendered from props, so a pin moving does not rebuild any geometry.
 */

/**
 * Two land resolutions. The coarse one is 96KB and enough for a whole globe;
 * the detailed one is 715KB and 80,000 points, fetched only once someone zooms
 * in far enough for the difference to show.
 */
const ATLASES = {
  coarse: '/data/countries-110m.json',
  detailed: '/data/countries-50m.json',
  fine: '/data/countries-10m.json'
};

/**
 * Zoom at which each resolution takes over. Each is fetched only when someone
 * actually zooms that far, so a casual look at the globe costs 96KB and a
 * drill-down to a single country costs the rest.
 */
const ATLAS_STEPS = [
  { from: 9, quality: 'fine' },
  { from: 1.8, quality: 'detailed' }
];

/** Zoom at which cities start to appear. */
const CITY_ZOOM = 1.5;

/** Zoom at which cities get their names written next to them. */
const CITY_LABEL_ZOOM = 2.1;

/** Palette, matching the design's "wire" globe mode. */
const OCEAN = ['#141B29', '#0C1119', '#080A0F'];
const LAND = '#232733';
const COAST = '#3B4252';
const BORDER = 'rgba(255,255,255,.10)';
const GRATICULE = 'rgba(255,255,255,.05)';
const RIM = '#4A5262';
const CITY_DOT = '#8A93A8';
const CITY_INK = '#C9D2E4';

const HERO = '#FF5A36';
const SUPPORT = '#FFC53D';
const PIN_SELECTED = '#F5F1EA';
const PIN_DIM = '#3D4250';
const PIN_DIM_FILL = '#2A2E38';
const PIN_DIM_INK = '#6C7280';
const PIN_INK = '#0B0B0C';

/** A pin sitting closer to the limb than this is too edge-on to draw. */
const HORIZON_MARGIN = 0.03;

const FLY_MS = 780;
const IDLE_SPIN = 0.05;
/**
 * How far in you can go. The upper end is what makes a country fill the view:
 * the visible radius is `asin(1 / zoom)`, so 3.4 tops out around 1,900km -
 * continental - while 64 is under 100km, which is a city and its neighbours.
 */
const ZOOM_RANGE = [0.85, 1000];

/** Exposed so the range can be asserted against real distances. */
export const ZOOM_LIMITS = ZOOM_RANGE;

/**
 * Roughly how far the eye reaches at a given zoom, in kilometres.
 *
 * The orthographic view shows a cap of angular radius `asin(1 / zoom)`, which
 * is what decides whether a country fits on screen. This ignores the globe's
 * inset within its square canvas, so it runs a few percent low; a live globe
 * reports its own exact figure through `visibleRadiusKm`.
 */
export function visibleRadiusKm(zoom) {
  return Math.round((Math.asin(Math.min(1, 1 / zoom)) * 180 / Math.PI) * 111);
}

/**
 * How wide a view suits a city, in kilometres.
 *
 * A fixed zoom cannot work across a catalogue that runs from towns of 15,000
 * to Shanghai's 25 million: framing Tel Aviv at Shanghai's zoom shows the whole
 * of Israel. Built-up area grows roughly with the cube root of population, so
 * that is what this follows - about 7km for a small town, 23km for Tel Aviv,
 * 60km for London - and the bounds keep either extreme sensible.
 */
export function viewRadiusKmFor(population) {
  const estimate = 0.3 * Math.cbrt(Math.max(0, population) || 1);
  return Math.max(6, Math.min(90, estimate));
}

/** How quickly the view eases toward a new zoom level. */
const ZOOM_EASE = 0.18;

/** Pins stop growing past this zoom; beyond it they would swallow the canvas. */
const PIN_ZOOM_CAP = 3.4;

/** How near the poles the camera will centre. Short of 90 only to stay stable. */
const MAX_FLY_LAT = 88;

/** Degrees of rotation per pixel dragged, at zoom 1. */
const DRAG_SPEED = 0.32;

/** Past this the poles crowd the limb and the globe is hard to read. */
const MAX_TILT = 78;

/** Distance, in px, within which a tap counts as hitting a pin. */
const TAP_RADIUS = 24;

/**
 * Where a drag from `start` by `(dx, dy)` pixels leaves the camera.
 *
 * Both axes are negated relative to the drag, because these are the *camera's*
 * coordinates, not the surface's: a point at longitude L is drawn at
 * `sin(L - camera.lon)`, so sweeping the camera east pulls the land west. The
 * land has to travel with the finger, so the camera travels against it.
 */
export function dragCamera(start, dx, dy, zoom = 1) {
  const speed = DRAG_SPEED / zoom;

  return {
    lon: start.lon - dx * speed,
    lat: Math.max(-MAX_TILT, Math.min(MAX_TILT, start.lat + dy * speed))
  };
}

/** A pointer that travelled further than this was a drag, not a tap. */
const TAP_SLOP = 7;

const atlasPromises = new Map();

/** Loaded at most once per page per resolution, and shared by every globe. */
function loadAtlas(quality) {
  if (!atlasPromises.has(quality)) {
    atlasPromises.set(
      quality,
      fetch(ATLASES[quality])
        .then((response) => {
          if (!response.ok) throw new Error(`atlas ${response.status}`);
          return response.json();
        })
        .then((topology) => ({ ...decodeCountries(topology), graticule: buildGraticule() }))
        // A globe without coastlines still shows pins, so this is not fatal.
        .catch(() => null)
    );
  }

  return atlasPromises.get(quality);
}

export function createGlobe({ size: initialSize = 320, onSelect, onNeedCities } = {}) {
  let size = initialSize;
  const canvas = document.createElement('canvas');
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Globe of people currently waiting');

  const context = canvas.getContext('2d');
  const projector = createProjector();

  const atlases = { coarse: null, detailed: null, fine: null };
  let people = [];
  let cities = [];
  let selected = null;

  /** Where cities were last requested from, so panning refetches but jitter does not. */
  let cityAnchor = null;

  const rotation = { lon: -30, lat: 20 };
  let zoom = 1;

  // Wheel and buttons set a target and the view eases toward it; a pinch moves
  // both together, because there the finger is the control.
  let zoomTarget = 1;
  let flight = null;
  let drag = null;
  let hits = [];
  let frame = 0;
  let raf = null;

  loadAtlas('coarse').then((loaded) => {
    atlases.coarse = loaded;
  });

  /**
   * The best land data in hand for this zoom level.
   *
   * Anything not yet downloaded is requested here and stood in for by the next
   * coarsest thing available, so zooming never blocks on a fetch.
   */
  function currentAtlas() {
    for (const step of ATLAS_STEPS) {
      if (zoom < step.from) continue;

      if (!atlases[step.quality]) {
        loadAtlas(step.quality).then((loaded) => {
          atlases[step.quality] = loaded;
        });
      }

      if (atlases[step.quality]) return atlases[step.quality];
    }

    return atlases.coarse;
  }

  /**
   * The angular radius of what the canvas can actually show. At zoom 1 that is
   * the whole near hemisphere; zoomed in it is a small cap, which is what makes
   * culling worth doing.
   */
  function visibleAngle() {
    return Math.asin(Math.min(1, (size / 2) / ((size / 2 - 8) * zoom)));
  }

  function cosVisibleAngle() {
    return Math.cos(visibleAngle());
  }

  /** Asks the screen for cities once the camera has moved somewhere new. */
  function requestCities() {
    if (!onNeedCities || zoom < CITY_ZOOM) {
      if (cities.length && zoom < CITY_ZOOM) cities = [];
      return;
    }

    // Refetch once the camera has moved a fair fraction of what it can see.
    const slack = Math.max(0.3, ((visibleAngle() * 180) / Math.PI) * 0.4);
    const moved =
      !cityAnchor ||
      Math.abs(cityAnchor.lon - rotation.lon) > slack ||
      Math.abs(cityAnchor.lat - rotation.lat) > slack ||
      cityAnchor.zoom / zoom > 1.6 ||
      zoom / cityAnchor.zoom > 1.6;

    if (!moved) return;

    cityAnchor = { lon: rotation.lon, lat: rotation.lat, zoom };
    onNeedCities({
      lat: rotation.lat,
      lng: rotation.lon,
      // A little wider than the view, so panning does not immediately run out.
      radiusKm: Math.max(40, Math.round((visibleAngle() * 180) / Math.PI * 111 * 1.3))
    });
  }

  /* --- Drawing ---------------------------------------------------------- */

  function advance(now) {
    if (flight) {
      const progress = Math.min(1, (now - flight.startedAt) / FLY_MS);
      const eased = 1 - (1 - progress) ** 3;

      rotation.lon = flight.fromLon + flight.deltaLon * eased;
      rotation.lat = flight.fromLat + (flight.toLat - flight.fromLat) * eased;
      zoom = flight.fromZoom + (flight.toZoom - flight.fromZoom) * eased;
      zoomTarget = zoom;

      if (progress >= 1) flight = null;
      return;
    }

    // Ease toward whatever the wheel or the buttons last asked for.
    if (Math.abs(zoomTarget - zoom) > 0.001) {
      zoom += (zoomTarget - zoom) * ZOOM_EASE;
    }

    // Idle drift, so the globe never looks frozen - but not once someone has
    // zoomed in to look at something specific.
    if (!drag && selected === null && zoom < CITY_ZOOM) {
      rotation.lon += IDLE_SPIN;
    }
  }

  function setZoom(next) {
    zoomTarget = Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], next));
  }

  /**
   * The zoom that puts a given ground radius at the edge of this canvas.
   * Inverts `visibleAngle`, so it accounts for the globe's inset within the
   * square rather than assuming the two are the same.
   */
  function zoomForRadiusKm(km) {
    const angle = Math.max(1e-6, (km / 111) * (Math.PI / 180));
    const wanted = (size / 2) / ((size / 2 - 8) * Math.sin(Math.min(Math.PI / 2, angle)));

    return Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], wanted));
  }

  /** Eases the camera to a point, optionally changing zoom. */
  function flyTo({ lon, lat, zoom: toZoom }) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    flight = {
      startedAt: performance.now(),
      fromLon: rotation.lon,
      fromLat: rotation.lat,
      // Take the short way round rather than unwinding the long way.
      deltaLon: ((lon - rotation.lon + 540) % 360) - 180,
      // Wide enough for every inhabited latitude to sit dead centre. The old
      // +/-70 was inside Alta's 69.97, which at a 7km view is half a screen out.
      toLat: Math.max(-MAX_FLY_LAT, Math.min(MAX_FLY_LAT, lat)),
      fromZoom: zoom,
      toZoom: Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], toZoom ?? zoom))
    };
  }

  function drawSphere(cx, cy, radius, screen) {
    const ocean = context.createRadialGradient(
      cx - radius * 0.4, cy - radius * 0.5, radius * 0.15,
      cx, cy, radius * 1.02
    );
    ocean.addColorStop(0, OCEAN[0]);
    ocean.addColorStop(0.7, OCEAN[1]);
    ocean.addColorStop(1, OCEAN[2]);

    context.save();
    context.beginPath();
    context.arc(cx, cy, Math.min(radius, screen / 2 - 2), 0, Math.PI * 2);
    context.clip();

    context.fillStyle = ocean;
    context.fillRect(0, 0, screen, screen);

    const atlas = currentAtlas();

    if (atlas) {
      const axis = projector.axis();
      const cosVisible = cosVisibleAngle();

      // Reject a whole country before transforming any of its points.
      const inView = (ring) =>
        capVisible(ring.cap, axis.x * ring.cap.x + axis.y * ring.cap.y + axis.z * ring.cap.z, cosVisible);

      context.strokeStyle = GRATICULE;
      context.lineWidth = 0.6;
      context.beginPath();
      for (const line of atlas.graticule) {
        if (inView(line)) projector.traceLine(context, line);
      }
      context.stroke();

      context.beginPath();
      for (const ring of atlas.land) {
        if (inView(ring)) projector.tracePolygon(context, ring);
      }
      context.fillStyle = LAND;
      context.fill();
      context.strokeStyle = COAST;
      context.lineWidth = 1;
      context.stroke();

      context.beginPath();
      for (const line of atlas.borders) {
        if (inView(line)) projector.traceLine(context, line);
      }
      context.strokeStyle = BORDER;
      context.lineWidth = 0.55;
      context.stroke();
    }

    // Sun-side lift and terminator shading, inside the clip.
    const shade = context.createRadialGradient(
      cx - radius * 0.45, cy - radius * 0.55, radius * 0.1,
      cx, cy, radius * 1.15
    );
    shade.addColorStop(0, 'rgba(255,255,255,.07)');
    shade.addColorStop(0.55, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(0,0,0,.55)');
    context.fillStyle = shade;
    context.fillRect(0, 0, screen, screen);
    context.restore();

    const halo = context.createRadialGradient(cx, cy, radius * 0.94, cx, cy, radius * 1.22);
    halo.addColorStop(0, `${SUPPORT}33`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = halo;
    context.beginPath();
    context.arc(cx, cy, radius * 1.22, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = RIM;
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.stroke();
  }

  /**
   * The city layer, drawn under the pins.
   *
   * Cities fade in with zoom rather than appearing all at once, and only earn a
   * label once there is room for one - a globe covered in overlapping type is
   * less readable than no labels at all.
   */
  function drawCities() {
    if (zoom < CITY_ZOOM || !cities.length) return;

    const fade = Math.min(1, (zoom - CITY_ZOOM) / 0.6);
    const labelled = zoom >= CITY_LABEL_ZOOM;
    const placed = [];

    context.save();
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.font = '600 10px Archivo, system-ui, sans-serif';

    for (const city of cities) {
      const point = projector.project(city.lng, city.lat);
      if (!point || point.depth <= 0.08) continue;

      const near = Math.min(1, 0.25 + point.depth);
      context.globalAlpha = fade * near * 0.9;

      context.fillStyle = CITY_DOT;
      context.beginPath();
      context.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
      context.fill();

      if (!labelled) continue;

      // One label per neighbourhood of the canvas, biggest city first.
      const clash = placed.some(
        (other) => Math.abs(other.x - point.x) < 54 && Math.abs(other.y - point.y) < 12
      );
      if (clash) continue;
      placed.push(point);

      context.fillStyle = CITY_INK;
      context.fillText(city.name, point.x + 5, point.y);
    }

    context.restore();
  }

  /** Pin scale falls off toward the limb so the sphere reads as curved. */
  function pinScale(depth) {
    // Zoom lifts a pin slightly, but only over the range the size was tuned
    // for - at 64x an unclamped pin is wider than the globe it sits on.
    return (0.58 + depth * 0.46) * (0.85 + Math.min(zoom, PIN_ZOOM_CAP) * 0.15);
  }

  function pinLift(scale, isSelected, index) {
    return 17 * scale + (isSelected ? 5 : 0) + Math.sin(frame * 0.05 + index * 1.7) * 1.5 * scale;
  }

  /**
   * Screen offsets for people who share a location.
   *
   * Everyone in a city carries that city's coordinates - the app knows what
   * town you are in and deliberately not where in it - so without this they
   * project to the same pixel and a crowd looks like one person. They are fanned
   * around the city's position in screen space rather than being given invented
   * coordinates, which would be a claim about where they live.
   */
  function fanOffsets(count) {
    if (count < 2) return [{ dx: 0, dy: 0 }];

    const radius = Math.min(30, 11 + count * 2.6);
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * 0.62 };
    });
  }

  function drawPins() {
    const visible = [];
    const crowds = new Map();

    for (const [index, person] of people.entries()) {
      const point = projector.project(person.lon, person.lat);
      if (!point || point.depth <= HORIZON_MARGIN) continue;

      // Grouped by where they actually are, to a tenth of a degree.
      const key = `${person.lat.toFixed(1)}:${person.lon.toFixed(1)}`;
      if (!crowds.has(key)) crowds.set(key, []);
      crowds.get(key).push(visible.length);

      visible.push({ person, index, ...point });
    }

    for (const members of crowds.values()) {
      if (members.length < 2) continue;

      const offsets = fanOffsets(members.length);
      for (const [slot, position] of members.entries()) {
        visible[position].x += offsets[slot].dx;
        visible[position].y += offsets[slot].dy;
      }
    }

    // Far pins first, so near ones overlap them.
    visible.sort((a, b) => a.depth - b.depth);
    hits = visible;

    for (const pin of visible) {
      const { person, index } = pin;
      const isSelected = selected === index;
      const scale = pinScale(pin.depth);
      const radius = 13 * scale * (isSelected ? 1.18 : 1);
      const y = pin.y - pinLift(scale, isSelected, index);
      const x = pin.x;

      const body = isSelected
        ? PIN_SELECTED
        : person.dim
          ? PIN_DIM
          : index % 3 === 0
            ? SUPPORT
            : HERO;

      context.save();
      context.globalAlpha = (person.dim ? 0.45 : 1) * Math.min(1, 0.42 + pin.depth * 0.9);

      // Contact shadow on the surface, so the pin reads as standing on it.
      context.fillStyle = 'rgba(0,0,0,.55)';
      context.beginPath();
      context.ellipse(pin.x, pin.y + 1, radius * 0.55, radius * 0.2, 0, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = body;
      context.beginPath();
      context.moveTo(pin.x, pin.y + 1);
      context.lineTo(x - radius * 0.46, y + radius * 0.66);
      context.lineTo(x + radius * 0.46, y + radius * 0.66);
      context.closePath();
      context.fill();

      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();

      const inner = radius - 3.4 * scale;

      context.beginPath();
      context.arc(x, y, inner, 0, Math.PI * 2);
      context.fillStyle = person.dim ? PIN_DIM_FILL : person.tint;
      context.fill();

      /*
       * A sample reads as an outline, a real person as a filled pin.
       *
       * The map is padded so a quiet hour still shows something alive, and
       * for a long time the two were drawn identically - which made the
       * caption underneath the only thing separating a person from scenery.
       * Now the picture says which is which on its own.
       */
      if (person.sample) {
        context.globalCompositeOperation = 'destination-out';
        context.beginPath();
        context.arc(x, y, inner - 1.6 * scale, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = 'source-over';

        context.restore();
        continue;
      }

      context.textAlign = 'center';
      context.textBaseline = 'middle';

      if (person.avatar && !person.dim) {
        // The chosen character, sized to sit inside the pin.
        context.font = `${Math.round(inner * 1.35)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        context.fillText(person.avatar, x, y + inner * 0.06);
      } else {
        context.fillStyle = person.dim ? PIN_DIM_INK : PIN_INK;
        context.font = `700 ${Math.round(11 * scale)}px Archivo, system-ui, sans-serif`;
        context.fillText(person.initials, x, y + 0.5);
      }

      if (isSelected) {
        const pulse = (frame % 60) / 60;
        context.globalAlpha = (1 - pulse) * 0.75;
        context.strokeStyle = PIN_SELECTED;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, y, radius + pulse * 17, 0, Math.PI * 2);
        context.stroke();
      }

      context.restore();
    }
  }

  function render(now) {
    raf = requestAnimationFrame(render);
    frame += 1;
    advance(now);

    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const pixels = Math.round(size * dpr);
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);

    const radius = (size / 2 - 8) * zoom;
    const centre = size / 2;
    projector.set(rotation.lon, rotation.lat, centre, centre, radius);

    drawSphere(centre, centre, radius, size);
    drawCities();
    drawPins();
    requestCities();
  }

  /* --- Interaction ------------------------------------------------------ */

  /** Live pointers, so a second finger can turn a drag into a pinch. */
  const pointers = new Map();
  let pinch = null;

  function pinchDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(event) {
    // The carousel also listens for drags; this one is ours.
    event.stopPropagation();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; dragging still works through the window listeners.
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    flight = null;

    if (pointers.size === 2) {
      // A second finger takes over: stop rotating and start scaling.
      drag = null;
      pinch = { distance: pinchDistance(), zoom };
      return;
    }

    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, lon: rotation.lon, lat: rotation.lat, moved: 0 };
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    event.stopPropagation();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch && pointers.size === 2) {
      const ratio = pinchDistance() / (pinch.distance || 1);
      zoom = Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], pinch.zoom * ratio));
      zoomTarget = zoom;
      return;
    }

    if (!drag) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    Object.assign(rotation, dragCamera(drag, dx, dy, zoom));
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);

    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      // Lifting one finger of a pinch resumes rotating with the other.
      const [remaining] = [...pointers.values()];
      drag = { x: remaining.x, y: remaining.y, lon: rotation.lon, lat: rotation.lat, moved: TAP_SLOP + 1 };
      return;
    }

    const gesture = drag;
    drag = null;
    if (!gesture || gesture.moved > TAP_SLOP) return;

    const box = canvas.getBoundingClientRect();
    const tapX = event.clientX - box.left;
    const tapY = event.clientY - box.top;

    let best = null;
    let bestDistance = TAP_RADIUS;

    for (const pin of hits) {
      const scale = pinScale(pin.depth);
      const distance = Math.hypot(tapX - pin.x, tapY - (pin.y - 17 * scale));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pin.index;
      }
    }

    onSelect?.(best);
  }

  function onWheel(event) {
    event.preventDefault();
    event.stopPropagation();

    // Proportional to the notch, so a trackpad flick and a mouse wheel both
    // cover the range without fifty separate scrolls.
    const step = Math.exp(-event.deltaY * 0.0022);
    setZoom(zoomTarget * step);
  }

  /** Double click or tap to dive in one step. */
  function onDoubleClick(event) {
    event.preventDefault();
    setZoom(zoomTarget * 2.2);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    element: canvas,

    /** The card is narrower on a phone than in the desktop mockup. */
    setSize(next) {
      if (!Number.isFinite(next) || next <= 0 || next === size) return;
      size = next;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
    },

    /** Multiplies the zoom, easing there over the next few frames. */
    zoomBy(factor) {
      setZoom(zoomTarget * factor);
    },

    get zoom() {
      return zoom;
    },

    /** Cities to draw, biggest first - the labeller relies on that order. */
    setCities(next) {
      cities = next ?? [];
    },

    setPeople(next) {
      people = next ?? [];
      if (selected !== null && selected >= people.length) selected = null;
    },

    setSelected(index) {
      selected = index;
    },

    flyTo,

    /**
     * Frames a city at a zoom that suits its size, rather than a fixed one.
     */
    flyToCity(city) {
      if (!city) return;
      flyTo({ lon: city.lng, lat: city.lat, zoom: zoomForRadiusKm(viewRadiusKmFor(city.population)) });
    },

    /**
     * Frames a whole country. Its reach is worked out on the server from where
     * its people actually are, so this only has to convert it to a zoom.
     */
    flyToCountry(country) {
      if (!country) return;
      flyTo({ lon: country.lng, lat: country.lat, zoom: zoomForRadiusKm(country.radiusKm) });
    },

    /** What the camera would need to be to see this far, on this canvas. */
    zoomForRadiusKm,

    /** Where the camera is pointed, for framing checks. */
    get cameraLon() {
      return rotation.lon;
    },

    get cameraLat() {
      return rotation.lat;
    },

    /** How far the eye actually reaches right now, in kilometres. */
    get visibleRadiusKm() {
      return Math.round(((visibleAngle() * 180) / Math.PI) * 111);
    },

    start() {
      if (raf === null) raf = requestAnimationFrame(render);
    },

    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    }
  };
}
