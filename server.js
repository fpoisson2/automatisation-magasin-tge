require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const rateLimit = require("express-rate-limit");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare Tunnel proxy
app.set("trust proxy", 1);

app.use(express.json());

// ── Rate limiters ──
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: "Trop de commandes. Réessayez plus tard." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 60,
  message: { error: "Trop de requêtes. Réessayez dans une minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Trop de recherches." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

// ── Auth middleware ──
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  // API routes return 401, page routes redirect
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  return res.redirect("/login");
}

// ── Login page ──
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.APP_USERNAME &&
    password === process.env.APP_PASSWORD
  ) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: "Identifiants invalides" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ── Static files ──
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Serve login.html assets without auth
app.use(express.static("public", { index: false }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Multer for photo uploads ──
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "uploads"),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = req.params.articleNo.replace(/[^a-zA-Z0-9_-]/g, "_");
      cb(null, `${name}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Format image invalide"));
  },
});

// ── Protected API routes ──
app.get("/api/inventory", requireAuth, (req, res) => {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "excel-to-json.json"), "utf-8")
  );
  res.json(data);
});

// ── RAG: Load inventory + embeddings ──
const EMBEDDING_URL = process.env.EMBEDDING_URL || "http://127.0.0.1:5111";

let inventoryData = [];
let embeddingsData = [];

function loadRAGData() {
  inventoryData = JSON.parse(
    fs.readFileSync(path.join(__dirname, "excel-to-json.json"), "utf-8")
  );

  const embFile = path.join(__dirname, "embeddings.json");
  if (fs.existsSync(embFile)) {
    const raw = JSON.parse(fs.readFileSync(embFile, "utf-8"));
    embeddingsData = raw.embeddings;
    console.log(`RAG: ${inventoryData.length} items, ${embeddingsData.length} embeddings loaded`);
  } else {
    console.warn("RAG: embeddings.json not found. Run 'node generate-embeddings.js' first.");
  }
}

loadRAGData();

// Filter out garbage inventory entries from search results
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
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Keyword search (exact matching)
function keywordSearch(query, topK = 10) {
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/);

  return inventoryData
    .map((item, index) => {
      let score = 0;
      const no = (item["No d'article"] || "").toLowerCase();
      const desc = (item["Description"] || "").toLowerCase();
      const keywords = (item["Mots clés"] || "").toLowerCase();
      const loc = (item["Localisation"] || "").toLowerCase();
      const fournisseur = (item["Fournisseur"] || "").toLowerCase();
      const searchable = `${no} ${desc} ${keywords} ${loc} ${fournisseur}`;

      if (no === q) score += 100;
      for (const term of terms) {
        if (no.includes(term)) score += 20;
        if (desc.includes(term)) score += 10;
        if (keywords.includes(term)) score += 8;
        if (fournisseur.includes(term)) score += 5;
        if (searchable.includes(term)) score += 1;
      }
      return { index, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// Hybrid search: combines semantic + keyword results
async function hybridSearch(query, topK = 10) {
  // Run both searches in parallel
  const embeddingPromise = fetch(`${EMBEDDING_URL}/embed-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: query }),
  });

  const kwResults = keywordSearch(query, topK);

  const res = await embeddingPromise;
  if (!res.ok) throw new Error("Embedding server unavailable");

  const data = await res.json();
  const queryEmb = data.embeddings[0];

  // Semantic scores
  const semanticScored = embeddingsData
    .map((emb, i) => ({ index: i, score: cosineSimilarity(queryEmb, emb) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2);

  // Merge: use a map of index -> combined score
  const scoreMap = new Map();

  // Normalize and weight semantic scores (weight: 0.5)
  const maxSemantic = semanticScored[0]?.score || 1;
  for (const r of semanticScored) {
    const norm = r.score / maxSemantic;
    scoreMap.set(r.index, (scoreMap.get(r.index) || 0) + norm * 0.5);
  }

  // Normalize and weight keyword scores (weight: 0.5)
  const maxKw = kwResults[0]?.score || 1;
  for (const r of kwResults) {
    const norm = r.score / maxKw;
    scoreMap.set(r.index, (scoreMap.get(r.index) || 0) + norm * 0.5);
  }

  // Sort by combined score, apply minimum threshold
  const MIN_SCORE = 0.15;
  const results = [...scoreMap.entries()]
    .map(([index, score]) => ({ index, score }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return results.map((s) => ({ ...inventoryData[s.index], _score: s.score }));
}

const SYSTEM_PROMPT = `Tu es l'assistant du Magasin TGE, un magasin de pièces électroniques dans un cégep (collège).
Tu es très amical, chaleureux et enthousiaste. Tu tutoies les gens. Tu utilises un ton décontracté et positif.

Ton rôle PRINCIPAL est d'aider les gens à trouver des articles dans l'inventaire du magasin.

Quand l'utilisateur cherche un article, les résultats de recherche pertinents de l'inventaire sont automatiquement fournis dans le contexte ci-dessous. Utilise-les pour répondre.

Après avoir vu les résultats:
1. Résume les résultats de façon concise et amicale (mentionne le numéro d'article et la description)
2. Si la quantité disponible est 0, mentionne-le
3. Si rien de pertinent n'est trouvé, dis-le et suggère d'essayer avec d'autres mots-clés

Tu parles en français québécois naturel. Sois bref dans tes réponses.`;

// ── Search API (public — students don't need auth) ──
app.post("/api/search", searchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query requis" });
    // Search wider, then deduplicate by description
    const raw = await hybridSearch(query, 50);
    const seen = new Map();
    for (const item of raw) {
      if (!isValidItem(item)) continue;
      const desc = (item["Description"] || "").trim();
      if (seen.has(desc)) {
        // Merge: sum disponible
        const existing = seen.get(desc);
        existing["Disponible"] = String(
          (parseInt(existing["Disponible"]) || 0) + (parseInt(item["Disponible"]) || 0)
        );
        existing["Quantité"] = String(
          (parseInt(existing["Quantité"]) || 0) + (parseInt(item["Quantité"]) || 0)
        );
      } else {
        seen.set(desc, { ...item });
      }
    }
    const final = [...seen.values()].filter((i) => (parseInt(i["Disponible"]) || 0) > 0);
    res.json(final.slice(0, 10));
  } catch (err) {
    console.error("Search failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !messages.length) {
      return res.status(400).json({ error: "Messages requis" });
    }

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      return res.status(400).json({ error: "Aucun message utilisateur" });
    }

    const start = Date.now();

    // RAG search directly — no LLM needed
    const searchResults = await hybridSearch(lastUserMsg.content, 10);
    const searchMs = Date.now() - start;
    console.log(`Search "${lastUserMsg.content}" → ${searchResults.length} results in ${searchMs}ms`);

    // Build a simple text reply from results
    let reply;
    if (searchResults.length === 0) {
      reply = "Aucun article trouvé pour cette recherche. Essaie avec d'autres mots-clés!";
    } else {
      const lines = searchResults.slice(0, 5).map((item) => {
        const dispo = parseInt(item["Disponible"]) || 0;
        const status = dispo > 0 ? `${dispo} dispo` : "rupture de stock";
        return `**#${item["No d'article"]}** — ${item["Description"].trim()} (${status}, ${item["Prix"]}$)`;
      });
      reply = `J'ai trouvé ${searchResults.length} résultat${searchResults.length > 1 ? "s" : ""}:\n\n${lines.join("\n")}`;
      if (searchResults.length > 5) {
        reply += `\n\n...et ${searchResults.length - 5} autre${searchResults.length - 5 > 1 ? "s" : ""} dans les cartes ci-dessous.`;
      }
    }

    res.json({ reply, results: searchResults });
  } catch (err) {
    console.error("Chat failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── SQLite: Orders queue ──
const db = new Database(path.join(__dirname, "magasin.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS item_extras (
    article_no TEXT PRIMARY KEY,
    photo_path TEXT,
    doc_url TEXT
  );
  CREATE TABLE IF NOT EXISTS students (
    da TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    student_da TEXT NOT NULL,
    student_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    article_no TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    prix TEXT,
    localisation TEXT
  );
`);

// ── SSE: connected clients ──
const sseClients = new Set(); // { res, da? } — da is set for students, null for admin

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.res.write(msg);
  }
}

function generateOrderNumber() {
  const row = db.prepare(
    "SELECT MAX(CAST(order_number AS INTEGER)) as max_num FROM orders"
  ).get();
  return String((row?.max_num || 0) + 1).padStart(3, "0");
}

// ── Student identification ──
app.get("/api/students/:da", apiLimiter, (req, res) => {
  if (!/^\d{5,9}$/.test(req.params.da)) return res.status(400).json({ error: "DA invalide" });
  const student = db.prepare("SELECT * FROM students WHERE da = ?").get(req.params.da);
  if (!student) return res.status(404).json({ error: "Inconnu" });
  db.prepare("UPDATE students SET last_seen = CURRENT_TIMESTAMP WHERE da = ?").run(req.params.da);
  res.json(student);
});

app.post("/api/students", apiLimiter, (req, res) => {
  const { da, name } = req.body;
  if (!da || !name) return res.status(400).json({ error: "DA et nom requis" });
  if (!/^\d{5,9}$/.test(da.trim())) return res.status(400).json({ error: "DA invalide (5-9 chiffres)" });
  if (name.trim().length < 2 || name.trim().length > 100) return res.status(400).json({ error: "Nom invalide" });
  db.prepare(
    "INSERT INTO students (da, name) VALUES (?, ?) ON CONFLICT(da) DO UPDATE SET name = ?, last_seen = CURRENT_TIMESTAMP"
  ).run(da.trim(), name.trim(), name.trim());
  res.json({ success: true });
});

// ── Frequent items for a student (enriched with inventory data) ──
app.get("/api/students/:da/frequent", apiLimiter, (req, res) => {
  if (!/^\d{5,9}$/.test(req.params.da)) return res.status(400).json({ error: "DA invalide" });
  const rows = db.prepare(`
    SELECT oi.article_no, SUM(oi.quantity) as total_qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.student_da = ? AND o.status != 'cancelled'
    GROUP BY oi.article_no
    ORDER BY total_qty DESC
    LIMIT 20
  `).all(req.params.da);

  // Enrich with inventory data
  const enriched = rows.map((r) => {
    const inv = inventoryData.find((i) => i["No d'article"] === r.article_no);
    if (!inv) return { ...r, found: false };
    return { ...r, found: true, item: inv };
  }).filter((r) => r.found);

  res.json(enriched);
});

// ── SSE endpoints (must be before :number param routes) ──
app.get("/api/orders/stream", (req, res) => {
  const da = req.query.da;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("event: connected\ndata: {}\n\n");

  const client = { res, da: da || null };
  sseClients.add(client);

  req.on("close", () => { sseClients.delete(client); });
});

app.get("/api/admin/orders/stream", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("event: connected\ndata: {}\n\n");

  const client = { res, da: null };
  sseClients.add(client);

  req.on("close", () => { sseClients.delete(client); });
});

// ── Order routes (no auth — students) ──
app.post("/api/orders", orderLimiter, (req, res) => {
  const { student_da, student_name, items } = req.body;
  if (!student_da || !student_name || !items?.length) {
    return res.status(400).json({ error: "DA, nom et articles requis" });
  }
  if (!/^\d{5,9}$/.test(student_da.trim())) {
    return res.status(400).json({ error: "DA invalide (5-9 chiffres)" });
  }
  if (student_name.trim().length < 2 || student_name.trim().length > 100) {
    return res.status(400).json({ error: "Nom invalide" });
  }
  if (items.length > 20) {
    return res.status(400).json({ error: "Maximum 20 articles par commande" });
  }

  const orderNumber = generateOrderNumber();
  const insert = db.prepare(
    "INSERT INTO orders (order_number, student_da, student_name) VALUES (?, ?, ?)"
  );
  const insertItem = db.prepare(
    "INSERT INTO order_items (order_id, article_no, description, quantity, prix, localisation) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const tx = db.transaction(() => {
    const result = insert.run(orderNumber, student_da.trim(), student_name.trim());
    const orderId = result.lastInsertRowid;
    for (const item of items) {
      insertItem.run(orderId, item.article_no, item.description, item.quantity || 1, item.prix || "0", item.localisation || "");
    }
    return orderId;
  });

  try {
    tx();
    broadcastSSE("order-new", {
      order_number: orderNumber,
      student_da: student_da.trim(),
      student_name: student_name.trim(),
      items: items.map((i) => ({ article_no: i.article_no, description: i.description, quantity: i.quantity || 1, prix: i.prix || "0" })),
    });
    res.json({ order_number: orderNumber });
  } catch (err) {
    console.error("Order creation failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Get active orders for a student by DA
app.get("/api/orders/by-da/:da", apiLimiter, (req, res) => {
  const orders = db.prepare(
    "SELECT * FROM orders WHERE student_da = ? ORDER BY created_at DESC LIMIT 50"
  ).all(req.params.da);

  for (const order of orders) {
    order.items = db.prepare(
      "SELECT * FROM order_items WHERE order_id = ?"
    ).all(order.id);
  }

  res.json(orders);
});

app.get("/api/orders/:number", apiLimiter, (req, res) => {
  const order = db.prepare(
    "SELECT * FROM orders WHERE order_number = ?"
  ).get(req.params.number);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });

  const items = db.prepare(
    "SELECT * FROM order_items WHERE order_id = ?"
  ).all(order.id);

  res.json({ ...order, items });
});

app.delete("/api/orders/:number", apiLimiter, (req, res) => {
  const order = db.prepare(
    "SELECT * FROM orders WHERE order_number = ?"
  ).get(req.params.number);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if (order.status !== "pending") {
    return res.status(400).json({ error: "Impossible d'annuler, la commande est déjà en traitement" });
  }
  db.prepare("UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  broadcastSSE("order-update", { order_number: order.order_number, status: "cancelled", student_da: order.student_da });
  res.json({ success: true });
});

// ── Print client acknowledgment ──
const PRINT_TOKEN = process.env.PRINT_TOKEN || "";

function requirePrintToken(req, res, next) {
  if (!PRINT_TOKEN) return res.status(503).json({ error: "Impression non configurée" });
  const auth = req.headers.authorization;
  if (auth === `Bearer ${PRINT_TOKEN}`) return next();
  return res.status(401).json({ error: "Token invalide" });
}

app.post("/api/print-ack/:number", requirePrintToken, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(req.params.number);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if (order.status !== "pending") return res.json({ success: true, already: true });

  db.prepare("UPDATE orders SET status = 'preparing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  broadcastSSE("order-update", { order_number: order.order_number, status: "preparing", student_da: order.student_da });
  console.log(`Print-ack: #${order.order_number} → preparing`);
  res.json({ success: true });
});

// ── Admin order routes (auth required) ──
app.get("/admin", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.use("/admin.js", requireAuth, express.static(path.join(__dirname, "public", "admin.js")));

app.get("/api/admin/orders", requireAuth, (req, res) => {
  const orders = db.prepare(
    "SELECT * FROM orders WHERE status NOT IN ('picked_up', 'cancelled') ORDER BY created_at ASC"
  ).all();

  for (const order of orders) {
    order.items = db.prepare(
      "SELECT * FROM order_items WHERE order_id = ?"
    ).all(order.id);
  }

  res.json(orders);
});

app.get("/api/admin/orders/all", requireAuth, (req, res) => {
  const orders = db.prepare(
    "SELECT * FROM orders ORDER BY created_at DESC LIMIT 100"
  ).all();

  for (const order of orders) {
    order.items = db.prepare(
      "SELECT * FROM order_items WHERE order_id = ?"
    ).all(order.id);
  }

  res.json(orders);
});

app.patch("/api/admin/orders/:id", requireAuth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ["pending", "preparing", "ready", "picked_up", "cancelled"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Statut invalide" });
  }

  // Get order info before update for broadcast
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });

  db.prepare(
    "UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(status, req.params.id);

  broadcastSSE("order-update", { order_number: order.order_number, status, student_da: order.student_da });
  res.json({ success: true });
});

// ── Item extras (photo + doc) ──
app.get("/api/items/:articleNo/extras", (req, res) => {
  const extras = db.prepare("SELECT * FROM item_extras WHERE article_no = ?").get(req.params.articleNo);
  res.json(extras || { article_no: req.params.articleNo, photo_path: null, doc_url: null });
});

app.post("/api/admin/items/:articleNo/photo", requireAuth, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Photo requise" });
  const photoPath = `/uploads/${req.file.filename}`;
  db.prepare(
    "INSERT INTO item_extras (article_no, photo_path) VALUES (?, ?) ON CONFLICT(article_no) DO UPDATE SET photo_path = ?"
  ).run(req.params.articleNo, photoPath, photoPath);
  res.json({ photo_path: photoPath });
});

app.post("/api/admin/items/:articleNo/doc", requireAuth, (req, res) => {
  const { doc_url } = req.body;
  if (!doc_url) return res.status(400).json({ error: "URL requise" });
  db.prepare(
    "INSERT INTO item_extras (article_no, doc_url) VALUES (?, ?) ON CONFLICT(article_no) DO UPDATE SET doc_url = ?"
  ).run(req.params.articleNo, doc_url, doc_url);
  res.json({ success: true });
});

// ── Visual search: identify component from photo ──
const visualSearchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Format image invalide"));
  },
});

