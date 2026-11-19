// gta6-meme-x-01 — "Post a GTA 6 meme on X" (make.fun bounty, $500, top 50).
//
// This program renders the entry's meme picture — a GTA "WASTED" homage for
// GTA 6 launch week, starring the make.fun ghost — into a 1200x675 PNG, and
// hands the repository's POST.json (the X post's address) to the grader.
//
// How it works: a tiny software rasterizer (framebuffer, gradients, circles,
// ellipses, scanline polygons, thick lines) draws a Vice City sunset scene
// with a hand-designed 5x7 bitmap font, then a minimal PNG encoder (CRC32 +
// zlib deflate, standard library only) writes the picture. No network, no
// dependencies, no randomness: the same run always writes the same bytes.
//
// Run it locally:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
// The grader runs it with MAKEFUN_BOT_DIR=/bot and MAKEFUN_OUTPUT_DIR=/output.
//
// The meme: GTA 6 is finally out after 13 years of waiting since GTA V, so
// the picture says WASTED — 13 YEARS OF WAITING — while the make.fun ghost,
// wearing its star badge, stands in the sunset: it did not wait, it got paid
// on make.fun. The post's text (see README.md) carries the play code.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Canvas and palette
// ---------------------------------------------------------------------------

const WIDTH = 1200;
const HEIGHT = 675;

const INK = '#191419'; // make.fun ink — outlines and text shadow
const MAGENTA = '#C41C83'; // make.fun magenta — the ghost's badge, the sky
const PURPLE = '#2B1055'; // Vice City dusk, top of the sky
const ORANGE = '#FF9A3D'; // sunset band at the horizon
const NEON = '#FF2E88'; // neon horizon line
const SUN = '#FFD319'; // retro sun
const GROUND = '#14082A'; // dark street at the bottom
const WHITE = '#FFFFFF';
const BLACK = '#000000';

type RGB = [number, number, number];

function hex(hexColor: string): RGB {
  const n = parseInt(hexColor.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// ---------------------------------------------------------------------------
// CRC32 and the PNG encoder (standard library only)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (1 + width * 4) + 1,
    );
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Framebuffer and drawing primitives
// ---------------------------------------------------------------------------

const fb = new Uint8Array(WIDTH * HEIGHT * 4);

function putPixel(x: number, y: number, color: RGB, alpha = 255): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || xi >= WIDTH || yi < 0 || yi >= HEIGHT || alpha <= 0) return;
  const i = (yi * WIDTH + xi) * 4;
  if (alpha >= 255) {
    fb[i] = color[0];
    fb[i + 1] = color[1];
    fb[i + 2] = color[2];
    fb[i + 3] = 255;
    return;
  }
  const a = alpha / 255;
  fb[i] = Math.round(color[0] * a + fb[i] * (1 - a));
  fb[i + 1] = Math.round(color[1] * a + fb[i + 1] * (1 - a));
  fb[i + 2] = Math.round(color[2] * a + fb[i + 2] * (1 - a));
  fb[i + 3] = 255;
}

function fillRect(x: number, y: number, w: number, h: number, color: RGB, alpha = 255): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(WIDTH, Math.ceil(x + w));
  const y1 = Math.min(HEIGHT, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) putPixel(xx, yy, color, alpha);
  }
}

function fillCircle(cx: number, cy: number, r: number, color: RGB, alpha = 255): void {
  const rr = Math.max(0, r);
  for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, rr * rr - dy * dy)));
    for (let xx = -dx; xx <= dx; xx++) putPixel(cx + xx, cy + dy, color, alpha);
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, color: RGB, alpha = 255): void {
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    const t = 1 - (dy * dy) / (ry * ry);
    if (t < 0) continue;
    const dx = Math.floor(rx * Math.sqrt(t));
    for (let xx = -dx; xx <= dx; xx++) putPixel(cx + xx, cy + dy, color, alpha);
  }
}

// Even-odd scanline fill for a simple (non self-intersecting) polygon.
function fillPolygon(points: Array<[number, number]>, color: RGB, alpha = 255): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(HEIGHT - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(WIDTH - 1, Math.floor(xs[k + 1])); x++) {
        putPixel(x, y, color, alpha);
      }
    }
  }
}

