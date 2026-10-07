// spriteer.com — the app's first run, step for step (SPRITEER.md, founder 2026-10-07 "the web the same as the app").
// 1/2: a finished character walks; one blinking dot guides you. Put one dot anywhere and see what it did — it shows
// in Idle, Walk and Die — and Play unlocks (the locked button says why). 2/2: the duel; it moves into your house.
import { sprite, tile, character, hasSprite, drawFrame, hex, isEmpty } from "./pixels.js";
import { Duel, RULES } from "./duel.js?v=9";
import { Room, member, moveIn, addGuest, framesOf, spHalf, doorToPythoneer, receiveDoor } from "./house.js";
import * as Skin from "./skinpng.js";
import { track } from "./track.js";
import { t, tn, applyI18n } from "./i18n.js";

const APP_STORE = "https://apps.apple.com/app/id6796374506";
const SKETCHES = ["hero", "slime", "ghost", "duck", "goblin", "skeleton", "bat", "crab", "zombie", "monkey", "snake", "spider", "mole", "bee", "jelly"];
const RIVALS = ["goblin", "skeleton", "zombie", "slime", "ghost", "spider"];
const RED = 0xd81e2cff >>> 0;
const EXTRA = [RED, 0xffffffff, 0xf7c230ff, 0x3882d9ff, 0x559e3dff, 0x7870dbff].map((v) => v >>> 0);   // no navy: it vanishes on the dark page
const $ = (s) => document.querySelector(s);
const cap = (s) => s.replace(/^u\//, "").replace(/^npc_/, "").replace(/^\w/, (c) => c.toUpperCase());

const state = {
  base: "hero", frames: null, start: null, shift: {}, hint: null, marks: [], color: RED, painted: false,
  name: "Hero", challenger: null, duel: null, room: null,
};

// ---------------------------------------------------------------- the sketch: finished, yours to mark

/** How a frame sits relative to Idle (a walk often steps a pixel over): the shift that lines most pixels up. */
function align(idle, other) {
  let best = [0, 0], score = -1;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    let n = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = idle[y * 8 + x]; if (!(v & 0xff)) continue;
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < 8 && Y >= 0 && Y < 8 && other[Y * 8 + X] === v) n++;
    }
    if (n > score || (n === score && Math.abs(dx) + Math.abs(dy) < Math.abs(best[0]) + Math.abs(best[1]))) { score = n; best = [dx, dy]; }
  }
  return best;
}

/** The guide: the pixel just under the mouth (the lowest dark run in the face). Any other dot counts too. */
function mouthHint(idle) {
  const dark = (v) => (v & 0xff) && ((v >>> 24) + ((v >>> 16) & 0xff) + ((v >>> 8) & 0xff)) < 120;
  for (let y = 6; y >= 3; y--) {
    for (let x = 0; x < 8; x++) {
      if (!dark(idle[y * 8 + x])) continue;
      const below = (y + 1) * 8 + x;
      // Already red there: red on red changes nothing, so no guide — any dot works.
      if (y + 1 < 8 && (idle[below] & 0xff) && !dark(idle[below])) return (idle[below] | 0xff) >>> 0 === RED ? null : { x, y: y + 1 };
    }
  }
  return null;
}

function startSketch(base) {
  state.base = base;
  state.frames = character(base);
  state.start = { idle: [...state.frames.idle], walk: [...state.frames.walk], die: [...state.frames.die] };
  state.shift = { idle: [0, 0], walk: align(state.frames.idle, state.frames.walk), die: align(state.frames.idle, state.frames.die) };
  state.hint = mouthHint(state.frames.idle);
  state.marks = []; state.painted = false;
  state.name = cap(base);
  $("#name").value = state.name;
  state.color = RED;
  buildPalette(); markPalette();
  $("#goal-note").textContent = t(state.hint ? "mk_hint" : "mk_hint_free");
  stepUI();
  drawEditor();
}

/** Before the first dot: the guide, and Play locked with its reason. After: what the dot did, and Play. */
function stepUI() {
  const p = state.painted;
  $("#draw").classList.toggle("painted", p);
  $("#goal").hidden = p;
  $("#mk-result").hidden = !p;
  $("#start-over").hidden = !p;
  $("#play").disabled = !p;
  $("#play").textContent = t(p ? "play" : "mk_locked");
}

