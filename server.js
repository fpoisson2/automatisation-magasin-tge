require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const compression = require("compression");
const morgan = require("morgan");
const helmet = require("helmet");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare Tunnel proxy
app.set("trust proxy", 1);

// ── Structured logging ──
morgan.token("ts", () => new Date().toISOString());
morgan.token("user", (req) => req.session?.userName || req.session?.userId || "-");
app.use(morgan(":ts :method :url :status :res[content-length] :response-time ms :user :remote-addr", {
  skip: (req) => req.url === "/api/health" || req.url.startsWith("/assets/") || req.url.endsWith(".js") || req.url.endsWith(".css"),
}));

// ── Security & compression ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate limiters ──
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: "Trop de commandes." }, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: "Trop de requêtes." }, standardHeaders: true, legacyHeaders: false });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: "Trop de recherches." }, standardHeaders: true, legacyHeaders: false });

// ── Sessions (SQLite-backed) ──
const SqliteStore = require("better-sqlite3-session-store")(session);
const sessionDb = new Database(path.join(__dirname, "sessions.db"));

app.use(session({
  store: new SqliteStore({ client: sessionDb, expired: { clear: true, intervalMs: 3600000 } }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 },
}));

// ── Auth middleware ──
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: "Non autorisé" });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.authenticated && req.session.userRole === "admin") return next();
  return res.status(403).json({ error: "Accès réservé aux administrateurs" });
}

// ── Auth routes ──
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM admin_users WHERE username = ?").get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.name || user.username;
    return res.json({ success: true, role: user.role, name: user.name });
  }
  return res.status(401).json({ error: "Identifiants invalides" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ── Static files ──
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { maxAge: "1h", index: false }));
}
app.use(express.static("public", { index: false, maxAge: "1h" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), { maxAge: "7d" }));

// ── RAG: Load inventory + embeddings ──
const EMBEDDING_URL = process.env.EMBEDDING_URL || "http://127.0.0.1:5111";
let inventoryData = [];
let embeddingsData = [];

function loadRAGData() {
  inventoryData = JSON.parse(fs.readFileSync(path.join(__dirname, "excel-to-json.json"), "utf-8"));
  const embFile = path.join(__dirname, "embeddings.json");
  if (fs.existsSync(embFile)) {
    const raw = JSON.parse(fs.readFileSync(embFile, "utf-8"));
    embeddingsData = raw.embeddings;
    console.log(`RAG: ${inventoryData.length} items, ${embeddingsData.length} embeddings loaded`);
  } else {
    console.warn("RAG: embeddings.json not found.");
  }
}

loadRAGData();

