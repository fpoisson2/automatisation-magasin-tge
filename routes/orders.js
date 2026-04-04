const express = require("express");
const path = require("path");

module.exports = function ({ db, orderLimiter, apiLimiter, requireAuth, requirePrintToken, sseClients, broadcastSSE, getOrderWithItems, generateOrderNumber }) {
  const router = express.Router();

  // ── SSE endpoints (must be before :number param routes) ──
  router.get("/api/orders/stream", (req, res) => {
    const da = req.query.da;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("event: connected\ndata: {}\n\n");
    const client = { res, da: da || null };
    sseClients.add(client);
    req.on("close", () => { sseClients.delete(client); });
  });

  router.get("/api/admin/orders/stream", requireAuth, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("event: connected\ndata: {}\n\n");
    const client = { res, da: null };
    sseClients.add(client);
    req.on("close", () => { sseClients.delete(client); });
  });

  // ── Create order ──
  router.post("/api/orders", orderLimiter, (req, res) => {
    const { student_da, student_name, items } = req.body;
    if (!student_da || !student_name || !items?.length) return res.status(400).json({ error: "DA, nom et articles requis" });
    if (!/^\d{5,9}$/.test(student_da.trim())) return res.status(400).json({ error: "DA invalide (5-9 chiffres)" });
    if (student_name.trim().length < 2 || student_name.trim().length > 100) return res.status(400).json({ error: "Nom invalide" });
    if (items.length > 20) return res.status(400).json({ error: "Maximum 20 articles par commande" });

    const orderNumber = generateOrderNumber();
    const insert = db.prepare("INSERT INTO orders (order_number, student_da, student_name) VALUES (?, ?, ?)");
    const insertItem = db.prepare("INSERT INTO order_items (order_id, article_no, description, quantity, prix, localisation) VALUES (?, ?, ?, ?, ?, ?)");

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
        order_number: orderNumber, student_da: student_da.trim(), student_name: student_name.trim(),
        items: items.map((i) => ({ article_no: i.article_no, description: i.description, quantity: i.quantity || 1, prix: i.prix || "0" })),
      });
      res.json({ order_number: orderNumber });
    } catch (err) {
      console.error("Order creation failed:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  });

  // ── Get orders by DA ──
  router.get("/api/orders/by-da/:da", apiLimiter, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.q || "";

    let orders;
    if (search) {
      orders = db.prepare(`
        SELECT o.* FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.student_da = ? AND (oi.article_no LIKE ? OR oi.description LIKE ? OR o.order_number LIKE ?)
        GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?
      `).all(req.params.da, `%${search}%`, `%${search}%`, `%${search}%`, limit, offset);
    } else {
      orders = db.prepare("SELECT * FROM orders WHERE student_da = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(req.params.da, limit, offset);
    }

    for (const order of orders) {
      order.items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    }

    const total = db.prepare("SELECT COUNT(*) as cnt FROM orders WHERE student_da = ?").get(req.params.da).cnt;
    res.json({ orders, total, limit, offset });
  });

  // ── Get single order ──
  router.get("/api/orders/:number", apiLimiter, (req, res) => {
    const order = getOrderWithItems(req.params.number);
    if (!order) return res.status(404).json({ error: "Commande introuvable" });
    res.json(order);
  });

  // ── Cancel order ──
  router.delete("/api/orders/:number", apiLimiter, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(req.params.number);
    if (!order) return res.status(404).json({ error: "Commande introuvable" });
    if (order.status !== "pending") return res.status(400).json({ error: "Impossible d'annuler, la commande est déjà en traitement" });
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    broadcastSSE("order-update", { order_number: order.order_number, status: "cancelled", student_da: order.student_da });
    res.json({ success: true });
  });

  // ── Print client ack ──
  router.post("/api/print-ack/:number", requirePrintToken, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE order_number = ?").get(req.params.number);
    if (!order) return res.status(404).json({ error: "Commande introuvable" });
    if (order.status !== "pending") return res.json({ success: true, already: true });
    db.prepare("UPDATE orders SET status = 'preparing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    broadcastSSE("order-update", { order_number: order.order_number, status: "preparing", student_da: order.student_da });
    console.log(`Print-ack: #${order.order_number} → preparing`);
    res.json({ success: true });
  });

  // ── Admin orders ──
  router.get("/api/admin/orders", requireAuth, (req, res) => {
    const orders = db.prepare("SELECT * FROM orders WHERE status NOT IN ('picked_up', 'cancelled') ORDER BY created_at ASC").all();
    for (const order of orders) {
      order.items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    }
    res.json(orders);
  });

  router.get("/api/admin/orders/all", requireAuth, (req, res) => {
    const orders = db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").all();
    for (const order of orders) {
      order.items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    }
    res.json(orders);
  });

  router.patch("/api/admin/orders/:id", requireAuth, (req, res) => {
    const { status } = req.body;
    const validStatuses = ["pending", "preparing", "ready", "picked_up", "cancelled"];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Statut invalide" });

    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ error: "Commande introuvable" });

    db.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, req.params.id);
    broadcastSSE("order-update", { order_number: order.order_number, status, student_da: order.student_da });
    res.json({ success: true });
  });

  return router;
};
