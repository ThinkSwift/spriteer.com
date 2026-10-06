// The house — HOUSE.md (PythoneerEngineKit). One house, two owners: this site writes the residents and
// guests (the Spriteer half); the exhibits (Pys, pets, fish) belong to Pythoneer and arrive through the
// door from pythoneer.io. Each half is kept in this browser exactly in the shape of house/sp.json and
// house/py.json; placement is computed, never stored.
import { TILES } from "./art.js";
import { tile, drawFrame, drawSilhouette, encodeFrame, decodeFrame, character } from "./pixels.js";

const SP_KEY = "spriteer.house.sp", PY_KEY = "spriteer.house.py";
export const ROOM = { w: 34, h: 10 };
export const RESIDENTS_IN_ROOM = 8;
const FLOOR = ROOM.h - 2;

function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
const nowISO = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export function spHalf() {
  const h = load(SP_KEY);
  if (h && (h.v ?? 1) <= 1) return { v: 1, savedAt: h.savedAt || nowISO(), residents: arr(h.residents), guests: arr(h.guests) };
  return { v: 1, savedAt: nowISO(), residents: [], guests: [] };
}
export function pyHalf() {
  const h = load(PY_KEY);
  return h && (h.v ?? 1) <= 1 ? h : null;
}
const arr = (a) => (Array.isArray(a) ? a.filter((m) => m && typeof m.id === "string") : []);

/** A character as a house member: {id, name, skin, movedIn, frames: [idle, walk, die]}. */
export function member(id, name, frames, skin = "Web") {
  return { id, name, skin, movedIn: nowISO(), frames: [frames.idle, frames.walk, frames.die].map(encodeFrame) };
}
export const framesOf = (m) => ({ idle: decodeFrame(m.frames[0]), walk: decodeFrame(m.frames[1] ?? m.frames[0]), die: decodeFrame(m.frames[2] ?? m.frames[0]) });

/** Moves a resident in (or replaces one with the same id). Returns the resident count. */
export function moveIn(m) {
  const h = spHalf();
  h.residents = h.residents.filter((r) => r.id !== m.id).concat([m]).slice(-512);
  h.savedAt = nowISO();
  store(SP_KEY, h);
  return h.residents.length;
}
export function addGuest(m) {
  const h = spHalf();
  if (h.guests.some((g) => g.id === m.id)) return false;
  h.guests = h.guests.concat([m]).slice(-512);
  h.savedAt = nowISO();
  store(SP_KEY, h);
  return true;
}

export function roomResidents(residents) {
  return residents.map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.movedIn || "").localeCompare(a.m.movedIn || "") || b.i - a.i)
    .slice(0, RESIDENTS_IN_ROOM).map((x) => x.m);
}

// --- the door to pythoneer.io: the house travels in the link (# never reaches a server) ---------

async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(s).arrayBuffer());
  let t = ""; for (const b of out) t += String.fromCharCode(b);
  return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function unpack(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const s = atob(b64), bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(st).text());
}

