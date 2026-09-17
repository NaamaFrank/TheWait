import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';
import { relativeTime } from '../core/format.js';

/**
 * Editors that start and end waits for you.
 *
 * A Claude Code hook can open a wait the moment a prompt is sent and close it
 * when the turn comes back, which is the whole loop with no button to press.
 *
 * The token is shown once and never again - the server keeps only a hash of it
 * - and every one is listed here with when it was last used, so anything that
 * looks wrong is one tap from revoked.
 */

const HOOK = 'node scripts/thewait-hook.mjs';

export function createAgents() {
  let agents = [];
  let issued = null;
  let busy = false;

  const list = el('div.own-list');
  const note = el('p.own-note');
  const reveal = el('div.agent-reveal', { hidden: true });

  const addButton = el('button.btn.btn-outline.btn-wide', {
    type: 'button',
    onclick: () => connect()
  }, ['Connect Claude Code']);

  const element = el('div.card', {}, [
    el('span.label', { text: 'Connected editors' }),
    el('p.field-hint', {
      text: 'A hook starts the wait when you send a prompt and ends it when the answer lands. Works only on this machine.'
    }),
    list,
    reveal,
    addButton,
    note
  ]);

  function paint() {
    render(list, agents.length
      ? agents.map((agent) =>
          el('div.own-row', {}, [
            el('div.own-row-body', {}, [
              el('div.own-title.truncate', { text: agent.label }),
              el('div.own-size-tag', {
                text: agent.lastUsedAt ? `last used ${relativeTime(agent.lastUsedAt)}` : 'never used'
              })
            ]),
            el('button.own-remove', {
              type: 'button',
              'aria-label': `Revoke ${agent.label}`,
              onclick: () => revoke(agent)
            }, ['✕'])
          ])
        )
      : [el('p.own-empty', { text: 'Nothing connected.' })]);

    addButton.disabled = busy;
  }

  /** Shown once. There is no second chance, because nothing stored it. */
  function showToken(token) {
    issued = token;

    render(reveal, [
      el('p.agent-once', { text: 'Copy this now. It is not shown again.' }),
      el('code.agent-token', { text: token }),
      el('button.btn.btn-hero.btn-wide', {
        type: 'button',
        onclick: () => copy(token)
      }, ['Copy']),
      el('p.agent-steps', { text: 'Then, in your project:' }),
      el('code.agent-cmd', { text: `${HOOK} login ${token.slice(0, 8)}…` }),
      el('p.agent-steps', {
        text: 'Add the start and end hooks to .claude/settings.json - see README.'
      }),
      el('button.btn.btn-outline.btn-wide', {
        type: 'button',
        onclick: () => { reveal.hidden = true; issued = null; }
      }, ['Done'])
    ]);

    reveal.hidden = false;
  }

  async function copy(token) {
    try {
      await navigator.clipboard.writeText(token);
      note.textContent = 'Copied.';
    } catch {
      note.textContent = 'Could not copy it - select it by hand.';
    }
  }

  async function connect() {
    if (busy) return;
    busy = true;
    note.textContent = '';
    paint();

    try {
      const { agent, token } = await api.createAgent('Claude Code');
      agents = [agent, ...agents];
      showToken(token);
    } catch (error) {
      note.textContent = error.message ?? 'That did not work.';
    } finally {
      busy = false;
      paint();
    }
  }

  async function revoke(agent) {
    const before = agents;
    agents = agents.filter((row) => row.id !== agent.id);
    paint();

    try {
      await api.revokeAgent(agent.id);
    } catch {
      agents = before;
      paint();
    }
  }

  async function refresh() {
    try {
      const { agents: rows } = await api.listAgents();
      agents = rows ?? [];
    } catch {
      // Offline: leave whatever is on screen.
    }

    paint();
  }

  paint();
  return { element, refresh };
}
