// Stomp Duel — your character against a rival, 30 seconds, first to three stomps.
// Every frame of the three-frame standard is used: Idle standing, Walk moving, Die when stomped.
// The same rules are the app's Cast Battle (SPRITEER.md, founder 2026-10-06).
// Bodies are the visible art, not the 8×8 cell (2026-10-07): a slime fills rows 2–6, so it used to float a pixel
// and be stomped in the air; and side by side the push (0.8) lost to walking (1.15), so fighters walked through.
import { tile, drawFrame } from "./pixels.js";
import { t } from "./i18n.js";

export const RULES = { stomps: 3, seconds: 30 };
const COLS = 20, ROWS = 12, T = 8;
const W = COLS * T, H = ROWS * T;
const GRAVITY = 0.22, JUMP = -4.1, RUN = 1.15, MAX_FALL = 4.5, BOUNCE = -3.2;
const DOWN_TICKS = 55, SAFE_TICKS = 60;   // after getting up, a second of safety (no spawn-stomping)
// One-way platforms: [row, fromCol, toCol]. The floor is row 11.
const PLATFORMS = [[8, 2, 6], [8, 13, 17], [5, 7, 12]];

function solidBelow(f, vy) {
  const yFeet = f.feet;
  if (yFeet >= (ROWS - 1) * T) return (ROWS - 1) * T;
  if (vy < 0) return null;
  for (const [r, a, b] of PLATFORMS) {
    const top = r * T;
    if (yFeet >= top && yFeet - vy <= top + 0.01 && f.x1 - 2 > a * T && f.x0 + 2 < (b + 1) * T) return top;
  }
  return null;
}

/** Visible rows/columns of a frame: [left, right) columns, top row, bottom row — or null when empty. */
function bounds(fr) {
  let l = 8, r = 0, t = 8, b = -1;
  for (let i = 0; i < 64; i++) if (fr && (fr[i] & 0xff)) {
    const x = i % 8, y = (i / 8) | 0;
    l = Math.min(l, x); r = Math.max(r, x + 1); t = Math.min(t, y); b = Math.max(b, y);
  }
  return b < 0 ? null : { l, r, t, b };
}

/** The body: Idle and Walk together (a walk that bobs keeps its bob). drop = empty rows under the feet,
 *  so the art is drawn standing on the ground; Die sits on its own lowest row. */
export function bodyOf(frames) {
  const i = bounds(frames.idle), w = bounds(frames.walk), d = bounds(frames.die);
  const u = i && w ? { l: Math.min(i.l, w.l), r: Math.max(i.r, w.r), t: Math.min(i.t, w.t), b: Math.max(i.b, w.b) } : i || w || { l: 0, r: 8, t: 0, b: 7 };
  return { l: u.l, r: u.r, top: u.t, drop: 7 - u.b, dieDrop: d ? 7 - d.b : 7 - u.b };
}

class Fighter {
  constructor(frames, x, facing) {
    this.f = frames; this.spawnX = x; this.facing = facing; this.body = bodyOf(frames);
    this.score = 0; this.reset();
  }
  /** World box of what you see: x0..x1 across (mirrored when facing left), head..feet down. */
  get x0() { return this.x + (this.facing < 0 ? 8 - this.body.r : this.body.l); }
  get x1() { return this.x + (this.facing < 0 ? 8 - this.body.l : this.body.r); }
  get head() { return this.y + this.body.drop + this.body.top; }
  get feet() { return this.y + T; }
  reset() { this.x = this.spawnX; this.y = 0; this.vx = 0; this.vy = 0; this.ground = false; this.down = 0; this.anim = 0; this.safe = SAFE_TICKS; }
  get alive() { return this.down === 0; }
}

export class Duel {
  /** you / rival: {idle, walk, die}; onEnd({won, draw, you, rival}). */
  constructor(canvas, you, rival, onEnd) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.you = new Fighter(you, 3 * T, 1);
    this.rival = new Fighter(rival, 16 * T, -1);
    this.onEnd = onEnd;
    this.keys = { left: false, right: false, jump: false };
    this.tiles = { grass: tile("Grass"), dirt: tile("Dirt"), plank: tile("Wood") };
    for (const f of [this.you, this.rival]) { f.y = (ROWS - 2) * T; f.ground = true; }   // start on the floor, visible through the countdown
    this.tick = 0; this.countdown = 200; this.left = RULES.seconds * 60; this.over = false;
    this.ai = { think: 0, dir: -1, jump: false };
    this.bindKeys();
    this.last = performance.now(); this.acc = 0;
    const loop = (now) => {
      this.acc += Math.min(100, now - this.last); this.last = now;
      while (this.acc >= 1000 / 60) { this.step(); this.acc -= 1000 / 60; }
      this.draw();
      if (!this.stopped) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.stopped = true; cancelAnimationFrame(this.raf); window.removeEventListener("keydown", this.kd); window.removeEventListener("keyup", this.ku); }

