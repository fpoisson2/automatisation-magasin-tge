// Shared admin navigation — loaded by all admin pages
(async function () {
  // Detect current page
  const path = window.location.pathname;

  // Get user info
  let me = { role: "magasinier" };
  try {
    const res = await fetch("/api/admin/me");
    if (res.status === 401) { window.location.href = "/login"; return; }
    if (res.ok) me = await res.json();
  } catch {}

  const links = [
    { href: "/admin", label: "Commandes" },
    { href: "/admin/stats", label: "Stats" },
    { href: "/admin/items", label: "Articles" },
    ...(me.role === "admin" ? [{ href: "/admin/users", label: "Utilisateurs" }] : []),
    { href: "/", label: "Inventaire" },
  ];

  const header = document.querySelector("header");
  if (!header) return;

  // Build nav links
  const nav = links.map((l) => {
    const active = path === l.href;
    return `<a href="${l.href}" style="${active ? "color:#fff;font-weight:600;" : ""}">${l.label}</a>`;
  }).join("");

  header.innerHTML = `
    <h1 style="font-size:var(--font-size-lg);font-weight:700;">${header.dataset.title || "Admin"}</h1>
    <div style="flex:1;"></div>
    ${nav}
    <button id="admin-logout" style="padding:0.25rem 0.7rem;border:1px solid rgba(255,255,255,0.2);border-radius:var(--radius-sm);background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.8);font-size:0.75rem;cursor:pointer;">D\u00e9connexion</button>
  `;

  document.getElementById("admin-logout").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });
})();
