#!/usr/bin/env node
/**
 * Generate PWA icons + OG image as PNGs without native deps:
 * draws a night-skyline motif into an RGBA buffer and encodes PNG
 * with node's zlib (deflate) + a small CRC32.
 *
 * Output: web/public/icon-192.png, icon-512.png, og-image.png
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "public");

// --- minimal PNG encoder ---
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- skyline drawing ---
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawSkyline(width, height) {
  const px = Buffer.alloc(width * height * 4);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  // night sky gradient
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const r = Math.round(11 + 30 * t);
    const g = Math.round(16 + 28 * t);
    const b = Math.round(38 + 50 * t);
    for (let x = 0; x < width; x++) set(x, y, r, g, b);
  }
  const rand = mulberry32(42);
  // stars
  for (let i = 0; i < width * height * 0.0008; i++) {
    set(Math.floor(rand() * width), Math.floor(rand() * height * 0.4), 200, 210, 230);
  }
  // buildings
  const base = Math.round(height * 0.92);
  let x = 0;
  while (x < width) {
    const w = Math.round((0.05 + rand() * 0.1) * width);
    const h = Math.round((0.2 + rand() * 0.45) * height);
    const shade = 30 + Math.round(rand() * 18);
    for (let bx = x; bx < Math.min(x + w - Math.max(2, w * 0.08), width); bx++) {
      for (let by = base - h; by < base; by++) set(bx, by, shade, shade + 4, shade + 16);
    }
    // lit windows
    const cell = Math.max(4, Math.round(width / 48));
    for (let wy = base - h + cell; wy < base - cell; wy += cell) {
      for (let wx = x + cell; wx < x + w - cell * 1.5; wx += cell) {
        if (rand() < 0.42) {
          for (let dy = 0; dy < cell * 0.45; dy++) {
            for (let dx = 0; dx < cell * 0.5; dx++) set(Math.round(wx + dx), Math.round(wy + dy), 255, 214, 150);
          }
        }
      }
    }
    x += w;
  }
  // ground / rail accent line
  for (let y = base; y < height; y++) {
    for (let gx = 0; gx < width; gx++) set(gx, y, 18, 20, 30);
  }
  const accentY = Math.round(height * 0.945);
  for (let gx = 0; gx < width; gx++) {
    set(gx, accentY, 184, 55, 63);
    set(gx, accentY + 1, 184, 55, 63);
  }
  return px;
}

for (const [name, w, h] of [["icon-192.png", 192, 192], ["icon-512.png", 512, 512], ["og-image.png", 1200, 630]]) {
  const png = encodePng(w, h, drawSkyline(w, h));
  writeFileSync(join(OUT, name), png);
  console.log(`${name}: ${(png.length / 1024).toFixed(1)} KB`);
}
