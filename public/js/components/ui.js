import { el } from '../core/dom.js';
import { humanDuration, relativeTime } from '../core/format.js';
import { icon } from './icons.js';

/** Presentational pieces shared by more than one screen. */

export function panelHead(kicker, title, trailing = null) {
  return el('div.panel-head', {}, [
    el('div', {}, [el('span.panel-kicker', { text: kicker }), el('h2', { text: title })]),
    trailing
  ]);
}

export function metricCard({ label, value, hint, iconName, tone = 'neutral' }) {
  return el('article.card.metric-card', {}, [
    el('div.metric-head', {}, [
      el('span.metric-label', { text: label }),
      el('span.metric-icon', {}, [icon(iconName, { size: 16 })])
    ]),
    el('div.metric-value', { text: value }),
    hint ? el('div.metric-hint', { class: `tone-${tone}`, text: hint }) : null
  ]);
}

export function sessionRow(session, { onDelete } = {}) {
  return el('article.session-row', { dataset: { id: session.id } }, [
    el('span.session-icon', {}, [icon('timer', { size: 18 })]),
    el('span.session-body', {}, [
      el('span.session-title', { text: session.label }),
      el('span.session-meta', { text: relativeTime(session.startedAt) })
    ]),
    el('span.session-duration', { text: humanDuration(session.durationSeconds) }),
    onDelete
      ? el('button.icon-button.session-delete', {
          type: 'button',
          'aria-label': `Delete ${session.label}`,
          onclick: () => onDelete(session)
        }, [icon('trash', { size: 16 })])
      : null
  ]);
}

export function emptyState(message, hint) {
  return el('div.empty-state', {}, [
    el('p.empty-title', { text: message }),
    hint ? el('p.empty-hint', { text: hint }) : null
  ]);
}

/** Non-blocking status line; screens use it instead of throwing alerts around. */
export function statusLine() {
  const node = el('p.status-line', { role: 'status', 'aria-live': 'polite' });

  return {
    node,
    set(message, tone = 'neutral') {
      node.textContent = message ?? '';
      node.dataset.tone = tone;
      node.classList.toggle('is-visible', Boolean(message));
    }
  };
}
