// Draws the app icons in public/icons/ from the Roster Mate mark (src/components/Logo.tsx).
// Placeholder artwork with no image dependencies: run `node scripts/icons.mjs` from web/ after
// changing the mark, and commit the PNGs.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = "#0E1014";

// The mark in its 30x30 viewBox, in paint order.
const MARK = [
  { x: 1, y: 1, w: 28, h: 28, r: 8, fill: "#161920", stroke: "#2A2F38", sw: 1 },
  { x: 7, y: 7, w: 7, h: 7, r: 2, fill: "#FCC35A" },
  { x: 16, y: 7, w: 7, h: 7, r: 2, fill: "#7DD3FC" },
  { x: 7, y: 16, w: 7, h: 7, r: 2, fill: "#C9B6FD" },
  { x: 16, y: 16, w: 7, h: 7, r: 2, stroke: "#5A616D", sw: 1.5 },
];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Signed distance from (px, py) to a rounded rectangle; negative inside.
function sdf(s, px, py) {
  const hw = s.w / 2;
  const hh = s.h / 2;
  const qx = Math.abs(px - (s.x + hw)) - (hw - s.r);
  const qy = Math.abs(py - (s.y + hh)) - (hh - s.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r;
}

/**
 * Renders the mark as a size x size PNG. With bleed, the canvas is filled with BG and the mark
 * scaled to `scale` of the canvas (maskable and Apple icons need an opaque, full-bleed square).
 */
function render(size, { bleed = false, scale = 1 } = {}) {
  const px = new Float64Array(size * size * 4); // premultiplied RGBA, 0..1
  const N = 4; // supersamples per axis
  const unit = (size * scale) / 30;
  const off = (size - size * scale) / 2;
  const layers = [];
  if (bleed) layers.push({ test: () => true, rgb: hex(BG) });
  for (const s of MARK) {
    if (s.fill) layers.push({ test: (x, y) => sdf(s, x, y) <= 0, rgb: hex(s.fill) });
    if (s.stroke) {
      layers.push({ test: (x, y) => Math.abs(sdf(s, x, y)) <= s.sw / 2, rgb: hex(s.stroke) });
    }
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4;
      for (const layer of layers) {
        let cov = 0;
        for (let sy = 0; sy < N; sy++) {
          for (let sx = 0; sx < N; sx++) {
            const x = (i + (sx + 0.5) / N - off) / unit;
            const y = (j + (sy + 0.5) / N - off) / unit;
            if (layer.test(x, y)) cov++;
          }
        }
        const a = cov / (N * N);
        if (!a) continue;
        for (let c = 0; c < 3; c++) px[o + c] = (layer.rgb[c] / 255) * a + px[o + c] * (1 - a);
        px[o + 3] = a + px[o + 3] * (1 - a);
      }
    }
  }
  return png(size, px);
}

function png(size, px) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4;
      const a = px[o + 3];
      const d = j * stride + 1 + i * 4;
      for (let c = 0; c < 3; c++) raw[d + c] = a ? Math.round((px[o + c] / a) * 255) : 0;
      raw[d + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
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

const out = new URL("../public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("icon-192.png", out), render(192));
writeFileSync(new URL("icon-512.png", out), render(512));
// Maskable icons keep the mark inside the central 80% safe zone.
writeFileSync(new URL("maskable-512.png", out), render(512, { bleed: true, scale: 0.7 }));
writeFileSync(new URL("apple-touch-icon.png", out), render(180, { bleed: true, scale: 0.8 }));