// A thick line as a chain of filled circles (used for palm trunks).
function thickLine(x1: number, y1: number, x2: number, y2: number, w: number, color: RGB): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const r = w / 2;
    fillCircle(lerp(x1, x2, t), lerp(y1, y2, t), r, color);
  }
}

// A 4-point sparkle (a diamond star): the make.fun ghost's eyes.
function sparkle(cx: number, cy: number, outer: number, color: RGB): void {
  const inner = outer * 0.28;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4 - Math.PI / 2;
    const r = k % 2 === 0 ? outer : inner;
    pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  fillPolygon(pts, color);
}

// A 5-point star: the white star in the ghost's magenta badge.
function star5(cx: number, cy: number, outer: number, color: RGB): void {
  const inner = outer * 0.45;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 10; k++) {
    const ang = (k * Math.PI) / 5 - Math.PI / 2;
    const r = k % 2 === 0 ? outer : inner;
    pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  fillPolygon(pts, color);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (designed for this meme: big, blocky, readable at a glance)
// Each glyph is 7 rows; each row is a 5-bit number, bit 4 = leftmost pixel.
// ---------------------------------------------------------------------------

const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 6, 8, 16, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '-': [0, 0, 0, 14, 0, 0, 0],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = 6; // glyph width + 1 unit of space

function measureText(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return (text.length * ADVANCE - 1) * scale;
}

function drawGlyph(ch: string, x: number, y: number, scale: number, color: RGB): void {
  const rows = FONT[ch] ?? FONT[' '];
  for (let r = 0; r < GLYPH_H; r++) {
    const bits = rows[r];
    for (let c = 0; c < GLYPH_W; c++) {
      if ((bits >> (GLYPH_W - 1 - c)) & 1) {
        fillRect(x + c * scale, y + r * scale, scale, scale, color);
      }
    }
  }
}

// Draws a line of text at (x, y) — the top-left of the first glyph.
// When outline is given, the whole line is first stamped in the outline
// colour at 8 offsets, so the letters carry a thick dark edge.
function drawText(text: string, x: number, y: number, scale: number, color: RGB, outline: RGB | null): void {
  const upper = text.toUpperCase();
  const offsets: Array<[number, number]> =
    outline === null
      ? [[0, 0]]
      : [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ];
  const thick = Math.max(2, Math.round(scale / 5));
  if (outline !== null) {
    for (const [dx, dy] of offsets) {
      for (let i = 0; i < upper.length; i++) {
        drawGlyph(upper[i], x + i * ADVANCE * scale + dx * thick, y + dy * thick, scale, outline);
      }
    }
  }
  for (let i = 0; i < upper.length; i++) {
    drawGlyph(upper[i], x + i * ADVANCE * scale, y, scale, color);
  }
}

function drawCentred(text: string, y: number, scale: number, color: RGB, outline: RGB | null): void {
  const w = measureText(text, scale);
  drawText(text, Math.round((WIDTH - w) / 2), y, scale, color, outline);
}

// ---------------------------------------------------------------------------
// The scene: a Vice City sunset, the WASTED screen, and the make.fun ghost
// ---------------------------------------------------------------------------

// Colour of the sky at height y (0 = top, 560 = horizon), for the gradient
// and for the slats cut through the retro sun.
function skyAt(y: number): RGB {
  const top = hex(PURPLE);
  const mid = hex(MAGENTA);
  const low = hex(ORANGE);
  if (y <= 250) return mix(top, mid, y / 250);
  return mix(mid, low, Math.min(1, (y - 250) / 310));
}

// Deterministic pseudo-random numbers (fixed seed: the picture never changes).
let rngState = 0x9e3779b9;
function rng(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}

function drawSky(): void {
  for (let y = 0; y < 560; y++) {
    const c = skyAt(y);
    for (let x = 0; x < WIDTH; x++) putPixel(x, y, c);
  }
  fillRect(0, 560, WIDTH, HEIGHT - 560, hex(GROUND));
  fillRect(0, 560, WIDTH, 3, hex(NEON));
}

function drawStars(): void {
  for (let i = 0; i < 42; i++) {
    const x = 16 + Math.floor(rng() * (WIDTH - 32));
    const y = 10 + Math.floor(rng() * 185);
    const s = rng() < 0.25 ? 2 : 1;
    fillRect(x, y, s, s, hex(WHITE), 235);
  }
}

function drawSun(): void {
  const cx = 1020;
  const cy = 95;
  const r = 55;
  fillCircle(cx, cy, r, hex(SUN));
  // Slats across the lower half: sky-coloured bars, thicker toward the bottom.
  const slats: Array<[number, number]> = [
    [102, 4],
    [114, 6],
    [128, 8],
  ];
  for (const [y, h] of slats) {
    fillRect(cx - r, y, r * 2, h, skyAt(y + h / 2));
  }
}

// One palm frond: a curved blade from (x0, y0) toward angle `ang`.
function drawFrond(x0: number, y0: number, ang: number, len: number, color: RGB): void {
  const tipX = x0 + len * Math.cos(ang);
  const tipY = y0 + len * Math.sin(ang);
  const ctrlX = x0 + len * 0.55 * Math.cos(ang) - len * 0.16 * Math.sin(ang);
  const ctrlY = y0 + len * 0.55 * Math.sin(ang) + len * 0.16 * Math.cos(ang);
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const steps = 10;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const bx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ctrlX + t * t * tipX;
    const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ctrlY + t * t * tipY;
    const dx = 2 * (1 - t) * (ctrlX - x0) + 2 * t * (tipX - ctrlX);
    const dy = 2 * (1 - t) * (ctrlY - y0) + 2 * t * (tipY - ctrlY);
    const m = Math.hypot(dx, dy) || 1;
    const w = 6.5 * (1 - t * 0.75);
    left.push([bx + (-dy / m) * w, by + (dx / m) * w]);
    right.push([bx - (-dy / m) * w, by - (dx / m) * w]);
  }
  fillPolygon([...left, ...right.reverse()], color);
}