/** Link to the Pythoneer site carrying this half. */
export async function doorToPythoneer(base = "https://pythoneer.io/") {
  return base + "#house=" + (await pack({ sp: spHalf() }));
}
/** Reads `#house=` (a half from the other site). Keeps the newer copy. Returns true when something arrived. */
export async function receiveDoor(hash) {
  const m = /[#&]house=([A-Za-z0-9_-]+)/.exec(hash || "");
  if (!m) return false;
  try {
    const got = await unpack(m[1]);
    if (got && got.py && (got.py.v ?? 1) <= 1) {
      const mine = pyHalf();
      if (!mine || (got.py.savedAt || "") > (mine.savedAt || "")) store(PY_KEY, got.py);
      return true;
    }
  } catch {}
  return false;
}

// --- the room ---------------------------------------------------------------------------------

const ROOM_ROWS = [
  "1111111111111111111111111111111111",
  "1------------------4------4------1",
  "1------------------45555554------1",
  "1------------------45555554------1",
  "1----6----------6--45555554-6----1",
  "1-------3333333----44444444------1",
  "1-------------------------------91",
  "1-------------------------------91",
  "1-78----------------------------91",
  "1111111111111111111111111111111111",
]; // House.roomTiles (engine) — 1 wood · - plank wall · 3 plank · 4 ice · 5 water · 6 torch · 7 bed · 8 bed foot · 9 door
const TILE_FOR = { "1": "Wood", "-": "Plank Wall", "3": "Plank", "4": "Ice", "5": "Water", "6": "Torch", "7": "Bed", "8": "Bed Foot", "9": "Trunk" };
const PETS = ["duck", "crab", "bee", "bat", "slime"];
const FISH = ["fish", "fish", "fish", "jelly", "jelly", "fish"];

export class Room {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.tiles = {};
    for (const k in TILE_FOR) this.tiles[k] = tile(TILE_FOR[k]);
    this.walkers = [];
    this.tick = 0;
    this.refresh();
    const loop = () => { this.step(); this.draw(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); }

  /** Re-reads both halves (after a move-in, or a door). */
  refresh() {
    this.sp = spHalf();
    this.py = pyHalf();
    const rs = roomResidents(this.sp.residents);
    const walkers = rs.map((m, k) => ({ f: framesOf(m), x: 5 + 3 * k, dir: k % 2 ? -1 : 1, seed: k * 7, name: m.name }));
    (this.py?.pets?.have || []).forEach((m, k) => {
      const f = framesOf(m);
      walkers.push({ f, x: 6 + ((k * 5) % 22), dir: 1, seed: 3 + k * 11 });
    });
    this.walkers = walkers;
    this.fish = (this.py?.fish?.have || []).map((m, k) => ({ f: framesOf(m), x: 20 + (k * 2) % 5, y: 2 + (k % 3), dir: k % 2 ? -1 : 1 }));
    this.pys = (this.py?.pys?.have || []).slice(-7).map((m) => framesOf(m).idle);
  }

  step() {
    this.tick++;
    for (const [i, w] of this.walkers.entries()) {
      const phase = Math.floor(this.tick / 45 + w.seed) % 6;
      w.moving = phase >= 2;
      if (!w.moving) continue;
      w.x += w.dir * 0.035;
      if (w.x < 4.5) { w.x = 4.5; w.dir = 1; }       // clear of the bed
      if (w.x > 30.5) { w.x = 30.5; w.dir = -1; }    // clear of the door
      if ((this.tick + i * 37) % 400 === 0) w.dir *= -1;
    }
    for (const f of this.fish) {
      f.x += f.dir * 0.02;
      if (f.x < 20) { f.x = 20; f.dir = 1; }
      if (f.x > 25) { f.x = 25; f.dir = -1; }
    }
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const cssW = c.clientWidth || 340;
    const dpr = window.devicePixelRatio || 1;
    const s = (cssW / (ROOM.w * 8)) * dpr;
    const W = Math.round(ROOM.w * 8 * s), H = Math.round(ROOM.h * 8 * s);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.imageSmoothingEnabled = false;
    const t = 8 * s;
    for (let y = 0; y < ROOM.h; y++) for (let x = 0; x < ROOM.w; x++) {
      const ch = ROOM_ROWS[y][x];
      if (ch !== "-" && ch !== "1") drawFrame(ctx, this.tiles["-"], x * t, y * t, s);
      drawFrame(ctx, this.tiles[ch], x * t, y * t, s);
    }
    // Torch glow
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const x of [5, 16, 28]) {
      const g = ctx.createRadialGradient((x + 0.5) * t, 4.3 * t, 0, (x + 0.5) * t, 4.3 * t, 2.6 * t);
      g.addColorStop(0, "rgba(255,170,60,0.22)"); g.addColorStop(1, "rgba(255,170,60,0)");
      ctx.fillStyle = g; ctx.fillRect((x - 3) * t, 1.5 * t, 7 * t, 6 * t);
    }
    ctx.restore();

    // Pythoneer's exhibits: the Py shelf (7), the tank, pets — silhouettes where nothing is home yet.
    const ghost = "rgba(255,240,215,0.30)";
    for (let k = 0; k < 7; k++) {
      const f = this.pys[k];
      if (f) drawFrame(ctx, f, (8 + k) * t, 4 * t, s);
      else drawSilhouette(ctx, character("npc_jumper").idle, (8 + k) * t, 4 * t, s, ghost);
    }
    if (!this.fish.length) FISH.slice(0, 2).forEach((k, i) => drawSilhouette(ctx, character(k).idle, (21 + i * 2) * t, (2 + i) * t, s, "rgba(255,255,255,0.35)"));
    for (const f of this.fish) drawFrame(ctx, Math.floor(this.tick / 20) % 2 ? f.f.walk : f.f.idle, f.x * t, f.y * t, s, f.dir < 0);
    if (!(this.py?.pets?.have || []).length) PETS.forEach((k, i) => drawSilhouette(ctx, character(k).idle, (11 + i * 4) * t, FLOOR * t, s, ghost));

    for (const w of this.walkers) {
      const f = w.moving && Math.floor(this.tick / 10) % 2 ? w.f.walk : w.f.idle;
      drawFrame(ctx, f, w.x * t, FLOOR * t, s, w.dir < 0);
    }
  }

  counts() {
    const py = this.py;
    return {
      residents: this.sp.residents.length, guests: this.sp.guests.length,
      pys: [py?.pys?.have?.length || 0, py?.pys?.total || 38],
      pets: [py?.pets?.have?.length || 0, py?.pets?.total || 6],   // Pythoneer's total wins (6 since the hatchling)
      fish: [py?.fish?.have?.length || 0, py?.fish?.total || 6],
    };
  }
}

export { TILES };
