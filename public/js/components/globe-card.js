/**
 * A postcard from the wait.
 *
 * The globe is the most distinctive thing this app has, and it is already a
 * canvas - so the share card for the Live screen is the globe itself, lifted
 * straight off the screen as the reader last saw it, with a line under it.
 *
 * The line is about real people only. The map pads a quiet hour with sample
 * pins and says so on screen, but a card going out to a feed is a claim made
 * somewhere the disclaimer cannot follow it.
 */

import { spelledDuration } from '../core/format.js';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const BACKDROP_TOP = '#141B29';
const BACKDROP_BOTTOM = '#07090E';
const TEXT = '#F7EFE4';
const TEXT_SOFT = '#9AA3B4';
const TEXT_DIM = '#5E6675';
const HERO = '#FF5A36';

const SANS = 'Archivo, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function text(ctx, value, { x, y, size, weight = 400, colour = TEXT, spacing = 0, align = 'center' }) {
  ctx.fillStyle = colour;
  ctx.font = `${weight} ${size}px ${SANS}`;
  ctx.letterSpacing = `${spacing}px`;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}

/**
 * The globe, with the glow it has on screen.
 *
 * Drawn behind the image rather than over it: a halo on top would wash out the
 * coastlines, which are the whole reason this looks like anything.
 */
function drawGlobe(ctx, source, cx, cy, radius) {
  if (!source?.width) return;

  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * 1.35);
  halo.addColorStop(0, 'rgba(120, 170, 255, 0.22)');
  halo.addColorStop(1, 'rgba(120, 170, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The source canvas is square and the globe is inscribed in it.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(source, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(190, 205, 230, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A row of dots standing in for the people, capped before it becomes a wall. */
function pips(ctx, count, y) {
  const shown = Math.min(12, Math.max(0, count));
  if (!shown) return;

  const size = 9;
  const gap = 15;
  const width = shown * size + (shown - 1) * gap;
  let x = (CARD_WIDTH - width) / 2;

  for (let i = 0; i < shown; i += 1) {
    // The first pip is you.
    ctx.fillStyle = i === 0 ? HERO : 'rgba(247, 239, 228, 0.45)';
    ctx.beginPath();
    ctx.arc(x + size / 2, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    x += size + gap;
  }
}

export function drawGlobeCard(canvas, data) {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const ctx = canvas.getContext?.('2d');
  if (!ctx) return CARD_HEIGHT;

  const backdrop = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  backdrop.addColorStop(0, BACKDROP_TOP);
  backdrop.addColorStop(1, BACKDROP_BOTTOM);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.textBaseline = 'alphabetic';

  const mid = CARD_WIDTH / 2;

  text(ctx, 'THE WAIT', { x: mid, y: 96, size: 24, weight: 800, spacing: 9, colour: TEXT_SOFT });
  text(ctx, data.kicker, { x: mid, y: 140, size: 21, colour: TEXT_DIM, spacing: 2 });

  drawGlobe(ctx, data.globe, mid, 610, 350);

  text(ctx, data.headline, { x: mid, y: 1058, size: 56, weight: 800 });
  text(ctx, data.sub, { x: mid, y: 1118, size: 28, colour: TEXT_SOFT });

  if (data.company) {
    pips(ctx, data.pips, 1176);
    text(ctx, data.company, { x: mid, y: 1232, size: 23, colour: TEXT_SOFT });
  }

  /*
   * The disclosure, and it has to be here.
   *
   * The map is padded with sample pins so a quiet hour still shows something
   * alive, and the globe draws them exactly like the real ones. On screen the
   * caption underneath says so. A card goes somewhere that caption cannot
   * follow, so it carries its own.
   */
  if (data.smallPrint) {
    text(ctx, data.smallPrint, { x: mid, y: 1288, size: 18, colour: TEXT_DIM });
  }

  return CARD_HEIGHT;
}

export function globeCardText(data) {
  return [data.headline, data.sub, data.company].filter(Boolean).join(' - ') + '. the-wait.app';
}

/**
 * What the card says.
 *
 * Every line is about something the app actually knows: where you are, what
 * your own clock reads, and how many real people are mid-wait. The pins on the
 * map are not that number - most of them are samples - so the card says which
 * is which rather than letting the picture make the claim.
 */
export function buildGlobeCardData({ globe, device, presence, wait, place }) {
  const real = Math.max(1, presence?.realWaiting ?? 1);
  const others = real - 1;
  const where = place ?? device?.city?.name ?? device?.country?.name ?? null;

  const phase = wait?.phase ?? 'idle';
  const elapsed = wait?.elapsedSeconds ?? 0;

  const sub = phase === 'running'
    ? `${spelledDuration(elapsed)} in, still going`
    : phase === 'paused'
      ? `${spelledDuration(elapsed)} in, on hold`
      : 'Not waiting on anything right now';

  return {
    globe,
    kicker: 'WHO IS WAITING ON A MACHINE',
    headline: where ?? 'Somewhere on this rock',
    sub,
    pips: real,
    company: others === 0
      ? 'No one else is mid-wait right now'
      : `${others} other${others === 1 ? '' : 's'} mid-wait right now`,
    smallPrint: 'The other pins are samples, so the map is never empty',
    footer: 'THE-WAIT.APP'
  };
}
