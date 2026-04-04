import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useAdminNotifications } from "../hooks/useAdminNotifications";
import { logout } from "../api";
import { Toasts } from "./Toasts";
import "./AdminNav.css";

export function AdminNav({ title }) {
  const { admin } = useAuth();
  const { soundEnabled, toggleSound, connected, pendingCount } = useAdminNotifications();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <>
      <header className="admin-header">
        <h1>{title}</h1>
        <div className="spacer" />

        <button className={`nav-btn ${soundEnabled ? "active" : ""}`} onClick={toggleSound}>
          {soundEnabled ? "🔔" : "🔕"}
        </button>

        <NavLink to="/admin" className="nav-link">
          Commandes
          {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
        </NavLink>
        <NavLink to="/admin/stats" className="nav-link">Stats</NavLink>
        <NavLink to="/admin/items" className="nav-link">Articles</NavLink>
        {admin?.role === "admin" && <NavLink to="/admin/users" className="nav-link">Utilisateurs</NavLink>}
        <button className="nav-btn" onClick={handleLogout}>Déconnexion</button>
      </header>

      {!connected && <div className="sse-banner">Connexion perdue...</div>}
      <Toasts />
    </>
  );
}
