import { useState, useRef } from "react";
import { AdminNav } from "../components/AdminNav";
import { search, getItemExtras, uploadItemPhoto, saveItemDoc } from "../api";

export function AdminItems() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const timer = useRef(null);

  const doSearch = async (q) => {
    if (!q) { setItems([]); return; }
    const results = await search(q);
    // Enrich with extras
    const enriched = await Promise.all(results.map(async (item) => {
      const extras = await getItemExtras(item["No d'article"]);
      return { ...item, _extras: extras || {} };
    }));
    setItems(enriched);
  };

  const handleInput = (val) => {
    setQuery(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(val.trim()), 200);
  };

  return (
    <>
      <AdminNav title="Articles" />
      <main style={{ maxWidth: 700, margin: "0 auto", padding: "var(--space-xl)" }}>
        <div style={{ position: "relative", marginBottom: "var(--space-lg)" }}>
          <input className="input" placeholder="Rechercher un article..." value={query} onChange={(e) => handleInput(e.target.value)} autoFocus style={{ paddingLeft: "2.25rem", borderRadius: "var(--radius-pill)" }} />
          <svg viewBox="0 0 24 24" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", width: 18, height: 18, fill: "var(--color-text-muted)" }}><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </div>

        {items.length === 0 && <p style={{ textAlign: "center", color: "var(--color-text-faint)", padding: "3rem" }}>Recherchez un article ci-dessus</p>}

        {items.map((item) => <ItemEditor key={item["No d'article"]} item={item} onUpdate={() => doSearch(query)} />)}
      </main>
    </>
  );
}

function ItemEditor({ item, onUpdate }) {
  const articleNo = item["No d'article"];
  const extras = item._extras || {};
  const [docUrl, setDocUrl] = useState(extras.doc_url || "");
  const [msg, setMsg] = useState("");

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const res = await uploadItemPhoto(articleNo, file);
    if (res.ok) { setMsg("Photo enregistrée"); onUpdate(); }
    else setMsg("Erreur");
    setTimeout(() => setMsg(""), 2000);
  };

  const handleDoc = async () => {
    if (!docUrl.trim()) return;
    const res = await saveItemDoc(articleNo, docUrl.trim());
    if (res.ok) setMsg("Doc sauvée");
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div className="card" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-sm)" }}>
      <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-start", marginBottom: "var(--space-md)" }}>
        {extras.photo_path
          ? <img src={extras.photo_path} alt="" style={{ width: 80, height: 80, borderRadius: "var(--radius-md)", objectFit: "contain", background: "var(--color-input-bg)", flexShrink: 0 }} />
          : <div style={{ width: 80, height: 80, borderRadius: "var(--radius-md)", background: "var(--color-input-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-faint)", fontSize: "var(--font-size-xs)", flexShrink: 0 }}>Pas de photo</div>
        }
        <div>
          <div className="mono" style={{ fontWeight: 700, color: "var(--color-accent)", fontSize: "var(--font-size-sm)" }}>#{articleNo}</div>
          <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-xs)" }}>{item["Description"]}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "center" }}>
        <label className="btn btn-secondary" style={{ cursor: "pointer", fontSize: "var(--font-size-xs)" }}>
          <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
          Choisir photo
        </label>
        <label className="btn btn-secondary" style={{ cursor: "pointer", fontSize: "var(--font-size-xs)" }}>
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: "none" }} />
          Prendre photo
        </label>
        <input className="input" placeholder="URL documentation" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} style={{ flex: 1, minWidth: 150, fontSize: "var(--font-size-xs)", padding: "var(--space-xs) var(--space-sm)" }} />
        <button className="btn" style={{ background: "var(--color-accent)", color: "#fff", fontSize: "var(--font-size-xs)" }} onClick={handleDoc}>Sauver</button>
        {msg && <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-success)" }}>{msg}</span>}
      </div>
    </div>
  );
}
