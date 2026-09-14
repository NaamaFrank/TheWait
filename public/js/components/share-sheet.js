import { el, render } from '../core/dom.js';
import { clockFace, formatCount, headlineDuration, hourLabel } from '../core/format.js';
import { drawReceipt, receiptText } from './receipt.js';

/**
 * Sharing the numbers.
 *
 * The receipt is drawn to a canvas and handed over as a PNG, because a file is
 * the only thing a feed will take. Where the browser cannot share files - which
 * is most desktops - it saves the image instead, and there is a plain-text
 * fallback for anywhere neither works.
 */

/** How many waits are itemised before the slip becomes a list. */
const ITEMS = 6;

/** What a task-less wait is called on the slip. */
const NOTHING = 'nothing cleared';

/** `Sun 08:14` - the weekday and clock time a wait began. */
function itemLabel(startedAt) {
  const at = new Date(startedAt);
  if (Number.isNaN(at.getTime())) return 'Prompt run';

  const day = at.toLocaleDateString('en-GB', { weekday: 'short' });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} ${time}`;
}

/** `14 Sep 2026 · 09:42`, the way a till stamps the bottom of a slip. */
function printedStamp() {
  const now = new Date();
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`.toUpperCase();
}

function reclaimedSeconds(progress) {
  return (progress?.mix ?? [])
    .filter((slice) => slice.id !== 'idle')
    .reduce((sum, slice) => sum + (slice.seconds ?? 0), 0);
}

/**
 * Turns a screen's worth of figures into a slip.
 *
 * Everything here is already on the Stats screen, so the shared card is the
 * same period the chips are on and there is nothing extra to fetch.
 */
export function buildReceiptData({ device, analytics, progress, sessions = [], periodLabel }) {
  const shown = sessions.slice(0, ITEMS);
  const cleared = progress?.tasksCleared ?? 0;
  const reclaimed = reclaimedSeconds(progress);

  const place = device?.city?.name ?? device?.country?.name ?? null;
  const who = [device?.displayName || 'Anonymous dev', place].filter(Boolean).join(' · ');

  const notes = [];
  if (analytics?.peakHour !== null && analytics?.peakHour !== undefined) {
    notes.push({ label: 'BUSIEST HOUR', value: hourLabel(analytics.peakHour) });
  }
  if (analytics?.longestSessionSeconds) {
    notes.push({ label: 'LONGEST WAIT', value: clockFace(analytics.longestSessionSeconds) });
  }
  if (progress?.streakDays) {
    notes.push({ label: 'STREAK', value: `${progress.streakDays} DAY${progress.streakDays === 1 ? '' : 'S'}` });
  }

  return {
    who,
    period: periodLabel,

    items: shown.map((session) => ({
      // When it happened, not what it was called. Six lines all reading
      // "Prompt run" is a list of nothing; the times are the texture.
      label: itemLabel(session.startedAt),
      time: clockFace(session.durationSeconds),
      note: session.tasksCleared
        ? `${session.tasksCleared} cleared`
        : NOTHING
    })),
    more: Math.max(0, (analytics?.sessionCount ?? 0) - shown.length),

    totals: [
      { label: 'WAITED', value: headlineDuration(analytics?.totalSeconds ?? 0) },
      { label: 'RECLAIMED', value: headlineDuration(reclaimed) },
      { label: 'CLEARED', value: formatCount(cleared) },
      { label: 'PUT TO WORK', value: `${progress?.putToWorkPercent ?? 0}%` }
    ],

    notes,

    // Owning the ones that got away is funnier than hiding them, and it is
    // the same number the Waits tile already admits to.
    voided: analytics?.abandonedCount
      ? `** ${analytics.abandonedCount} LEFT RUNNING - VOID **`
      : null,

    stamp: '*** THANK YOU ***',
    footer: 'COME BACK WHEN IT IS SLOW',
    code: 'THE-WAIT.APP',
    printedAt: printedStamp(),
    seed: (analytics?.totalSeconds ?? 0) + cleared * 31 + (analytics?.sessionCount ?? 0) * 7
  };
}

function toBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
    else resolve(null);
  });
}

function saveImage(blob) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: 'the-wait-receipt.png' });

  document.body.append(link);
  link.click();
  link.remove();

  // Revoked on the next turn of the loop, once the download has taken it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createShareSheet() {
  const canvas = el('canvas.receipt-canvas', { 'aria-label': 'Your receipt' });
  const note = el('p.share-note');

  let data = null;

  const primary = el('button.btn.btn-hero.btn-wide', { type: 'button', onclick: () => share() });
  const copy = el('button.btn.btn-outline.btn-wide', { type: 'button', onclick: () => copyText() }, ['Copy as text']);

  const sheet = el('div.share-sheet', {}, [
    el('div.share-card', {}, [
      el('div.row-between', {}, [
        el('span.label.label-wide', { text: 'Your receipt' }),
        el('button.share-close', {
          type: 'button',
          'aria-label': 'Close',
          onclick: () => close()
        }, ['✕'])
      ]),
      el('div.receipt-frame', {}, [canvas]),
      note,
      primary,
      copy
    ])
  ]);

  const element = el('div.share-backdrop', {
    hidden: true,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Share your receipt',
    onclick: (event) => { if (event.target === element) close(); }
  }, [sheet]);

  /** File sharing is the good path, and most desktops do not have it. */
  const canShareFiles = () =>
    Boolean(navigator.canShare && navigator.share);

  async function share() {
    const blob = await toBlob(canvas);
    if (!blob) return;

    const file = new File([blob], 'the-wait-receipt.png', { type: 'image/png' });

    if (canShareFiles() && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: receiptText(data) });
        note.textContent = '';
        return;
      } catch {
        // Dismissed, or refused - fall through to saving it.
      }
    }

    saveImage(blob);
    note.textContent = 'Saved to your downloads.';
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(receiptText(data));
      note.textContent = 'Copied.';
    } catch {
      note.textContent = 'Could not copy it.';
    }
  }

  function close() {
    element.hidden = true;
  }

  function open(next) {
    data = next;
    note.textContent = '';
    primary.textContent = canShareFiles() ? 'Share' : 'Save image';

    drawReceipt(canvas, data);
    element.hidden = false;
  }

  return { element, open, close };
}
