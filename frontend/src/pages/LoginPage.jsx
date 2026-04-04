import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await login(username, password);
      if (res.ok) navigate("/admin");
      else setError("Identifiants invalides.");
    } catch {
      setError("Erreur de connexion.");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <form onSubmit={handleSubmit} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", padding: "2rem", width: "90%", maxWidth: 340 }}>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.2rem" }}>Magasin TGE</h1>
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.8rem", marginBottom: "1.5rem" }}>Administration</p>

        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: "0.25rem" }}>Utilisateur</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus style={{ marginBottom: "0.85rem" }} />

        <label style={{ display: "block", fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: "0.25rem" }}>Mot de passe</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: "0.85rem" }} />

        <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%", background: "var(--color-primary)" }}>
          {loading ? "Connexion..." : "Connexion"}
        </button>
        {error && <p style={{ color: "var(--color-danger)", fontSize: "0.8rem", marginTop: "0.75rem" }}>{error}</p>}
      </form>
    </div>
  );
}
