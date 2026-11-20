import { boardSVG, hexDistance, TERRAIN } from "./hexmap.js";
import { cameraSupported, capture, startCamera, stopCamera } from "./camera.js";
import { deleteCampaign, getCampaign, listCampaigns, newId, saveCampaign } from "./store.js";

const app = document.getElementById("app");
const tabs = document.getElementById("tabs");
const toastEl = document.getElementById("toast");

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (sel) => app.querySelector(sel);
const $$ = (sel) => [...app.querySelectorAll(sel)];

const ICON = {
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M4 17a2 2 0 0 1 2-2h12"/></svg>',
  party: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><path d="M15 4.5a3.5 3.5 0 0 1 0 7M17.5 14.5c2 .8 3.5 2.8 3.5 5.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  die: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#f2b544" stroke-width="2" stroke-linejoin="round"><path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>',
};
const HERO_COLORS = ["#5aa7d6", "#e8552b", "#a98ae0", "#f2b544", "#3f9a7a", "#e07aa5"];
const CLASSES = ["Ranger", "Fighter", "Wizard", "Cleric", "Rogue", "Bard", "Druid", "Explorer"];
const STORY_IDEAS = [
  "A classic fantasy quest to save a village",
  "A spooky mystery in the swamp",
  "Pirates and treasure along the river",
  "Explore ancient ruins full of puzzles",
  "A funny adventure for kids",
];

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 5000);
}