function drawPalm(baseX: number, topX: number, topY: number, lean: number): void {
  const color = hex(GROUND);
  // Trunk: a tapered polygon along a slightly bowed curve, wide at the base.
  const midX = (baseX + topX) / 2 + lean;
  const midY = (560 + topY) / 2;
  const steps = 16;
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = (1 - t) * (1 - t) * baseX + 2 * (1 - t) * t * midX + t * t * topX;
    const y = (1 - t) * (1 - t) * 560 + 2 * (1 - t) * t * midY + t * t * topY;
    const dx = 2 * (1 - t) * (midX - baseX) + 2 * t * (topX - midX);
    const dy = 2 * (1 - t) * (midY - 560) + 2 * t * (topY - midY);
    const m = Math.hypot(dx, dy) || 1;
    const w = 8 - 4 * t;
    left.push([x + (-dy / m) * w, y + (dx / m) * w]);
    right.push([x - (-dy / m) * w, y - (dx / m) * w]);
  }
  fillPolygon([...left, ...right.reverse()], color);
  // Five fronds fanning upward from the crown.
  const angles = [-Math.PI / 2 - 0.95, -Math.PI / 2 - 0.5, -Math.PI / 2, -Math.PI / 2 + 0.5, -Math.PI / 2 + 0.95];
  for (const a of angles) drawFrond(topX, topY, a, 100, color);
}