/** Back to the character as the sketch started — your marks go, nothing else does. */
function startOver() {
  state.frames = { idle: [...state.start.idle], walk: [...state.start.walk], die: [...state.start.die] };
  state.marks = []; state.painted = false; state.color = RED;
  markPalette(); stepUI();
}

function paletteColors() {
  const seen = new Set(EXTRA.slice(0, 1));
  for (const k of ["idle", "walk", "die"]) for (const v of state.frames[k]) if (v & 0xff) seen.add(v >>> 0);
  for (const v of EXTRA) seen.add(v);
  return [...seen].slice(0, 14);
}

function buildPalette() {
  const p = $("#palette");
  p.innerHTML = "";
  for (const v of [...paletteColors(), 0]) {
    const b = document.createElement("button");
    b.className = "swatch" + (v === 0 ? " eraser" : "");
    b.style.background = v ? hex(v) : "";
    b.setAttribute("aria-label", v ? hex(v) : "⌫");
    b.dataset.v = String(v);
    b.onclick = () => { state.color = v; markPalette(); };
    p.appendChild(b);
  }
}
function markPalette() {
  for (const b of document.querySelectorAll(".swatch")) b.classList.toggle("on", Number(b.dataset.v) === state.color);
}

// ---------------------------------------------------------------- editor: one big canvas, three frames follow

const CELLS = ["idle", "walk", "die"];
function paintCanvas(c, f, k, now, keepLast = false) {
  const ctx = c.getContext("2d");
  // Size from the laid-out box, capped — a canvas without its CSS (a stale cache) must not grow itself every frame.
  const size = Math.min(1024, Math.round(c.getBoundingClientRect().width * (window.devicePixelRatio || 1))) || 256;
  if (c.width !== size) { c.width = size; c.height = size; }
  const s = size / 8;
  ctx.clearRect(0, 0, size, size);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? "#f1f4fa" : "#ffffff"; ctx.fillRect(x * s, y * s, s, s); }
  drawFrame(ctx, f, 0, 0, s);
  // Your marks glow for a moment in every frame they landed in.
  const [dx, dy] = state.shift[k] || [0, 0];
  state.marks.forEach((m, i) => {
    let age = now - m.at;
    if (keepLast && i === state.marks.length - 1) age = Math.min(age, 800);   // the newest stays softly outlined
    if (age > 1400) return;
    const X = m.x + dx, Y = m.y + dy; if (X < 0 || X > 7 || Y < 0 || Y > 7) return;
    ctx.strokeStyle = `rgba(247,194,48,${1 - age / 1400})`; ctx.lineWidth = Math.max(2, s / 6);
    ctx.strokeRect(X * s + ctx.lineWidth / 2, Y * s + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
  });
  return { ctx, s };
}

function drawEditor() {
  const now = performance.now();
  const { ctx, s } = paintCanvas($("#big"), state.frames.idle, "idle", now);
  if (state.hint && !state.painted) {   // the suggestion stays visible: a dashed square, red breathing inside
    const breath = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(now / 330));
    ctx.fillStyle = `rgba(216,30,44,${breath})`; ctx.fillRect(state.hint.x * s, state.hint.y * s, s, s);
    ctx.setLineDash([s / 6, s / 8]); ctx.lineWidth = Math.max(2, s / 12); ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(state.hint.x * s + 2, state.hint.y * s + 2, s - 4, s - 4); ctx.setLineDash([]);
  }
  if (state.painted) for (const k of CELLS) paintCanvas($("#mini-" + k), state.frames[k], k, now, true);
  drawStage($("#stage"), now / 1000);
}

