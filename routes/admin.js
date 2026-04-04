const express = require("express");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcryptjs");

module.exports = function ({ db, requireAuth, requireAdmin, apiLimiter, inventoryData }) {
  const router = express.Router();

  // ── Item extras ──
  router.post("/api/items/extras-batch", (req, res) => {
    const { articleNos } = req.body;
    if (!articleNos?.length) return res.json({});
    const placeholders = articleNos.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM item_extras WHERE article_no IN (${placeholders})`).all(...articleNos);
    const map = {};
    for (const r of rows) map[r.article_no] = r;
    res.json(map);
  });

  router.get("/api/items/:articleNo/extras", (req, res) => {
    const extras = db.prepare("SELECT * FROM item_extras WHERE article_no = ?").get(req.params.articleNo);
    res.json(extras || { article_no: req.params.articleNo, photo_path: null, doc_url: null });
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(__dirname, "..", "uploads"),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = req.params.articleNo.replace(/[^a-zA-Z0-9_-]/g, "_");
        cb(null, `${name}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error("Format image invalide"));
    },
  });

  router.post("/api/admin/items/:articleNo/photo", requireAuth, upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Photo requise" });
    const photoPath = `/uploads/${req.file.filename}`;
    db.prepare("INSERT INTO item_extras (article_no, photo_path) VALUES (?, ?) ON CONFLICT(article_no) DO UPDATE SET photo_path = ?").run(req.params.articleNo, photoPath, photoPath);
    res.json({ photo_path: photoPath });
  });

  router.post("/api/admin/items/:articleNo/doc", requireAuth, (req, res) => {
    const { doc_url } = req.body;
    if (!doc_url) return res.status(400).json({ error: "URL requise" });
    db.prepare("INSERT INTO item_extras (article_no, doc_url) VALUES (?, ?) ON CONFLICT(article_no) DO UPDATE SET doc_url = ?").run(req.params.articleNo, doc_url, doc_url);
    res.json({ success: true });
  });

  // ── Photo learning ──
  const photoLearnUpload = multer({
    storage: multer.diskStorage({
      destination: path.join(__dirname, "..", "uploads", "learned"),
      filename: (req, file, cb) => {
        const name = req.params.articleNo.replace(/[^a-zA-Z0-9_-]/g, "_");
        cb(null, `${name}_${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
      else cb(new Error("Format invalide"));
    },
  });

  router.post("/api/items/:articleNo/learn-photo", apiLimiter, photoLearnUpload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Photo requise" });
    const photoPath = `/uploads/learned/${req.file.filename}`;
    db.prepare("INSERT INTO item_photos (article_no, photo_path, source) VALUES (?, ?, 'user')").run(req.params.articleNo, photoPath);

    const extras = db.prepare("SELECT photo_path FROM item_extras WHERE article_no = ?").get(req.params.articleNo);
    if (!extras || !extras.photo_path) {
      db.prepare("INSERT INTO item_extras (article_no, photo_path) VALUES (?, ?) ON CONFLICT(article_no) DO UPDATE SET photo_path = ?").run(req.params.articleNo, photoPath, photoPath);
    }

    console.log(`Photo learned: ${req.params.articleNo} ← ${req.file.filename}`);
    res.json({ success: true });
  });

  // ── User management ──
  router.get("/api/admin/users", requireAdmin, (req, res) => {
    const users = db.prepare("SELECT id, username, role, name, created_at FROM admin_users ORDER BY created_at").all();
    res.json(users);
  });

  router.post("/api/admin/users", requireAdmin, (req, res) => {
    const { username, password, role, name } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Nom d'utilisateur et mot de passe requis" });
    if (role && !["admin", "magasinier"].includes(role)) return res.status(400).json({ error: "Rôle invalide" });
    const hash = bcrypt.hashSync(password, 10);
    try {
      db.prepare("INSERT INTO admin_users (username, password, role, name) VALUES (?, ?, ?, ?)").run(username, hash, role || "magasinier", name || username);
      res.json({ success: true });
    } catch (err) {
      if (err.message.includes("UNIQUE")) return res.status(409).json({ error: "Nom d'utilisateur déjà pris" });
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  router.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: "Impossible de supprimer votre propre compte" });
    db.prepare("DELETE FROM admin_users WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  router.get("/api/admin/me", requireAuth, (req, res) => {
    res.json({ id: req.session.userId, role: req.session.userRole, name: req.session.userName });
  });

  // ── Statistics ──
  router.get("/api/admin/stats", requireAuth, (req, res) => {
    console.log("Stats request from:", req.session.userName, "role:", req.session.userRole);

    const topArticles = db.prepare(`
      SELECT oi.article_no, oi.description, SUM(oi.quantity) as total_qty, COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled' GROUP BY oi.article_no ORDER BY total_qty DESC LIMIT 20
    `).all();

    const avgPrepTime = db.prepare(`
      SELECT AVG((julianday(updated_at) - julianday(created_at)) * 1440) as avg_minutes
      FROM orders WHERE status = 'ready' AND updated_at != created_at
    `).get();

    const ordersByHour = db.prepare(`
      SELECT strftime('%H', created_at) as hour, COUNT(*) as count
      FROM orders WHERE status != 'cancelled' GROUP BY hour ORDER BY hour
    `).all();

    const ordersByDay = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM orders WHERE status != 'cancelled' GROUP BY day ORDER BY day DESC LIMIT 30
    `).all();

    const totalOrders = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status != 'cancelled'").get().cnt;
    const totalStudents = db.prepare("SELECT COUNT(DISTINCT student_da) as cnt FROM orders WHERE status != 'cancelled'").get().cnt;

    res.json({ topArticles, avgPrepTimeMinutes: Math.round(avgPrepTime?.avg_minutes || 0), ordersByHour, ordersByDay, totalOrders, totalStudents });
  });

  return router;
};
