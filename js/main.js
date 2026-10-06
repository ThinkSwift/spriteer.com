// spriteer.com — fill four dots, watch it walk, win a duel, it moves into your house.
// The same loop as the app's first run (SPRITEER.md, founder 2026-10-06).
import { sprite, character, hasSprite, drawFrame, hex, isEmpty } from "./pixels.js";
import { Duel, RULES } from "./duel.js";
import { Room, member, moveIn, addGuest, framesOf, spHalf, doorToPythoneer, receiveDoor } from "./house.js";
import * as Skin from "./skinpng.js";
import { track } from "./track.js";

const APP_STORE = "https://apps.apple.com/app/id6796374506";
const SKETCHES = ["hero", "slime", "ghost", "duck", "goblin", "skeleton", "bat", "crab", "zombie", "monkey", "snake", "spider", "mole", "bee", "jelly"];
const RIVALS = ["goblin", "skeleton", "zombie", "slime", "ghost", "spider"];
const EXTRA = [0xffffffff, 0x211f40ff, 0xde5c33ff, 0xf7c230ff, 0x3882d9ff, 0x559e3dff, 0x7870dbff].map((v) => v >>> 0);
const TARGETS = 4;
const $ = (s) => document.querySelector(s);
const cap = (s) => s.replace(/^u\//, "").replace(/^npc_/, "").replace(/^\w/, (c) => c.toUpperCase());

const state = {
  base: "hero", frames: null, targets: [], color: 0, painted: false, done: false,
  name: "Hero", challenger: null, duel: null, room: null, autoStart: null,
};

// ---------------------------------------------------------------- sketch: Walk with dots missing

/** The dots that make the walk: pixels where Walk differs from Idle, lowest rows first. */
function walkDots(idle, walk) {
  const diff = [];
  for (let i = 63; i >= 0; i--) if ((walk[i] & 0xff) && walk[i] !== idle[i]) diff.push(i);
  const pick = diff.slice(0, TARGETS);
  for (let i = 63; pick.length < TARGETS && i >= 0; i--) if ((walk[i] & 0xff) && !pick.includes(i)) pick.push(i);
  return pick;
}

function startSketch(base) {
  state.base = base;
  const c = character(base);
  state.targets = walkDots(c.idle, c.walk).map((i) => ({ i, hint: c.walk[i] }));
  for (const t of state.targets) c.walk[t.i] = 0;
  state.frames = c;
  state.done = false; state.painted = false;
  state.name = cap(base);
  $("#name").value = state.name;
  buildPalette();
  state.color = state.targets[0]?.hint ?? EXTRA[0];
  markPalette();
  updateGoal();
  drawEditor();
}

function paletteColors() {
  const seen = new Set();
  for (const k of ["idle", "walk", "die"]) for (const v of state.frames[k]) if (v & 0xff) seen.add(v >>> 0);
  for (const t of state.targets) seen.add(t.hint >>> 0);
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
    b.setAttribute("aria-label", v ? "Color " + hex(v) : "Eraser");
    b.dataset.v = String(v);
    b.onclick = () => { state.color = v; markPalette(); };
    p.appendChild(b);
  }
}
function markPalette() {
  for (const b of document.querySelectorAll(".swatch")) b.classList.toggle("on", Number(b.dataset.v) === state.color);
}

function filled() { return state.targets.filter((t) => state.frames.walk[t.i] & 0xff).length; }

function updateGoal() {
  const n = filled();
  $("#goal-count").textContent = `${n}/${state.targets.length}`;
  $("#goal").classList.toggle("done", n === state.targets.length);
  $("#play").disabled = n < state.targets.length;
}

// ---------------------------------------------------------------- editor

