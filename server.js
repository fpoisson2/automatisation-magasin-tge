require("dotenv").config();
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

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

// ── Protected static files (except login.html) ──
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/app.js", requireAuth, express.static(path.join(__dirname, "public", "app.js")));

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

// ── Search API (for voice mode) ──
app.post("/api/search", requireAuth, async (req, res) => {
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
