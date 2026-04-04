const express = require("express");

module.exports = function ({ searchLimiter, uploadLimiter, hybridSearch, deduplicateResults, inventoryData, db, apiLimiter, EMBEDDING_URL }) {
  const router = express.Router();
  const multer = require("multer");

  // ── Text search ──
  router.post("/api/search", searchLimiter, async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: "Query requis" });
      const raw = await hybridSearch(query, 50);
      res.json(deduplicateResults(raw));
    } catch (err) {
      console.error("Search failed:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  // ── Photo search ──
  const visualSearchUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error("Format image invalide"));
    },
  });

  router.post("/api/search/photo", searchLimiter, uploadLimiter, visualSearchUpload.single("photo"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Photo requise" });

    try {
      const base64 = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype;

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

      const raw = await hybridSearch(keywords, 50);
      res.json({ keywords, results: deduplicateResults(raw) });
    } catch (err) {
      console.error("Visual search failed:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  // ── Students ──
  router.get("/api/students/autocomplete", apiLimiter, (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) return res.json([]);
    const results = db.prepare("SELECT da, name FROM students WHERE da LIKE ? ORDER BY last_seen DESC LIMIT 5").all(`${q}%`);
    res.json(results);
  });

  router.get("/api/students/:da", apiLimiter, (req, res) => {
    if (!/^\d{5,9}$/.test(req.params.da)) return res.status(400).json({ error: "DA invalide" });
    const student = db.prepare("SELECT * FROM students WHERE da = ?").get(req.params.da);
    if (!student) return res.status(404).json({ error: "Inconnu" });
    db.prepare("UPDATE students SET last_seen = CURRENT_TIMESTAMP WHERE da = ?").run(req.params.da);
    res.json(student);
  });

  router.post("/api/students", apiLimiter, (req, res) => {
    const { da, name } = req.body;
    if (!da || !name) return res.status(400).json({ error: "DA et nom requis" });
    if (!/^\d{5,9}$/.test(da.trim())) return res.status(400).json({ error: "DA invalide (5-9 chiffres)" });
    if (name.trim().length < 2 || name.trim().length > 100) return res.status(400).json({ error: "Nom invalide" });
    db.prepare(
      "INSERT INTO students (da, name) VALUES (?, ?) ON CONFLICT(da) DO UPDATE SET name = ?, last_seen = CURRENT_TIMESTAMP"
    ).run(da.trim(), name.trim(), name.trim());
    res.json({ success: true });
  });

  router.get("/api/students/:da/frequent", apiLimiter, (req, res) => {
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

    const enriched = rows.map((r) => {
      const inv = inventoryData.find((i) => i["No d'article"] === r.article_no);
      if (!inv) return { ...r, found: false };
      return { ...r, found: true, item: inv };
    }).filter((r) => r.found);

    res.json(enriched);
  });

  return router;
};
