import { svg } from '../core/dom.js';
import { headlineDuration, hourLabel } from '../core/format.js';

/**
 * Two SVG charts, both driven straight from the analytics payload.
 *
 * They share a single value-to-geometry helper so the line and the bars agree
 * on padding and scaling instead of each inventing their own.
 */

const VIEWBOX = { width: 320, height: 140 };
const PADDING = { top: 14, right: 10, bottom: 22, left: 10 };

function plotArea() {
  return {
    left: PADDING.left,
    top: PADDING.top,
    width: VIEWBOX.width - PADDING.left - PADDING.right,
    height: VIEWBOX.height - PADDING.top - PADDING.bottom
  };
}

/** Maps a value in `[0, max]` onto the plot's y axis, top-down. */
function scaleY(value, max, area) {
  if (max <= 0) return area.top + area.height;
  return area.top + area.height * (1 - value / max);
}

function chartRoot(children, { label }) {
  return svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': label
    },
    children
  );
}

function gridLines(area) {
  return [0.25, 0.5, 0.75, 1].map((fraction) =>
    svg('line', {
      class: 'chart-grid',
      x1: area.left,
      x2: area.left + area.width,
      y1: area.top + area.height * fraction,
      y2: area.top + area.height * fraction
    })
  );
}

function emptyState(area, message) {
  return svg(
    'text',
    { class: 'chart-empty', x: area.left + area.width / 2, y: area.top + area.height / 2, 'text-anchor': 'middle' },
    [message]
  );
}

/** Smooth cubic path through the points, tangents estimated from neighbours. */
function smoothPath(points) {
  if (points.length < 2) return '';

  const segments = [`M${points[0].x} ${points[0].y}`];

  for (let i = 0; i < points.length - 1; i += 1) {
    const previous = points[i - 1] ?? points[i];
    const current = points[i];
    const next = points[i + 1];
    const following = points[i + 2] ?? next;

    const control1 = { x: current.x + (next.x - previous.x) / 6, y: current.y + (next.y - previous.y) / 6 };
    const control2 = { x: next.x - (following.x - current.x) / 6, y: next.y - (following.y - current.y) / 6 };

    segments.push(`C${control1.x} ${control1.y} ${control2.x} ${control2.y} ${next.x} ${next.y}`);
  }

  return segments.join(' ');
}

/** Average wait by hour of day - the PRD's trend line. */
export function hourlyTrendChart(hourly) {
  const area = plotArea();
  const max = Math.max(...hourly.map((entry) => entry.averageSeconds), 1);
  const hasData = hourly.some((entry) => entry.sessionCount > 0);

  if (!hasData) {
    return chartRoot([...gridLines(area), emptyState(area, 'No waits logged yet')], {
      label: 'Wait time by hour of day, no data yet'
    });
  }

  const points = hourly.map((entry, index) => ({
    x: area.left + (area.width * index) / (hourly.length - 1),
    y: scaleY(entry.averageSeconds, max, area),
    entry
  }));

  const fillPath = `${smoothPath(points)} L${points.at(-1).x} ${area.top + area.height} L${points[0].x} ${area.top + area.height} Z`;

  const nodes = points
    .filter((point) => point.entry.sessionCount > 0)
    .map((point) =>
      svg('circle', {
        class: 'chart-node',
        cx: point.x,
        cy: point.y,
        r: 2.6,
        'vector-effect': 'non-scaling-stroke'
      }, [svg('title', {}, [`${hourLabel(point.entry.hour)} - ${headlineDuration(point.entry.averageSeconds)} avg`])])
    );

  const axis = [0, 6, 12, 18].map((hour) =>
    svg('text', {
      class: 'chart-axis',
      x: area.left + (area.width * hour) / (hourly.length - 1),
      y: VIEWBOX.height - 6,
      'text-anchor': hour === 0 ? 'start' : 'middle'
    }, [hourLabel(hour)])
  );

  return chartRoot(
    [
      svg('defs', {}, [
        svg('linearGradient', { id: 'trendFill', x1: '0', y1: '0', x2: '0', y2: '1' }, [
          svg('stop', { offset: '0', 'stop-color': '#7dfaff', 'stop-opacity': '0.34' }),
          svg('stop', { offset: '1', 'stop-color': '#8d6dff', 'stop-opacity': '0' })
        ])
      ]),
      ...gridLines(area),
      svg('path', { class: 'chart-fill', d: fillPath }),
      svg('path', { class: 'chart-line', d: smoothPath(points), 'vector-effect': 'non-scaling-stroke' }),
      ...nodes,
      ...axis
    ],
    { label: 'Average wait time by hour of day' }
  );
}

/** Per-day totals across the analytics window. */
export function dailyBarChart(daily) {
  const area = plotArea();
  const max = Math.max(...daily.map((day) => day.totalSeconds), 1);
  const slot = area.width / daily.length;
  const barWidth = Math.min(slot * 0.5, 18);

  const bars = daily.flatMap((day, index) => {
    const centre = area.left + slot * (index + 0.5);
    const top = scaleY(day.totalSeconds, max, area);

    return [
      svg('rect', {
        class: day.isToday ? 'chart-bar is-today' : 'chart-bar',
        x: centre - barWidth / 2,
        y: top,
        width: barWidth,
        height: Math.max(2, area.top + area.height - top),
        rx: barWidth / 2
      }, [svg('title', {}, [`${day.weekday} - ${headlineDuration(day.totalSeconds)}`])]),
      svg('text', { class: 'chart-axis', x: centre, y: VIEWBOX.height - 6, 'text-anchor': 'middle' }, [day.weekday])
    ];
  });

  return chartRoot([...gridLines(area), ...bars], { label: 'Total wait time per day' });
}