// The make.fun ghost, drawn in the style of the press-kit mark: a white
// sheet with a dome top and a wavy 3-scallop hem, black sparkle eyes, and the
// magenta star badge on its side. (cx, top) is the centre of the dome top;
// w is the body width, h the body height.
function drawGhost(cx: number, top: number, w: number, h: number): void {
  const r = w / 2;
  const domeY = top + r;
  const hemY = top + h - r / 2;
  const outline = hex(INK);
  const body = hex(WHITE);
  // Body outline, built from points: dome arc, right side, wavy hem, left side.
  const pts: Array<[number, number]> = [];
  for (let a = Math.PI; a >= 0; a -= Math.PI / 24) {
    pts.push([cx + r * Math.cos(a), domeY - r * Math.sin(a)]);
  }
  pts.push([cx + r, hemY]);
  const scallops = 3;
  const sw = w / scallops;
  for (let i = scallops - 1; i >= 0; i--) {
    const scx = cx - r + sw * (i + 0.5);
    const sr = sw / 2;
    for (let a = 0; a <= Math.PI; a += Math.PI / 12) {
      pts.push([scx + sr * Math.cos(a), hemY + sr * Math.sin(a)]);
    }
  }
  pts.push([cx - r, domeY]);
  // Thick dark edge: stamp the body in ink at 8 offsets, then white on top.
  const o = 6;
  for (const [dx, dy] of [
    [-o, -o],
    [0, -o],
    [o, -o],
    [-o, 0],
    [o, 0],
    [-o, o],
    [0, o],
    [o, o],
  ] as Array<[number, number]>) {
    fillPolygon(
      pts.map(([x, y]) => [x + dx, y + dy] as [number, number]),
      outline,
    );
  }
  fillPolygon(pts, body);
  // Sparkle eyes.
  sparkle(cx - w * 0.16, domeY - r * 0.28, 13, outline);
  sparkle(cx + w * 0.14, domeY - r * 0.34, 13, outline);
  // Magenta star badge overlapping the right edge, white star inside.
  const badgeX = cx + r - 4;
  const badgeY = domeY + r * 0.42;
  fillCircle(badgeX, badgeY, 33, outline);
  fillCircle(badgeX, badgeY, 29, hex(MAGENTA));
  star5(badgeX, badgeY, 16, body);
  // Small white dot below the badge, as on the mark.
  fillCircle(badgeX - 12, badgeY + 42, 16, outline);
  fillCircle(badgeX - 12, badgeY + 42, 13, body);
}

// ---------------------------------------------------------------------------
// Scene assembly and entry point
// ---------------------------------------------------------------------------

function drawScene(): void {
  drawSky();
  drawStars();
  drawSun();
  drawPalm(70, 112, 385, 26);
  drawPalm(1130, 1088, 392, -26);

  const white = hex(WHITE);
  const ink = hex(INK);
  const lines: Array<{ text: string; y: number; scale: number }> = [
    { text: 'GTA 6 IS FINALLY OUT', y: 44, scale: 6 },
    { text: 'WASTED', y: 120, scale: 20 },
    { text: '13 YEARS OF WAITING', y: 290, scale: 7 },
    { text: 'MY AGENT GOT PAID ON MAKE.FUN', y: 596, scale: 6 },
  ];
  for (const line of lines) {
    const w = measureText(line.text, line.scale);
    if (w > WIDTH - 80) {
      throw new Error(`caption too wide for the canvas: "${line.text}" is ${w}px`);
    }
    if (line.y + GLYPH_H * line.scale > HEIGHT) {
      throw new Error(`caption runs off the bottom: "${line.text}"`);
    }
    drawCentred(line.text, line.y, line.scale, white, ink);
  }

  // Shadow, then the ghost standing on the ground between the captions.
  fillEllipse(600, 550, 96, 10, hex(BLACK), 90);
  drawGhost(600, 355, 150, 190);
}

function main(): void {
  const botDir = process.env.MAKEFUN_BOT_DIR ?? '/bot';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outputDir, { recursive: true });

  drawScene();
  const png = encodePng(fb, WIDTH, HEIGHT);
  const memePath = join(outputDir, 'meme.png');
  writeFileSync(memePath, png);
  console.log(`meme.png written: ${memePath} (${WIDTH}x${HEIGHT}, ${png.length} bytes)`);

  const postPath = join(botDir, 'POST.json');
  if (existsSync(postPath)) {
    copyFileSync(postPath, join(outputDir, 'POST.json'));
    console.log('POST.json copied to the output directory.');
  } else {
    console.log(
      'WARNING: no POST.json in the bot directory yet — the post goes live ' +
        'first, then POST.json names its address and this program copies it.',
    );
  }
}

main();
