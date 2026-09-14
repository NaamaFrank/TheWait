import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { clockFace, formatCount, headlineDuration, hourLabel, relativeTime } from '../core/format.js';
import { calendarHeatmap, dayStrip } from '../components/charts.js';
import { chipRow, emptyState, screenHead } from '../components/ui.js';
import { buildReceiptData, createShareSheet } from '../components/share-sheet.js';

/**
 * What the waiting added up to.
 *
 * Opens with a sentence rather than a wall of numbers - the rest of the app has
 * a voice and this screen used to read like a dashboard. Underneath: when you
 * wait, how much of it you used, the shape of the waits themselves, and the
 * individual ones.
 */

/** Colours for the time-use mix, applied by position. */
const MIX_COLOURS = ['var(--hero)', 'var(--gold)', 'var(--green)', 'var(--tint-2)', 'var(--tint-7)'];

/** The unused slice is always drawn in the same muted tone, wherever it lands. */
const IDLE_COLOUR = 'var(--card-inset)';

const RANGES = [
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'all', label: 'All time', days: 3650 }
];

/** Below this the calendar is a single stubby column, so bars say more. */
const CALENDAR_FROM_DAYS = 14;

/** How many individual waits the list shows before it becomes a wall. */
const RECENT_WAITS = 8;

/** The server sends short names; a sentence wants the whole word. */
const WEEKDAY_NAMES = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday'
};

