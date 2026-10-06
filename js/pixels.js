// 8×8 frames: Uint32Array(64) of 0xRRGGBBAA, 0 = transparent. Drawing and the HOUSE.md frame encoding.
import { SPRITES, TILES } from "./art.js";

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

function fromEntry(e) {
  const f = new Uint32Array(64);
  if (!e) return f;
  const pal = e.pal.map((h) => ((parseInt(h.slice(1), 16) << 8) | 0xff) >>> 0);
  for (let i = 0; i < 64; i++) {
    const ch = e.px[i];
    f[i] = ch === "." ? 0 : pal[DIGITS.indexOf(ch)];
  }
  return f;
}

export const sprite = (key) => fromEntry(SPRITES[key]);
export const tile = (name) => fromEntry(TILES[name]);
export const hasSprite = (key) => key in SPRITES;

/** A built-in character: {idle, walk, die}. */
export const character = (base) => ({ idle: sprite(base + "_idle"), walk: sprite(base + "_walk"), die: sprite(base + "_die") });

export function hex(v) { return "#" + (v >>> 8).toString(16).padStart(6, "0"); }

/** Draws a frame at (x, y), `s` screen pixels per art pixel, optionally mirrored. */
export function drawFrame(ctx, f, x, y, s, flip = false, alpha = 1) {
  if (!f) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 64; i++) {
    const v = f[i];
    if (!(v & 0xff)) continue;
    const px = i % 8, py = (i / 8) | 0;
    ctx.fillStyle = hex(v);
    ctx.fillRect(Math.round(x + (flip ? 7 - px : px) * s), Math.round(y + py * s), Math.ceil(s), Math.ceil(s));
  }
  ctx.restore();
}

/** A frame as one flat color (silhouettes of what is not home yet). */
export function drawSilhouette(ctx, f, x, y, s, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < 64; i++) if (f[i] & 0xff) ctx.fillRect(Math.round(x + (i % 8) * s), Math.round(y + ((i / 8) | 0) * s), Math.ceil(s), Math.ceil(s));
}

// HOUSE.md §2: base64 of 256 bytes RGBA8, binary alpha.
export function encodeFrame(f) {
  let s = "";
  for (let i = 0; i < 64; i++) {
    const v = (f[i] & 0xff) < 128 ? 0 : (f[i] | 0xff) >>> 0;
    s += String.fromCharCode(v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  return btoa(s);
}
export function decodeFrame(text) {
  try {
    const s = atob(text);
    if (s.length !== 256) return null;
    const f = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
      const a = s.charCodeAt(i * 4 + 3);
      f[i] = a < 128 ? 0 : ((s.charCodeAt(i * 4) << 24) | (s.charCodeAt(i * 4 + 1) << 16) | (s.charCodeAt(i * 4 + 2) << 8) | 0xff) >>> 0;
    }
    return f;
  } catch { return null; }
}

export const isEmpty = (f) => !f || !f.some((v) => v & 0xff);