/** The character lives on a strip of grass: it walks (Idle ↔ Walk); every 6 s a slime knocks it over (Die). */
const GRASS = tile("Grass"), SLIME = [sprite("slime_idle"), sprite("slime_walk")];
function drawStage(c, t) {
  const dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
  const W = Math.min(2400, Math.round(r.width * dpr)) || 600, H = Math.min(600, Math.round(r.height * dpr)) || 136;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = false;
  const s = H / 3.2 / 8, T = 8 * s, ground = H - T;
  ctx.fillStyle = "#8fc3f0"; ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += T) drawFrame(ctx, GRASS, x, ground, s);
  const cycle = t % 6, walked = Math.floor(t / 6) * 3.4 + Math.min(cycle, 3) + Math.max(0, cycle - 5.6);
  const span = W - T - 16 * dpr, u = (walked * 34 * dpr) % (span * 2);
  const heroX = 8 * dpr + (u < span ? u : span * 2 - u), facing = u < span;
  const speed = W / 2.4, slimeX = W - (cycle - 3) * speed;
  const hit = 3 + Math.max(0, W - heroX - T * 0.7) / speed;
  const down = cycle >= hit && cycle < hit + 1, moving = cycle < 3 || cycle >= 5.6;
  if (cycle > 3 && cycle < 5.6) drawFrame(ctx, SLIME[Math.floor(t * 6) % 2], slimeX, ground - T, s);
  const f = down ? state.frames.die : (moving && Math.floor(t * 4) % 2 ? state.frames.walk : state.frames.idle);
  drawFrame(ctx, f, heroX, ground - T, s, !facing);
}

function setPixel(f, x, y, v) { if (x >= 0 && x < 8 && y >= 0 && y < 8) f[y * 8 + x] = v; }

function paintAt(ev) {
  const c = $("#big"), r = c.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * 8), y = Math.floor(((ev.clientY - r.top) / r.height) * 8);
  if (x < 0 || y < 0 || x > 7 || y > 7) return;
  if (state.frames.idle[y * 8 + x] === state.color) return;
  for (const k of CELLS) { const [dx, dy] = state.shift[k]; setPixel(state.frames[k], x + dx, y + dy, state.color); }
  state.marks.push({ x, y, at: performance.now() });
  if (!state.painted) {
    state.painted = true;
    track("first_stroke", { base: state.base }, { onlyOnce: true });
    track("first_mark", { base: state.base, hint: state.hint && state.hint.x === x && state.hint.y === y ? "1" : "0" }, { onlyOnce: true });
    stepUI();
  }
}

