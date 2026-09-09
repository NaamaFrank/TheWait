/**
 * Generates the PWA icons.
 *
 * Encodes PNGs directly (zlib is in the standard library) so the project keeps
 * its zero-dependency install. Run with `npm run icons` after changing the
 * palette below; the output is committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BACKGROUND = [7, 17, 30];
const CYAN = [125, 250, 255];
const PURPLE = [141, 109, 255];
const DEEP = [18, 26, 62];

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));

  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * Math.max(0, Math.min(1, t)));
const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * A glowing orb on a dark ground: the app mark from the header, scaled up.
 * The orb sits well inside the maskable safe zone (40% of the width), so
 * Android's circular crop never clips it.
 */
function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const orbRadius = size * 0.30;
  const ringRadius = size * 0.395;
  const ringWidth = size * 0.013;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      const distance = Math.hypot(dx, dy);

      let colour = [...BACKGROUND];

      // Outer atmosphere.
      const glow = clamp01(1 - (distance - orbRadius) / (size * 0.24));
      if (distance > orbRadius) colour = mix(colour, CYAN, glow * glow * 0.18);

      // The ring.
      const ringDelta = Math.abs(distance - ringRadius);
      if (ringDelta < ringWidth) {
        colour = mix(colour, CYAN, (1 - ringDelta / ringWidth) * 0.8);
      }

      // The orb, lit from the upper left.
      if (distance <= orbRadius) {
        const lx = (dx + orbRadius * 0.34) / orbRadius;
        const ly = (dy + orbRadius * 0.38) / orbRadius;
        const lit = clamp01(1 - Math.hypot(lx, ly) * 0.78);

        // Shade from a deep indigo in the shadow to a cyan highlight, so the
        // orb reads as a lit sphere rather than a flat disc.
        colour = mix(DEEP, mix(PURPLE, CYAN, lit ** 2.2), 0.18 + 0.82 * lit ** 0.85);

        // Soften the silhouette edge.
        const edge = clamp01((orbRadius - distance) / 1.6);
        colour = mix(mix([...BACKGROUND], CYAN, glow * glow * 0.18), colour, edge);
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = Math.round(colour[0]);
      pixels[offset + 1] = Math.round(colour[1]);
      pixels[offset + 2] = Math.round(colour[2]);
      pixels[offset + 3] = 255;
    }
  }

  return encodePng(size, pixels);
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const file = path.join(outputDir, name);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`${name} (${size}x${size}) -> ${fs.statSync(file).size} bytes`);
}
