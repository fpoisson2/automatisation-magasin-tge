require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare Tunnel proxy
app.set("trust proxy", 1);

app.use(express.json());
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
app.post("/api/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query requis" });
    const results = await hybridSearch(query, 10);
    res.json(results);
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
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM orders WHERE date(created_at) = ?"
  ).get(today);
  return String((row?.cnt || 0) + 1).padStart(3, "0");
}

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
app.post("/api/orders", (req, res) => {
  const { student_da, student_name, items } = req.body;
  if (!student_da || !student_name || !items?.length) {
    return res.status(400).json({ error: "DA, nom et articles requis" });
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

app.get("/api/orders/:number", (req, res) => {
  const order = db.prepare(
    "SELECT * FROM orders WHERE order_number = ?"
  ).get(req.params.number);
  if (!order) return res.status(404).json({ error: "Commande introuvable" });

  const items = db.prepare(
    "SELECT * FROM order_items WHERE order_id = ?"
  ).all(order.id);

  res.json({ ...order, items });
});

app.delete("/api/orders/:number", (req, res) => {
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