function overlay(text) {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div><div class="spinner"></div><p>${esc(text)}</p></div>`;
  document.body.appendChild(el);
  return () => el.remove();
}

async function api(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    const isForm = body instanceof FormData;
    const res = await fetch(path, {
      method: "POST",
      body: isForm ? body : JSON.stringify(body),
      headers: isForm ? {} : { "Content-Type": "application/json" },
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === "string" ? d : "Something went wrong. Please try again.");
    }
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The request took too long. Please try again.");
    if (e instanceof TypeError) throw new Error("No connection to the server. Check your internet.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function setTabs(c, active) {
  document.body.classList.toggle("no-tabs", !c);
  tabs.hidden = !c;
  if (!c) return;
  const t = (name, label, icon) =>
    `<a href="#/c/${c.id}/${name}" class="${active === name ? "on" : ""}" ${active === name ? 'aria-current="page"' : ""}>${ICON[icon]}${label}</a>`;
  tabs.innerHTML = t("map", "Map", "map") + t("scan", "Scan", "camera") + t("quests", "Quests", "book") + t("party", "Party", "party");
}

const activeQuest = (c) => c.quests.find((q) => q.status === "active");
const tileByLabel = (c, label) => c.board.find((t) => t.label === label);
const tileName = (c, label) => {
  const t = tileByLabel(c, label);
  return c.places[label] || (t ? `${TERRAIN[t.terrain]?.name || ""} ${label}` : label);
};
const heroClass = (c, name) => c.heroes.find((h) => h.name === name)?.cls || "";

// ---------------------------------------------------------------- router
let cleanup = null;
let draft = null;          // new campaign being created: { board }
const busy = new Set();    // campaign ids waiting for the Game Master

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  toastEl.hidden = true;
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  window.scrollTo(0, 0);
  if (parts[0] === "new") return parts[1] === "story" ? viewStorySetup() : viewScan(null);
  if (parts[0] === "c") {
    const c = getCampaign(parts[1]);
    if (!c) { location.hash = "#/"; return; }
    const view = { map: viewMap, scan: viewScan, quests: viewQuests, party: viewParty }[parts[2]] || viewQuests;
    return view(c);
  }
  viewHome();
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- home
const DEMO = [
  ["forest", 0, 0], ["mountain", 1, 0], ["plains", -1, 1], ["swamp", 0, 1], ["water", 1, 1],
  ["village", -1, 2], ["ruins", 0, 2],
].map(([terrain, q, r], i) => ({ id: i, label: `D-${i}`, terrain, q, r }));

function viewHome() {
  setTabs(null);
  const list = listCampaigns();
  app.innerHTML = `
    <header class="top"><div class="titles"><div class="eyebrow">Tabletop adventure</div><h1>Snap Quest</h1></div></header>
    <div style="max-width:300px;margin:0 auto">${boardSVG(DEMO)}</div>
    <p class="muted" style="text-align:center;margin:6px 0 20px">Snap the board. Shape the world for your quest.</p>
    <a class="btn" href="#/new">New adventure</a>
    ${list.length ? `<h2 style="margin:26px 0 12px">Your adventures</h2>` + list.map((c) => `
      <a class="card campaign" href="#/c/${c.id}/party">
        <div class="eyebrow">${c.board.length} tiles · ${c.heroes.length} heroes</div>
        <h3>${esc(c.title)}</h3>
        <div class="muted small">${esc(activeQuest(c)?.title || "No active quest")} · ${new Date(c.updated).toLocaleDateString()}</div>
      </a>`).join("") : ""}
    <section class="card" style="margin-top:22px">
      <h2>How to play</h2>
      <ol class="steps">
        <li><span><a href="/print-tiles.pdf" target="_blank" rel="noopener">Print the tiles</a> on matte card, cut them out.</span></li>
        <li><span>Build your world on the table.</span></li>
        <li><span>Snap the board with this app.</span></li>
        <li><span>Tell the AI Game Master what story you want.</span></li>
        <li><span>Play! Roll your real d20 when the Game Master asks.</span></li>
      </ol>
    </section>`;
}

// ---------------------------------------------------------------- scan
function viewScan(c) {
  setTabs(c, "scan");
  if (c) document.body.classList.add("no-tabs"), (tabs.hidden = true);
  let stream = null;
  let result = null;
  const exitHref = c ? `#/c/${c.id}/map` : "#/";
  cleanup = () => stopCamera(stream);

  const header = `
    <header class="top center">
      <a class="round" href="${exitHref}" aria-label="Close">${ICON.close}</a>
      <div class="titles"><div class="eyebrow">${c ? esc(c.title) : "New adventure"}</div><h1>Scan the board</h1></div>
      <span class="round" style="visibility:hidden"></span>
    </header>`;

  function renderCamera() {
    const live = cameraSupported();
    app.innerHTML = header + `
      <div class="viewfinder">
        ${live ? `<video autoplay muted playsinline></video>` :
          `<div class="no-camera">Live preview isn't available in this browser.<br>Use <b>Take photo</b> below.</div>`}
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="pill">Fit the whole board in the frame</div>
      </div>
      ${live ? `<button class="shutter" id="shutter" aria-label="Take photo"></button>` : ""}
      <div class="row" style="margin-top:${live ? 4 : 18}px">
        ${live ? "" : `<label class="btn">Take photo<input id="snapfile" type="file" accept="image/*" capture="environment" hidden></label>`}
        <label class="btn ghost small">Upload a photo<input id="pickfile" type="file" accept="image/*" hidden></label>
      </div>
      <p class="muted small" style="text-align:center">Shoot from above · lift minis off the markers · avoid lamp glare</p>`;
    if (live) {
      startCamera($("video")).then((s) => {
        stream = s;
        if (!app.contains($("video"))) stopCamera(s);
      }).catch(() => {
        const vf = $(".viewfinder");
        if (!vf) return;
        vf.querySelector("video")?.replaceWith(Object.assign(document.createElement("div"), {
          className: "no-camera", innerHTML: "Camera preview was blocked.<br>Use <b>Take photo</b> below, or allow the camera and reopen this page.",
        }));
        // fall back to the phone's own camera app
        $("#shutter")?.replaceWith(Object.assign(document.createElement("label"), {
          className: "btn", style: "margin-top:18px",
          innerHTML: 'Take photo<input id="snapfile" type="file" accept="image/*" capture="environment" hidden>',
        }));
        const input = $("#snapfile");
        input.onchange = () => input.files[0] && send(input.files[0]);
      });
      $("#shutter").onclick = async () => {
        $("#shutter").disabled = true;
        try { send(await capture($("video"), stream)); }
        catch { toast("Could not take the photo. Try again."); $("#shutter").disabled = false; }
      };
    }
    for (const id of ["#snapfile", "#pickfile"]) {
      const input = $(id);
      if (input) input.onchange = () => input.files[0] && send(input.files[0]);
    }
  }

  async function send(blob) {
    const done = overlay("Reading markers…");
    try {
      const form = new FormData();
      form.append("photo", blob, "board.jpg");
      result = await api("/api/scan", form);
      stopCamera(stream); stream = null;
      renderResult();
    } catch (e) {
      toast(e.message);
      const btn = $("#shutter"); if (btn) btn.disabled = false;
    } finally { done(); }
  }

  function renderResult() {
    const tiles = result.tiles;
    const oldIds = new Set((c?.board || []).map((t) => t.id));
    const newIds = new Set(tiles.map((t) => t.id));
    const added = tiles.filter((t) => !oldIds.has(t.id));
    const removed = (c?.board || []).filter((t) => !newIds.has(t.id));
    const minTiles = c ? 1 : 3;
    app.innerHTML = header + `
      ${result.preview ? `<div class="viewfinder result"><img alt="Your board with recognised tiles outlined" src="data:image/jpeg;base64,${result.preview}"></div>` : ""}
      <section class="card" style="margin-top:14px">
        <div class="stat"><strong>${tiles.length} tile${tiles.length === 1 ? "" : "s"} read</strong>
          <span class="muted small">${result.unreadable ? `${result.unreadable} unreadable` : "all markers read"}</span></div>
        <div class="progress"><i style="width:${tiles.length + result.unreadable ? Math.round(100 * tiles.length / (tiles.length + result.unreadable)) : 0}%"></i></div>
        ${c ? `<p class="small muted" style="margin:0">${added.length ? `New: ${added.map((t) => `${esc(t.label)} ${TERRAIN[t.terrain].name}`).join(", ")}. ` : "No new tiles. "}${removed.length ? `Removed: ${removed.map((t) => esc(t.label)).join(", ")}.` : ""}</p>` : ""}
        ${result.warnings.map((w) => `<div class="warn"><b>!</b><span>${esc(w)}</span></div>`).join("")}
      </section>
      ${tiles.length ? `<section class="card map-card">${boardSVG(tiles, { highlight: c ? added.map((t) => t.label) : [] })}</section>` : ""}
      <div class="row">
        <button class="btn ghost" id="retake">Retake</button>
        <button class="btn" id="use" ${tiles.length < minTiles ? "disabled" : ""}>${c ? "Update board" : "Use this board"}</button>
      </div>
      ${tiles.length < minTiles ? `<p class="muted small" style="text-align:center">Scan at least ${minTiles} tiles to continue.</p>` : ""}`;
    $("#retake").onclick = () => { result = null; renderCamera(); };
    $("#use").onclick = () => {
      if (!c) { draft = { board: tiles }; location.hash = "#/new/story"; return; }
      c.board = tiles;
      const note = [added.length && `New land: ${added.map((t) => `${TERRAIN[t.terrain].name} ${t.label}`).join(", ")}`,
                    removed.length && `Lost: ${removed.map((t) => t.label).join(", ")}`].filter(Boolean).join(" · ");
      c.boardNote = note || "";
      c.log.push({ role: "system", text: note ? `Board updated. ${note}.` : "Board rescanned, nothing changed." });
      saveCampaign(c);
      if (added.length || removed.length) {
        takeTurn(c, { kind: "board", added: added.map((t) => t.id), removed: removed.map((t) => t.id) });
      }
      location.hash = `#/c/${c.id}/${added.length || removed.length ? "quests" : "map"}`;
    };
  }

  renderCamera();
}

