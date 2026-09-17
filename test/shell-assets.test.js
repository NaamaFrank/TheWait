import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The service worker's precache list is written by hand, because there is no
 * build step to generate it. A module that is renamed or added without being
 * listed simply would not be available offline - and nothing else would notice.
 * This test is what notices.
 */

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Everything under these directories must be precached. */
const REQUIRED_DIRS = ['js', 'styles'];

function walk(dir) {
  const found = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(`/${path.relative(publicDir, full).split(path.sep).join('/')}`);
  }

  return found;
}

function shellAssets() {
  const source = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
  const block = /const SHELL_ASSETS = \[([\s\S]*?)\];/.exec(source);

  assert.ok(block, 'sw.js should declare SHELL_ASSETS');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('every shipped module and stylesheet is precached', () => {
  const listed = new Set(shellAssets());
  const missing = REQUIRED_DIRS.flatMap((dir) => walk(path.join(publicDir, dir))).filter(
    // The worker itself is fetched by the browser, never precached by itself.
    (asset) => asset !== '/sw.js' && !listed.has(asset)
  );

  assert.deepEqual(missing, [], `not precached in sw.js: ${missing.join(', ')}`);
});

test('every precached asset actually exists', () => {
  const missing = shellAssets()
    .filter((asset) => asset !== '/')
    .filter((asset) => !fs.existsSync(path.join(publicDir, asset.slice(1))));

  assert.deepEqual(missing, [], `listed in sw.js but not on disk: ${missing.join(', ')}`);
});

/**
 * The Stats chart area is drawn three ways - bars, a month, a year - and all
 * three have to occupy the same box, or the card resizes when the range chips
 * are tapped. That height is a token, and it is redefined on desktop, so
 * nothing in JS may draw against a number of its own.
 */
test('the bars are sized as a share of the box, not in pixels', () => {
  const stats = fs.readFileSync(path.join(publicDir, 'js', 'screens', 'stats.js'), 'utf8');
  const bar = /class: day\.isToday[\s\S]{0,200}?height: `([^`]+)`/.exec(stats);

  assert.ok(bar, 'stats.js should set a height on the chart bars');
  assert.match(bar[1], /%$/, 'a bar height must be a percentage of the track');
});

test('every Stats chart fills the box rather than fixing its own height', () => {
  const screens = fs.readFileSync(path.join(publicDir, 'styles', 'screens.css'), 'utf8');

  /** The declaration block for a selector, without a regex full of escapes. */
  const blockFor = (selector) => {
    const at = screens.indexOf(`${selector} {`);
    return at === -1 ? null : screens.slice(at, screens.indexOf('}', at));
  };

  // One box, sized by the token, shared by every drawing.
  const slot = blockFor('.chart-slot');
  assert.ok(slot, '.chart-slot should be styled');
  assert.match(slot, /min-height: var\(--chart-h\)/, 'the token is the floor of the box');

  // The drawings grow into it, so a card paired with a taller one has no gap.
  for (const selector of ['.chart', '.heat-grid', '.heatmap-scroll', '.day-strip']) {
    const block = blockFor(selector);
    assert.ok(block, `${selector} should be styled`);
    assert.match(block, /flex: 1/, `${selector} should fill the slot`);
    assert.doesNotMatch(block, /height: var\(--chart-h\)/, `${selector} must not pin its own height`);
  }
});

/**
 * Percentage bar heights need a parent whose height is settled.
 *
 * Both charts draw their bars as a share of the column they stand in. A flex
 * row that aligns its children to `flex-end` leaves each column only as tall
 * as its contents - so the percentage resolves against nothing and every bar
 * renders at zero height. The chart looks empty and nothing errors.
 */
test('the bar columns are stretched, so a percentage height has something to measure', () => {
  const screens = fs.readFileSync(path.join(publicDir, 'styles', 'screens.css'), 'utf8');

  const blockFor = (selector) => {
    const at = screens.indexOf(`${selector} {`);
    return at === -1 ? null : screens.slice(at, screens.indexOf('}', at));
  };

  // `.chart` holds .chart-col/.chart-track; `.day-bars` holds .day-hour.
  for (const selector of ['.chart', '.day-bars']) {
    const block = blockFor(selector);
    assert.ok(block, `${selector} should be styled`);
    assert.match(
      block,
      /align-items: stretch/,
      `${selector} must stretch its columns or the bars inside collapse to nothing`
    );
  }
});

test('both charts size their bars as a share of those columns', () => {
  const charts = fs.readFileSync(path.join(publicDir, 'js', 'components', 'charts.js'), 'utf8');
  const dayBar = /day-bar[\s\S]{0,300}?height: `([^`]+)`/.exec(charts);

  assert.ok(dayBar, 'charts.js should set a height on the day bars');
  assert.match(dayBar[1], /%`?$/, 'the day bars follow the box, like the chart bars');
});

/**
 * The task card must not resize as the task changes.
 *
 * Titles run from twenty characters to sixty-eight, and the line beneath from
 * thirty to eighty. On a phone that swung the body by about 74px, so every
 * "Next" resized the card and shoved everything below it down the screen.
 */
test('the task body has a floor, so the card stays the same size', () => {
  const css = fs.readFileSync(path.join(publicDir, 'styles', 'components.css'), 'utf8');

  const blockFor = (selector) => {
    const at = css.indexOf(`${selector} {`);
    return at === -1 ? null : css.slice(at, css.indexOf('}', at));
  };

  const body = blockFor('.task-body');
  assert.ok(body, '.task-body should be styled');
  assert.match(body, /min-height: \d+px/, 'without a floor the card resizes with the words');

  // Centred content would move the title about between tasks, which is the
  // same flicker by another route.
  assert.match(body, /justify-content: flex-start/, 'short tasks sit at the top');

  const desktop = blockFor('[data-view="desktop"] .task-body');
  assert.ok(desktop, 'a desktop column is wider, so it needs its own floor');
  assert.match(desktop, /min-height: \d+px/);
});