function bindEditor() {
  const c = $("#big");
  let down = false;
  c.addEventListener("pointerdown", (e) => { down = true; c.setPointerCapture(e.pointerId); paintAt(e); e.preventDefault(); });
  c.addEventListener("pointermove", (e) => { if (down) paintAt(e); });
  c.addEventListener("pointerup", () => { down = false; });
  c.addEventListener("pointercancel", () => { down = false; });
  $("#name").addEventListener("input", (e) => { state.name = e.target.value.trim().slice(0, 24) || cap(state.base); });
  $("#play").onclick = () => startDuel();
  $("#start-over").onclick = () => startOver();
  $("#another").onclick = () => {
    const i = SKETCHES.indexOf(state.base);
    startSketch(SKETCHES[(i + 1) % SKETCHES.length]);
    show("draw");
  };
  const tick = () => { drawEditor(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- duel

function rivalFrames() {
  if (state.challenger) return state.challenger.frames;
  return monsterFrames();
}

function monsterFrames() {
  const pool = RIVALS.filter((r) => r !== state.base);
  return character(pool[Math.floor(Math.random() * pool.length)]);
}

// A resident fights a monster; a guest is the rival and your newest resident fights it — never the friend's
// character as your own fighter (UX sim 2026-10-07, same rule as the app's DuelSheet).
function startDuel(fighter, guest, mine) {
  if (!fighter && !state.painted) return;            // 2/2 opens after the first dot (the button says so)
  const you = fighter || state.frames;
  if (isEmpty(you.idle) || isEmpty(you.walk) || isEmpty(you.die)) return;
  show("duel");
  $("#result").hidden = true;
  $("#rival-name").textContent = guest ? t("challenge_name", { name: guest.name })
    : !fighter && state.challenger ? t("challenge_name", { name: state.challenger.name }) : t("rival_line");
  state.duel?.stop();
  const fresh = !fighter;
  const rival = guest ? guest.frames : fresh ? rivalFrames() : monsterFrames();
  state.lastDuel = { fighter, guest, mine };
  if (mine) state.last = mine;                       // a guest duel: the resident who fought is the one to share
  state.reply = null;
  $("#share-last").textContent = t("challenge_friend");
  state.duel = new Duel($("#arena"), you, rival, (r) => endDuel(r, fresh ? you : null));
  state.duel.onClose = () => { state.duel?.stop(); show(fresh ? "draw" : "house"); };
  track("duel_start", { base: state.base, vs: guest ? "guest" : fresh && state.challenger ? "challenge" : "monster", marked: state.painted ? "1" : "0" });
  $("#duel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function endDuel(r, newcomer) {
  let line = t(r.draw ? "result_draw" : r.won ? "result_won" : "result_lost", { a: r.you, b: r.rival });
  if (newcomer) {
    const m = member("web:" + Date.now().toString(36), state.name, newcomer, "Web");
    const n = moveIn(m);
    state.last = m;
    track("move_in", { n: String(n) });
    line += " " + t("moved_in", { name: state.name, n });
    newSketchAfter();
  }
  if (state.challenger && addGuest(state.challenger.member)) line += " " + t("guest_stays", { name: state.challenger.name });
  // Against a friend's character the share answers with the score — the friend gets your character back (the reply loop).
  const friend = state.lastDuel?.guest || (newcomer && state.challenger ? state.challenger : null);
  if (friend && state.last) {
    state.reply = { me: state.last.id, name: friend.name, won: r.won, draw: r.draw, a: r.you, b: r.rival };
    $("#share-last").textContent = t("challenge_back");
  }
  $("#result-line").textContent = line;
  $("#result").hidden = false;
  state.room?.refresh();
  renderHouse();
}

function newSketchAfter() {
  // the editor keeps a fresh copy — the one that moved in is in the house now
  const i = SKETCHES.indexOf(state.base);
  state.nextBase = SKETCHES[(i + 1) % SKETCHES.length];
}

// ---------------------------------------------------------------- sharing: the link is a Skin PNG

async function linkFor(m) {
  const f = framesOf(m);
  const key = "u/" + (m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "friend");
  const png = await Skin.encode(m.name, [[key + "_idle", key + "_walk", key + "_die"]],
    { [key + "_idle"]: f.idle, [key + "_walk"]: f.walk, [key + "_die"]: f.die },
    [{ kind: "character", key, display: m.name }]);
  return "https://spriteer.com/c/#" + Skin.toBase64Url(png);
}

/** The character as a picture (Idle · Walk · Die, 12×): what the friend sees in the thread before the link. */
function previewBlob(m) {
  const f = framesOf(m), S = 12, pad = 8;
  const c = document.createElement("canvas");
  c.width = pad * 2 + 3 * 8 * S + 2 * S; c.height = pad * 2 + 8 * S;
  const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fbf7ef"; ctx.fillRect(0, 0, c.width, c.height);
  [f.idle, f.walk, f.die].forEach((fr, i) => drawFrame(ctx, fr, pad + i * (8 * S + S), pad, S));
  return new Promise((r) => c.toBlob(r, "image/png"));
}

/** What the link says. After a duel against a friend's character it answers with the score (the reply loop). */
function shareText(m) {
  const r = state.reply;
  if (r && r.me === m.id) return t(r.draw ? "reply_draw" : r.won ? "reply_won" : "reply_lost", { me: m.name, name: r.name, a: r.a, b: r.b });
  return t("share_text", { name: m.name });
}

async function share(m) {
  const url = await linkFor(m);
  const text = shareText(m);
  track("link_share", { n: String(spHalf().residents.length), reply: state.reply && state.reply.me === m.id ? "1" : "0" });
  if (navigator.share) {
    // With a picture attached the url can be dropped by some targets, so it rides in the text as well.
    let files = [];
    try {
      const blob = await previewBlob(m);
      const file = blob && new File([blob], "spriteer-" + (m.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".png", { type: "image/png" });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) files = [file];
    } catch {}
    try {
      await navigator.share(files.length ? { title: "Spriteer", text: text + "\n" + url, files } : { title: "Spriteer", text, url });
      return;
    } catch (e) { if (e?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(text + "\n" + url); toast(t("link_copied")); } catch { prompt(t("copy_prompt"), url); }
}

async function downloadHouse() {
  const h = spHalf();
  const all = [...h.residents, ...h.guests].slice(-128);
  if (!all.length) return;
  const strips = [], frames = {}, assets = [];
  const used = new Set();
  for (const m of all) {
    let key = "u/" + (m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "friend");
    for (let n = 2; used.has(key); n++) key = key.replace(/-\d+$/, "") + "-" + n;
    used.add(key);
    const f = framesOf(m);
    strips.push([key + "_idle", key + "_walk", key + "_die"]);
    Object.assign(frames, { [key + "_idle"]: f.idle, [key + "_walk"]: f.walk, [key + "_die"]: f.die });
    assets.push({ kind: "character", key, display: m.name });
  }
  const png = await Skin.encode("My house", strips, frames, assets);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([png], { type: "image/png" }));
  a.download = "spriteer-house.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function readChallenge() {
  const m = /^#([A-Za-z0-9_-]{40,})$/.exec(location.hash);
  if (!location.pathname.startsWith("/c") || !m) return;
  try {
    const skin = await Skin.decode(Skin.fromBase64Url(m[1]));
    const strip = skin.strips.find((s) => Array.isArray(s) && s[0] && skin.frames[s[0]]);
    if (!strip) throw new Error("empty");
    const fr = { idle: skin.frames[strip[0]], walk: skin.frames[strip[1]] || skin.frames[strip[0]], die: skin.frames[strip[2]] || skin.frames[strip[0]] };
    const name = (skin.assets.find((a) => strip[0].startsWith(a.key))?.display) || skin.name;
    state.challenger = { name, frames: fr, member: member("guest:" + m[1].slice(-24), name, fr, skin.name) };
    track("link_open", {});
    // The Smart App Banner's "Open" hands this very link to the app, so the challenge survives the hop.
    document.querySelector('meta[name="apple-itunes-app"]')?.setAttribute("content", "app-id=6796374506, app-argument=" + location.href);
    $("#challenge").hidden = false;
    $("#challenge-name").textContent = t("challenge_name", { name });
    const c = $("#challenge-art"), ctx = c.getContext("2d");
    c.width = c.height = 96; ctx.imageSmoothingEnabled = false;
    let tick = 0;   // not "t": a block-scoped t shadowed the i18n t() above, and every link read as broken
    const loop = () => { ctx.clearRect(0, 0, 96, 96); drawFrame(ctx, Math.floor(tick++ / 16) % 2 ? fr.walk : fr.idle, 8, 8, 10); requestAnimationFrame(loop); };
    loop();
  } catch (e) {
    $("#challenge").hidden = false;
    $("#challenge-name").textContent = t("bad_link");
  }
}

// ---------------------------------------------------------------- house

function renderHouse() {
  const h = spHalf(), counts = state.room?.counts();
  $("#house-count").textContent = h.residents.length ? tn("residents", h.residents.length) + (h.guests.length ? " · " + tn("guests", h.guests.length) : "") : t("house_empty");
  if (counts) $("#py-count").textContent = t("py_counts", { a: counts.pys[0], b: counts.pys[1], c: counts.pets[0], d: counts.pets[1], e: counts.fish[0], f: counts.fish[1] });
  const list = $("#residents");
  list.innerHTML = "";
  const people = [...h.residents.map((m) => ({ m, guest: false })).reverse(), ...h.guests.map((m) => ({ m, guest: true })).reverse()];
  for (const { m, guest } of people.slice(0, 60)) {
    const card = document.createElement("div");
    card.className = "resident";
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d"); ctx.imageSmoothingEnabled = false;
    drawFrame(ctx, framesOf(m).idle, 0, 0, 8);
    const name = document.createElement("div"); name.className = "rname"; name.textContent = m.name;
    const tag = document.createElement("div"); tag.className = "rtag"; tag.textContent = t(guest ? "tag_guest" : "tag_resident");
    const row = document.createElement("div"); row.className = "ractions";
    const duel = document.createElement("button"); duel.textContent = t("btn_duel");
    duel.onclick = () => guest ? startDuel(myFighter(), { name: m.name, frames: framesOf(m) }, myResident()) : startDuel(framesOf(m), null, m);
    const sh = document.createElement("button"); sh.textContent = t("btn_challenge"); sh.onclick = () => share(m);
    row.append(duel, sh);
    if (!guest && APPLE) {
      // A link to spriteer.com from spriteer.com never leaves Safari (Universal Links skip same-site taps), so the
      // app's own scheme carries the same Skin PNG; without the app, the App Store opens instead.
      const app = document.createElement("a"); app.textContent = t("btn_open_app"); app.className = "rapp"; app.href = "#";
      app.onclick = (e) => { e.preventDefault(); openInApp(m); };
      row.append(app);
    }
    card.append(c, name, tag, row);
    list.append(card);
  }
}

const APPLE = /iPhone|iPad|Macintosh/.test(navigator.userAgent);

function myResident() {
  const h = spHalf();
  return h.residents[h.residents.length - 1] || null;
}
function myFighter() {
  const r = myResident();
  return r ? framesOf(r) : state.frames;
}

async function openInApp(m) {
  const u = await linkFor(m);
  track("open_app", {});
  const frag = u.slice(u.indexOf("#"));
  const t0 = Date.now();
  window.location.href = "spriteer://c/?own=1" + frag;
  setTimeout(() => {
    if (document.visibilityState === "visible" && Date.now() - t0 < 2500) window.location.href = APP_STORE + "?ct=web-sp-open";
  }, 1400);
}

// ---------------------------------------------------------------- page

function show(which) {
  $("#draw").classList.toggle("dim", which !== "draw");
  $("#duel").hidden = which !== "duel";
  if (which === "draw" && state.nextBase) { startSketch(state.nextBase); state.nextBase = null; }
  if (which !== "duel") state.duel?.stop();
}

function toast(text) {
  const el = $("#toast");
  el.textContent = text; el.hidden = false;
  clearTimeout(el._h); el._h = setTimeout(() => { el.hidden = true; }, 1800);
}

function bindDuelControls() {
  for (const b of document.querySelectorAll("[data-key]")) {
    const k = b.dataset.key;
    const on = (e) => { state.duel?.press(k, true); e.preventDefault(); };
    const off = (e) => { state.duel?.press(k, false); e.preventDefault(); };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
  }
  $("#rematch").onclick = () => {
    const d = state.lastDuel || {};
    startDuel(d.guest ? d.fighter : state.last ? framesOf(state.last) : d.fighter, d.guest, d.mine);
  };
  $("#share-last").onclick = () => state.last && share(state.last);
  $("#draw-next").onclick = () => { show("draw"); $("#draw").scrollIntoView({ behavior: "smooth" }); };
  $("#to-house").onclick = () => $("#house").scrollIntoView({ behavior: "smooth" });
  $("#quit").onclick = () => state.duel?.onClose?.();
}

async function boot() {
  applyI18n(location.pathname.startsWith("/c") ? "page_title_c" : "page_title");
  await receiveDoor(location.hash);
  bindEditor();
  bindDuelControls();
  startSketch(spHalf().residents.length ? SKETCHES[1 + (spHalf().residents.length % (SKETCHES.length - 1))] : "hero");
  state.room = new Room($("#room"));
  renderHouse();
  $("#download").onclick = downloadHouse;
  $("#to-py").onclick = async (e) => {
    e.preventDefault();
    track("house_door", { to: "py" });
    location.href = await doorToPythoneer("https://pythoneer.io/night/?ct=sp-house");
  };
  new IntersectionObserver((es, o) => {
    if (es.some((e) => e.isIntersecting)) { const c = state.room.counts(); track("house_open", { residents: String(c.residents), guests: String(c.guests) }); o.disconnect(); }
  }).observe($("#house"));
  await readChallenge();
  for (const a of document.querySelectorAll("a[data-store]")) a.href = `${APP_STORE}?ct=${a.dataset.store}`;
}

boot();
