import { useState, useEffect } from "react";
import { AdminNav } from "../components/AdminNav";
import { getStats } from "../api";

export function AdminStats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getStats().then((d) => d ? setStats(d) : setError("Erreur de chargement")).catch(() => setError("Erreur"));
  }, []);

  return (
    <>
      <AdminNav title="Statistiques" />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "var(--space-xl)" }}>
        {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
        {stats && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-xl)" }}>
            <BigStat num={stats.totalOrders} label="Commandes" />
            <BigStat num={stats.totalStudents} label="Étudiants" />
            <BigStat num={`${stats.avgPrepTimeMinutes} min`} label="Temps moyen" />
          </div>

          <h2 style={{ fontSize: "var(--font-size-base)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "var(--space-xl) 0 var(--space-md)", paddingBottom: "var(--space-sm)", borderBottom: "1px solid var(--color-border)" }}>Achalandage par heure</h2>
          <HoursChart data={stats.ordersByHour} />

          <h2 style={{ fontSize: "var(--font-size-base)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "var(--space-xl) 0 var(--space-md)", paddingBottom: "var(--space-sm)", borderBottom: "1px solid var(--color-border)" }}>Articles les plus demandés</h2>
          <TopArticles data={stats.topArticles} />
        </>}
      </main>
    </>
  );
}

function BigStat({ num, label }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "var(--space-lg)" }}>
      <div className="mono" style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-primary)" }}>{num}</div>
      <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: "var(--space-xs)" }}>{label}</div>
    </div>
  );
}

function HoursChart({ data }) {
  const hoursMap = {};
  data.forEach((h) => { hoursMap[parseInt(h.hour)] = h.count; });
  const max = Math.max(...data.map((h) => h.count), 1);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, alignItems: "end", height: 80, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "var(--space-md) var(--space-sm) var(--space-sm)" }}>
        {Array.from({ length: 24 }, (_, h) => {
          const count = hoursMap[h] || 0;
          return <div key={h} title={`${h}h: ${count}`} style={{ background: "var(--color-accent)", borderRadius: "2px 2px 0 0", height: `${Math.max((count / max) * 100, 2)}%`, opacity: 0.7 }} />;
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, padding: "0 var(--space-sm)" }}>
        {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ textAlign: "center", fontSize: "0.55rem", color: "var(--color-text-faint)" }}>{h}</span>)}
      </div>
    </>
  );
}

function TopArticles({ data }) {
  const max = data[0]?.total_qty || 1;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Article", "Description", "Qté", "Commandes", ""].map((h, i) => (
            <th key={i} style={{ textAlign: "left", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textTransform: "uppercase", padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--color-border)" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((a) => (
          <tr key={a.article_no}>
            <td className="mono" style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-sm)", color: "var(--color-accent)", fontWeight: 600, borderBottom: "1px solid var(--color-border-light)" }}>{a.article_no}</td>
            <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-sm)", borderBottom: "1px solid var(--color-border-light)" }}>{(a.description || "").substring(0, 40)}</td>
            <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-sm)", fontWeight: 700, borderBottom: "1px solid var(--color-border-light)" }}>{a.total_qty}</td>
            <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: "var(--font-size-sm)", borderBottom: "1px solid var(--color-border-light)" }}>{a.order_count}</td>
            <td style={{ width: "30%", padding: "var(--space-sm) var(--space-md)", borderBottom: "1px solid var(--color-border-light)" }}>
              <div style={{ height: 8, background: "var(--color-accent)", borderRadius: 4, opacity: 0.6, width: `${(a.total_qty / max) * 100}%` }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
