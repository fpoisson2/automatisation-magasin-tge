import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { logout } from "../api";
import "./AdminNav.css";

export function AdminNav({ title, extra }) {
  const { admin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="admin-header">
      <h1>{title}</h1>
      <div className="spacer" />
      {extra}
      <NavLink to="/admin">Commandes</NavLink>
      <NavLink to="/admin/stats">Stats</NavLink>
      <NavLink to="/admin/items">Articles</NavLink>
      {admin?.role === "admin" && <NavLink to="/admin/users">Utilisateurs</NavLink>}
      <NavLink to="/">Inventaire</NavLink>
      <button className="nav-logout" onClick={handleLogout}>Déconnexion</button>
    </header>
  );
}
