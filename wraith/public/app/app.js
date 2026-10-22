import { BareMuxConnection } from "/baremux/index.mjs";

const $ = (id) => document.getElementById(id);
const uv = self.__uv$config;

/* ---------- settings ---------- */
const SKEY = "wraith:settings";
const LKEY = "wraith:links";
const defaults = {
  engine: "https://www.google.com/search?q=%s",
  mode: "bare",
  disguise: "none",
  disguiseTitle: "",
  disguiseIcon: "",
  panicUrl: "https://www.google.com",
  theme: "night",
};
const defaultLinks = [
  { name: "YouTube", url: "https://www.youtube.com" },
  { name: "Reddit", url: "https://www.reddit.com" },
  { name: "Wikipedia", url: "https://en.wikipedia.org" },
  { name: "Spotify", url: "https://open.spotify.com" },
  { name: "Discord", url: "https://discord.com/app" },
];
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
let settings = { ...defaults, ...read(SKEY, {}) };
let links = read(LKEY, defaultLinks);

/* ---------- toast ---------- */
let toastT;
function toast(msg, err) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", !!err);
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), err ? 6000 : 2500);
}
const status = (msg, err) => { const s = $("status"); s.textContent = msg; s.classList.toggle("error", !!err); };

/* ---------- theme & disguise ---------- */
const disguises = {
  none: { title: "", icon: "" },
  docs: { title: "Untitled document - Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" },
  drive: { title: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" },
  classroom: { title: "Classes", icon: "https://ssl.gstatic.com/classroom/favicon.png" },
  studyloop: { title: "StudyLoop — Focus Timer & Revision Hub", icon: "/gate-icon.svg" },
};
function disguise() {
  if (settings.disguise === "custom") return { title: settings.disguiseTitle, icon: settings.disguiseIcon };
  return disguises[settings.disguise] || disguises.none;
}
let liveTitle = "Wraith";
function applyDisguise() {
  const d = disguise();
  document.title = d.title || liveTitle;
  $("favicon").href = d.icon || "/favicon.svg";
}
const applyTheme = () => { document.documentElement.dataset.theme = settings.theme; };

/* ---------- proxy ---------- */
const conn = new BareMuxConnection("/baremux/worker.js");
let ready = null;

function transport() {
  if (settings.mode === "wisp") {
    const wisp = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/wisp/";
    return ["/epoxy/index.mjs", [{ wisp }]];
  }
  return ["/baremod/index.mjs", [location.origin + "/bare/"]];
}

function waitActive(reg) {
  if (reg.active) return Promise.resolve();
  const w = reg.installing || reg.waiting;
  return new Promise((res, rej) => {
    if (!w) return res();
    w.addEventListener("statechange", () => {
      if (w.state === "activated") res();
      if (w.state === "redundant") rej(new Error("The proxy failed to install. Reload the page."));
    });
  });
}

function setup() {
  if (!ready) {
    ready = (async () => {
      if (!("serviceWorker" in navigator)) {
        throw new Error(
          location.protocol === "http:" && location.hostname !== "localhost"
            ? "This needs https:// to work. Open the https link instead."
            : "This browser blocked the proxy. Avoid Firefox private windows."
        );
      }
      const reg = await navigator.serviceWorker.register("/uv/sw.js", { scope: uv.prefix });
      await waitActive(reg);
      await conn.setTransport(...transport());
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}
async function refreshTransport() {
  try { await conn.setTransport(...transport()); } catch {}
}

function toUrl(text) {
  text = text.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) { try { return new URL(text).href; } catch {} }
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) {
    try { return new URL("https://" + text).href; } catch {}
  }
  return (settings.engine || defaults.engine).replace("%s", encodeURIComponent(text));
}
const encode = (url) => uv.prefix + uv.encodeUrl(url);
function decode(frame) {
  try {
    const href = frame.contentWindow.location.href;
    const base = location.origin + uv.prefix;
    return href.startsWith(base) ? uv.decodeUrl(href.slice(base.length)) : "";
  } catch { return ""; }
}

/* ---------- tabs ---------- */
const tabs = [];
let activeId = null;
let seq = 1;
const active = () => tabs.find((t) => t.id === activeId);

function view(name) {
  document.body.dataset.view = name;
  $("home").hidden = name !== "home";
  $("browser").hidden = name !== "browser";
}

async function open(text, newTab) {
  const url = toUrl(text);
  if (!url) return;
  status("Connecting…");
  try { await setup(); }
  catch (e) { status(e.message, true); toast(e.message, true); return; }
  status("");
  const t = !newTab && active();
  if (t) navigate(t, url); else createTab(url);
  view("browser");
}

function createTab(url) {
  const id = seq++;
  const frame = document.createElement("iframe");
  frame.allow = "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; picture-in-picture";
  $("frames").appendChild(frame);

  const btn = document.createElement("button");
  btn.className = "tab loading";
  btn.setAttribute("role", "tab");
  btn.innerHTML = `<span class="fb"></span><span class="tt">Loading…</span><span class="x" role="button" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></span>`;
  btn.addEventListener("click", (e) => { if (e.target.closest(".x")) closeTab(id); else select(id); });
  btn.addEventListener("auxclick", (e) => { if (e.button === 1) closeTab(id); });
  $("tabs").insertBefore(btn, $("newtab"));

  const tab = { id, frame, btn, url, title: "", icon: "" };
  tabs.push(tab);
  frame.addEventListener("load", () => onLoad(tab));
  navigate(tab, url);
  select(id);
}

function navigate(tab, url) {
  tab.url = url;
  tab.btn.classList.add("loading");
  tab.frame.src = encode(url);
  if (tab.id === activeId) $("addr").value = url;
}
function select(id) {
  activeId = id;
  for (const t of tabs) {
    const on = t.id === id;
    t.frame.hidden = !on;
    t.btn.setAttribute("aria-selected", String(on));
  }
  const t = active();
  if (t) { $("addr").value = t.url; liveTitle = t.title || "Wraith"; applyDisguise(); t.btn.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}
function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  t.frame.remove();
  t.btn.remove();
  if (!tabs.length) { activeId = null; liveTitle = "Wraith"; applyDisguise(); view("home"); $("q").value = ""; $("q").focus(); return; }
  if (activeId === id) select(tabs[Math.min(i, tabs.length - 1)].id);
}

function onLoad(tab) {
  tab.btn.classList.remove("loading");
  update(tab);
  try {
    const win = tab.frame.contentWindow;
    win.addEventListener("keydown", keys, true);
    win.open = (u) => { if (u) { try { createTab(new URL(u, decode(tab.frame) || tab.url).href); } catch {} } return null; };
  } catch {}
}
function update(tab) {
  const real = decode(tab.frame);
  if (real) tab.url = real;
  let title = "", icon = "";
  try {
    const doc = tab.frame.contentDocument;
    title = doc.title;
    const l = doc.querySelector('link[rel~="icon"]');
    icon = l ? l.href : "";
  } catch {}
  let host = "";
  try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch {}
  tab.title = title || host || "New tab";

  if (icon !== tab.icon) {
    tab.icon = icon;
    const prev = tab.btn.querySelector(".fav, .fb");
    let el;
    if (icon) {
      el = document.createElement("img");
      el.className = "fav"; el.alt = ""; el.src = icon;
      el.onerror = () => el.replaceWith(fb(host));
    } else el = fb(host);
    prev.replaceWith(el);
  } else if (!icon) {
    const f = tab.btn.querySelector(".fb");
    if (f) f.textContent = (host[0] || "").toUpperCase();
  }
  tab.btn.querySelector(".tt").textContent = tab.title;
  tab.btn.title = tab.title;
  if (tab.id === activeId) {
    if (document.activeElement !== $("addr")) $("addr").value = tab.url;
    liveTitle = tab.title; applyDisguise();
  }
}
function fb(host) { const s = document.createElement("span"); s.className = "fb"; s.textContent = (host[0] || "").toUpperCase(); return s; }
setInterval(() => { for (const t of tabs) update(t); }, 1200);

/* new-tab button */
const newTabBtn = document.createElement("button");
newTabBtn.id = "newtab";
newTabBtn.className = "icon newtab";
newTabBtn.setAttribute("aria-label", "New tab");
newTabBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
newTabBtn.onclick = () => { view("home"); $("q").value = ""; $("q").dataset.new = "1"; $("q").focus(); };
$("tabs").appendChild(newTabBtn);

/* ---------- nav buttons ---------- */
const win = () => active()?.frame.contentWindow;
$("b-back").onclick = () => { try { win().history.back(); } catch {} };
$("b-fwd").onclick = () => { try { win().history.forward(); } catch {} };
$("b-reload").onclick = () => { const t = active(); if (!t) return; t.btn.classList.add("loading"); try { t.frame.contentWindow.location.reload(); } catch { navigate(t, t.url); } };
$("b-home").onclick = () => { view("home"); $("q").value = ""; $("q").focus(); };
$("b-full").onclick = () => { active()?.frame.requestFullscreen?.().catch(() => toast("Full screen isn’t available here.", true)); };

$("search").addEventListener("submit", (e) => { e.preventDefault(); const q = $("q"); const n = q.dataset.new === "1" || !tabs.length; delete q.dataset.new; open(q.value, n); });
$("address").addEventListener("submit", (e) => { e.preventDefault(); open($("addr").value); $("addr").blur(); });
$("addr").addEventListener("focus", (e) => e.target.select());

/* ---------- keys ---------- */
function keys(e) {
  if (e.target?.closest?.("input, textarea, select")) {
    // only react to panic key outside text fields
  } else if (e.key === "`") { e.preventDefault(); window.top.location.replace(settings.panicUrl || defaults.panicUrl); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key.toLowerCase() === "t") { e.preventDefault(); newTabBtn.click(); }
    if (e.key.toLowerCase() === "w" && active()) { e.preventDefault(); closeTab(activeId); }
  }
}
document.addEventListener("keydown", keys, true);

/* ---------- shortcuts ---------- */
function renderLinks() {
  const ul = $("link-list");
  ul.innerHTML = "";
  links.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "link-item";
    const open_ = document.createElement("button");
    open_.className = "open";
    const ic = document.createElement("span");
    ic.className = "ic";
    ic.textContent = s.name[0]?.toUpperCase() || "?";
    open_.append(ic, document.createTextNode(s.name));
    open_.onclick = () => open(s.url, true);
    const del = document.createElement("button");
    del.className = "del"; del.setAttribute("aria-label", `Remove ${s.name}`);
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.onclick = () => { links.splice(i, 1); write(LKEY, links); renderLinks(); };
    li.append(open_, del);
    ul.appendChild(li);
  });
  const add = document.createElement("li");
  const b = document.createElement("button");
  b.className = "add-link"; b.textContent = "+ Add";
  b.onclick = () => { $("link-dialog").returnValue = ""; $("l-name").value = ""; $("l-url").value = ""; $("link-dialog").showModal(); };
  add.appendChild(b);
  ul.appendChild(add);
}
$("link-dialog").addEventListener("close", () => {
  if ($("link-dialog").returnValue !== "save") return;
  const name = $("l-name").value.trim();
  const url = toUrl($("l-url").value);
  if (!name || !url) return;
  links.push({ name, url }); write(LKEY, links); renderLinks();
});

