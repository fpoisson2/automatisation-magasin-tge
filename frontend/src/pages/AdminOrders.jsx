import { useState, useEffect, useRef } from "react";
import { AdminNav } from "../components/AdminNav";
import { Badge } from "../components/Badge";
import { useSSE } from "../hooks/useSSE";
import { getAdminOrders, getAdminOrdersAll, updateOrderStatus } from "../api";

export function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioCtx = useRef(null);

  const fetchAll = async () => {
    const active = await getAdminOrders();
    if (active) setOrders(active);
    const all = await getAdminOrdersAll();
    if (all) setCompleted(all.filter((o) => o.status === "picked_up" || o.status === "cancelled" || o.status === "ready"));
  };

  useEffect(() => { fetchAll(); }, []);

  const connected = useSSE("/api/admin/orders/stream", {
    "order-new": () => { playSound(); fetchAll(); },
    "order-update": () => { playSound(); fetchAll(); },
  });

  const playSound = () => {
    if (!soundEnabled) return;
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.start();
    osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    osc.stop(ctx.currentTime + 0.4);
  };

  const changeStatus = async (id, status) => {
    await updateOrderStatus(id, status);
    fetchAll();
  };

  const pending = orders.filter((o) => o.status === "pending");
  const preparing = orders.filter((o) => o.status === "preparing");
  const ready = orders.filter((o) => o.status === "ready");
  const total = pending.length + preparing.length + ready.length;

  useEffect(() => {
    document.title = total > 0 ? `(${total}) Commandes` : "Commandes";
  }, [total]);

  const soundBtn = (
    <button onClick={() => { setSoundEnabled(!soundEnabled); if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)(); }}
      className="nav-logout" style={{ borderColor: soundEnabled ? "var(--color-success)" : undefined, color: soundEnabled ? "#4ade80" : undefined }}>
      Son: {soundEnabled ? "ON" : "OFF"}
    </button>
  );

  return (
    <>
      <AdminNav title="Commandes" extra={soundBtn} />
      {!connected && <div style={{ background: "var(--color-danger)", color: "#fff", textAlign: "center", fontSize: "var(--font-size-xs)", padding: "0.2rem" }}>Connexion perdue...</div>}
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "var(--space-xl)" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "var(--space-xl)" }}>
          <StatCard num={pending.length} label="En attente" color="#e65100" />
          <StatCard num={preparing.length} label="En préparation" color="var(--color-accent)" />
          <StatCard num={ready.length} label="Prêtes" color="var(--color-success)" />
        </div>

        <OrderSection title={`En attente (${pending.length})`} orders={pending}
          actions={(o) => [
            { label: "Préparer", cls: "btn-primary", onClick: () => changeStatus(o.id, "preparing") },
            { label: "Annuler", cls: "btn-secondary", onClick: () => changeStatus(o.id, "cancelled") },
          ]} />

        <OrderSection title={`En préparation (${preparing.length})`} orders={preparing}
          actions={(o) => [
            { label: "Prête", cls: "btn-primary", style: { background: "var(--color-success)" }, onClick: () => changeStatus(o.id, "ready") },
            { label: "Annuler", cls: "btn-secondary", onClick: () => changeStatus(o.id, "cancelled") },
          ]} />

        <OrderSection title={`Prêtes (${ready.length})`} orders={ready}
          actions={() => []}
          badge={(o) => <Badge status="ready" />} />

        {total === 0 && <p style={{ textAlign: "center", color: "var(--color-text-placeholder)", padding: "2.5rem" }}>Aucune commande en cours</p>}

        {completed.length > 0 && (
          <>
            <SectionTitle>Historique du jour</SectionTitle>
            {completed.map((o) => (
              <OrderCard key={o.id} order={o}>
                <Badge status={o.status} />
              </OrderCard>
            ))}
          </>
        )}
      </main>
    </>
  );
}

function StatCard({ num, label, color }) {
  return (
    <div className="card" style={{ flex: 1, textAlign: "center", padding: "0.85rem" }}>
      <div className="mono" style={{ fontSize: "1.75rem", fontWeight: 700, color }}>{num}</div>
      <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: "0.15rem" }}>{label}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, margin: "var(--space-xl) 0 var(--space-sm)", paddingBottom: "var(--space-sm)", borderBottom: "1px solid var(--color-border)" }}>{children}</div>;
}

function OrderSection({ title, orders, actions, badge }) {
  if (!orders.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {orders.map((o) => (
        <OrderCard key={o.id} order={o}>
          {badge?.(o)}
          {actions(o).map((a, i) => (
            <button key={i} className={`btn ${a.cls}`} style={{ fontSize: "0.8rem", padding: "0.35rem 0.85rem", ...a.style }} onClick={a.onClick}>{a.label}</button>
          ))}
        </OrderCard>
      ))}
    </>
  );
}

function OrderCard({ order, children }) {
  const time = new Date(order.created_at + "Z").toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="card" style={{ padding: "0.85rem 1rem", marginBottom: "0.5rem", borderRadius: "var(--radius-md)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <span className="mono" style={{ fontSize: "1.1rem", fontWeight: 700 }}>#{order.order_number}</span>
        <span style={{ flex: 1, fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
          <strong style={{ color: "var(--color-text)" }}>{order.student_name}</strong> (DA: {order.student_da})
        </span>
        <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-faint)" }}>{time}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.6rem" }}>
        {(order.items || []).map((item, i) => (
          <span key={i} style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", borderRadius: 4, padding: "0.2rem 0.5rem", fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>
            <strong style={{ color: "var(--color-text)" }}>x{item.quantity}</strong> #{item.article_no} — {(item.description || "").substring(0, 35)}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.4rem" }}>{children}</div>
    </div>
  );
}