// ---------------------------------------------------------------- story setup
function viewStorySetup() {
  setTabs(null);
  if (!draft?.board?.length) { location.hash = "#/new"; return; }
  const heroes = draft.heroes || [{ name: "", cls: "Ranger" }];
  const heroRow = (h, i) => `
    <div class="hero-row" data-i="${i}">
      <input type="text" maxlength="30" placeholder="Hero ${i + 1} name" value="${esc(h.name)}" aria-label="Hero ${i + 1} name">
      <select aria-label="Hero ${i + 1} class">${CLASSES.map((k) => `<option ${k === h.cls ? "selected" : ""}>${k}</option>`).join("")}</select>
      <button type="button" aria-label="Remove hero" ${heroes.length === 1 ? "disabled" : ""}>×</button>
    </div>`;
  app.innerHTML = `
    <header class="top">
      <a class="round" href="#/new" aria-label="Back to scan">${ICON.back}</a>
      <div class="titles"><div class="eyebrow">${draft.board.length} tiles scanned</div><h1>Your story</h1></div>
    </header>
    <section class="card map-card">${boardSVG(draft.board)}</section>
    <form id="setup">
      <label class="field"><span>Tell the Game Master what story you want</span>
        <textarea id="premise" maxlength="1000" placeholder="e.g. A cozy mystery: the stones in the swamp hum at night and hunters keep disappearing…">${esc(draft.premise || "")}</textarea>
      </label>
      <div class="chips">${STORY_IDEAS.map((s) => `<button type="button" class="chip idea">${esc(s)}</button>`).join("")}</div>
      <h2 style="margin-top:22px">Heroes</h2>
      <div id="heroes">${heroes.map(heroRow).join("")}</div>
      <button type="button" class="btn ghost small" id="addhero" ${heroes.length >= 6 ? "disabled" : ""}>+ Add hero</button>
      <button class="btn" style="margin-top:22px">Begin the story</button>
    </form>`;

  const readHeroes = () => $$(".hero-row").map((row) => ({
    name: row.querySelector("input").value.trim(), cls: row.querySelector("select").value,
  }));
  const keep = () => { draft.premise = $("#premise").value; draft.heroes = readHeroes(); };
  $$(".idea").forEach((b) => (b.onclick = () => { $("#premise").value = b.textContent; }));
  $("#addhero").onclick = () => { keep(); draft.heroes.push({ name: "", cls: CLASSES[draft.heroes.length % CLASSES.length] }); viewStorySetup(); };
  $$(".hero-row button").forEach((b) => (b.onclick = () => {
    keep(); draft.heroes.splice(+b.closest(".hero-row").dataset.i, 1); viewStorySetup();
  }));
  $("#setup").onsubmit = async (e) => {
    e.preventDefault();
    keep();
    const premise = draft.premise.trim();
    if (!premise) { toast("Tell the Game Master what kind of story you want."); $("#premise").focus(); return; }
    const heroesList = draft.heroes.map((h, i) => ({ name: h.name || `Hero ${i + 1}`, cls: h.cls }));
    const done = overlay("The Game Master is shaping your world…");
    try {
      const out = await api("/api/story/start", {
        premise, heroes: heroesList, board: draft.board.map(boardEntry),
      });
      const c = {
        id: newId(), created: Date.now(), title: out.campaign_title, premise, heroes: heroesList,
        board: draft.board, summary: out.summary, places: Object.fromEntries(out.places.map((p) => [p.tile, p.name])),
        party_tile: out.party_tile, quests: [{ ...out.quest, status: "active" }],
        log: [{ role: "gm", text: out.opening }], choices: out.choices, pending_check: null,
        activeHero: heroesList[0].name, turns: 0, boardNote: "",
      };
      saveCampaign(c);
      draft = null;
      location.hash = `#/c/${c.id}/quests`;
    } catch (err) {
      toast(err.message);
    } finally { done(); }
  };
}

