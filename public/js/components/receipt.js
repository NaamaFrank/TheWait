/**
 * A till receipt for time spent waiting on a machine.
 *
 * Drawn to a canvas rather than composed in the DOM because the point of it is
 * the PNG: a sentence on a clipboard is not something anybody posts. Everything
 * is laid out in "paper units" and scaled once, so the same code renders both
 * the preview on screen and the full-size export.
 *
 * The look is a thermal till roll - narrow, monospaced, dot leaders, a torn
 * edge at both ends - because it is the one share card that is funny about the
 * thing this app is for, and because mono text in a narrow column needs no
 * layout engine to look deliberate.
 */

/** The export. Portrait, which is what every feed wants. */
export const CARD_WIDTH = 1080;
export const CARD_MIN_HEIGHT = 1350;

const PAPER_WIDTH = 660;
const PAD_X = 46;

/** Radians off square. Roughly a degree - any more and it reads as a mistake. */
const PAPER_TILT = -0.019;

/* --- The palette ---------------------------------------------------------- */

const BACKDROP_TOP = '#1C1714';
const BACKDROP_BOTTOM = '#0E0B0A';
const PAPER = '#F6F1E6';
const PAPER_BAND = '#E4DBC9';
const INK = '#26211D';
const INK_SOFT = '#6F6558';
const INK_FAINT = '#A99D8C';
const ACCENT = '#C1442A';

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

/* --- Small drawing helpers ------------------------------------------------ */

function ink(ctx, { size = 19, weight = 400, colour = INK, spacing = 0 } = {}) {
  ctx.fillStyle = colour;
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.letterSpacing = `${spacing}px`;
}

function centred(ctx, text, y, options = {}) {
  ink(ctx, options);
  ctx.textAlign = 'center';
  ctx.fillText(text, PAPER_WIDTH / 2, y);
  ctx.textAlign = 'left';
}

/**
 * A label on the left, a figure on the right, joined by dots.
 *
 * The leader dots are what make it read as a receipt rather than a table, and
 * they are measured rather than guessed so the right column never drifts.
 */
function row(ctx, label, value, y, options = {}) {
  const { size = 19, weight = 400, colour = INK, leader = '.' } = options;
  ink(ctx, { size, weight, colour });

  const left = PAD_X;
  const right = PAPER_WIDTH - PAD_X;
  const labelWidth = ctx.measureText(label).width;
  const valueWidth = ctx.measureText(value).width;

  ctx.fillText(label, left, y);
  ctx.textAlign = 'right';
  ctx.fillText(value, right, y);
  ctx.textAlign = 'left';

  const gap = right - left - labelWidth - valueWidth - 16;
  if (gap <= 0 || !leader) return;

  const dot = ctx.measureText(leader).width || 1;
  ink(ctx, { size, weight, colour: INK_FAINT });
  ctx.fillText(leader.repeat(Math.floor(gap / dot)), left + labelWidth + 8, y);
}

function rule(ctx, y, { dashed = true, colour = INK_FAINT, width = 1 } = {}) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [5, 5] : []);
  ctx.beginPath();
  ctx.moveTo(PAD_X, y);
  ctx.lineTo(PAPER_WIDTH - PAD_X, y);
  ctx.stroke();
  ctx.restore();
}

/**
 * The torn edge.
 *
 * A till roll is ripped, not cut, so both ends get the same sawtooth. It is
 * the detail that stops the card reading as a white rectangle.
 */
function tornEdge(ctx, y, direction, { reverse = false } = {}) {
  const teeth = 34;
  const step = PAPER_WIDTH / teeth;
  const depth = 13;

  /*
   * Continues the path from wherever it already is - it never moves to a
   * corner of its own. The bottom edge is walked right to left, because
   * jumping back to x=0 to start it crosses the outline and fills the whole
   * card with a black triangle.
   */
  if (reverse) {
    for (let i = teeth; i > 0; i -= 1) {
      ctx.lineTo(i * step - step / 2, y + depth * direction);
      ctx.lineTo((i - 1) * step, y);
    }
    return;
  }

  for (let i = 0; i < teeth; i += 1) {
    ctx.lineTo(i * step + step / 2, y + depth * direction);
    ctx.lineTo((i + 1) * step, y);
  }
}