const CELLS = ["idle", "walk", "die"];
function drawEditor() {
  for (const k of CELLS) {
    const c = document.getElementById("cell-" + k), ctx = c.getContext("2d");
    const size = c.clientWidth * (window.devicePixelRatio || 1);
    if (c.width !== size) { c.width = size; c.height = size; }
    const s = size / 8;
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#f1f4fa" : "#ffffff";
      ctx.fillRect(x * s, y * s, s, s);
    }
    drawFrame(ctx, state.frames[k], 0, 0, s);
    if (k === "walk") {
      const blink = Math.floor(performance.now() / 450) % 2;
      for (const t of state.targets) {
        if (state.frames.walk[t.i] & 0xff) continue;
        const x = (t.i % 8) * s, y = ((t.i / 8) | 0) * s;
        ctx.globalAlpha = 0.35; ctx.fillStyle = hex(t.hint); ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1;
        ctx.setLineDash([s / 5, s / 6]); ctx.lineWidth = Math.max(2, s / 10);
        ctx.strokeStyle = blink ? "#de5c33" : "#211f40";
        ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
        ctx.setLineDash([]);
      }
    }
  }
  // the preview walks as soon as there is a walk
  const p = $("#preview"), pc = p.getContext("2d");
  const ps = p.clientWidth * (window.devicePixelRatio || 1);
  if (p.width !== ps) { p.width = ps; p.height = ps; }
  pc.clearRect(0, 0, ps, ps);
  const step = Math.floor(performance.now() / 260) % 2;
  drawFrame(pc, step ? state.frames.walk : state.frames.idle, ps * 0.1, ps * 0.1, (ps * 0.8) / 8);
}

function paintAt(k, ev) {
  const c = document.getElementById("cell-" + k), r = c.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * 8), y = Math.floor(((ev.clientY - r.top) / r.height) * 8);
  if (x < 0 || y < 0 || x > 7 || y > 7) return;
  const i = y * 8 + x, before = state.frames[k][i];
  if (before === state.color) return;
  state.frames[k][i] = state.color;
  if (!state.painted) { state.painted = true; track("first_stroke", { base: state.base }, { onlyOnce: true }); }
  if (state.autoStart) { clearTimeout(state.autoStart); state.autoStart = null; $("#goal-note").textContent = "Press Play when ready."; }
  const wasDone = state.done;
  updateGoal();
  if (!wasDone && filled() === state.targets.length) {
    state.done = true;
    track("walk_done", { base: state.base });
    $("#goal-note").textContent = "It walks! The duel starts in a moment…";
    state.autoStart = setTimeout(() => startDuel(), 1600);
  }
}

function bindEditor() {
  for (const k of CELLS) {
    const c = document.getElementById("cell-" + k);
    let down = false;
    c.addEventListener("pointerdown", (e) => { down = true; c.setPointerCapture(e.pointerId); paintAt(k, e); e.preventDefault(); });
    c.addEventListener("pointermove", (e) => { if (down) paintAt(k, e); });
    c.addEventListener("pointerup", () => { down = false; });
    c.addEventListener("pointercancel", () => { down = false; });
  }
  $("#name").addEventListener("input", (e) => { state.name = e.target.value.trim().slice(0, 24) || cap(state.base); });
  $("#play").onclick = () => startDuel();
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
  const pool = RIVALS.filter((r) => r !== state.base);
  return character(pool[Math.floor(Math.random() * pool.length)]);
}

