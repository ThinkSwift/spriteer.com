// Stomp Duel — your character against a rival, 30 seconds, first to three stomps.
// Every frame of the three-frame standard is used: Idle standing, Walk moving, Die when stomped.
// The same rules are the app's Cast Battle (SPRITEER.md, founder 2026-10-06).
import { tile, drawFrame } from "./pixels.js";

export const RULES = { stomps: 3, seconds: 30 };
const COLS = 20, ROWS = 12, T = 8;
const W = COLS * T, H = ROWS * T;
const GRAVITY = 0.22, JUMP = -4.1, RUN = 1.15, MAX_FALL = 4.5, BOUNCE = -3.2;
const DOWN_TICKS = 55, SAFE_TICKS = 60;   // after getting up, a second of safety (no spawn-stomping)
// One-way platforms: [row, fromCol, toCol]. The floor is row 11.
const PLATFORMS = [[8, 2, 6], [8, 13, 17], [5, 7, 12]];

function solidBelow(x, yFeet, vy) {
  if (yFeet >= (ROWS - 1) * T) return (ROWS - 1) * T;
  if (vy < 0) return null;
  for (const [r, a, b] of PLATFORMS) {
    const top = r * T;
    if (yFeet >= top && yFeet - vy <= top + 0.01 && x + 6 > a * T && x + 2 < (b + 1) * T) return top;
  }
  return null;
}

class Fighter {
  constructor(frames, x, facing) {
    this.f = frames; this.spawnX = x; this.facing = facing;
    this.score = 0; this.reset();
  }
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
    this.contact(this.you, this.rival);
    this.contact(this.rival, this.you);
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
    const land = solidBelow(f.x, f.y + T, f.vy);
    if (land !== null && f.vy >= 0) { f.y = land - T; f.vy = 0; f.ground = true; }
    else f.ground = false;
    if (f.vx) f.anim++;
  }

  contact(a, b) {
    if (!a.alive || !b.alive || b.safe > 0) return;
    const overlapX = a.x + 7 > b.x + 1 && a.x + 1 < b.x + 7;
    const feet = a.y + T;
    if (overlapX && a.vy > 0 && feet >= b.y && feet <= b.y + 5) {
      b.down = DOWN_TICKS; b.vx = 0;
      a.vy = BOUNCE; a.score++;
      this.flash = { x: b.x, y: b.y, t: 18 };
      return;
    }
    if (overlapX && Math.abs(a.y - b.y) < 6) {                    // side by side: push apart
      const push = a.x < b.x ? -0.8 : 0.8;
      a.x = Math.max(0, Math.min(W - T, a.x + push));
    }
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
      if (!blink) drawFrame(ctx, this.frameOf(f), f.x * s, f.y * s, s, f.facing < 0);
    }
    // a marker over your character
    if (this.you.alive) {
      ctx.fillStyle = "#f7c230";
      const mx = (this.you.x + 3) * s, my = (this.you.y - 4) * s;
      ctx.fillRect(mx, my, 2 * s, 2 * s);
    }
    if (this.flash && this.flash.t-- > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash.t / 18})`;
      ctx.fillRect((this.flash.x - 2) * s, (this.flash.y - 2) * s, 12 * s, 12 * s);
    }
    // HUD
    ctx.fillStyle = "#211f40";
    ctx.font = `bold ${Math.round(7 * s)}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left"; ctx.fillText(`YOU ${this.you.score}`, 4 * s, 3 * s);
    ctx.textAlign = "right"; ctx.fillText(`${this.rival.score} RIVAL`, (W - 4) * s, 3 * s);
    ctx.textAlign = "center"; ctx.fillText(`${Math.max(0, Math.ceil(this.left / 60))}`, (W / 2) * s, 3 * s);
    if (this.countdown > 0) {
      const n = Math.ceil((this.countdown - 50) / 50);
      ctx.font = `bold ${Math.round(20 * s)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(n > 0 ? String(n) : "GO", (W / 2) * s, (H / 2 - 12) * s);
      ctx.font = `bold ${Math.round(6 * s)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`Stomp ${RULES.stomps} times · ${RULES.seconds}s`, (W / 2) * s, (H / 2 + 12) * s);
    }
  }
}
