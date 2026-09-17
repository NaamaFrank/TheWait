import { el, svg } from '../core/dom.js';
import { hourLabel } from '../core/format.js';

/**
 * The Stats screen's drawings.
 *
 * SVG rather than canvas: these are static once rendered, so there is nothing
 * to animate and no reason to run a render loop or worry about device pixel
 * ratios. They are also the only place `hourLabel` was ever written for.
 */

/* --- When you wait -------------------------------------------------------- */

/** Where the axis is labelled. Every third hour is noise at this width. */
const HOUR_MARKS = [0, 6, 12, 18];

/**
 * The day, midnight to midnight, one bar an hour.
 *
 * This was a twenty-four hour dial, which read as a clock face - and a clock
 * face has twelve hours on it, so nobody could tell which wedge was 3am and
 * which was 3pm. A left-to-right strip is plainer and says the thing outright.
 */
export function dayStrip(hourly, { peakHour = null } = {}) {
  const busiest = Math.max(1, ...hourly.map((entry) => entry.sessionCount));

  const bars = hourly.map((entry) => {
    const share = entry.sessionCount / busiest;

    return el('div.day-hour', { title: `${hourLabel(entry.hour)}: ${entry.sessionCount} waits` }, [
      el('div.day-bar', {
        class: entry.hour === peakHour && entry.sessionCount ? 'is-peak' : '',
        // A share of the strip, not a pixel count - the strip grows with the
        // card. The floor keeps an empty hour visible as the track it sits in.
        style: { height: `${entry.sessionCount ? 18 + share * 82 : 4}%` }
      })
    ]);
  });

  const marks = HOUR_MARKS.map((hour) =>
    el('span.day-mark', { style: { left: `${(hour / 24) * 100}%` }, text: hourLabel(hour).replace(' ', '') })
  );

  return el('div.day-strip', {}, [
    el('div.day-bars', { role: 'img', 'aria-label': 'Waits by hour of day' }, bars),
    el('div.day-axis', {}, [...marks, el('span.day-mark.is-end', { text: '12AM' })])
  ]);
}

/* --- The calendar --------------------------------------------------------- */

const CELL = 13;
const GAP = 3;

/**
 * Up to this many days are drawn as a month grid; past it, a scrolling strip.
 *
 * Thirty days in week-columns is five narrow columns stranded against the left
 * edge of a card four times as wide. Laid out the way a month is normally read
 * - weekdays across, weeks down - the same thirty squares fill the space.
 */
const GRID_MAX_DAYS = 45;

/** Sunday-first, to match `getUTCDay`. */
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Five steps read as "some, more, a lot"; a smooth gradient reads as noise. */
function band(count, busiest) {
  return count === 0 ? 0 : Math.min(4, Math.ceil((count / busiest) * 4));
}

function cellTitle(day) {
  return `${day.date}: ${day.sessionCount} ${day.sessionCount === 1 ? 'wait' : 'waits'}`;
}

/** How many blanks before the first day, so every column is one weekday. */
function leadingBlanks(daily) {
  return new Date(`${daily[0].date}T00:00:00Z`).getUTCDay();
}

/**
 * A month, weekdays across and weeks down.
 *
 * The squares size themselves from the column width, so this fills whatever
 * it is given rather than sitting in the corner of it.
 */
function calendarGrid(daily, busiest) {
  const pad = Array.from({ length: leadingBlanks(daily) }, () => el('div.heat-pad'));

  const squares = daily.map((day) =>
    el('div.heat-box', {
      class: `heat-${band(day.sessionCount, busiest)}${day.isToday ? ' is-today' : ''}`,
      title: cellTitle(day)
    })
  );

  return el('div.heat-grid', { role: 'img', 'aria-label': `Waits per day over the last ${daily.length} days` }, [
    ...WEEKDAY_INITIALS.map((initial) => el('span.heat-dow', { text: initial })),
    ...pad,
    ...squares
  ]);
}

/**
 * A year, a column per week, scrolled to the recent end.
 *
 * Left-to-right is oldest-to-newest, so the default scroll position shows the
 * far past - months of empty squares, with everything that actually happened
 * off the right edge. It opens on today instead.
 */
function calendarStrip(daily, busiest) {
  const cells = [...Array.from({ length: leadingBlanks(daily) }, () => null), ...daily];
  const weeks = Math.ceil(cells.length / 7);

  const squares = cells.map((day, index) => {
    if (!day) return null;

    return svg('rect', {
      x: Math.floor(index / 7) * (CELL + GAP),
      y: (index % 7) * (CELL + GAP),
      width: CELL,
      height: CELL,
      rx: 3,
      class: `heat-cell heat-${band(day.sessionCount, busiest)}${day.isToday ? ' is-today' : ''}`
    }, [svg('title', {}, [cellTitle(day)])]);
  });

  const scroller = el('div.heatmap-scroll', {}, [
    svg('svg', {
      class: 'heatmap',
      width: weeks * (CELL + GAP),
      height: 7 * (CELL + GAP),
      viewBox: `0 0 ${weeks * (CELL + GAP)} ${7 * (CELL + GAP)}`,
      role: 'img',
      'aria-label': `Waits per day over the last ${daily.length} days`
    }, squares.filter(Boolean))
  ]);

  // Only once it is in the document does it have a width to scroll within.
  const toEnd = () => { scroller.scrollLeft = scroller.scrollWidth; };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(toEnd);
  else toEnd();

  return scroller;
}

export function calendarHeatmap(daily) {
  if (!daily.length) return el('p.empty', { text: 'Nothing here yet.' });

  const busiest = Math.max(1, ...daily.map((day) => day.sessionCount));

  return daily.length <= GRID_MAX_DAYS
    ? calendarGrid(daily, busiest)
    : calendarStrip(daily, busiest);
}
