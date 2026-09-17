import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The place-kind badges.
 *
 * Both kinds have to be visible, and visibly different. An outlined city badge
 * shipped once whose border sat at 1.3:1 against the row behind it - present in
 * the markup, invisible on screen, and read as a missing badge next to the
 * solid gold country pill. These assert the colours themselves, because that is
 * where that bug lived.
 */

const stylesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public/styles');
const components = fs.readFileSync(path.join(stylesDir, 'components.css'), 'utf8');
const tokens = fs.readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8');

/** The declarations of one rule, found by scanning rather than by regex. */
function ruleFor(selector) {
  const at = components.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);

  const open = components.indexOf('{', at);
  const close = components.indexOf('}', open);

  return Object.fromEntries(
    components
      .slice(open + 1, close)
      .split(';')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colon = line.indexOf(':');
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      })
  );
}

/** Resolves a `var(--x)` reference down to the hex the tokens name. */
function hexOf(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return trimmed.slice(0, 7);

  const name = trimmed.slice(trimmed.indexOf('--'), trimmed.indexOf(')'));
  const at = tokens.indexOf(`${name}:`);
  assert.notEqual(at, -1, `no token named ${name}`);

  const hex = tokens.slice(at + name.length + 1, tokens.indexOf(';', at)).trim();
  assert.ok(hex.startsWith('#'), `${name} is not a hex colour: ${hex}`);

  return hex;
}

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The last declaration wins, so a shorthand border is read for its colour. */
function fillOf(rule) {
  return hexOf(rule.background);
}

test('both place badges are filled, not outlined into invisibility', () => {
  for (const kind of ['country', 'city']) {
    const rule = ruleFor(`.place-kind.is-${kind}`);

    assert.ok(rule.background, `the ${kind} badge needs a background`);
    assert.notEqual(rule.background, 'transparent', `the ${kind} badge must not be transparent`);
    assert.notEqual(rule.background, 'none', `the ${kind} badge must not be blank`);
  }
});

test('both badges read clearly against the row behind them', () => {
  const row = hexOf('var(--card)');

  for (const kind of ['country', 'city']) {
    const rule = ruleFor(`.place-kind.is-${kind}`);
    const fill = fillOf(rule);
    const ink = hexOf(rule.color);

    const legible = contrast(ink, fill);
    const standsOut = contrast(fill, row);

    assert.ok(legible >= 4.5, `${kind} text is only ${legible.toFixed(2)}:1 on its own pill`);
    assert.ok(
      standsOut >= 1.5,
      `the ${kind} pill is only ${standsOut.toFixed(2)}:1 against the row, so its shape disappears`
    );
  }
});

test('the two badges are told apart by more than their wording', () => {
  const country = fillOf(ruleFor('.place-kind.is-country'));
  const city = fillOf(ruleFor('.place-kind.is-city'));

  assert.notEqual(country, city, 'a country and a city must not look identical');
  assert.ok(contrast(country, city) >= 3, 'and must differ enough to tell at a glance');
});

test('both badges share their shape, so only colour separates them', () => {
  const base = ruleFor('.place-kind');

  // Size, weight and radius live on the shared rule, not the per-kind ones.
  for (const property of ['font-size', 'font-weight', 'border-radius', 'padding']) {
    assert.ok(base[property], `.place-kind should set ${property} for both kinds`);
  }

  for (const kind of ['country', 'city']) {
    const rule = ruleFor(`.place-kind.is-${kind}`);
    for (const property of ['font-size', 'padding', 'border-radius']) {
      assert.equal(rule[property], undefined, `.is-${kind} must not restyle ${property}`);
    }
  }
});
