import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { headlineDuration, hourLabel, humanDuration } from '../core/format.js';
import { dailyBarChart, hourlyTrendChart } from '../components/charts.js';
import { emptyState, metricCard, panelHead, sessionRow } from '../components/ui.js';
import { icon } from '../components/icons.js';

/** Analytics & Insights - weekly aggregates, hour-of-day trend, session history. */

const WINDOW_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
];

export function createAnalyticsScreen({ store }) {
  const metrics = el('div.metric-grid');
  const trendChart = el('div.chart-slot');
  const dailyChart = el('div.chart-slot');
  const historyList = el('div.session-list');
  const peakNote = el('span.panel-note', { text: '' });

  let windowDays = WINDOW_OPTIONS[0].days;
  let loading = false;

  const windowToggle = el('div.segmented', { role: 'group', 'aria-label': 'Analytics window' },
    WINDOW_OPTIONS.map((option) =>
      el('button.segmented-option', {
        type: 'button',
        class: option.days === windowDays ? 'is-active' : '',
        dataset: { days: String(option.days) },
        onclick: () => {
          if (windowDays === option.days) return;
          windowDays = option.days;
          syncToggle();
          refresh();
        }
      }, [option.label])
    )
  );

  function syncToggle() {
    for (const button of windowToggle.children) {
      button.classList.toggle('is-active', Number(button.dataset.days) === windowDays);
    }
  }

  const element = el('section.screen.screen-analytics', { hidden: true }, [
    el('header.screen-head', {}, [
      el('div', {}, [
        el('p.eyebrow', { text: 'Insights' }),
        el('h1', { text: 'Your waiting' })
      ]),
      windowToggle
    ]),

    metrics,

    el('section.card', {}, [
      panelHead('Latency trend', 'By hour of day', peakNote),
      trendChart
    ]),

    el('section.card', {}, [
      panelHead('Daily totals', 'Per day', null),
      dailyChart
    ]),

    el('section.card', {}, [
      panelHead('Recent sessions', 'History', null),
      historyList
    ])
  ]);

  function renderMetrics(analytics) {
    const changed = analytics.totalChangePercent;
    const changeHint =
      changed === null
        ? 'No prior period to compare'
        : `${changed >= 0 ? '+' : ''}${changed}% vs previous ${analytics.windowDays} days`;

    render(metrics, [
      metricCard({
        label: `Total wait, last ${analytics.windowDays} days`,
        value: headlineDuration(analytics.totalSeconds),
        hint: changeHint,
        iconName: 'chart',
        tone: changed === null ? 'neutral' : changed > 0 ? 'negative' : 'positive'
      }),
      metricCard({
        label: 'Daily average',
        value: `${headlineDuration(analytics.dailyAverageSeconds)}/day`,
        hint: `${analytics.sessionCount} session${analytics.sessionCount === 1 ? '' : 's'} logged`,
        iconName: 'bars'
      }),
      metricCard({
        label: 'Average wait',
        value: humanDuration(analytics.averageSessionSeconds),
        hint: `Longest ${humanDuration(analytics.longestSessionSeconds)}`,
        iconName: 'timer'
      })
    ]);
  }

  async function refresh() {
    if (loading) return;
    loading = true;

    try {
      const analytics = await api.getAnalytics(windowDays);
      const { sessions } = await api.listSessions(25);

      store.set({ analytics });
      renderMetrics(analytics);

      peakNote.textContent = analytics.peakHour === null ? '' : `Peak ${hourLabel(analytics.peakHour)}`;

      render(trendChart, hourlyTrendChart(analytics.hourly));
      render(dailyChart, dailyBarChart(analytics.daily));

      render(
        historyList,
        sessions.length
          ? sessions.map((session) => sessionRow(session, { onDelete: removeSession }))
          : emptyState('No waits logged yet.', 'Start the timer next time you send a prompt.')
      );
    } catch (error) {
      render(metrics, emptyState('Could not load your insights.', error.message));
    } finally {
      loading = false;
    }
  }

  async function removeSession(session) {
    const row = historyList.querySelector(`[data-id="${CSS.escape(session.id)}"]`);
    row?.classList.add('is-removing');

    try {
      await api.deleteSession(session.id);
      await refresh();
    } catch {
      row?.classList.remove('is-removing');
    }
  }

  const exportButton = el('button.button.button-ghost.export-button', {
    type: 'button',
    onclick: exportLog
  }, [icon('check', { size: 16 }), el('span.button-label', { text: 'Copy log as JSON' })]);

  element.append(exportButton);

  async function exportLog() {
    try {
      const { sessions } = await api.listSessions(500);
      await navigator.clipboard.writeText(JSON.stringify(sessions, null, 2));
      exportButton.querySelector('.button-label').textContent = 'Copied';
    } catch {
      exportButton.querySelector('.button-label').textContent = 'Copy failed';
    } finally {
      setTimeout(() => {
        exportButton.querySelector('.button-label').textContent = 'Copy log as JSON';
      }, 1800);
    }
  }

  return {
    element,
    enter: refresh,
    refresh
  };
}
