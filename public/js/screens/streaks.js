import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { screenHead } from '../components/ui.js';

/**
 * The streak and what it has earned.
 *
 * A day counts when at least one task was cleared during a wait - waiting alone
 * never advances anything here, which is the same rule the leaderboard uses.
 */

export function createStreaksScreen({ store }) {
  const element = el('section.screen', { 'data-screen': 'streaks' });

  const streakNumber = el('span.streak-num', { text: '0' });
  const streakCaption = el('span.streak-cap', { text: 'days in a row' });
  const week = el('div.week');
  const streakNote = el('p.streak-note');
  const badges = el('div.grid-2');

  render(element, [
    screenHead("Don't break it", 'Streak & spoils'),

    el('div.card-cream.streak-card', {}, [
      el('div.streak-head', {}, [streakNumber, streakCaption]),
      week,
      streakNote
    ]),

    badges
  ]);

  function paint() {
    const progress = store.state.progress;
    if (!progress) return;

    streakNumber.textContent = String(progress.streakDays);
    streakCaption.textContent = progress.streakDays === 1 ? 'day so far' : 'days in a row';

    render(week, progress.week.map((day) =>
      el('div.week-day', {
        class: day.done ? 'is-on' : '',
        title: day.date
      }, [day.label])
    ));

    streakNote.textContent = progress.streakDays
      ? `One wait put to work each day keeps it alive.${
          progress.nextMilestone ? ` Next milestone at ${progress.nextMilestone}.` : ''
        }`
      : 'Clear one task during a wait today and the streak starts.';

    render(badges, progress.badges.map((badge) =>
      el('div.badge', { class: badge.earned ? '' : 'is-locked' }, [
        el('span.badge-mark'),
        el('div.badge-name', { text: badge.name }),
        el('div.badge-note', { text: badge.note })
      ])
    ));
  }

  store.subscribe(paint, ['progress']);

  async function refresh() {
    try {
      store.set({ progress: await api.getProgress() });
    } catch {
      // Keep whatever is already drawn.
    }
  }

  return {
    element,
    enter: refresh,
    refresh
  };
}