/**
 * Decoration, but stable for a given set of numbers rather than random noise.
 *
 * Thin bars with wide gaps, and a taller guard pair at each end. Even widths
 * and thick bars read as a solid black block rather than a barcode.
 */
function barcode(ctx, y, seed) {
  let state = Math.max(1, Math.abs(Math.trunc(seed)) || 7);
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };

  const height = 56;
  const left = PAD_X + 56;
  const right = PAPER_WIDTH - PAD_X - 56;
  ctx.fillStyle = INK;

  const guard = (x) => {
    ctx.fillRect(x, y, 2, height + 8);
    ctx.fillRect(x + 5, y, 2, height + 8);
  };

  guard(left);
  guard(right - 7);

  let x = left + 16;
  while (x < right - 20) {
    const bar = 1 + (next() % 4);
    const gap = 3 + (next() % 5);
    if (x + bar > right - 20) break;
    ctx.fillRect(x, y, bar, height);
    x += bar + gap;
  }
}

const upper = (text) => String(text ?? '').toUpperCase();

/** Thermal paper, with the faint banding a cheap printer leaves behind. */
function drawPaper(ctx, height) {
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    tornEdge(ctx, 0, 1);                            // left to right, across the top
    ctx.lineTo(PAPER_WIDTH, height);                // down the right edge
    tornEdge(ctx, height, -1, { reverse: true });   // right to left, across the bottom
    ctx.closePath();                                // up the left edge
  };

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 54;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = PAPER;
  outline();
  ctx.fill();
  ctx.restore();

  // Everything below is clipped to the paper, so nothing bleeds over a tooth.
  ctx.save();
  outline();
  ctx.clip();

  /*
   * A till roll is never flat. A hint of shade down both long edges is what
   * stops this reading as a white rectangle with text on it.
   */
  const curl = ctx.createLinearGradient(0, 0, PAPER_WIDTH, 0);
  curl.addColorStop(0, 'rgba(140, 124, 100, 0.20)');
  curl.addColorStop(0.12, 'rgba(140, 124, 100, 0)');
  curl.addColorStop(0.88, 'rgba(140, 124, 100, 0)');
  curl.addColorStop(1, 'rgba(140, 124, 100, 0.16)');
  ctx.fillStyle = curl;
  ctx.fillRect(0, 0, PAPER_WIDTH, height);

  ctx.fillStyle = PAPER_BAND;
  ctx.globalAlpha = 0.3;
  for (let y = 0; y < height; y += 21) ctx.fillRect(0, y, PAPER_WIDTH, 1);
  ctx.restore();
}

/* --- The slip ------------------------------------------------------------- */

/**
 * Draws the slip and reports how long it came out.
 *
 * Called twice: once against a throwaway context to measure, once for real.
 * A week with eight waits on it is taller than one with two, and the card is
 * sized around whatever this returns.
 */