// ---------------------------------------------------------------- game master turns
const boardEntry = ({ id, q, r, rotation }) => ({ id, q, r, rotation: rotation || 0 });

function payload(c) {
  return {
    premise: c.premise, heroes: c.heroes, board: c.board.map(boardEntry), summary: c.summary,
    places: c.places, party_tile: c.party_tile,
    quests: c.quests.map(({ title, hook, tile, level, status }) => ({ title, hook, tile, level, status })),
    recent: c.log.slice(-12).map((e) => ({ role: e.role, text: e.text, who: e.who || "" })),
  };
}

function applyTurn(c, out) {
  c.log.push({ role: "gm", text: out.narration });
  for (const p of out.places) c.places[p.tile] = p.name;
  c.party_tile = out.party_tile;
  for (const u of out.quest_updates) {
    const q = c.quests.find((q) => q.title.toLowerCase() === u.title.toLowerCase() && q.status === "active");
    if (q) {
      q.status = u.status;
      c.log.push({ role: "system", text: `Quest ${u.status}: ${q.title}` });
    }
  }
  if (out.new_quest && !c.quests.some((q) => q.title === out.new_quest.title)) {
    c.quests.push({ ...out.new_quest, status: "active" });
    c.log.push({ role: "system", text: `New quest: ${out.new_quest.title}` });
  }
  c.summary = out.summary;
  c.choices = out.choices;
  c.pending_check = out.check;
  c.turns = (c.turns || 0) + 1;
}

