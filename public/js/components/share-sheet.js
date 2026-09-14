import { el } from '../core/dom.js';
import { formatCount, hourLabel, spelledDuration } from '../core/format.js';

/**
 * Sharing.
 *
 * The card is drawn to a canvas and handed over as a PNG, because a file is the
 * only thing a feed will take. Where the browser cannot share files - which is
 * most desktops - it saves the image instead, and there is a plain-text
 * fallback for anywhere neither works.
 *
 * The sheet itself knows nothing about what is on the card: Stats hands it a
 * till receipt, Live hands it a picture of the globe.
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

/**
 * Turns a screen's worth of figures into a slip.
 *
 * Everything here is already on the Stats screen, so the shared card is the
 * same period the chips are on and there is nothing extra to fetch.
 *
 * Only facts the app actually holds. It knows how long you waited and how many
 * things you cleared; it has never known how long any one of them took, so
 * there is no "time reclaimed" here. The slip used to print one, derived from
 * the whole length of every wait that had a task in it - which counted a
 * thirty-minute wait as thirty minutes of work because you did one stretch.
 */
export function buildReceiptData({ device, analytics, progress, sessions = [], periodLabel }) {
  const shown = sessions.slice(0, ITEMS);
  const cleared = progress?.tasksCleared ?? 0;
  const waits = analytics?.sessionCount ?? 0;
  // Counted on the server, not rebuilt from the rounded percentage.
  const used = progress?.waitsUsed ?? 0;

  const place = device?.city?.name ?? device?.country?.name ?? null;
  const who = [device?.displayName || 'Anonymous dev', place].filter(Boolean).join(' · ');

  const notes = [];
  if (analytics?.peakHour !== null && analytics?.peakHour !== undefined) {
    notes.push({ label: 'BUSIEST HOUR', value: hourLabel(analytics.peakHour) });
  }
  if (analytics?.longestSessionSeconds) {
    notes.push({ label: 'LONGEST WAIT', value: spelledDuration(analytics.longestSessionSeconds) });
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
      time: spelledDuration(session.durationSeconds),
      note: session.tasksCleared
        ? `${session.tasksCleared} cleared`
        : NOTHING
    })),
    more: Math.max(0, waits - shown.length),

    /*
     * Four counts and one duration, no percentages. Two percentages of
     * different denominators sat here before - 45% of the time against 40% of
     * the waits - which invited the reader to divide one figure by another and
     * find the answer did not match.
     */
    totals: [
      { label: 'TIME WAITED', value: spelledDuration(analytics?.totalSeconds ?? 0) },
      { label: 'WAITS', value: formatCount(waits) },
      { label: 'WAITS YOU USED', value: formatCount(used) },
      { label: 'THINGS DONE', value: formatCount(cleared) }
    ],

    notes,

    // Owning the ones that got away is funnier than hiding them, and it is
    // the same number the Waits tile already admits to.
    voided: analytics?.abandonedCount
      ? `** ${analytics.abandonedCount} WAIT${analytics.abandonedCount === 1 ? '' : 'S'} LEFT RUNNING - NOT COUNTED **`
      : null,

    // Receipts carry small print, and this one has something to explain.
    smallPrint: 'A WAIT COUNTS AS USED IF YOU CLEARED SOMETHING DURING IT.',

    stamp: '*** THANK YOU ***',
    footer: 'COME BACK WHEN IT IS SLOW',
    code: 'THE-WAIT.APP',
    printedAt: printedStamp(),
    seed: (analytics?.totalSeconds ?? 0) + cleared * 31 + waits * 7
  };
}

function toBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
    else resolve(null);
  });
}

function saveImage(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });

  document.body.append(link);
  link.click();
  link.remove();

  // Revoked on the next turn of the loop, once the download has taken it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One sheet, whatever is being shared.
 *
 * The export path - canvas to PNG, Web Share where there is one, a download
 * where there is not, text as the last resort - is the same whether the card
 * is a till receipt or a picture of the globe. Only the drawing differs, so
 * that is what `open` takes.
 */
export function createShareSheet() {
  const canvas = el('canvas.receipt-canvas');
  const note = el('p.share-note');
  const heading = el('span.label.label-wide');

  let current = null;

  const primary = el('button.btn.btn-hero.btn-wide', { type: 'button', onclick: () => share() });
  const copy = el('button.btn.btn-outline.btn-wide', { type: 'button', onclick: () => copyText() }, ['Copy as text']);

  const sheet = el('div.share-sheet', {}, [
    el('div.share-card', {}, [
      el('div.row-between', {}, [
        heading,
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
    'aria-label': 'Share',
    onclick: (event) => { if (event.target === element) close(); }
  }, [sheet]);

  /** File sharing is the good path, and most desktops do not have it. */
  const canShareFiles = () => Boolean(navigator.canShare && navigator.share);

  const asText = () => current?.toText?.(current.data) ?? '';

  async function share() {
    const blob = await toBlob(canvas);
    if (!blob) return;

    const file = new File([blob], current.filename, { type: 'image/png' });

    if (canShareFiles() && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: asText() });
        note.textContent = '';
        return;
      } catch {
        // Dismissed, or refused - fall through to saving it.
      }
    }

    saveImage(blob, current.filename);
    note.textContent = 'Saved to your downloads.';
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(asText());
      note.textContent = 'Copied.';
    } catch {
      note.textContent = 'Could not copy it.';
    }
  }

  function close() {
    element.hidden = true;
  }

  /**
   * @param title    What the sheet calls it.
   * @param data     Passed straight to `draw` and `toText`.
   * @param draw     (canvas, data) - renders the card at export size.
   * @param toText   (data) - the plain-text fallback.
   * @param filename What the saved PNG is called.
   */
  function open({ title, data, draw, toText, filename = 'the-wait.png' }) {
    current = { data, toText, filename };

    heading.textContent = title;
    canvas.setAttribute('aria-label', title);
    note.textContent = '';
    primary.textContent = canShareFiles() ? 'Share' : 'Save image';

    draw(canvas, data);
    element.hidden = false;

    /*
     * Canvas takes whatever font is loaded at the moment it draws, so a card
     * opened before the webfont arrives is rendered in the fallback and stays
     * that way. Drawing again once the fonts settle costs a frame and fixes
     * it; `ready` has already resolved on any later visit.
     */
    document.fonts?.ready?.then(() => {
      if (current?.data === data) draw(canvas, data);
    }).catch(() => {});
  }

  return { element, open, close };
}