  // The app's keys on Mac (engine GameInput.swift, founder 2026-10-06): ←→ / A D move (the key pressed
  // last wins), Space is the bottom button = Jump (↑ / W also jump), Esc closes. Pads: A jumps, B / Menu close.
  bindKeys() {
    const dirs = { ArrowLeft: "L", KeyA: "L", ArrowRight: "R", KeyD: "R" };
    const jumps = new Set(["Space", "ArrowUp", "KeyW"]);
    this.held = [];
    const apply = () => {
      const h = this.held[this.held.length - 1];
      this.keys.left = h === "L"; this.keys.right = h === "R";
    };
    this.kd = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Escape") { e.preventDefault(); this.onClose?.(); return; }
      const d = dirs[e.code];
      if (d) { this.held = this.held.filter((x) => x !== d).concat(d); apply(); e.preventDefault(); return; }
      if (jumps.has(e.code)) { this.keys.jump = true; e.preventDefault(); }
    };
    this.ku = (e) => {
      const d = dirs[e.code];
      if (d) { this.held = this.held.filter((x) => x !== d); apply(); e.preventDefault(); return; }
      if (jumps.has(e.code)) { this.keys.jump = false; e.preventDefault(); }
    };
    window.addEventListener("keydown", this.kd);
    window.addEventListener("keyup", this.ku);
  }
  /** On-screen buttons call this. */
  press(k, on) { this.keys[k] = on; }

  /** Standard-mapping gamepads: d-pad / left stick move, A (0) jumps, B (1) or Menu (9) closes. */
  pollPad() {
    const pad = [...(navigator.getGamepads?.() || [])].find((p) => p && p.mapping === "standard");
    if (!pad) { if (this.padWas) { this.keys.left = this.keys.right = this.keys.jump = false; this.padWas = false; } return; }
    const b = (i) => !!pad.buttons[i]?.pressed, ax = pad.axes[0] || 0;
    const left = b(14) || ax < -0.4, right = b(15) || ax > 0.4, jump = b(0);
    if (left || right || jump || this.padWas) { this.keys.left = left; this.keys.right = right && !left; this.keys.jump = jump; }
    this.padWas = left || right || jump;
    if ((b(1) || b(9)) && !this.padClose) { this.padClose = true; this.onClose?.(); }
    if (!b(1) && !b(9)) this.padClose = false;
  }

  step() {
    this.tick++;
    if (this.over) return;
    if (this.countdown > 0) { this.countdown--; return; }
    this.left--;
    this.pollPad();
    this.think();
    this.move(this.you, this.keys);
    this.move(this.rival, this.ai);
    if (!this.stomp(this.you, this.rival) && !this.stomp(this.rival, this.you)) this.separate(this.you, this.rival);
    if (this.you.score >= RULES.stomps || this.rival.score >= RULES.stomps || this.left <= 0) this.finish();
  }

  think() {
    const a = this.ai, me = this.rival, p = this.you;
    a.jump = false;
    if (!me.alive) return;
    if (--a.think > 0) return;
    a.think = 18 + Math.floor(Math.random() * 16);
    const dx = p.x - me.x, dy = p.y - me.y;
    const above = dy < -6 && Math.abs(dx) < 14 && p.vy > 0;
    if (above) { a.dir = dx > 0 ? -1 : 1; a.jump = false; return; }        // dodge a stomp from above
    a.dir = Math.abs(dx) < 4 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
    if (me.ground && (dy < -10 ? Math.random() < 0.6 : Math.abs(dx) < 26 && Math.random() < 0.28)) a.jump = true;
    if (Math.random() < 0.15) a.dir = -a.dir;                                 // it wanders a little
  }

  move(f, input) {
    if (!f.alive) {
      if (--f.down === 0) f.reset();
      return;
    }
    if (f.safe > 0) f.safe--;
    const dir = input === this.ai ? input.dir : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    f.vx = dir * RUN;
    if (dir) f.facing = dir;
    if ((input.jump) && f.ground) { f.vy = JUMP; f.ground = false; }
    f.vy = Math.min(MAX_FALL, f.vy + GRAVITY);
    f.x = Math.max(0, Math.min(W - T, f.x + f.vx));
    f.y += f.vy;
    const land = solidBelow(f, f.vy);
    if (land !== null && f.vy >= 0) { f.y = land - T; f.vy = 0; f.ground = true; }
    else f.ground = false;
    if (f.vx) f.anim++;
  }

  /** a's feet came down onto b's visible head this tick (judged against where both were a tick ago). */
  stomp(a, b) {
    if (!a.alive || !b.alive || b.safe > 0) return false;
    const across = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    if (across <= 1 || a.vy <= b.vy) return false;
    const head = b.head;
    if (a.feet < head || a.feet - a.vy > head - b.vy + 2) return false;
    b.down = DOWN_TICKS; b.vx = 0;
    a.y = head - T; a.vy = BOUNCE; a.score++;                     // the feet meet the head: no sinking in at full speed
    this.flash = { x: b.x0 - 2, y: head - 2, t: 18 };
    return true;
  }

  /** Bodies are solid side to side: an overlap is split between the two (a wall takes no share). */
  separate(a, b) {
    if (!a.alive || !b.alive) return;
    const across = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const down = Math.min(a.feet, b.feet) - Math.max(a.head, b.head);
    if (across <= 0 || down <= 1) return;
    const [l, r] = a.x0 + a.x1 <= b.x0 + b.x1 ? [a, b] : [b, a];
    const clamp = (f) => { f.x = Math.max(0, Math.min(W - T, f.x)); };
    const lx = l.x; l.x -= across / 2; clamp(l);
    r.x += across - (lx - l.x); clamp(r);
    const left = Math.min(l.x1, r.x1) - Math.max(l.x0, r.x0);   // r hit the wall: l takes the rest
    if (left > 0) { l.x -= left; clamp(l); }
  }

  finish() {
    this.over = true;
    const won = this.you.score > this.rival.score, draw = this.you.score === this.rival.score;
    setTimeout(() => this.onEnd?.({ won, draw, you: this.you.score, rival: this.rival.score }), 900);
  }

  frameOf(f) {
    if (!f.alive) return f.f.die;
    if (!f.ground) return f.f.walk;
    return f.vx && Math.floor(f.anim / 8) % 2 ? f.f.walk : f.f.idle;
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const s = ((c.clientWidth || 320) / W) * dpr;
    const cw = Math.round(W * s), ch = Math.round(H * s);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#8fc3f0"; ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (const [cx, cy] of [[22, 14], [104, 22], [140, 10]]) ctx.fillRect(cx * s, cy * s, 18 * s, 4 * s);
    for (let x = 0; x < COLS; x++) drawFrame(ctx, this.tiles.grass, x * T * s, (ROWS - 1) * T * s, s);
    for (const [r, a, b] of PLATFORMS) for (let x = a; x <= b; x++) drawFrame(ctx, this.tiles.plank, x * T * s, r * T * s, s);

    for (const f of [this.rival, this.you]) {
      const blink = (!f.alive && f.down < 18 && Math.floor(f.down / 3) % 2) || (this.countdown === 0 && f.alive && f.safe > 0 && Math.floor(f.safe / 4) % 2);
      if (!blink) drawFrame(ctx, this.frameOf(f), f.x * s, (f.y + (f.alive ? f.body.drop : f.body.dieDrop)) * s, s, f.facing < 0);
    }
    // a marker over your character
    if (this.you.alive) {
      ctx.fillStyle = "#f7c230";
      const mx = ((this.you.x0 + this.you.x1) / 2 - 1) * s, my = (this.you.head - 4) * s;
      ctx.fillRect(mx, my, 2 * s, 2 * s);
    }
    if (this.flash && this.flash.t-- > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash.t / 18})`;
      ctx.fillRect(this.flash.x * s, this.flash.y * s, 12 * s, 12 * s);
    }
    // HUD
    ctx.fillStyle = "#211f40";
    ctx.font = `bold ${Math.round(7 * s)}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText(t("hud_you", { n: this.you.score }), 4 * s, 3 * s);
    ctx.textAlign = "right"; ctx.fillText(t("hud_rival", { n: this.rival.score }), (W - 4) * s, 3 * s);
    ctx.textAlign = "center"; ctx.fillText(`${Math.max(0, Math.ceil(this.left / 60))}`, (W / 2) * s, 3 * s);
    if (this.countdown > 0) {
      const n = Math.ceil((this.countdown - 50) / 50);
      ctx.font = `bold ${Math.round(20 * s)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(n > 0 ? String(n) : t("hud_go"), (W / 2) * s, (H / 2 - 12) * s);
      ctx.font = `bold ${Math.round(6 * s)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(t("hud_rule"), (W / 2) * s, (H / 2 + 12) * s);
    }
  }
}