export function createStatsScreen({ store }) {
  const element = el('section.screen', { 'data-screen': 'stats' });

  let range = RANGES[0];
  let sessions = [];
  let loading = false;

  /** All-time figures, kept apart so the records do not follow the chips. */
  let lifetime = { analytics: null, progress: null };

  const headline = el('p.stat-headline');
  const ranges = chipRow(RANGES, range.id, (id) => setRange(id));

  const timeWaited = el('div.tile-value', { text: '0m' });
  const putToWork = el('div.tile-value', { text: '0%' });
  const waitCount = el('div.tile-value', { text: '0' });
  const cleared = el('div.tile-value', { text: '0' });
  const timeDelta = el('span.tile-delta');

  /** Waits nobody ended, which no figure on this screen counts. */
  const setAside = el('span.tile-delta');

  const ringSlot = el('div.chart-slot');
  const whenNote = el('p.card-note');

  const trendLabel = el('span.label.label-wide', { text: 'How often it happens' });
  const trend = el('span.delta');
  const chartSlot = el('div.chart-slot');
  const trendNote = el('p.card-note');

  const shareSheet = createShareSheet();

  const shareButton = el('button.head-action', {
    type: 'button',
    'aria-label': 'Share your numbers',
    onclick: () => openShare()
  }, ['Share']);

  const distribution = el('div.card');
  const mixList = el('div.card');
  const records = el('div.grid-2');
  const recent = el('div.ticker');

  render(element, [
    screenHead('Your waiting', 'Where it all went', { aside: shareButton }),
    headline,
    ranges.element,

    el('div.grid-2', {}, [
      el('div.tile.tile-lg.tile-fill.tile-hero', {}, [
        el('div.label', { text: 'Time waited' }),
        timeWaited,
        timeDelta
      ]),
      el('div.tile.tile-lg.tile-fill.tile-gold', {}, [
        el('div.label', { text: 'Put to work' }),
        putToWork
      ]),
      el('div.tile.tile-lg', {}, [el('div.label', { text: 'Waits' }), waitCount, setAside]),
      el('div.tile.tile-lg', {}, [el('div.label', { text: 'Tasks cleared' }), cleared])
    ]),

    el('div.card', {}, [
      el('span.label.label-wide', { text: 'Your day, hour by hour' }),
      ringSlot,
      whenNote
    ]),

    el('div.card', {}, [
      el('div.row-baseline', {}, [trendLabel, trend]),
      chartSlot,
      trendNote
    ]),

    distribution,
    mixList,

    el('div.section', {}, [
      el('span.label.label-wide.records-head', { text: 'Personal bests' }),
      records
    ]),

    el('div.section', {}, [
      el('span.label.label-wide.records-head', { text: 'The last few' }),
      recent
    ]),

    shareSheet.element
  ]);

  /**
   * The receipt is of whatever is on screen.
   *
   * Sharing the week while looking at all time would be a card about numbers
   * the person is not reading, so the range chips decide the period and there
   * is nothing extra to fetch.
   */
  function openShare() {
    shareSheet.open(buildReceiptData({
      device: store.state.device,
      analytics: store.state.analytics,
      progress: store.state.progress,
      sessions,
      periodLabel: range.id === 'all' ? 'All time' : `Last ${range.days} days`
    }));
  }

  /* --- The sentence at the top ------------------------------------------- */

  function paintHeadline(analytics, progress) {
    if (!analytics?.sessionCount) {
      headline.textContent = 'Nothing logged yet. Start a wait and this fills in.';
      return;
    }

    const span = range.id === 'all' ? 'so far' : `in the last ${range.days} days`;
    const used = progress?.putToWorkPercent ?? 0;

    const verdict =
      used >= 80 ? 'Almost none of it wasted.'
        : used >= 50 ? `You put ${used}% of it to work.`
          : used > 0 ? `Only ${used}% of it went anywhere.`
            : 'None of it went anywhere yet.';

    headline.textContent = `${headlineDuration(analytics.totalSeconds)} of waiting ${span}. ${verdict}`;
  }

  /* --- Pieces ------------------------------------------------------------ */

  /*
   * Each chart gets a sentence saying what it shows.
   *
   * A chart answers a question only once you have read it; a line under it
   * answers the question outright, and the chart becomes the evidence. These
   * only ever state what the numbers already say - no encouragement, and
   * nothing at all when there is not enough to go on.
   */

  /** Which stretch of the day an hour falls in, for a friendlier sentence. */
  function partOfDay(hour) {
    if (hour < 5) return 'the small hours';
    if (hour < 12) return 'mornings';
    if (hour < 17) return 'afternoons';
    if (hour < 22) return 'evenings';
    return 'late nights';
  }

  function paintRing(analytics) {
    const busy = analytics.hourly.some((entry) => entry.sessionCount);

    render(ringSlot, busy
      ? [dayStrip(analytics.hourly, { peakHour: analytics.peakHour })]
      : [emptyState('A few more waits and a pattern shows up here.')]);

    whenNote.textContent =
      busy && analytics.peakHour !== null
        ? `Busiest around ${hourLabel(analytics.peakHour)} — ${partOfDay(analytics.peakHour)} are your thing.`
        : '';
  }

  function paintTrendNote(analytics) {
    const days = analytics.daily.length || 1;
    const perDay = analytics.sessionCount / days;

    if (!analytics.sessionCount) {
      trendNote.textContent = '';
      return;
    }

    const perWeek = perDay * 7;
    const rate =
      perDay >= 1.5 ? `About ${Math.round(perDay)} waits a day`
        : perDay >= 0.7 ? 'Roughly one a day'
          : perWeek >= 1.5 ? `About ${Math.round(perWeek)} a week`
            // Rounding this up to "about 1 a week" would overstate it by half.
            : 'Less than one a week';

    // Only worth saying once there are enough weeks for it to be a pattern
    // rather than a restatement of the one bar that happens to be tallest.
    const byWeekday = new Map();
    for (const day of analytics.daily) {
      byWeekday.set(day.weekday, (byWeekday.get(day.weekday) ?? 0) + day.sessionCount);
    }

    const heaviest = [...byWeekday.entries()].sort((a, b) => b[1] - a[1])[0];
    const pattern =
      analytics.daily.length >= 14 && heaviest?.[1]
        // The field is a short name (`Sun`), and "Suns" is not a word.
        ? ` ${WEEKDAY_NAMES[heaviest[0]] ?? heaviest[0]} is the heaviest day.`
        : '';

    trendNote.textContent = `${rate}.${pattern}`;
  }

  function paintBars(daily) {
    const peak = Math.max(1, ...daily.map((day) => day.sessionCount));

    render(chartSlot, [
      el('div.chart', {}, daily.map((day) =>
        el('div.chart-col', {}, [
          // A share of the track rather than a pixel count: the card's height
          // is a token, and CSS is the only thing that knows what it resolves to.
          el('div.chart-track', {}, [
            el('div.chart-bar', {
              class: day.isToday ? 'is-today' : '',
              style: { height: `${Math.max(3, Math.round((day.sessionCount / peak) * 100))}%` },
              title: `${day.weekday}: ${day.sessionCount} waits`
            })
          ]),
          el('span.chart-day', { text: day.initial })
        ])
      ))
    ]);
  }

  function paintDistribution(analytics) {
    const total = analytics.distribution.reduce((sum, bucket) => sum + bucket.count, 0);
    const commonest = [...analytics.distribution].sort((a, b) => b.count - a.count)[0];

    render(distribution, [
      el('span.label.label-wide', { text: "How long you're left hanging" }),
      ...(total
        ? analytics.distribution.map((bucket) => {
            const share = Math.round((bucket.count / total) * 100);

            return el('div.mix-row', {
              title: `${bucket.label}: ${bucket.count} of ${total} waits (${share}%)`
            }, [
              el('div.mix-head', {}, [
                el('span', { text: bucket.label }),
                el('span.mix-pct', { text: String(bucket.count) })
              ]),
              el('div.meter', {}, [
                el('div.meter-fill', { style: { width: `${share}%`, background: 'var(--gold)' } })
              ])
            ]);
          })
        : [emptyState('Log a wait or two and this fills in.')]),
      total && commonest?.count
        ? el('p.card-note', {
            text: `Most of your waits are ${commonest.label.toLowerCase()} — ` +
              `${Math.round((commonest.count / total) * 100)}% of them.`
          })
        : null
    ]);
  }

  function paintMix(mix) {
    const used = mix.filter((slice) => slice.id !== 'idle');
    const biggest = [...used].sort((a, b) => b.percent - a.percent)[0];
    const idle = mix.find((slice) => slice.id === 'idle');

    render(mixList, [
      el('span.label.label-wide', { text: 'What you did with it' }),
      ...(mix.length
        ? mix.map((slice, index) =>
            el('div.mix-row', {
              title: `${slice.label}: ${slice.percent}% of the time you waited`
            }, [
              el('div.mix-head', {}, [
                el('span', { text: slice.label }),
                el('span.mix-pct', { text: `${slice.percent}%` })
              ]),
              el('div.meter', {}, [
                el('div.meter-fill', {
                  style: {
                    width: `${slice.percent}%`,
                    background: slice.id === 'idle' ? IDLE_COLOUR : MIX_COLOURS[index % MIX_COLOURS.length]
                  }
                })
              ])
            ])
          )
        : [emptyState('Clear a task during a wait and this fills in.')]),
      biggest?.percent
        ? el('p.card-note', {
            // The idle slice is the interesting half of this when it is large.
            text: (idle?.percent ?? 0) > biggest.percent
              ? `${idle.percent}% of it went nowhere. ${biggest.label} is what you did most of the rest.`
              : `${biggest.label} took the most of it, at ${biggest.percent}%.`
          })
        : null
    ]);
  }

  /** `1 task`, `2 tasks` - a record of one should not read as a mistake. */
  const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

  function paintRecords(lifetime, lifetimeProgress) {
    const analytics = lifetime;
    const progress = lifetimeProgress;
    const rows = [
      { label: 'Longest wait', value: clockFace(analytics.longestSessionSeconds) },
      { label: 'Most in one wait', value: plural(progress?.bestTasksInOneWait ?? 0, 'task') },
      {
        label: 'Best day',
        value: analytics.bestDay ? plural(analytics.bestDay.count, 'wait') : '—',
        hint: analytics.bestDay?.weekday
      },
      { label: 'Longest streak', value: plural(progress?.longestStreakDays ?? 0, 'day') }
    ];

    render(records, rows.map((row) =>
      el('div.tile', {}, [
        el('div.label', { text: row.label }),
        el('div.record-value', { text: row.value }),
        row.hint ? el('div.record-hint', { text: row.hint }) : null
      ])
    ));
  }

  function paintRecent() {
    render(recent, sessions.length
      ? sessions.slice(0, RECENT_WAITS).map((session) =>
          el('div.wait-row', {}, [
            el('span.wait-length', { text: clockFace(session.durationSeconds) }),
            el('div.wait-body', {}, [
              el('div.wait-when.truncate', { text: relativeTime(session.startedAt) }),
              el('div.wait-did', {
                text: session.tasksCleared ? `${plural(session.tasksCleared, 'task')} cleared` : 'nothing cleared'
              })
            ]),
            el('button.wait-forget', {
              type: 'button',
              'aria-label': 'Forget this wait',
              onclick: () => forget(session)
            }, ['✕'])
          ])
        )
      : [emptyState(loading ? 'Loading…' : 'No waits logged yet.')]);
  }

  /* --- Data -------------------------------------------------------------- */

  async function forget(session) {
    sessions = sessions.filter((row) => row.id !== session.id);
    paintRecent();

    try {
      await api.deleteSession(session.id);
      await refresh();
    } catch {
      // It is still on the server; the next refresh puts it back.
      await refresh();
    }
  }

  function setRange(id) {
    range = RANGES.find((candidate) => candidate.id === id) ?? RANGES[0];
    ranges.select(range.id);
    refresh();
  }

  function paint() {
    const analytics = store.state.analytics;
    const progress = store.state.progress;
    if (!analytics) return;

    paintHeadline(analytics, progress);

    timeWaited.textContent = headlineDuration(analytics.totalSeconds);
    waitCount.textContent = formatCount(analytics.sessionCount);

    /*
     * Said out loud rather than quietly dropped. A wait left running overnight
     * is not a wait, and counting it made the average, the spread and the
     * longest-wait record all describe forgetfulness instead of waiting.
     */
    const abandoned = analytics.abandonedCount ?? 0;
    setAside.textContent = abandoned
      ? `${abandoned} left running, not counted`
      : '';
    cleared.textContent = formatCount(progress?.tasksCleared ?? 0);
    putToWork.textContent = `${progress?.putToWorkPercent ?? 0}%`;

    const change = analytics.totalChangePercent;
    timeDelta.textContent =
      change === null ? '' : `${change >= 0 ? '+' : ''}${change}% on the period before`;

    paintRing(analytics);
    paintTrendNote(analytics);

    // A calendar of seven squares says less than seven bars do.
    const asCalendar = analytics.daily.length >= CALENDAR_FROM_DAYS;

    const countChange = analytics.countChangePercent;
    trend.textContent = countChange === null ? '' : `${countChange >= 0 ? '+' : ''}${countChange}%`;
    trend.className = `delta${countChange === null ? ' is-flat' : countChange < 0 ? ' is-down' : ''}`;

    if (asCalendar) render(chartSlot, [calendarHeatmap(analytics.daily)]);
    else paintBars(analytics.daily);

    paintDistribution(analytics);
    paintMix(progress?.mix ?? []);
    if (lifetime.analytics) paintRecords(lifetime.analytics, lifetime.progress);
    paintRecent();
  }

  store.subscribe(paint, ['analytics', 'progress']);

  async function refresh() {
    loading = true;

    try {
      const everything = RANGES.at(-1).days;

      const [analytics, progress, history, allAnalytics, allProgress] = await Promise.all([
        api.getAnalytics(range.days),
        api.getProgress(range.days),
        api.listSessions(RECENT_WAITS),
        // Records are lifetime bests, whatever period is on screen.
        range.days === everything ? null : api.getAnalytics(everything),
        range.days === everything ? null : api.getProgress(everything)
      ]);

      lifetime = { analytics: allAnalytics ?? analytics, progress: allProgress ?? progress };
      sessions = history.sessions ?? [];
      store.set({ analytics, progress });
      paint();
    } catch {
      // Keep the last good numbers rather than blanking the screen.
    } finally {
      loading = false;
    }
  }

  return {
    element,
    enter: refresh,
    refresh
  };
}