async function takeTurn(c, action, entry) {
  if (busy.has(c.id)) return;
  busy.add(c.id);
  if (entry) c.log.push(entry);
  if (action.kind === "say") c.boardNote = "";
  const prevChoices = c.choices, prevCheck = c.pending_check;
  c.choices = [];
  if (action.kind === "roll") c.pending_check = null;
  saveCampaign(c);
  refresh(c);
  try {
    const out = await api("/api/story/turn", { campaign: payload(c), action });
    const fresh = getCampaign(c.id) || c;     // the campaign may have changed meanwhile
    applyTurn(fresh, out);
    saveCampaign(fresh);
  } catch (err) {
    const fresh = getCampaign(c.id) || c;
    if (entry) {
      const i = fresh.log.findIndex((e) => e.ts === entry.ts && e.role === entry.role);
      if (i >= 0) fresh.log.splice(i, 1);
    }
    fresh.choices = prevChoices;
    fresh.pending_check = prevCheck;
    saveCampaign(fresh);
    toast(err.message);
    if (action.kind === "say") lastDraftText = action.text;
  } finally {
    busy.delete(c.id);
    refresh(c);
  }
}

let lastDraftText = "";

function refresh(c) {
  // re-render only if the user is still looking at this campaign's quests or map
  const h = location.hash;
  if (h === `#/c/${c.id}/quests` || h === `#/c/${c.id}`) viewQuests(getCampaign(c.id));
  else if (h === `#/c/${c.id}/map`) viewMap(getCampaign(c.id));
}

