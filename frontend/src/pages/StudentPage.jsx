import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { useCart } from "../hooks/useCart";
import { useSSE } from "../hooks/useSSE";
import { ItemCard } from "../components/ItemCard";
import { Modal } from "../components/Modal";
import { Badge } from "../components/Badge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import * as api from "../api";
import "./StudentPage.css";

export function StudentPage() {
  const { studentDA, studentName, loginStudent, logoutStudent, admin } = useAuth();
  const { cart, addItem, removeItem, updateQty, clearCart, totalItems } = useCart();

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [resultLabel, setResultLabel] = useState("");
  const [frequentMap, setFrequentMap] = useState(new Map());
  const [lastPhoto, setLastPhoto] = useState(null);
  const [photoStatus, setPhotoStatus] = useState("");
  const searchTimer = useRef(null);
  const searchController = useRef(null);

  // Orders state
  const [activeOrders, setActiveOrders] = useState([]);
  const [historyOrders, setHistoryOrders] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historySearch, setHistorySearch] = useState("");
  const [dismissed, setDismissed] = useState(() => JSON.parse(localStorage.getItem("dismissedOrders") || "[]"));

  // Modals
  const [showCart, setShowCart] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [expandedOrders, setExpandedOrders] = useState(new Set());

  // DA modal
  const [daInput, setDaInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [daStep, setDaStep] = useState("da"); // "da" or "name"
  const showDAModal = !studentDA || !studentName;

  // ── Load frequent articles ──
  useEffect(() => {
    if (!studentDA) return;
    api.getFrequent(studentDA).then((rows) => {
      if (!rows) return;
      setFrequentMap(new Map(rows.map((r) => [r.article_no, r.total_qty])));
      if (!query) {
        setResultLabel("Vous avez récemment emprunté :");
        setResults(rows.filter((r) => r.item).map((r) => r.item));
      }
    });
  }, [studentDA]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load orders ──
  const loadOrders = useCallback(async () => {
    if (!studentDA) return;
    const data = await api.getOrdersByDA(studentDA, { q: historySearch });
    if (!data) return;
    setActiveOrders(data.orders.filter((o) => o.status !== "picked_up" && o.status !== "cancelled" && !(o.status === "ready" && dismissed.includes(o.order_number))));
    setHistoryOrders(data.orders.filter((o) => o.status === "picked_up" || o.status === "cancelled" || o.status === "ready"));
    setHistoryTotal(data.total);
    setHistoryOffset(data.orders.length);
  }, [studentDA, dismissed, historySearch]);

  useEffect(() => { loadOrders(); }, [loadOrders]); // eslint-disable-line react-hooks/set-state-in-effect

  // ── SSE ──
  useSSE(studentDA ? `/api/orders/stream?da=${studentDA}` : null, {
    "order-update": (data) => {
      if (data.student_da !== studentDA) return;
      if (data.status === "ready") {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(`Commande #${data.order_number}`, { body: "Présentez-vous au comptoir avec votre carte étudiante." });
        }
      }
      loadOrders();
    },
  });

  // ── Search ──
  const doSearch = useCallback(async (q) => {
    if (searchController.current) searchController.current.abort();
    const ctrl = new AbortController();
    searchController.current = ctrl;
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }), signal: ctrl.signal });
      if (!res.ok) return;
      let items = await res.json();
      // Boost frequent
      if (frequentMap.size > 0) {
        const freq = items.filter((r) => frequentMap.has(r["No d'article"]));
        const rest = items.filter((r) => !frequentMap.has(r["No d'article"]));
        freq.sort((a, b) => (frequentMap.get(b["No d'article"]) || 0) - (frequentMap.get(a["No d'article"]) || 0));
        items = [...freq, ...rest];
      }
      setResults(items);
      setResultLabel(`${items.length} résultat${items.length > 1 ? "s" : ""}`);
    } catch (e) { if (e.name !== "AbortError") console.error(e); }
  }, [frequentMap]);

  const handleSearchInput = (val) => {
    setQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!val.trim()) {
      setResults([]);
      setResultLabel("");
      // Show suggestions
      if (frequentMap.size > 0) {
        api.getFrequent(studentDA).then((rows) => {
          if (rows) { setResultLabel("Vous avez récemment emprunté :"); setResults(rows.filter((r) => r.item).map((r) => r.item)); }
        });
      }
      return;
    }
    setLastPhoto(null);
    searchTimer.current = setTimeout(() => doSearch(val.trim()), 120);
  };

  // ── Photo search ──
  const handlePhotoSearch = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setLastPhoto(file);
    setPhotoStatus("Identification en cours...");
    try {
      const data = await api.searchPhoto(file);
      setQuery(data.keywords);
      setResults(data.results);
      setResultLabel(`${data.results.length} résultat${data.results.length > 1 ? "s" : ""} pour "${data.keywords}"`);
      setPhotoStatus("");
    } catch { setPhotoStatus("Erreur d'identification."); setTimeout(() => setPhotoStatus(""), 3000); }
  };

  // ── Add to cart (with photo learning) ──
  const handleAdd = (articleNo) => {
    const item = results.find((r) => r["No d'article"] === articleNo);
    if (!item) return;
    addItem(articleNo, item["Description"], item["Prix"], item["Localisation"]);
    if (lastPhoto) api.learnPhoto(articleNo, lastPhoto).catch(() => {});
  };

  // ── Submit order ──
  const handleSubmitOrder = async () => {
    try {
      const data = await api.createOrder(studentDA, studentName, cart.map((c) => ({ article_no: c.article_no, description: c.description, quantity: c.quantity, prix: c.prix, localisation: c.localisation })));
      setOrderNumber(data.order_number);
      clearCart();
      setShowCart(false);
      loadOrders();
    } catch { alert("Erreur lors de la soumission."); }
  };

  // ── Cancel order ──
  const handleCancel = async (num) => {
    await api.cancelOrder(num);
    setConfirmCancel(null);
    loadOrders();
  };

  // ── Dismiss ready order ──
  const handleDismiss = (num) => {
    const next = [...dismissed, num];
    setDismissed(next);
    localStorage.setItem("dismissedOrders", JSON.stringify(next));
  };

  // ── DA login flow ──
  const handleDASubmit = async () => {
    if (!daInput || !/^\d{5,9}$/.test(daInput)) return;

    // Try to find existing student
    const student = await api.getStudent(daInput);
    if (student) {
      // Known student — log in directly
      await api.saveStudent(daInput, student.name);
      loginStudent(daInput, student.name);
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } else {
      // New student — ask for name
      setDaStep("name");
    }
  };

  const handleNameSubmit = async () => {
    if (!nameInput.trim()) return;
    await api.saveStudent(daInput, nameInput.trim());
    loginStudent(daInput, nameInput.trim());
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  };

  // ── Toggle order detail ──
  const toggleOrder = (num) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  };

  // ── Load more history ──
  const loadMore = async () => {
    const data = await api.getOrdersByDA(studentDA, { offset: historyOffset, q: historySearch });
    if (!data) return;
    setHistoryOrders((prev) => [...prev, ...data.orders.filter((o) => o.status === "picked_up" || o.status === "cancelled" || o.status === "ready")]);
    setHistoryOffset((prev) => prev + data.orders.length);
  };

  // ── Admin redirect ──
  if (showDAModal && admin) {
    return (
      <Modal open>
        <h2>Magasin TGE</h2>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem" }}>Connecté comme <strong>{admin.name}</strong> ({admin.role})</p>
        <div className="btn-row" style={{ justifyContent: "center", gap: "0.5rem" }}>
          <a href="/admin" className="btn btn-primary" style={{ textDecoration: "none" }}>Dashboard</a>
          <button className="btn btn-secondary" onClick={async () => { await api.logout(); window.location.reload(); }}>Déconnexion</button>
        </div>
      </Modal>
    );
  }

  return (
    <>
      {/* DA Modal */}
      <Modal open={showDAModal}>
        <h2>Magasin TGE</h2>
        {daStep === "da" ? (
          <>
            <p style={{ color: "var(--color-text-muted)", marginBottom: "1rem", fontSize: "0.85rem" }}>Entrez votre numéro de DA pour commencer.</p>
            <input className="input" value={daInput} onChange={(e) => setDaInput(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && handleDASubmit()} placeholder="1234567" autoFocus style={{ marginBottom: "0.85rem", fontSize: "1.2rem", textAlign: "center", letterSpacing: "0.1em" }} />
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleDASubmit} disabled={daInput.length < 5}>Continuer</button>
          </>
        ) : (
          <>
            <p style={{ color: "var(--color-text-muted)", marginBottom: "1rem", fontSize: "0.85rem" }}>Bienvenue! C'est votre première visite. Comment vous appelez-vous?</p>
            <input className="input" value={nameInput} onChange={(e) => setNameInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()} placeholder="Prénom Nom" autoFocus style={{ marginBottom: "0.85rem" }} />
            <div className="btn-row" style={{ justifyContent: "space-between" }}>
              <button className="btn btn-secondary" onClick={() => { setDaStep("da"); setDaInput(""); }}>Retour</button>
              <button className="btn btn-primary" onClick={handleNameSubmit} disabled={!nameInput.trim()}>Commencer</button>
            </div>
          </>
        )}
      </Modal>

      {/* Header */}
      <header className="student-header">
        <span className="student-name">{studentName}</span>
        <div style={{ flex: 1 }} />
        {historyTotal > 0 && <button className="header-btn" onClick={() => setShowHistory(true)}>Commandes</button>}
        {studentDA && <button className="header-btn" onClick={logoutStudent} title="Changer de compte">
          <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "currentColor", verticalAlign: "middle" }}><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>
        </button>}
      </header>

      {/* Active orders */}
      <div className="page-layout">
        <main className="student-main">
          {photoStatus && <div className="photo-status">{photoStatus}</div>}

          {activeOrders.length > 0 && (
            <div className="active-orders">
              {activeOrders.map((o) => (
                <OrderBanner key={o.id} order={o} expanded={expandedOrders.has(o.order_number)} onToggle={() => toggleOrder(o.order_number)} onCancel={() => setConfirmCancel(o.order_number)} onDismiss={() => handleDismiss(o.order_number)} />
              ))}
            </div>
          )}

          {results.length === 0 && !resultLabel && <div className="empty-state"><p>Recherchez un article dans l'inventaire</p></div>}
          {resultLabel && <div className="result-count">{resultLabel}</div>}

          <div className="results-grid">
            {results.map((item) => {
              const no = item["No d'article"];
              const inCart = cart.find((c) => c.article_no === no);
              return <ItemCard key={no} item={item} cartQty={inCart?.quantity || 0} onAdd={handleAdd} onUpdateQty={updateQty} freq={frequentMap.get(no) || 0} />;
            })}
          </div>
        </main>

        {/* Cart sidebar (desktop) */}
        {totalItems > 0 && (
          <aside className="cart-sidebar">
            <h3>Panier <span className="cart-count">({totalItems})</span></h3>
            <CartItems cart={cart} updateQty={updateQty} removeItem={removeItem} />
            <button className="btn btn-primary" style={{ width: "100%", marginTop: "var(--space-md)" }} onClick={() => setShowSubmit(true)}>Soumettre la demande</button>
          </aside>
        )}
      </div>

      {/* Cart FAB (mobile) */}
      {totalItems > 0 && (
        <div className="cart-fab" onClick={() => setShowCart(true)}>
          <svg viewBox="0 0 24 24" style={{ width: 24, height: 24, fill: "#fff" }}><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" /></svg>
          <span className="cart-badge">{totalItems}</span>
        </div>
      )}

      {/* Cart Modal (mobile) */}
      <Modal open={showCart} onClose={() => setShowCart(false)} top>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
          <h2 style={{ margin: 0 }}>Panier</h2>
          <button className="btn btn-ghost" onClick={() => setShowCart(false)}>&times;</button>
        </div>
        <CartItems cart={cart} updateQty={updateQty} removeItem={removeItem} />
        <button className="btn btn-primary" style={{ width: "100%", marginTop: "var(--space-md)" }} onClick={() => { setShowCart(false); setShowSubmit(true); }}>Soumettre la demande</button>
      </Modal>

      {/* Submit Modal */}
      <Modal open={showSubmit} onClose={() => setShowSubmit(false)}>
        {!orderNumber ? (
          <>
            <h2>Confirmer la demande</h2>
            <div style={{ background: "var(--color-input-bg)", borderRadius: "var(--radius-md)", padding: "0.6rem 0.85rem", marginBottom: "1rem", fontSize: "0.8rem" }}>
              <div style={{ marginBottom: "0.5rem" }}><strong>{studentName}</strong> (DA: {studentDA})</div>
              {cart.map((c, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.15rem 0" }}><span>#{c.article_no}</span><span>x{c.quantity}</span></div>)}
            </div>
            <div className="btn-row">
              <button className="btn btn-secondary" onClick={() => setShowSubmit(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSubmitOrder}>Confirmer</button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <h2>Demande envoyée</h2>
            <div className="mono" style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--color-success)", margin: "0.75rem 0" }}>#{orderNumber}</div>
            <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem", lineHeight: 1.4 }}>Présentez ce numéro au comptoir.<br />On vous appelle quand c'est prêt.</p>
            <button className="btn btn-primary" onClick={() => { setShowSubmit(false); setOrderNumber(""); }}>OK</button>
          </div>
        )}
      </Modal>

      {/* History Modal */}
      <Modal open={showHistory} onClose={() => setShowHistory(false)} top wide>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>Commandes</h2>
          <button className="btn btn-ghost" onClick={() => setShowHistory(false)}>&times;</button>
        </div>
        <input className="input" placeholder="Rechercher..." value={historySearch} onChange={(e) => { setHistorySearch(e.target.value); }} style={{ marginBottom: "0.5rem", fontSize: "var(--font-size-sm)" }} />
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {historyOrders.map((o) => (
            <HistoryOrder key={o.id} order={o} expanded={expandedOrders.has(`h-${o.order_number}`)} onToggle={() => toggleOrder(`h-${o.order_number}`)} onReorder={() => { (o.items || []).forEach((i) => addItem(i.article_no, i.description, i.prix, i.localisation)); setShowHistory(false); setShowCart(true); }} />
          ))}
          {historyOrders.length === 0 && <p style={{ textAlign: "center", color: "var(--color-text-faint)", padding: "1rem" }}>Aucune commande</p>}
          {historyOffset < historyTotal && <button className="btn btn-secondary" style={{ width: "100%", marginTop: "var(--space-md)" }} onClick={loadMore}>Voir plus</button>}
        </div>
      </Modal>

      {/* Confirm dialog */}
      <ConfirmDialog open={!!confirmCancel} message="Êtes-vous sûr de vouloir annuler cette demande?" onConfirm={() => handleCancel(confirmCancel)} onCancel={() => setConfirmCancel(null)} />

      {/* Search bar (bottom) */}
      <div className="search-area">
        <div className="search-bar">
          <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          <input value={query} onChange={(e) => handleSearchInput(e.target.value)} placeholder="Rechercher un article..." />
          {query && <button className="search-clear" onClick={() => handleSearchInput("")}>&times;</button>}
        </div>
        <label className="photo-btn">
          <input type="file" accept="image/*" capture="environment" onChange={handlePhotoSearch} style={{ display: "none" }} />
          <svg viewBox="0 0 24 24"><path d="M12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0 3.2 3.2 0 1 0-6.4 0M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" /></svg>
        </label>
      </div>
    </>
  );
}

function CartItems({ cart, updateQty, removeItem }) {
  return cart.map((item) => (
    <div key={item.article_no} className="cart-row">
      <div className="cart-row-info">
        <div className="mono" style={{ fontSize: "var(--font-size-sm)", fontWeight: 700, color: "var(--color-accent)" }}>#{item.article_no}</div>
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>
      </div>
      <div className="qty-control">
        <button onClick={() => updateQty(item.article_no, -1)}>-</button>
        <span>{item.quantity}</span>
        <button onClick={() => updateQty(item.article_no, 1)}>+</button>
      </div>
      <button className="remove-btn" onClick={() => removeItem(item.article_no)}>&times;</button>
    </div>
  ));
}

function OrderBanner({ order, expanded, onToggle, onCancel, onDismiss }) {
  const items = order.items || [];
  const summary = items.map((i) => `${i.quantity}x #${i.article_no}`).join(", ");
  return (
    <div className="order-banner">
      <div className="order-banner-header" onClick={onToggle}>
        <span className="mono" style={{ fontWeight: 700 }}>#{order.order_number}</span>
        <Badge status={order.status} />
        <span className="order-summary">{summary}</span>
        {order.status === "ready" && <button className="btn btn-primary dismiss-btn" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>Confirmer la réception</button>}
        <span className="expand-arrow">{expanded ? "▴" : "▾"}</span>
      </div>
      {order.status === "ready" && <div className="ready-instructions">Présentez-vous au comptoir avec votre <strong>carte étudiante</strong> et le numéro <strong>#{order.order_number}</strong></div>}
      {expanded && (
        <div className="order-detail">
          {items.map((i, idx) => <div key={idx} className="detail-row"><span className="mono" style={{ fontWeight: 700 }}>x{i.quantity}</span><span className="mono" style={{ color: "var(--color-accent)" }}>#{i.article_no}</span><span>{(i.description || "").substring(0, 40)}</span></div>)}
          {order.status === "pending" && <button className="btn btn-danger-outline" style={{ marginTop: "var(--space-sm)" }} onClick={onCancel}>Annuler la demande</button>}
        </div>
      )}
    </div>
  );
}

function HistoryOrder({ order, expanded, onToggle, onReorder }) {
  const items = order.items || [];
  const summary = items.map((i) => `${i.quantity}x #${i.article_no}`).join(", ");
  const date = order.created_at ? new Date(order.created_at + "Z").toLocaleDateString("fr-CA", { day: "numeric", month: "short" }) : "";
  const statusText = order.status === "cancelled" ? "Annulée" : order.status === "ready" ? "Prête" : "Terminée";
  return (
    <div className="order-banner" style={{ opacity: 0.7 }}>
      <div className="order-banner-header" onClick={onToggle}>
        <span className="mono" style={{ fontWeight: 700 }}>#{order.order_number}</span>
        <Badge status={order.status} label={statusText} />
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-faint)" }}>{date}</span>
        <span className="order-summary">{summary}</span>
        <span className="expand-arrow">{expanded ? "▴" : "▾"}</span>
      </div>
      {expanded && (
        <div className="order-detail">
          {items.map((i, idx) => <div key={idx} className="detail-row"><span className="mono" style={{ fontWeight: 700 }}>x{i.quantity}</span><span className="mono" style={{ color: "var(--color-accent)" }}>#{i.article_no}</span><span>{(i.description || "").substring(0, 40)}</span></div>)}
          <button className="btn btn-secondary" style={{ marginTop: "var(--space-sm)", fontSize: "var(--font-size-xs)" }} onClick={onReorder}>Recommander</button>
        </div>
      )}
    </div>
  );
}