function drawSlip(ctx, data) {
  let y = 62;
  const line = (n = 1) => { y += 26 * n; };

  ctx.textBaseline = 'alphabetic';

  centred(ctx, 'THE WAIT', y + 14, { size: 42, weight: 700, spacing: 6 });
  line(2.3);
  centred(ctx, 'RECEIPT FOR TIME SPENT', y, { size: 17, colour: INK_SOFT, spacing: 1 });
  line();
  centred(ctx, 'WAITING ON A MACHINE', y, { size: 17, colour: INK_SOFT, spacing: 1 });
  line(1.7);

  centred(ctx, upper(data.who), y, { size: 19, weight: 700 });
  line();
  centred(ctx, upper(data.period), y, { size: 16, colour: INK_SOFT });
  line(1.5);

  rule(ctx, y, { dashed: false });
  line(0.9);
  row(ctx, 'ITEM', 'TIME', y, { size: 15, colour: INK_SOFT, leader: null });
  line(0.5);
  rule(ctx, y);
  line(1.2);

  for (const item of data.items) {
    row(ctx, item.label, item.time, y);
    line();

    if (item.note) {
      ink(ctx, { size: 15, colour: INK_SOFT });
      ctx.fillText(`  ${item.note}`, PAD_X, y);
      line(0.9);
    }
  }

  if (data.more) {
    ink(ctx, { size: 15, colour: INK_SOFT });
    ctx.fillText(`  ...and ${data.more} more`, PAD_X, y);
    line(1.2);
  } else {
    line(0.3);
  }

  rule(ctx, y);
  line(1.3);

  for (const total of data.totals) {
    row(ctx, total.label, total.value, y, { size: 21, weight: 700 });
    line(1.15);
  }

  line(0.2);
  rule(ctx, y, { dashed: false, colour: INK, width: 2 });
  line(0.35);
  rule(ctx, y, { dashed: false, colour: INK, width: 2 });
  line(1.4);

  for (const note of data.notes) {
    row(ctx, note.label, note.value, y, { size: 17, colour: INK_SOFT });
    line();
  }

  if (data.voided) {
    line(0.4);
    ink(ctx, { size: 17, weight: 700, colour: ACCENT });
    ctx.fillText(data.voided, PAD_X, y);
    line(1.2);
  } else {
    line(0.6);
  }

  rule(ctx, y);
  line(1.6);

  centred(ctx, data.stamp, y, { size: 20, weight: 700, spacing: 2 });
  line(1.3);
  centred(ctx, data.footer, y, { size: 15, colour: INK_SOFT });
  line(2);

  barcode(ctx, y, data.seed);
  y += 64;
  line(1.2);

  centred(ctx, data.code, y, { size: 14, colour: INK_SOFT, spacing: 3 });
  line(0.9);
  centred(ctx, data.printedAt, y, { size: 13, colour: INK_FAINT, spacing: 1 });
  line(1.6);

  return y;
}

/* --- The card ------------------------------------------------------------- */

/**
 * Renders the receipt into `canvas`, sizing the canvas to the content.
 *
 * Returns the height used so a caller can lay out a preview without having to
 * measure the bitmap itself.
 */
export function drawReceipt(canvas, data) {
  const doc = canvas.ownerDocument ?? globalThis.document;
  const probe = doc?.createElement?.('canvas');
  let slipHeight = 1100;

  if (probe) {
    probe.width = PAPER_WIDTH;
    probe.height = 4000;
    const probeCtx = probe.getContext?.('2d');
    if (probeCtx) slipHeight = drawSlip(probeCtx, data);
  }

  const margin = 120;
  const height = Math.max(CARD_MIN_HEIGHT, Math.round(slipHeight + margin * 2));

  canvas.width = CARD_WIDTH;
  canvas.height = height;

  const ctx = canvas.getContext?.('2d');
  if (!ctx) return height;

  const backdrop = ctx.createLinearGradient(0, 0, CARD_WIDTH, height);
  backdrop.addColorStop(0, BACKDROP_TOP);
  backdrop.addColorStop(1, BACKDROP_BOTTOM);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  /*
   * A degree or so off square. Nobody lays a receipt down straight, and the
   * tilt is most of what makes this read as a photographed object rather than
   * a rectangle that happens to be on a dark background. The margin absorbs
   * the corners that swing out.
   */
  ctx.save();
  ctx.translate(CARD_WIDTH / 2, height / 2);
  ctx.rotate(PAPER_TILT);
  ctx.translate(-PAPER_WIDTH / 2, -slipHeight / 2);
  drawPaper(ctx, slipHeight);
  drawSlip(ctx, data);
  ctx.restore();

  return height;
}

/** The same slip as plain text, for anywhere an image will not go. */
export function receiptText(data) {
  const width = 34;
  const pad = (label, value) => {
    const dots = Math.max(1, width - label.length - value.length);
    return label + '.'.repeat(dots) + value;
  };

  return [
    'THE WAIT - receipt for time spent',
    'waiting on a machine',
    '',
    upper(data.who),
    upper(data.period),
    '',
    ...data.totals.map((total) => pad(total.label, total.value)),
    '',
    ...data.notes.map((note) => pad(note.label, note.value)),
    '',
    data.stamp
  ].join('\n');
}
