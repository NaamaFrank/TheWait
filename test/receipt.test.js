import assert from 'node:assert/strict';
import test from 'node:test';
import { receiptText } from '../public/js/components/receipt.js';

/**
 * The share card.
 *
 * The drawing itself is a canvas, which has nothing to assert about here - it
 * is checked by rendering it and looking at it. What is worth pinning is the
 * slip's arithmetic and the text fallback, both of which are pure.
 */

const SLIP = {
  who: 'Naama · Tel Aviv',
  period: 'Last 7 days',
  items: [{ label: 'Mon 08:14', time: '30:51', note: '4 cleared' }],
  more: 6,
  totals: [
    { label: 'WAITED', value: '3h 3m' },
    { label: 'RECLAIMED', value: '1h 31m' }
  ],
  notes: [{ label: 'STREAK', value: '7 DAYS' }],
  voided: '** 2 LEFT RUNNING - VOID **',
  stamp: '*** THANK YOU ***',
  footer: 'COME BACK WHEN IT IS SLOW',
  code: 'THE-WAIT.APP',
  printedAt: '14 SEPT 2026 · 12:17',
  seed: 1234
};

test('the text fallback keeps the figures in one column', () => {
  const lines = receiptText(SLIP).split('\n');
  const waited = lines.find((line) => line.startsWith('WAITED'));
  const reclaimed = lines.find((line) => line.startsWith('RECLAIMED'));

  assert.ok(waited && reclaimed);
  // Dot leaders are the whole point; every row has to end in the same place.
  assert.equal(waited.length, reclaimed.length, 'the values must line up');
  assert.ok(waited.endsWith('3h 3m'));
});

test('a long label does not push the value off the line', () => {
  const text = receiptText({
    ...SLIP,
    totals: [{ label: 'A VERY LONG LABEL INDEED THAT RUNS ON', value: '999h' }]
  });

  const row = text.split('\n').find((line) => line.startsWith('A VERY'));
  assert.ok(row.endsWith('999h'), 'the value survives');
  assert.ok(row.includes('.'), 'and there is still a leader, however short');
});

test('the slip says who and when', () => {
  const text = receiptText(SLIP);

  assert.match(text, /NAAMA · TEL AVIV/);
  assert.match(text, /LAST 7 DAYS/);
  assert.match(text, /THANK YOU/);
});
