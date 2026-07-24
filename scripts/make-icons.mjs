/**
 * Generate the PWA icons.
 *
 * Writes PNGs byte by byte using Node's built-in zlib, so the project needs
 * no image tooling and no dependencies. Run with `npm run icons`.
 *
 * The mark is a compass needle over a brass ring: legible down to about
 * 40 px, which is the size iOS shows on the home screen.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const NAVY = [11, 31, 51];
const NAVY_DEEP = [6, 22, 38];
const BRASS = [201, 162, 75];
const BRASS_BRIGHT = [240, 198, 97];
const NEEDLE_S_LIGHT = [94, 79, 46];
const NEEDLE_S_DARK = [70, 60, 35];

// --- PNG encoding ---------------------------------------------------------

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode straight RGBA bytes as a PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

  // One filter byte (0 = none) in front of each scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Drawing --------------------------------------------------------------

/** Sign of the cross product; used for the point-in-triangle test. */
const side = (px, py, ax, ay, bx, by) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = side(px, py, ax, ay, bx, by);
  const d2 = side(px, py, bx, by, cx, cy);
  const d3 = side(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Colour of the icon at a point, in coordinates centred on the mark.
 * `r` is the design radius; everything is expressed as a fraction of it.
 */
function sample(x, y, r) {
  const dist = Math.hypot(x, y);

  // Brass ring
  if (dist >= 0.86 * r && dist <= 0.99 * r) return BRASS;

  // Centre hub
  if (dist <= 0.08 * r) return NAVY_DEEP;

  const N = [0, -0.66 * r];
  const S = [0, 0.5 * r];
  const E = [0.24 * r, 0];
  const W = [-0.24 * r, 0];
  const C = [0, 0];

  // The needle is split down its axis so the two halves catch light
  // differently, which is what makes it read as a three-dimensional object.
  if (inTriangle(x, y, N, E, C)) return BRASS_BRIGHT;
  if (inTriangle(x, y, N, W, C)) return BRASS;
  if (inTriangle(x, y, S, E, C)) return NEEDLE_S_LIGHT;
  if (inTriangle(x, y, S, W, C)) return NEEDLE_S_DARK;

  return NAVY;
}

/**
 * Render one icon.
 *
 * `scale` sets how much of the square the mark occupies. Maskable icons need
 * the design inside the inner 80% so a platform can crop to a circle or a
 * squircle without clipping it.
 */
function renderIcon(size, scale) {
  const rgba = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const r = centre * scale;
  const SS = 3; // 3x3 supersampling, since there is no antialiasing to inherit

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS - centre;
          const y = py + (sy + 0.5) / SS - centre;
          const [cr, cg, cb] = sample(x, y, r);
          red += cr;
          green += cg;
          blue += cb;
        }
      }

      const n = SS * SS;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(red / n);
      rgba[i + 1] = Math.round(green / n);
      rgba[i + 2] = Math.round(blue / n);
      rgba[i + 3] = 255;
    }
  }

  return encodePng(size, rgba);
}

// --- Main -----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  ['icon-180.png', 180, 0.88],
  ['icon-192.png', 192, 0.88],
  ['icon-512.png', 512, 0.88],
  ['icon-512-maskable.png', 512, 0.62],
];

for (const [name, size, scale] of icons) {
  const png = renderIcon(size, scale);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
