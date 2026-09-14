import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { formatCount } from '../core/format.js';
import { avatar, emptyState, screenHead } from '../components/ui.js';

/**
 * The weekly board.
 *
 * Ranked by XP earned during waits, never by time waited. Until there are
 * enough real players the table is padded with sample ones, and every padded
 * row says so rather than quietly passing as a person.
 */

export function createBoardScreen({ store }) {
  const element = el('section.screen', { 'data-screen': 'board' });

  const rows = el('div.board');
  const note = el('p.note');

  render(element, [
    screenHead('This week · global', 'Leaderboard'),
    rows,
    note
  ]);

  function paint() {
    const board = store.state.leaderboard;
    if (!board) return;

    render(rows, board.rows.length
      ? board.rows.map((row) =>
          el('div.board-row', { class: row.isMe ? 'is-me' : '' }, [
            el('span.board-rank', { class: row.rank <= 3 ? 'is-podium' : '', text: String(row.rank) }),
            avatar(row.isMe ? { ...row, displayName: 'Me' } : row, { size: 'md' }),
            el('div.board-body', {}, [
              el('div.board-name.truncate', { text: row.isMe ? 'You' : row.displayName }),
              el('div.board-meta.truncate', {
                text: `${row.place} · ${row.tasksCleared} tasks${row.simulated ? ' · sample player' : ''}`
              })
            ]),
            el('span.board-score', { text: formatCount(row.score) })
          ])
        )
      : [emptyState('Nobody has scored this week yet.')]);

    note.textContent =
      `Ranked by XP earned during waits, not by how long you waited. Waiting is not a skill. ` +
      `${board.realPlayers} real ${board.realPlayers === 1 ? 'player' : 'players'} this week; ` +
      `the rest of the table is sample data until more people join.`;
  }

  store.subscribe(paint, ['leaderboard']);

  async function refresh() {
    try {
      store.set({ leaderboard: await api.getLeaderboard() });
    } catch {
      // Keep the last table rather than emptying it.
    }
  }

  return {
    element,
    enter: refresh,
    refresh
  };
}
