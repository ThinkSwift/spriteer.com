// Spriteer Skin PNG v1 — the picture is the file.
// Spec: https://github.com/ThinkSwift/Spriteer docs/skin-png-v1.md (mirrors engine Packs/SkinPNG.swift).
// A pixel is a 32-bit RGBA number (0xRRGGBBAA); 0 is transparent. A frame is 64 of them, row-major.

export const WIDTH = 96, CELL = 8, STRIPS_PER_ROW = 4, CELLS_PER_STRIP = 3;
const MAGIC = [0x53, 0x50, 0x52, 0x54]; // "SPRT"
const FIXED_HEADER = 14;
const BYTES_PER_HEADER_ROW = WIDTH * CELL * 3;
const MAX_MANIFEST = 256 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}
const crcDone = (c) => (c ^ 0xffffffff) >>> 0;

const normalized = (v) => ((v & 0xff) < 128 ? 0 : (v | 0xff) >>> 0);

/** strips: [[key|null, key|null, key|null], ...]; frames: {key: Uint32 frame (64)}; assets: optional .spriteerpack assets. */
export async function encode(name, strips, frames, assets) {
  strips = strips.map((s) => [0, 1, 2].map((k) => s[k] ?? null));
  const manifest = { v: 1, skin: name, strips };
  if (assets && assets.length) manifest.assets = assets;
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  if (json.length > MAX_MANIFEST) throw new Error("manifest too large");
  const headerRows = Math.max(1, Math.ceil((FIXED_HEADER + json.length) / BYTES_PER_HEADER_ROW));
  const stripRows = Math.ceil(strips.length / STRIPS_PER_ROW);
  const h = CELL * (headerRows + stripRows);
  const px = new Uint8Array(WIDTH * h * 4);

  const body = [];
  strips.forEach((strip, i) => {
    strip.forEach((key, k) => {
      const f = key ? frames[key] : null;
      const ox = (i % STRIPS_PER_ROW) * CELL * CELLS_PER_STRIP + k * CELL;
      const oy = CELL * (headerRows + Math.floor(i / STRIPS_PER_ROW));
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const v = normalized(f ? f[y * CELL + x] : 0);
        const o = ((oy + y) * WIDTH + ox + x) * 4;
        px[o] = v >>> 24; px[o + 1] = (v >>> 16) & 0xff; px[o + 2] = (v >>> 8) & 0xff; px[o + 3] = v & 0xff;
        body.push(px[o], px[o + 1], px[o + 2], px[o + 3]);
      }
    });
  });

  const header = [...MAGIC, 1, headerRows, ...be32(json.length), ...be32(crcDone(crc32(body, crc32(json))))];
  for (const b of json) header.push(b);
  for (let p = 0; p < WIDTH * CELL * headerRows; p++) px[p * 4 + 3] = 255;
  header.forEach((b, i) => { px[Math.floor(i / 3) * 4 + (i % 3)] = b; });
  return writePNG(px, WIDTH, h);
}

/** bytes (Uint8Array or Blob) → {name, strips, frames: {key: Uint32Array(64)}, assets}. Throws Error(code). */
export async function decode(input) {
  const blob = input instanceof Blob ? input : new Blob([input], { type: "image/png" });
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  } catch { throw new Error("notSkinPNG"); }
  const w = bmp.width, h = bmp.height;
  if (w < WIDTH || w % WIDTH) throw new Error("notSkinPNG");
  const s = w / WIDTH;
  if (h < CELL * s || h % (CELL * s) || w * h > 40_000_000) throw new Error("notSkinPNG");
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  const full = ctx.getImageData(0, 0, w, h, { colorSpace: "srgb" }).data;
  const logicalH = h / s, half = Math.floor(s / 2);
  const pixel = (x, y) => { const o = ((y * s + half) * w + x * s + half) * 4; return [full[o], full[o + 1], full[o + 2], full[o + 3]]; };
  const headerByte = (i) => pixel(Math.floor(i / 3) % WIDTH, Math.floor(Math.floor(i / 3) / WIDTH))[i % 3];

  for (let i = 0; i < 4; i++) if (headerByte(i) !== MAGIC[i]) {
    throw new Error(blob.type && blob.type !== "image/png" ? "recompressed" : "notSkinPNG");
  }
  const version = headerByte(4);
  if (version > 1) throw new Error("newerVersion");
  const headerRows = headerByte(5);
  let length = 0; for (let i = 6; i < 10; i++) length = length * 256 + headerByte(i);
  let crc = 0; for (let i = 10; i < 14; i++) crc = crc * 256 + headerByte(i);
  if (headerRows < 1 || CELL * headerRows > logicalH || length > MAX_MANIFEST || FIXED_HEADER + length > headerRows * BYTES_PER_HEADER_ROW) throw new Error("damaged");
  const json = new Uint8Array(length);
  for (let i = 0; i < length; i++) json[i] = headerByte(FIXED_HEADER + i);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(json)); } catch { throw new Error("damaged"); }
  if (!manifest || !Array.isArray(manifest.strips)) throw new Error("damaged");
  if ((manifest.v ?? 1) > 1) throw new Error("newerVersion");
  const stripRows = logicalH / CELL - headerRows;
  if (manifest.strips.length > stripRows * STRIPS_PER_ROW) throw new Error("damaged");

  let c = crc32(json);
  const frames = {};
  manifest.strips.forEach((strip, i) => {
    for (let k = 0; k < 3; k++) {
      const key = Array.isArray(strip) ? strip[k] ?? null : null;
      const ox = (i % STRIPS_PER_ROW) * CELL * CELLS_PER_STRIP + k * CELL;
      const oy = CELL * (headerRows + Math.floor(i / STRIPS_PER_ROW));
      const f = new Uint32Array(64);
      const cellBytes = new Uint8Array(256);
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const [r, g, b, a] = pixel(ox + x, oy + y);
        const v = a < 128 ? 0 : (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
        f[y * CELL + x] = v;
        const o = (y * CELL + x) * 4;
        cellBytes[o] = v >>> 24; cellBytes[o + 1] = (v >>> 16) & 0xff; cellBytes[o + 2] = (v >>> 8) & 0xff; cellBytes[o + 3] = v & 0xff;
      }
      c = crc32(cellBytes, c);
      if (typeof key === "string" && key && !(key in frames) && f.some((v) => v & 0xff)) frames[key.slice(0, 120)] = f;
    }
  });
  if (crcDone(c) !== crc >>> 0) throw new Error("damaged");
  const name = String(manifest.skin ?? "").trim().slice(0, 80) || "Skin";
  return { name, strips: manifest.strips, frames, assets: Array.isArray(manifest.assets) ? manifest.assets : [] };
}

// --- base64url, for links ---------------------------------------------------------------------

export function toBase64Url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// --- a minimal PNG writer (RGBA8, no filter, zlib via CompressionStream) ----------------------

function be32(v) { return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]; }

async function zlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function writePNG(rgba, w, h) {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const idat = await zlib(raw);
  const chunks = [];
  const chunk = (type, data) => {
    const t = new TextEncoder().encode(type);
    const td = new Uint8Array(t.length + data.length); td.set(t); td.set(data, t.length);
    chunks.push(new Uint8Array(be32(data.length)), td, new Uint8Array(be32(crcDone(crc32(td)))));
  };
  chunk("IHDR", new Uint8Array([...be32(w), ...be32(h), 8, 6, 0, 0, 0]));
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array());
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const total = sig.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of [sig, ...chunks]) { out.set(c, o); o += c.length; }
  return out;
}
