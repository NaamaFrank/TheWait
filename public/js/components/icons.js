import { svg } from '../core/dom.js';

/**
 * One definition per icon. The old markup repeated the same clock path in five
 * places; every icon now has exactly one source of truth.
 */
const PATHS = {
  clock: ['M12 12V7', 'M12 12l3.5 2'],
  timer: ['M12 8v4l3 2'],
  chart: ['M4 19h16', 'M5 15l4-4 4 3 5-8'],
  bars: ['M6 5v14', 'M6 19h13', 'M9 16V9', 'M14 16v-4', 'M19 16V6'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.6 2.4 4 5.5 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.5-4-9s1.4-6.6 4-9z'],
  spark: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M6 6l2.5 2.5', 'M15.5 15.5L18 18', 'M18 6l-2.5 2.5', 'M8.5 15.5L6 18'],
  breath: ['M4 12h4a2 2 0 0 0 2-2V8', 'M20 12h-4a2 2 0 0 1-2 2v2', 'M12 3v18'],
  code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
  book: ['M4 5v14h7V5z', 'M13 5v14h7V5z'],
  broom: ['M14 4l6 6', 'M13 8L5 16l3 3 8-8', 'M5 16l-1 4 4-1'],
  chat: ['M4 5h16v10H9l-5 4z'],
  dice: ['M4 4h16v16H4z', 'M9 9h.01', 'M15 15h.01'],
  moon: ['M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'],
  location: ['M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z', 'M12 10.5v.01'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M5.5 12a6.5 6.5 0 0 1 11-4.2L20 11', 'M18.5 12a6.5 6.5 0 0 1-11 4.2L4 13'],
  play: ['M9 6l9 6-9 6z'],
  stop: ['M7 7h10v10H7z'],
  check: ['M5 13l4 4 10-10'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  trash: ['M5 7h14', 'M9 7V5h6v2', 'M7 7l1 12h8l1-12'],
  shuffle: ['M4 7h4l8 10h4', 'M4 17h4l2-2.5', 'M15 7h5V4', 'M20 17h-3v3'],
  users: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M2 20c0-3.3 2.7-5 6-5s6 1.7 6 5', 'M16 6.5a3 3 0 0 1 0 6', 'M17 15c2.5.4 5 1.9 5 5']
};

const CIRCLES = {
  clock: { cx: 12, cy: 12, r: 9 },
  timer: { cx: 12, cy: 12, r: 8 }
};

/** Builds a 24x24 stroked icon. Returns `null` for unknown names. */
export function icon(name, { size = 20, className = 'icon' } = {}) {
  const paths = PATHS[name];
  if (!paths) return null;

  const children = paths.map((d) => svg('path', { d }));
  const circle = CIRCLES[name];
  if (circle) children.unshift(svg('circle', circle));

  return svg(
    'svg',
    {
      class: className,
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true'
    },
    children
  );
}

/** Category id -> icon name, with a safe default. */
export function categoryIcon(categoryIconName, options) {
  return icon(categoryIconName, options) ?? icon('spark', options);
}