// ---------------------------------------------------------------- quests (story)
function viewQuests(c) {
  setTabs(c, "quests");
  const q = activeQuest(c);
  const waiting = busy.has(c.id);
  const check = c.pending_check;
  const entry = (e) => {
    if (e.role === "gm") return `<div class="msg gm"><div class="who">AI Game Master</div>${esc(e.text)}</div>`;
    if (e.role === "player") return `<div class="msg player"><div class="who">${esc(e.who)}${heroClass(c, e.who) ? " · " + esc(heroClass(c, e.who)) : ""}</div>${esc(e.text)}</div>`;
    if (e.role === "roll") return `<div class="msg roll ${e.ok ? "" : "fail"}">${ICON.die}<div><b>${esc(e.who)} · ${esc(e.skill)}</b><div class="muted small">target ${e.target} · ${e.ok ? "success" : "failure"}</div></div><span class="big">${e.roll}</span></div>`;
    return `<div class="msg system">${esc(e.text)}</div>`;
  };
  const heroPick = c.heroes.length > 1 ? `<div class="heroes-pick" role="radiogroup" aria-label="Who acts">${c.heroes.map((h) =>
    `<button type="button" class="chip hero ${h.name === c.activeHero ? "on" : ""}" role="radio" aria-checked="${h.name === c.activeHero}">${esc(h.name)}</button>`).join("")}</div>` : "";

  app.innerHTML = `
    <header class="top center">
      <a class="round" href="#/c/${c.id}/map" aria-label="Map">${ICON.back}</a>
      <div class="titles"><div class="eyebrow">${q ? "Quest" : esc(c.title)}</div><h1 style="font-size:24px">${esc(q ? q.title : "Free roam")}</h1></div>
      <span class="round" style="visibility:hidden"></span>
    </header>
    <div class="log">${c.log.map(entry).join("")}
      ${waiting ? `<div class="msg gm"><div class="who">AI Game Master</div><span class="typing" aria-label="Writing"><span></span><span></span><span></span></span></div>` : ""}
    </div>
    ${waiting ? "" : check ? `
      <section class="card dice" style="margin-top:14px">
        <div class="row" style="align-items:center">${ICON.die}<div style="flex:6"><h3>Roll your real d20</h3>
          <div class="muted">${esc(check.skill)} check · target ${check.target} · ${esc(check.hero)}</div></div></div>
        ${check.reason ? `<p class="small muted" style="margin:10px 0 0">${esc(check.reason)}</p>` : ""}
        <div class="d20">${Array.from({ length: 20 }, (_, i) => `<button type="button" data-roll="${i + 1}" aria-label="Rolled ${i + 1}">${i + 1}</button>`).join("")}</div>
        <button type="button" class="btn ghost small" id="autoroll" style="margin:12px auto 0">No dice? Roll for me</button>
      </section>` : `
      ${c.choices?.length ? `<div class="eyebrow what">What do you do?</div>${c.choices.map((ch) => `<button class="choice">${esc(ch)}</button>`).join("")}` : `<div class="eyebrow what">What do you do?</div>`}
      ${heroPick}
      <form class="composer" id="say">
        <textarea id="said" rows="1" maxlength="500" placeholder="${esc(c.activeHero || "Your hero")} does…" aria-label="Your action">${esc(lastDraftText)}</textarea>
        <button class="round" aria-label="Send">${ICON.send}</button>
      </form>`}`;
  lastDraftText = "";
  window.scrollTo(0, document.body.scrollHeight);

  const say = (text) => {
    text = text.trim();
    if (!text) return;
    const hero = c.activeHero || c.heroes[0]?.name || "";
    takeTurn(c, { kind: "say", text, hero }, { role: "player", who: hero, text, ts: Date.now() });
  };
  $$(".choice").forEach((b) => (b.onclick = () => say(b.textContent)));
  $$(".chip.hero").forEach((b) => (b.onclick = () => {
    c.activeHero = b.textContent; saveCampaign(c);
    $$(".chip.hero").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
    $("#said").placeholder = `${c.activeHero} does…`;
  }));
  const form = $("#say");
  if (form) {
    form.onsubmit = (e) => { e.preventDefault(); say($("#said").value); };
    $("#said").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  }
  const roll = (n) => {
    const ok = n >= check.target;
    takeTurn(c, { kind: "roll", roll: n, check, hero: check.hero },
      { role: "roll", who: check.hero, skill: check.skill, target: check.target, roll: n, ok, ts: Date.now(),
        text: `${check.hero} rolled ${n} for ${check.skill} (target ${check.target}): ${ok ? "success" : "failure"}` });
  };
  $$("[data-roll]").forEach((b) => (b.onclick = () => roll(+b.dataset.roll)));
  const auto = $("#autoroll");
  if (auto) auto.onclick = () => roll(1 + Math.floor(Math.random() * 20));
}

