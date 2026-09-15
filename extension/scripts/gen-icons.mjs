// scripts/gen-icons.mjs — writes public/icon/{16,32,48,128}.png without any image library.
// Design: rounded blue tile, a white "window" (title bar + body) and a search-lens dot.
// Deterministic, so the icons are reproducible from source; run `node scripts/gen-icons.mjs`.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];

const BG = [0x1f, 0x6f, 0xeb]; // blue tile
const FG = [0xff, 0xff, 0xff]; // window
const BAR = [0xcc, 0xe0, 0xff]; // title bar tint
const LENS = [0xff, 0xb0, 0x2e]; // amber lens dot

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance to a rounded rectangle centred at (cx, cy).
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - hw + r;
  const dy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

// 1 inside, 0 outside, anti-aliased over one pixel.
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));

function mix(base, top, a) {
  return base.map((v, i) => Math.round(v + (top[i] - v) * a));
}

function pixel(size) {
  const s = size;
  return (x, y) => {
    let rgb = [0, 0, 0];
    let alpha = 0;
    // tile
    const tile = cover(sdRoundRect(x, y, s / 2, s / 2, s / 2, s / 2, s * 0.22));
    if (tile > 0) {
      rgb = BG;
      alpha = tile;
    }
    // window body
    const win = cover(sdRoundRect(x, y, s / 2, s * 0.54, s * 0.3, s * 0.24, s * 0.05));
    if (win > 0) rgb = mix(rgb, FG, win);
    // title bar (top slice of the window)
    const inWin = win > 0 && y < s * 0.4;
    if (inWin) rgb = mix(rgb, BAR, win);
    // lens dot at the lower-right corner
    const lens = cover(Math.hypot(x - s * 0.7, y - s * 0.7) - s * 0.13);
    if (lens > 0) rgb = mix(rgb, LENS, lens);
    const ring = cover(Math.abs(Math.hypot(x - s * 0.7, y - s * 0.7) - s * 0.13) - s * 0.025);
    if (ring > 0 && s >= 32) rgb = mix(rgb, BG, ring);
    return [rgb[0], rgb[1], rgb[2], Math.round(alpha * 255)];
  };
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT, `${size}.png`), png(size, pixel(size)));
  console.log(`icon ${size}x${size}`);
}