app.post("/api/search/photo", searchLimiter, visualSearchUpload.single("photo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Photo requise" });

  try {
    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;

    // Ask GPT-5.4-nano to identify the component
    const visionRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-nano",
        messages: [
          {
            role: "system",
            content: "Tu es un expert en composants électroniques. L'utilisateur te montre une photo d'un composant. Identifie-le en 2-5 mots-clés de recherche pour un inventaire de magasin électronique (ex: 'résistance 10k', 'arduino uno', 'câble BNC'). Réponds UNIQUEMENT avec les mots-clés, rien d'autre.",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: "text", text: "Qu'est-ce que c'est?" },
            ],
          },
        ],
        max_completion_tokens: 50,
      }),
    });

    if (!visionRes.ok) {
      console.error("Vision API error:", await visionRes.text());
      return res.status(500).json({ error: "Erreur identification" });
    }

    const visionData = await visionRes.json();
    const keywords = visionData.choices[0].message.content.trim();
    console.log(`Visual search: "${keywords}"`);

    // Search inventory with those keywords
    const raw = await hybridSearch(keywords, 50);
    const seen = new Map();
    for (const item of raw) {
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

    const finalResults = [...seen.values()].filter((i) => (parseInt(i["Disponible"]) || 0) > 0);
    res.json({ keywords, results: finalResults.slice(0, 10) });
  } catch (err) {
    console.error("Visual search failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/session", requireAuth, async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-realtime-1.5",
          voice: "shimmer",
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI session error:", err);
      return res.status(response.status).json({ error: "Erreur OpenAI" });
    }

    const data = await response.json();
    // Only send the ephemeral client_secret, never the full API key
    res.json({ client_secret: data.client_secret });
  } catch (err) {
    console.error("Session creation failed:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré: http://localhost:${PORT}`);
});