/* ---------- settings drawer ---------- */
const openSettings = () => { $("settings").hidden = false; $("scrim").hidden = false; $("close-settings").focus(); };
const closeSettings = () => { $("settings").hidden = true; $("scrim").hidden = true; };
document.querySelectorAll("[data-settings]").forEach((b) => (b.onclick = openSettings));
$("close-settings").onclick = closeSettings;
$("scrim").onclick = closeSettings;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("settings").hidden) closeSettings(); });

function fill() {
  $("s-engine").value = settings.engine;
  $("s-mode").value = settings.mode;
  $("s-disguise").value = settings.disguise;
  $("disguise-custom").hidden = settings.disguise !== "custom";
  $("s-disguise-title").value = settings.disguiseTitle;
  $("s-disguise-icon").value = settings.disguiseIcon;
  $("s-panic-url").value = settings.panicUrl;
  $("s-theme").value = settings.theme;
}
function bind(id, key, after) {
  const el = $(id);
  el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => { settings[key] = el.value; write(SKEY, settings); after?.(); });
}
bind("s-engine", "engine");
bind("s-mode", "mode", () => { refreshTransport(); toast("Reload your tabs to use the new mode."); });
bind("s-disguise", "disguise", () => { $("disguise-custom").hidden = settings.disguise !== "custom"; applyDisguise(); });
bind("s-disguise-title", "disguiseTitle", applyDisguise);
bind("s-disguise-icon", "disguiseIcon", applyDisguise);
bind("s-panic-url", "panicUrl");
bind("s-theme", "theme", applyTheme);

$("s-blank").onclick = () => {
  const w = window.open("about:blank", "_blank");
  if (!w) { toast("Allow pop-ups, then try again.", true); return; }
  const d = disguise();
  w.document.title = d.title || "Wraith";
  const link = w.document.createElement("link");
  link.rel = "icon"; link.href = d.icon || location.origin + "/favicon.svg";
  w.document.head.appendChild(link);
  w.document.body.style.margin = "0";
  const f = w.document.createElement("iframe");
  f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0";
  f.allow = "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media";
  f.src = location.origin + "/";
  w.document.body.appendChild(f);
  location.replace(settings.panicUrl || defaults.panicUrl);
};

$("s-lock").onclick = async () => {
  try { await fetch("/api/leave", { method: "POST" }); } catch {}
  location.replace(settings.panicUrl || defaults.panicUrl);
};

/* ---------- go ---------- */
applyTheme();
applyDisguise();
fill();
renderLinks();
view("home");
setup().catch((e) => status(e.message, true));
