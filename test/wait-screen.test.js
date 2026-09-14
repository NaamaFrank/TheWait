import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The line explaining pause and end.
 *
 * It used to be the last element on the screen - on desktop, in the opposite
 * column from the buttons it describes - so it read as a footnote about the
 * app rather than the label for two controls. It belongs with them.
 */

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const source = () => fs.readFileSync(path.join(publicDir, 'js', 'screens', 'wait.js'), 'utf8');

test('the hint sits in the timer card, with the controls it describes', () => {
  const wait = source();
  const at = wait.indexOf("el('div.card-cream'");
  // Up to the task card that follows it - the block has nested arrays, so
  // the first `]),` is the end of a row, not the end of the card.
  const card = wait.slice(at, wait.indexOf("el('div.card'", at));

  assert.ok(at !== -1, 'the timer card should still be there');
  assert.match(card, /\bhint\b/, 'the hint belongs inside the timer card');

  // And nowhere else: a second copy at the foot is what this replaced.
  const foot = wait.slice(wait.indexOf("el('div.grid-2'", at));
  assert.doesNotMatch(foot.slice(0, foot.indexOf(']);')), /\bhint\b/, 'not at the foot of the screen as well');
});

test('every phase names both controls by the words on them', () => {
  const wait = source();
  const at = wait.indexOf('const HINTS = {');
  const hints = wait.slice(at, wait.indexOf('};', at));

  // The button says Pause / Resume / End; the sentence under it must agree.
  assert.match(hints, /running: '[^']*\bPause\b[^']*\bEnd\b/, 'running names pause and end');
  assert.match(hints, /paused: '[^']*\bResume\b[^']*\bEnd\b/, 'paused names resume and end');
  assert.match(hints, /idle: '[^']*\bstart\b/, 'idle names start');
});

test('the hint is legible on the cream card it now sits on', () => {
  const css = fs.readFileSync(path.join(publicDir, 'styles', 'components.css'), 'utf8');
  const at = css.indexOf('.card-cream .hint {');

  assert.ok(at !== -1, '.hint on cream needs its own colour');
  assert.match(
    css.slice(at, css.indexOf('}', at)),
    /color: var\(--on-cream-soft\)/,
    'the dark-background tone is 2.4:1 on cream; the cream side\'s muted ink is 5.4:1'
  );
});