// ---------------------------------------------------------------- map
function viewMap(c) {
  setTabs(c, "map");
  const q = activeQuest(c);
  const party = tileByLabel(c, c.party_tile);
  const qt = q && tileByLabel(c, q.tile);
  const dist = party && qt ? hexDistance(party, qt) : null;
  app.innerHTML = `
    <header class="top">
      <div class="titles"><div class="eyebrow">${esc(c.title)}</div><h1>Your world</h1></div>
      <a class="round" href="#/c/${c.id}/scan" aria-label="Rescan the board">${ICON.camera}</a>
    </header>
    <section class="card map-card">
      ${boardSVG(c.board, { party: c.party_tile, quest: q?.tile, places: c.places })}
      ${c.party_tile ? `<span class="where">${ICON.pin} Party at ${esc(tileName(c, c.party_tile))}</span>` : ""}
    </section>
    ${c.boardNote ? `<div class="alert">${esc(c.boardNote)}</div>` : ""}
    ${q ? `
      <section class="card">
        <div class="kicker">✦ Active quest</div>
        <div class="quest-title">${esc(q.title)}</div>
        <p class="muted" style="margin:0 0 6px">${esc(q.hook)}</p>
        <div class="chips">
          <span class="chip">${ICON.pin} ${esc(qt ? `${TERRAIN[qt.terrain].name} · ${q.tile}` : q.tile)}</span>
          ${dist !== null ? `<span class="chip">${dist === 0 ? "You are here" : `${dist} move${dist === 1 ? "" : "s"} away`}</span>` : ""}
          <span class="chip">Level ${q.level}</span>
        </div>
        <a class="btn" href="#/c/${c.id}/quests" style="margin-top:8px">Continue the quest</a>
      </section>` : `
      <section class="card">
        <div class="kicker">No active quest</div>
        <p class="muted">Ask the Game Master for a new adventure, or explore freely.</p>
        <a class="btn" href="#/c/${c.id}/quests">Go to the story</a>
      </section>`}
    ${busy.has(c.id) ? `<p class="muted small" style="text-align:center">The Game Master is writing…</p>` : ""}`;
}

// ---------------------------------------------------------------- party / recap
function viewParty(c) {
  setTabs(c, "party");
  const days = Math.floor((Date.now() - (c.updated || Date.now())) / 86400000);
  app.innerHTML = `
    <header class="top">
      <div class="titles"><div class="eyebrow">${esc(c.title)}</div><h1>Welcome back</h1></div>
      ${days >= 1 ? `<span class="chip">${days} day${days === 1 ? "" : "s"} since last game</span>` : ""}
    </header>
    <section class="card">
      <div class="kicker gold">✦ Previously…</div>
      <p style="font-size:18px;margin:10px 0 0">${esc(c.summary || "Your story is just beginning.")}</p>
    </section>
    <div class="eyebrow" style="margin:22px 0 12px">Quests so far</div>
    <ul class="timeline">${[...c.quests].reverse().map((q) => `
      <li class="${q.status}"><span class="muted small">${q.status === "active" ? "In progress" : q.status === "completed" ? "Completed" : "Failed"} · ${esc(tileName(c, q.tile))}</span>
        <b>${esc(q.title)}</b><span class="muted">${esc(q.hook)}</span></li>`).join("")}
    </ul>
    <div class="party" style="margin:8px 0 18px">${c.heroes.map((h, i) => `
      <div class="card member"><div class="avatar" style="background:${HERO_COLORS[i % HERO_COLORS.length]}">${esc(h.name[0] || "?")}</div>
        <b>${esc(h.name)}</b><div class="muted small">${esc(h.cls)}</div></div>`).join("")}
    </div>
    <a class="btn" href="#/c/${c.id}/quests">Continue the story</a>
    <details class="card" style="margin-top:22px">
      <summary class="muted">Story request &amp; settings</summary>
      <p>${esc(c.premise)}</p>
      <button class="btn ghost small" id="delete" type="button">Delete this adventure</button>
    </details>`;
  $("#delete").onclick = () => {
    if (confirm(`Delete "${c.title}" from this phone? This cannot be undone.`)) {
      deleteCampaign(c.id);
      location.hash = "#/";
    }
  };
}

route();
