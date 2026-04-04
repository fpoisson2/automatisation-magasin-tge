
export function ItemCard({ item, cartQty = 0, onAdd, onUpdateQty, freq = 0 }) {
  const dispo = parseInt(item["Disponible"]) || 0;
  const articleNo = item["No d'article"];

  return (
    <div className="card" style={{ borderRadius: "var(--radius-xl)", padding: "0.85rem 1.1rem" }}>
      {item._photo && <img src={item._photo} alt="" style={{ width: "100%", maxHeight: 140, objectFit: "contain", borderRadius: 4, marginBottom: "0.4rem", background: "var(--color-input-bg)" }} loading="lazy" />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.15rem" }}>
        <span className="mono" style={{ fontWeight: 700, color: "var(--color-accent)", fontSize: "var(--font-size-sm)" }}>#{articleNo}</span>
        {dispo > 0 && (
          cartQty > 0 ? (
            <QtyControl qty={cartQty} onMinus={() => onUpdateQty(articleNo, -1)} onPlus={() => onAdd(articleNo)} />
          ) : (
            <button onClick={() => onAdd(articleNo)} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--color-input-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", fontSize: "1.4rem", fontWeight: 300, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
          )
        )}
      </div>
      <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", marginBottom: "0.4rem", lineHeight: 1.3 }}>
        {item["Description"]}
        {freq > 0 && <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", fontStyle: "italic" }}> (commandé {freq}x)</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", fontSize: "var(--font-size-xs)" }}>
        <span style={{ background: dispo === 0 ? "var(--color-danger-light)" : "var(--color-input-bg)", padding: "0.15rem 0.4rem", borderRadius: 3, color: dispo === 0 ? "var(--color-danger)" : "var(--color-text-secondary)" }}>
          Dispo: <strong>{dispo}</strong>
        </span>
      </div>
      {item._doc && <a href={item._doc} target="_blank" rel="noopener" style={{ fontSize: "var(--font-size-xs)", color: "var(--color-accent)", textDecoration: "none" }}>Documentation</a>}
    </div>
  );
}

function QtyControl({ qty, onMinus, onPlus }) {
  const btnStyle = { width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--color-input-border)", background: "var(--color-surface)", fontSize: "1.1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
      <button style={btnStyle} onClick={onMinus}>-</button>
      <span style={{ minWidth: "1.5rem", textAlign: "center", fontWeight: 700, fontSize: "var(--font-size-base)" }}>{qty}</span>
      <button style={btnStyle} onClick={onPlus}>+</button>
    </div>
  );
}
