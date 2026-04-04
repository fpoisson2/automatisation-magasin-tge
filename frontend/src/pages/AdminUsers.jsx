import { useState, useEffect } from "react";
import { AdminNav } from "../components/AdminNav";
import { useAuth } from "../hooks/useAuth";
import { getUsers, createUser, deleteUser } from "../api";

export function AdminUsers() {
  const { admin } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: "", name: "", password: "", role: "magasinier" });
  const [msg, setMsg] = useState({ text: "", ok: false });

  const load = () => getUsers().then((d) => d && setUsers(d));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!form.username || !form.password) { setMsg({ text: "Nom et mot de passe requis.", ok: false }); return; }
    const res = await createUser({ ...form, name: form.name || form.username });
    if (res.ok) {
      setMsg({ text: "Compte créé!", ok: true });
      setForm({ username: "", name: "", password: "", role: "magasinier" });
      load();
    } else {
      const data = await res.json();
      setMsg({ text: data.error || "Erreur", ok: false });
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Supprimer cet utilisateur?")) return;
    await deleteUser(id);
    load();
  };

  return (
    <>
      <AdminNav title="Utilisateurs" />
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "var(--space-xl)" }}>
        {users.map((u) => (
          <div key={u.id} className="card" style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", padding: "var(--space-md) var(--space-lg)", marginBottom: "var(--space-sm)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{u.name || u.username}</div>
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>@{u.username}</div>
            </div>
            <span className={`badge ${u.role === "admin" ? "" : "badge-preparing"}`} style={u.role === "admin" ? { background: "var(--color-primary)", color: "#fff" } : {}}>{u.role}</span>
            {u.id !== admin?.id && <button onClick={() => handleDelete(u.id)} style={{ background: "none", border: "none", color: "var(--color-text-faint)", cursor: "pointer", fontSize: "1.2rem" }}>&times;</button>}
          </div>
        ))}

        <h2 style={{ fontSize: "var(--font-size-base)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "var(--space-xl) 0 var(--space-md)", paddingBottom: "var(--space-sm)", borderBottom: "1px solid var(--color-border)" }}>Ajouter un utilisateur</h2>

        <div className="card" style={{ padding: "var(--space-lg)" }}>
          <Field label="Nom d'utilisateur" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
          <Field label="Nom complet" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Mot de passe" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" />
          <label style={{ display: "block", fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-xs)" }}>Rôle</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={{ marginBottom: "var(--space-md)" }}>
            <option value="magasinier">Magasinier</option>
            <option value="admin">Administrateur</option>
          </select>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleCreate}>Créer le compte</button>
          {msg.text && <p style={{ color: msg.ok ? "var(--color-success)" : "var(--color-danger)", fontSize: "var(--font-size-sm)", marginTop: "var(--space-sm)" }}>{msg.text}</p>}
        </div>
      </main>
    </>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <>
      <label style={{ display: "block", fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-xs)" }}>{label}</label>
      <input className="input" type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{ marginBottom: "var(--space-md)" }} />
    </>
  );
}
