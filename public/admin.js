let orders = [];
let completedOrders = [];
let soundEnabled = false;
let audioCtx = null;

const ordersContainer = document.getElementById("orders-container");
const soundToggle = document.getElementById("sound-toggle");

// ── Sound toggle ──
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.textContent = `Son: ${soundEnabled ? "ON" : "OFF"}`;
  soundToggle.classList.toggle("active", soundEnabled);
  // Init AudioContext on user gesture
  if (soundEnabled && !audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
});

function playNotificationSound() {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 800;
  gain.gain.value = 0.3;
  osc.start();
  osc.frequency.setValueAtTime(800, audioCtx.currentTime);
  osc.frequency.setValueAtTime(1000, audioCtx.currentTime + 0.1);
  osc.frequency.setValueAtTime(800, audioCtx.currentTime + 0.2);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime + 0.25);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
  osc.stop(audioCtx.currentTime + 0.4);
}

// ── Fetch orders ──
async function fetchOrders() {
  try {
    const res = await fetch("/api/admin/orders");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!res.ok) return;
    orders = await res.json();

    // Fetch completed orders too
    const allRes = await fetch("/api/admin/orders/all");
    if (allRes.ok) {
      const all = await allRes.json();
      completedOrders = all.filter((o) => o.status === "picked_up" || o.status === "cancelled");
    }

    renderOrders();
  } catch (err) {
    console.error("Fetch orders failed:", err);
  }
}

// ── Change order status ──
async function changeStatus(orderId, newStatus) {
  try {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) fetchOrders();
  } catch (err) {
    console.error("Status change failed:", err);
  }
}

// ── Render ──
function renderOrders() {
  // Stats
  const pending = orders.filter((o) => o.status === "pending");
  const preparing = orders.filter((o) => o.status === "preparing");
  const ready = orders.filter((o) => o.status === "ready");

  document.getElementById("stat-pending").textContent = pending.length;
  document.getElementById("stat-preparing").textContent = preparing.length;
  document.getElementById("stat-ready").textContent = ready.length;

  const total = pending.length + preparing.length + ready.length;
  document.title = total > 0 ? `(${total}) Dashboard Magasinier` : "Dashboard Magasinier";

  let html = "";

  if (pending.length > 0) {
    html += `<div class="section-title">En attente (${pending.length})</div>`;
    html += pending.map((o) => renderOrderCard(o, [
      { label: "Préparer", cls: "btn-prepare", status: "preparing" },
      { label: "Annuler", cls: "btn-cancel-order", status: "cancelled" },
    ])).join("");
  }

  if (preparing.length > 0) {
    html += `<div class="section-title">En préparation (${preparing.length})</div>`;
    html += preparing.map((o) => renderOrderCard(o, [
      { label: "Prête", cls: "btn-ready", status: "ready" },
      { label: "Annuler", cls: "btn-cancel-order", status: "cancelled" },
    ])).join("");
  }

  if (ready.length > 0) {
    html += `<div class="section-title">Prêtes (${ready.length})</div>`;
    html += ready.map((o) => renderOrderCard(o, [], `<span class="status-badge status-done">Prête</span>`)).join("");
  }

  if (total === 0) {
    html = `<div class="empty-section">Aucune commande en cours</div>`;
  }

  // Completed/cancelled history
  if (completedOrders.length > 0) {
    html += `<div class="section-title" style="margin-top:2.5rem;">Historique du jour</div>`;
    html += completedOrders.map((o) => {
      const statusLabel = o.status === "picked_up" ? "Remise" : "Annulée";
      const statusCls = o.status === "picked_up" ? "status-done" : "status-cancelled";
      return renderOrderCard(o, [], `<span class="status-badge ${statusCls}">${statusLabel}</span>`);
    }).join("");
  }

  ordersContainer.innerHTML = html;

  // Bind action buttons
  ordersContainer.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      changeStatus(btn.dataset.orderId, btn.dataset.action);
    });
  });
}

function renderOrderCard(order, actions, badgeHtml = "") {
  const time = new Date(order.created_at + "Z").toLocaleTimeString("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const items = (order.items || []).map((item) =>
    `<span class="order-item-chip"><span class="qty">x${item.quantity}</span> #${item.article_no} — ${item.description.substring(0, 35)}</span>`
  ).join("");

  const btns = actions.map((a) =>
    `<button class="${a.cls}" data-order-id="${order.id}" data-action="${a.status}">${a.label}</button>`
  ).join("");

  return `
    <div class="order-card">
      <div class="order-header">
        <div class="order-num">#${order.order_number}</div>
        <div class="student-info"><strong>${order.student_name}</strong> (DA: ${order.student_da})</div>
        <div class="order-time">${time}</div>
      </div>
      <div class="order-items">${items}</div>
      <div class="actions">${btns}${badgeHtml}</div>
    </div>
  `;
}

// ── SSE connection ──
fetchOrders();

const evtSource = new EventSource("/api/admin/orders/stream");

evtSource.addEventListener("connected", () => {
  document.body.classList.remove("sse-offline");
});

evtSource.addEventListener("order-new", () => {
  playNotificationSound();
  fetchOrders();
});

evtSource.addEventListener("order-update", () => {
  playNotificationSound();
  fetchOrders();
});

evtSource.onerror = () => {
  document.body.classList.add("sse-offline");
};
