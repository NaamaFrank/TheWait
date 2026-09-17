import { api } from '../core/api.js';
import { el, render } from '../core/dom.js';

/**
 * The things you keep meaning to do.
 *
 * Nobody can write two hundred good twenty-minute tasks for a stranger, which
 * is why the catalogue thins out badly at the top end - but you know three.
 * These sit in the same queue as the catalogue's and are offered first when a
 * wait is the right size for them.
 *
 * Deliberately not a to-do list: no due dates, no priorities, no done-and-
 * archived pile. A short list of things worth doing in a gap.
 */

/** The sizes, in the words someone would use about their own errand. */
const SIZES = [
  { id: 'micro', label: 'A minute' },
  { id: 'short', label: 'A few minutes' },
  { id: 'medium', label: 'Ten-ish' },
  { id: 'long', label: 'A while' }
];

const DEFAULT_SIZE = 'short';

export function createOwnTasks() {
  let tasks = [];
  let size = DEFAULT_SIZE;
  let busy = false;

  const list = el('div.own-list');
  const note = el('p.own-note');

  const input = el('input.input', {
    type: 'text',
    placeholder: 'Water the plants',
    maxlength: '80',
    onkeydown: (event) => { if (event.key === 'Enter') add(); }
  });

  const sizes = el('div.own-sizes', {}, SIZES.map((option) =>
    el('button.own-size', {
      type: 'button',
      class: option.id === DEFAULT_SIZE ? 'is-active' : '',
      onclick: () => pickSize(option.id)
    }, [option.label])
  ));

  const addButton = el('button.btn.btn-outline.btn-wide', {
    type: 'button',
    onclick: () => add()
  }, ['Add it']);

  const element = el('div.card', {}, [
    el('span.label', { text: 'Your own tasks' }),
    el('p.field-hint', {
      text: 'Offered during a wait that is the right length for them, before anything from the catalogue.'
    }),
    list,
    input,
    sizes,
    addButton,
    note
  ]);

  function pickSize(next) {
    size = next;
    for (const [index, button] of [...sizes.children].entries()) {
      button.classList.toggle('is-active', SIZES[index].id === next);
    }
  }

  function paint() {
    render(list, tasks.length
      ? tasks.map((task) =>
          el('div.own-row', {}, [
            el('div.own-row-body', {}, [
              el('div.own-title.truncate', { text: task.title }),
              el('div.own-size-tag', { text: SIZES.find((s) => s.id === task.bucket)?.label ?? task.bucket })
            ]),
            el('button.own-remove', {
              type: 'button',
              'aria-label': `Remove ${task.title}`,
              onclick: () => remove(task)
            }, ['✕'])
          ])
        )
      : [el('p.own-empty', { text: 'Nothing yet. Add something you keep putting off.' })]);

    addButton.disabled = busy;
  }

  async function add() {
    const title = input.value.trim();
    if (!title || busy) return;

    busy = true;
    note.textContent = '';
    paint();

    try {
      const { task } = await api.addTask(title, size);
      tasks = [...tasks, task];
      input.value = '';
    } catch (error) {
      note.textContent = error.message ?? 'That did not save.';
    } finally {
      busy = false;
      paint();
    }
  }

  async function remove(task) {
    // Optimistic: the list is short and a failed delete puts it straight back.
    const before = tasks;
    tasks = tasks.filter((row) => row.id !== task.id);
    paint();

    try {
      await api.deleteTask(task.id);
    } catch {
      tasks = before;
      paint();
    }
  }

  async function refresh() {
    try {
      const { tasks: rows } = await api.listTasks();
      tasks = rows ?? [];
    } catch {
      // Offline: leave whatever is on screen.
    }

    paint();
  }

  paint();
  return { element, refresh };
}