function startDuel(fighter) {
  if (state.autoStart) { clearTimeout(state.autoStart); state.autoStart = null; }
  const you = fighter || state.frames;
  if (isEmpty(you.idle) || isEmpty(you.walk) || isEmpty(you.die)) return;
  show("duel");
  $("#result").hidden = true;
  $("#rival-name").textContent = state.challenger ? `${state.challenger.name} challenges you` : `Stomp the rival ${RULES.stomps} times in ${RULES.seconds} seconds`;
  state.duel?.stop();
  const fresh = !fighter;
  state.duel = new Duel($("#arena"), you, rivalFrames(), (r) => endDuel(r, fresh ? you : null));
  state.duel.onClose = () => { state.duel?.stop(); show(fresh ? "draw" : "house"); };
  track("arcade_play", { base: state.base, challenge: state.challenger ? "1" : "0" });
  $("#duel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function endDuel(r, newcomer) {
  let line = r.draw ? `A draw, ${r.you}–${r.rival}.` : r.won ? `You won ${r.you}–${r.rival}!` : `The rival won ${r.rival}–${r.you}.`;
  if (newcomer) {
    const m = member("web:" + Date.now().toString(36), state.name, newcomer, "Web");
    const n = moveIn(m);
    state.last = m;
    track("move_in", { n: String(n) });
    line += ` ${state.name} moved into your house · ${n}`;
    newSketchAfter();
  }
  if (state.challenger && addGuest(state.challenger.member)) line += ` ${state.challenger.name} stays as your guest.`;
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

async function share(m) {
  const url = await linkFor(m);
  const text = `${m.name} challenges you. Stomp it 3 times in 30 seconds.`;
  track("link_share", { n: String(spHalf().residents.length) });
  if (navigator.share) {
    try { await navigator.share({ title: "Spriteer", text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Copy this link", url); }
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
    $("#challenge").hidden = false;
    $("#challenge-name").textContent = `${name} challenges you`;
    const c = $("#challenge-art"), ctx = c.getContext("2d");
    c.width = c.height = 96; ctx.imageSmoothingEnabled = false;
    let t = 0;
    const loop = () => { ctx.clearRect(0, 0, 96, 96); drawFrame(ctx, Math.floor(t++ / 16) % 2 ? fr.walk : fr.idle, 8, 8, 10); requestAnimationFrame(loop); };
    loop();
  } catch (e) {
    $("#challenge").hidden = false;
    $("#challenge-name").textContent = "This link could not be read. Ask for a fresh one.";
  }
}

// ---------------------------------------------------------------- house

function renderHouse() {
  const h = spHalf(), counts = state.room?.counts();
  $("#house-count").textContent = h.residents.length ? `${h.residents.length} resident${h.residents.length > 1 ? "s" : ""}${h.guests.length ? ` · ${h.guests.length} guest${h.guests.length > 1 ? "s" : ""}` : ""}` : "No one lives here yet — fill four dots above.";
  if (counts) $("#py-count").textContent = `Pys ${counts.pys[0]}/${counts.pys[1]} · Pets ${counts.pets[0]}/${counts.pets[1]} · Fish ${counts.fish[0]}/${counts.fish[1]}`;
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
    const tag = document.createElement("div"); tag.className = "rtag"; tag.textContent = guest ? "Guest" : "Resident";
    const row = document.createElement("div"); row.className = "ractions";
    const duel = document.createElement("button"); duel.textContent = "Duel"; duel.onclick = () => startDuel(framesOf(m));
    const sh = document.createElement("button"); sh.textContent = "Challenge"; sh.onclick = () => share(m);
    row.append(duel, sh);
    if (!guest) {
      const app = document.createElement("a"); app.textContent = "Open in app"; app.className = "rapp";
      linkFor(m).then((u) => { app.href = u; });
      row.append(app);
    }
    card.append(c, name, tag, row);
    list.append(card);
  }
}

// ---------------------------------------------------------------- page

function show(which) {
  $("#draw").classList.toggle("dim", which !== "draw");
  $("#duel").hidden = which !== "duel";
  if (which === "draw" && state.nextBase) { startSketch(state.nextBase); state.nextBase = null; }
  if (which !== "duel") state.duel?.stop();
}

function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 1800);
}

function bindDuelControls() {
  for (const b of document.querySelectorAll("[data-key]")) {
    const k = b.dataset.key;
    const on = (e) => { state.duel?.press(k, true); e.preventDefault(); };
    const off = (e) => { state.duel?.press(k, false); e.preventDefault(); };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
  }
  $("#rematch").onclick = () => startDuel(state.last ? framesOf(state.last) : undefined);
  $("#share-last").onclick = () => state.last && share(state.last);
  $("#draw-next").onclick = () => { show("draw"); $("#draw").scrollIntoView({ behavior: "smooth" }); };
  $("#to-house").onclick = () => $("#house").scrollIntoView({ behavior: "smooth" });
  $("#quit").onclick = () => state.duel?.onClose?.();
}

async function boot() {
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
