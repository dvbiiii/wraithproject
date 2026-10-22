import express from "express";
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createBareServer } from "@tomphttp/bare-server-node";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const require = createRequire(import.meta.url);
const { uvPath } = require("@titaniumnetwork-dev/ultraviolet");
const { epoxyPath } = require("@mercuryworkshop/epoxy-transport");
const { baremuxPath } = require("@mercuryworkshop/bare-mux/node");
const { bareModulePath } = require("@mercuryworkshop/bare-as-module3");

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const PORT = Number(process.env.PORT) || 8080;

/* ---------- 4-digit code ---------- */
// Set PIN on your host to change it. Must be exactly 4 digits.
const PIN = /^\d{4}$/.test(process.env.PIN || "") ? process.env.PIN : "1234";
const COOKIE = "el_session";
const token = createHash("sha256").update(`wraith:${PIN}`).digest("hex");

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function loggedIn(req) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return same(decodeURIComponent(v.join("=")), token);
  }
  return false;
}

// A 4-digit code is easy to guess, so lock an address out after 5 wrong tries.
const attempts = new Map(); // ip -> { fails, lockedUntil }
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) if (a.lockedUntil < now) attempts.delete(ip);
}, 30 * 60 * 1000).unref();

/* ---------- Proxy backends ---------- */
// Bare ("Fast" mode): your server fetches pages, so your computer does less work.
// Its default limit of 10 requests a minute breaks almost every site, so it's raised here.
const bare = createBareServer("/bare/", {
  connectionLimiter: { maxConnectionsPerIP: 1_000_000, windowDuration: 1, blockDuration: 1 },
});
// Wisp ("Encrypted" mode): an encrypted tunnel; your browser does the encryption.
logging.set_level(logging.WARN);
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;

/* ---------- Web app ---------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.post("/api/join", express.json({ limit: "1kb" }), (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const a = attempts.get(ip) || { fails: 0, lockedUntil: 0 };
  if (a.lockedUntil > now) {
    return res.status(429).json({ ok: false, wait: Math.ceil((a.lockedUntil - now) / 60000) });
  }
  if (!same(req.body?.code ?? "", PIN)) {
    a.fails += 1;
    let left = MAX_FAILS - a.fails;
    if (left <= 0) { a.lockedUntil = now + LOCK_MS; a.fails = 0; left = 0; }
    attempts.set(ip, a);
    return res.status(401).json({ ok: false, left });
  }
  attempts.delete(ip);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  res.json({ ok: true });
});

app.post("/api/leave", (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// Until the code is entered, the only thing that exists is the study page.
// Everything else — the app, its scripts, the proxy assets — returns 404, so there's
// nothing to hint that a proxy lives here.
const gateFiles = new Set(["/gate.css", "/gate.js", "/gate-icon.svg"]);
app.use((req, res, next) => {
  if (loggedIn(req)) return next();
  if (gateFiles.has(req.path)) return res.sendFile(join(publicDir, "gate", req.path.slice(1)));
  // Serve the study page only for a real page visit, so app scripts and assets
  // just 404 instead of quietly returning HTML.
  const isPageVisit =
    req.method === "GET" &&
    req.accepts("html") &&
    (req.headers["sec-fetch-mode"] === "navigate" || !req.headers["sec-fetch-mode"]) &&
    !req.path.includes(".");
  if (isPageVisit) return res.sendFile(join(publicDir, "gate", "index.html"));
  res.status(404).end();
});

app.use(express.static(join(publicDir, "app")));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/baremod/", express.static(bareModulePath));
app.use((req, res) => res.status(404).send("Not found"));

/* ---------- Server ---------- */
const server = createServer();

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    if (!loggedIn(req)) { res.writeHead(404); res.end(); return; }
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (!loggedIn(req)) { socket.end(); return; }
  if (bare.shouldRoute(req)) bare.routeUpgrade(req, socket, head);
  else if (req.url?.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
  else socket.end();
});

server.listen(PORT, () => {
  console.log(`Wraith is running on http://localhost:${PORT}`);
  if (PIN === "1234") console.log("Your code is 1234. Set the PIN variable to change it.");
});

function shutdown() {
  server.close();
  bare.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
