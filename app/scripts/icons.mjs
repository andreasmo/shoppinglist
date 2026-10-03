// Erzeugt die PWA-Icons als PNG – ohne Abhängigkeiten (eigener Rasterizer + PNG-Encoder).
// Motiv: dunkles Feld, weißer Haken, drei Punkte in den Ladenfarben.   npm run icons
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x15, 0x18, 0x1d];
const WHITE = [0xff, 0xff, 0xff];
const DOTS = [
  [196, 404, 24, [0x6b, 0x93, 0xec]],
  [256, 404, 24, [0xe5, 0x63, 0x58]],
  [316, 404, 24, [0xd8, 0xa2, 0x44]],
];
const CHECK = [[150, 250], [226, 326], [370, 174]];
const HALF_STROKE = 27;
const RADIUS = 112; // Ecken der nicht-maskierbaren Variante (512er-Raster)

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRounded(u, v) {
  const dx = Math.max(RADIUS - u, 0, u - (512 - RADIUS));
  const dy = Math.max(RADIUS - v, 0, v - (512 - RADIUS));
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

/** Farbe an einem Punkt im 512er-Raster, oder null (transparent). */
function sample(u, v, rounded) {
  if (rounded && !insideRounded(u, v)) return null;
  for (let i = 0; i < CHECK.length - 1; i++) if (distToSegment(u, v, CHECK[i], CHECK[i + 1]) <= HALF_STROKE) return WHITE;
  for (const [cx, cy, r, c] of DOTS) if (Math.hypot(u - cx, v - cy) <= r) return c;
  return BG;
}

function render(size, rounded) {
  const SS = 4;
  const scale = 512 / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const c = sample((x + (i + 0.5) / SS) * scale, (y + (j + 0.5) / SS) * scale, rounded);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = (y * size + x) * 4;
      if (a) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = (name) => new URL(`../public/${name}`, import.meta.url);
for (const [name, size, rounded] of [
  ["pwa-192.png", 192, true],
  ["pwa-512.png", 512, true],
  ["pwa-maskable-512.png", 512, false],
  ["apple-touch-icon.png", 180, false],
]) {
  writeFileSync(out(name), png(size, render(size, rounded)));
  console.log(`${name} (${size}px)`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="${RADIUS}" fill="#15181d"/>
<polyline points="${CHECK.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#fff" stroke-width="${HALF_STROKE * 2}" stroke-linecap="round" stroke-linejoin="round"/>
${DOTS.map(([cx, cy, r, c]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgb(${c.join(",")})"/>`).join("\n")}
</svg>
`;
writeFileSync(out("favicon.svg"), svg);
console.log("favicon.svg");