// ── Search utilities ──
function isValidItem(item) {
  const no = item["No d'article"] || "";
  const desc = (item["Description"] || "").trim();
  if (no.includes("/")) return false;
  if (/^VOIRNOTE$/i.test(no)) return false;
  if (desc.length < 3) return false;
  if (/^[0-9]+$/.test(desc)) return false;
  return true;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const SYNONYMS = {
  "condo": "condensateur", "condos": "condensateur", "cap": "condensateur",
  "resist": "résistance", "res": "résistance", "pot": "potentiomètre", "potard": "potentiomètre",
  "transfo": "transformateur", "alim": "alimentation", "proto": "protoboard", "breadboard": "protoboard",
  "fer": "fer à souder", "scope": "oscilloscope", "oscillo": "oscilloscope",
  "multi": "multimètre", "multimetre": "multimètre", "dmm": "multimètre",
  "led": "led", "del": "led", "usb": "usb", "hdmi": "hdmi", "bnc": "bnc",
  "rj45": "rj45", "ethernet": "rj45", "rpi": "raspberry pi", "rasp": "raspberry pi",
  "uno": "arduino uno", "mega": "arduino mega", "nano": "arduino nano",
  "opamp": "amplificateur opérationnel", "op-amp": "amplificateur opérationnel",
  "ampli": "amplificateur", "ic": "circuit intégré", "ci": "circuit intégré",
  "pcb": "circuit imprimé", "mosfet": "mosfet", "bjt": "transistor",
  "npn": "transistor npn", "pnp": "transistor pnp", "relay": "relais", "relai": "relais",
  "switch": "interrupteur", "bouton": "bouton poussoir", "wire": "fil", "cable": "câble",
  "solder": "soudure", "soudure": "soudure", "clip": "pince", "probe": "sonde",
  "batt": "batterie", "pile": "batterie", "moteur": "moteur", "motor": "moteur",
  "servo": "servomoteur", "stepper": "moteur pas à pas",
};

function expandSynonyms(query) {
  const terms = query.toLowerCase().split(/\s+/);
  const expanded = [...terms];
  for (const term of terms) { if (SYNONYMS[term]) expanded.push(...SYNONYMS[term].split(/\s+/)); }
  return [...new Set(expanded)].join(" ");
}

function keywordSearch(query, topK = 10) {
  const q = expandSynonyms(query).toLowerCase().trim();
  const terms = q.split(/\s+/);
  return inventoryData.map((item, index) => {
    let score = 0;
    const no = (item["No d'article"] || "").toLowerCase();
    const desc = (item["Description"] || "").toLowerCase();
    const keywords = (item["Mots clés"] || "").toLowerCase();
    const fournisseur = (item["Fournisseur"] || "").toLowerCase();
    const searchable = `${no} ${desc} ${keywords} ${fournisseur}`;
    if (no === q) score += 100;
    for (const term of terms) {
      if (no.includes(term)) score += 20;
      if (desc.includes(term)) score += 10;
      if (keywords.includes(term)) score += 8;
      if (fournisseur.includes(term)) score += 5;
      if (searchable.includes(term)) score += 1;
    }
    return { index, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

async function hybridSearch(query, topK = 10) {
  const embeddingPromise = fetch(`${EMBEDDING_URL}/embed-query`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: query }),
  });
  const kwResults = keywordSearch(query, topK);
  const res = await embeddingPromise;
  if (!res.ok) throw new Error("Embedding server unavailable");
  const data = await res.json();
  const queryEmb = data.embeddings[0];
  const semanticScored = embeddingsData
    .map((emb, i) => ({ index: i, score: cosineSimilarity(queryEmb, emb) }))
    .sort((a, b) => b.score - a.score).slice(0, topK * 2);
  const scoreMap = new Map();
  const maxSemantic = semanticScored[0]?.score || 1;
  for (const r of semanticScored) scoreMap.set(r.index, (scoreMap.get(r.index) || 0) + (r.score / maxSemantic) * 0.5);
  const maxKw = kwResults[0]?.score || 1;
  for (const r of kwResults) scoreMap.set(r.index, (scoreMap.get(r.index) || 0) + (r.score / maxKw) * 0.5);
  const MIN_SCORE = 0.15;
  return [...scoreMap.entries()]
    .map(([index, score]) => ({ index, score }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => ({ ...inventoryData[s.index], _score: s.score }));
}

function deduplicateResults(items, limit = 25) {
  const seen = new Map();
  for (const item of items) {
    if (!isValidItem(item)) continue;
    const desc = (item["Description"] || "").trim();
    if (seen.has(desc)) {
      const existing = seen.get(desc);
      existing["Disponible"] = String((parseInt(existing["Disponible"]) || 0) + (parseInt(item["Disponible"]) || 0));
      existing["Quantité"] = String((parseInt(existing["Quantité"]) || 0) + (parseInt(item["Quantité"]) || 0));
    } else {
      seen.set(desc, { ...item });
    }
  }
  const results = [...seen.values()].filter((i) => (parseInt(i["Disponible"]) || 0) > 0).slice(0, limit);
  if (results.length) {
    const articleNos = results.map((r) => r["No d'article"]);
    const placeholders = articleNos.map(() => "?").join(",");
    const extras = db.prepare(`SELECT * FROM item_extras WHERE article_no IN (${placeholders})`).all(...articleNos);
    const extrasMap = {};
    for (const e of extras) extrasMap[e.article_no] = e;
    for (const r of results) {
      const ex = extrasMap[r["No d'article"]];
      if (ex) { r._photo = ex.photo_path; r._doc = ex.doc_url; }
    }
  }
  return results;
}

function getOrderWithItems(orderNumber) {
  const order = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(orderNumber);
  if (!order) return null;
  order.items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
  return order;
}

// ── SQLite ──
const db = new Database(path.join(__dirname, "magasin.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS item_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, article_no TEXT NOT NULL, photo_path TEXT NOT NULL, source TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS item_extras (article_no TEXT PRIMARY KEY, photo_path TEXT, doc_url TEXT);
  CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'magasinier', name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS students (da TEXT PRIMARY KEY, name TEXT NOT NULL, last_seen DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, student_da TEXT NOT NULL, student_name TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, article_no TEXT NOT NULL, description TEXT NOT NULL, quantity INTEGER DEFAULT 1, prix TEXT, localisation TEXT);
`);

// Seed admin from env
{
  const count = db.prepare("SELECT COUNT(*) as cnt FROM admin_users").get().cnt;
  if (count === 0 && process.env.APP_USERNAME && process.env.APP_PASSWORD) {
    const hash = bcrypt.hashSync(process.env.APP_PASSWORD, 10);
    db.prepare("INSERT INTO admin_users (username, password, role, name) VALUES (?, ?, 'admin', 'Administrateur')").run(process.env.APP_USERNAME, hash);
    console.log(`Admin user '${process.env.APP_USERNAME}' created from env`);
  }
}

// ── SSE ──
const sseClients = new Set();
function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.res.write(msg);
}

function generateOrderNumber() {
  const row = db.prepare("SELECT MAX(CAST(order_number AS INTEGER)) as max_num FROM orders").get();
  return String((row?.max_num || 0) + 1).padStart(3, "0");
}

const PRINT_TOKEN = process.env.PRINT_TOKEN || "";
function requirePrintToken(req, res, next) {
  if (!PRINT_TOKEN) return res.status(503).json({ error: "Impression non configurée" });
  if (req.headers.authorization === `Bearer ${PRINT_TOKEN}`) return next();
  return res.status(401).json({ error: "Token invalide" });
}

// ── Mount route modules ──
const deps = { db, inventoryData, embeddingsData, EMBEDDING_URL, sseClients, broadcastSSE, generateOrderNumber, getOrderWithItems, hybridSearch, deduplicateResults, requireAuth, requireAdmin, requirePrintToken, orderLimiter, apiLimiter, searchLimiter };
app.use(require("./routes/search")(deps));
app.use(require("./routes/orders")(deps));
app.use(require("./routes/admin")(deps));

// ── Health check ──
app.get("/api/health", async (req, res) => {
  const checks = { server: "ok", database: "error", embeddings: "error", uptime: process.uptime() };
  try { db.prepare("SELECT 1").get(); checks.database = "ok"; checks.orders = db.prepare("SELECT COUNT(*) as cnt FROM orders").get().cnt; checks.students = db.prepare("SELECT COUNT(*) as cnt FROM students").get().cnt; } catch (e) { checks.databaseError = e.message; }
  try { const r = await fetch(`${EMBEDDING_URL}/health`, { signal: AbortSignal.timeout(3000) }); if (r.ok) { const d = await r.json(); checks.embeddings = "ok"; checks.embeddingModel = d.model; } } catch (e) { checks.embeddingsError = e.message; }
  checks.inventoryItems = inventoryData.length;
  checks.embeddingsLoaded = embeddingsData.length;
  checks.sseClients = sseClients.size;
  res.status(checks.database === "ok" && checks.embeddings === "ok" ? 200 : 503).json(checks);
});

// ── API 404 ──
app.all("/api/*", (req, res) => { res.status(404).json({ error: "Endpoint introuvable" }); });

// ── SPA catch-all ──
const spaIndex = path.join(__dirname, "dist", "index.html");
if (fs.existsSync(spaIndex)) {
  app.get("*", (req, res) => { res.sendFile(spaIndex); });
}

// ── Auto-deliver ready orders after 30 min ──
setInterval(() => {
  const expired = db.prepare("SELECT * FROM orders WHERE status = 'ready' AND (julianday('now') - julianday(updated_at)) * 1440 > 30").all();
  for (const order of expired) {
    db.prepare("UPDATE orders SET status = 'picked_up', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    broadcastSSE("order-update", { order_number: order.order_number, status: "picked_up", student_da: order.student_da });
    console.log(`Auto-delivered: #${order.order_number} (30min timeout)`);
  }
}, 60000);

app.listen(PORT, () => { console.log(`Serveur démarré: http://localhost:${PORT}`); });
