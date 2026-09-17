import assert from 'node:assert/strict';
import test from 'node:test';
import { createCarousel } from '../public/js/core/carousel.js';

/**
 * Screen lifecycle order.
 *
 * A screen that sizes something against its own box - the Live screen's globe -
 * gets zero from a box that is still `display: none`. `start` showed the screen
 * before entering it; `activate` did the reverse, so every later tab switch
 * measured nothing, kept the size it had, and jumped once something else
 * resized it. Both paths have to agree.
 */

/** Just enough element for the carousel; `classList` is the part under test. */
function fakeElement() {
  const classes = new Set();

  return {
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name)
    },
    setAttribute() {},
    addEventListener() {},
    style: { setProperty() {} },
    inert: false
  };
}

/** Reports a width only while it is the current screen, as a real box does. */
function measuringScreen() {
  const element = fakeElement();
  const measured = [];

  return {
    element,
    measured,
    enter() {
      measured.push(element.classList.contains('is-current') ? 600 : 0);
    },
    leave() {}
  };
}

function build() {
  globalThis.addEventListener ??= () => {};

  const first = measuringScreen();
  const second = measuringScreen();

  const carousel = createCarousel({
    track: fakeElement(),
    screens: [first, second],
    initialIndex: 0,
    sliding: false,
    onChange() {}
  });

  return { carousel, first, second };
}

test('a screen is visible before it is entered, on first paint', () => {
  const { carousel, first } = build();
  carousel.start();

  assert.deepEqual(first.measured, [600], 'the first screen must measure its real box');
});

test('a screen is visible before it is entered, on every later switch', () => {
  const { carousel, second } = build();
  carousel.start();
  carousel.go(1);

  // Zero here is the bug: enter() runs, measures nothing, and the screen keeps
  // whatever size it had until something resizes it - visibly, after paint.
  assert.deepEqual(second.measured, [600], 'switching must not measure a hidden screen');
});

test('leaving happens before the next screen takes over', () => {
  const order = [];
  globalThis.addEventListener ??= () => {};

  const screen = (name) => ({
    element: fakeElement(),
    enter: () => order.push(`enter ${name}`),
    leave: () => order.push(`leave ${name}`)
  });

  const carousel = createCarousel({
    track: fakeElement(),
    screens: [screen('a'), screen('b')],
    initialIndex: 0,
    sliding: false,
    onChange() {}
  });

  carousel.start();
  carousel.go(1);

  assert.deepEqual(order, ['enter a', 'leave a', 'enter b'], 'nothing polls off-screen');
});
