// ── State ──
let searchTimer = null;
let searchController = null;
let cart = []; // { article_no, description, prix, quantity }
let lastOrderNumber = null;
let myOrders = JSON.parse(localStorage.getItem("myOrders") || "[]");
let orderPollTimer = null;
let studentDA = localStorage.getItem("studentDA") || "";
let studentName = localStorage.getItem("studentName") || "";

const resultsEl = document.getElementById("results");
const resultCount = document.getElementById("result-count");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const myOrdersEl = document.getElementById("my-orders");
const daModal = document.getElementById("da-modal");
const userBadge = document.getElementById("user-badge");

// ── DA identification ──
function initDA() {
  if (studentDA && studentName) {
    daModal.classList.remove("open");
    userBadge.textContent = studentName;
    searchInput.focus();
  } else {
    daModal.classList.add("open");
    document.getElementById("da-input").focus();
  }
}

document.getElementById("da-confirm").addEventListener("click", () => {
  const da = document.getElementById("da-input").value.trim();
  const name = document.getElementById("name-input").value.trim();
  if (!da || !name) {
    alert("Veuillez entrer votre DA et votre nom.");
    return;
  }
  studentDA = da;
  studentName = name;
  localStorage.setItem("studentDA", da);
  localStorage.setItem("studentName", name);
  daModal.classList.remove("open");
  userBadge.textContent = name;
  searchInput.focus();
  requestNotifPermission();
  connectSSE();
});

// Allow Enter key in DA modal
document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("da-confirm").click();
});

initDA();
const cartBar = document.getElementById("cart-bar");
const cartItemsEl = document.getElementById("cart-items");
const cartCountEl = document.getElementById("cart-count");
const submitOrderBtn = document.getElementById("submit-order-btn");
const submitModal = document.getElementById("submit-modal");

// ── Live search ──
searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (searchController) searchController.abort();

  if (!query) {
    resultsEl.innerHTML = "";
    resultCount.style.display = "none";
    emptyState.style.display = "";
    return;
  }

  searchTimer = setTimeout(() => liveSearch(query), 120);
});

async function liveSearch(query) {
  searchController = new AbortController();
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: searchController.signal,
    });
    if (!res.ok) return;
    const results = await res.json();
    displayResults(results);
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
}

// ── UI helpers ──
function displayResults(items) {
  resultsEl.innerHTML = "";
  emptyState.style.display = "none";

  if (!items.length) {
    resultCount.style.display = "block";
    resultCount.textContent = "Aucun article trouvé";
    return;
  }

  resultCount.style.display = "block";
  resultCount.textContent = `${items.length} résultat${items.length > 1 ? "s" : ""}`;

  items.forEach((item) => {
    const dispo = parseInt(item["Disponible"]) || 0;
    const articleNo = item["No d'article"];
    const inCart = cart.find((c) => c.article_no === articleNo);
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="card-header">
        <div class="article-no">#${articleNo}</div>
        ${dispo > 0 ? `
          <button class="add-btn ${inCart ? "added" : ""}" data-article="${articleNo}" data-desc="${item["Description"]}" data-prix="${item["Prix"]}" data-loc="${item["Localisation"] || ""}">
            ${inCart ? "Ajouté" : "+ Ajouter"}
          </button>
        ` : ""}
      </div>
      <div class="description">${item["Description"]}</div>
      <div class="meta">
        <span>Qté: <strong>${item["Quantité"]}</strong></span>
        <span class="${dispo === 0 ? "out-of-stock" : ""}">Dispo: <strong>${item["Disponible"]}</strong></span>
        <span>Prix: <strong>${item["Prix"]}$</strong></span>
        ${item["Localisation"] ? `<span>Loc: <strong>${item["Localisation"]}</strong></span>` : ""}
        ${item["État"] ? `<span>État: <strong>${item["État"]}</strong></span>` : ""}
        ${item["Fournisseur"] ? `<span>Fourn: <strong>${item["Fournisseur"]}</strong></span>` : ""}
      </div>
    `;
    resultsEl.appendChild(card);
  });

  // Add-to-cart buttons
  resultsEl.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const articleNo = btn.dataset.article;
      const desc = btn.dataset.desc;
      const prix = btn.dataset.prix;
      const loc = btn.dataset.loc;
      addToCart(articleNo, desc, prix, loc);
      btn.classList.add("added");
      btn.textContent = "Ajouté";
    });
  });
}

// ── Cart logic ──
function addToCart(articleNo, description, prix, localisation) {
  const existing = cart.find((c) => c.article_no === articleNo);
  if (existing) {
    existing.quantity++;
  } else {
    cart.push({ article_no: articleNo, description, prix, localisation, quantity: 1 });
  }
  renderCart();
}

function removeFromCart(articleNo) {
  cart = cart.filter((c) => c.article_no !== articleNo);
  renderCart();
  // Update add buttons in results
  resultsEl.querySelectorAll(".add-btn").forEach((btn) => {
    if (btn.dataset.article === articleNo) {
      btn.classList.remove("added");
      btn.textContent = "+ Ajouter";
    }
  });
}

function updateCartQty(articleNo, delta) {
  const item = cart.find((c) => c.article_no === articleNo);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(articleNo);
    return;
  }
  renderCart();
}

function renderCart() {
  if (cart.length === 0) {
    cartBar.classList.remove("visible");
    return;
  }

  cartBar.classList.add("visible");

  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);
  cartCountEl.textContent = `${totalItems} article${totalItems > 1 ? "s" : ""}`;

  cartItemsEl.innerHTML = "";
  cart.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "cart-chip";
    chip.innerHTML = `
      <span>#${item.article_no}</span>
      <div class="qty-control">
        <button class="qty-btn" data-article="${item.article_no}" data-delta="-1">-</button>
        <span>${item.quantity}</span>
        <button class="qty-btn" data-article="${item.article_no}" data-delta="1">+</button>
      </div>
      <button class="remove-btn" data-article="${item.article_no}">&times;</button>
    `;
    cartItemsEl.appendChild(chip);
  });

  cartItemsEl.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateCartQty(btn.dataset.article, parseInt(btn.dataset.delta));
    });
  });

  cartItemsEl.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeFromCart(btn.dataset.article);
    });
  });
}

// ── Order tracking ──
const STATUS_LABELS = {
  pending: "En attente",
  preparing: "En pr\u00e9paration",
  ready: "Pr\u00eate!",
};

const STATUS_NOTIF = {
  preparing: "Votre commande est en pr\u00e9paration!",
  ready: "Votre commande est pr\u00eate! Pr\u00e9sentez-vous au comptoir.",
};

function saveMyOrders() {
  localStorage.setItem("myOrders", JSON.stringify(myOrders));
}

// ── Push notification permission ──
function updateNotifUI() {
  const modalBtn = document.getElementById("notif-btn");
  const headerBtn = document.getElementById("notif-header-btn");
  if (!("Notification" in window)) {
    if (modalBtn) { modalBtn.textContent = "Non support\u00e9"; modalBtn.disabled = true; }
    if (headerBtn) headerBtn.style.display = "none";
    return;
  }
  if (Notification.permission === "granted") {
    if (modalBtn) { modalBtn.textContent = "Notifications activ\u00e9es"; modalBtn.style.borderColor = "#22c55e"; modalBtn.style.color = "#22c55e"; modalBtn.disabled = true; }
    if (headerBtn) { headerBtn.textContent = "Notifs activ\u00e9es"; headerBtn.style.display = ""; headerBtn.style.borderColor = "#22c55e"; headerBtn.style.color = "#22c55e"; headerBtn.disabled = true; }
  } else if (Notification.permission === "denied") {
    if (modalBtn) { modalBtn.textContent = "Bloqu\u00e9es"; modalBtn.style.color = "#f87171"; modalBtn.disabled = true; }
    if (headerBtn) { headerBtn.textContent = "Notifs bloqu\u00e9es"; headerBtn.style.display = ""; headerBtn.style.borderColor = "#f87171"; headerBtn.style.color = "#f87171"; headerBtn.title = "Cliquez sur le cadenas dans la barre d'adresse pour d\u00e9bloquer"; }
  } else {
    if (headerBtn) headerBtn.style.display = "";
  }
}

async function askNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    const result = await Notification.requestPermission();
    updateNotifUI();
    if (result === "granted") {
      new Notification("Magasin TGE", { body: "Vous recevrez une notification quand votre commande sera pr\u00eate!" });
    }
  }
}

document.getElementById("notif-btn")?.addEventListener("click", askNotifPermission);
document.getElementById("notif-header-btn")?.addEventListener("click", askNotifPermission);

updateNotifUI();

function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then(updateNotifUI);
  }
}

function sendPushNotif(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

// ── SSE connection ──
let evtSource = null;

function connectSSE() {
  if (!studentDA) return;
  if (evtSource) evtSource.close();

  evtSource = new EventSource(`/api/orders/stream?da=${encodeURIComponent(studentDA)}`);

  evtSource.addEventListener("order-update", (e) => {
    const data = JSON.parse(e.data);
    // Only care about our orders
    if (!myOrders.includes(data.order_number)) return;

    // Push notification
    if (STATUS_NOTIF[data.status]) {
      sendPushNotif(`Commande #${data.order_number}`, STATUS_NOTIF[data.status]);
    }

    // Refresh order display
    refreshMyOrders();
  });

  evtSource.addEventListener("order-new", () => {
    // Another student's order — ignore for student view
  });

  evtSource.onerror = () => {
    // Reconnect handled automatically by EventSource
  };
}

async function refreshMyOrders() {
  if (myOrders.length === 0) {
    myOrdersEl.classList.remove("visible");
    return;
  }

  let html = "";
  const stillActive = [];

  for (const num of myOrders) {
    try {
      const res = await fetch(`/api/orders/${num}`);
      if (!res.ok) continue;
      const order = await res.json();
      if (!order) continue;

      if (order.status === "picked_up" || order.status === "cancelled") continue;

      stillActive.push(num);
      const items = (order.items || []).map((i) => `${i.quantity}x #${i.article_no}`).join(", ");

      html += `
        <div class="my-order">
          <div class="order-num">#${order.order_number}</div>
          <span class="order-status ${order.status}">${STATUS_LABELS[order.status] || order.status}</span>
          <div class="order-detail">${items}</div>
          ${order.status === "pending" ? `<button class="cancel-link" data-order="${order.order_number}">Annuler</button>` : ""}
        </div>
      `;
    } catch (err) {
      stillActive.push(num);
    }
  }

  myOrders = stillActive;
  saveMyOrders();

  if (html) {
    myOrdersEl.innerHTML = html;
    myOrdersEl.classList.add("visible");

    myOrdersEl.querySelectorAll(".cancel-link").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("\u00cates-vous s\u00fbr de vouloir annuler cette demande?")) return;
        try {
          const res = await fetch(`/api/orders/${btn.dataset.order}`, { method: "DELETE" });
          if (res.ok) {
            myOrders = myOrders.filter((n) => n !== btn.dataset.order);
            saveMyOrders();
            refreshMyOrders();
          } else {
            const data = await res.json();
            alert(data.error || "Impossible d'annuler");
          }
        } catch (err) {
          alert("Erreur lors de l'annulation.");
        }
      });
    });
  } else {
    myOrdersEl.classList.remove("visible");
  }
}

// Init: request notifications, connect SSE, load orders
requestNotifPermission();
refreshMyOrders();
connectSSE();

// ── Order submission ──
submitOrderBtn.addEventListener("click", () => {
  const modalForm = document.getElementById("modal-form");
  const modalConfirmation = document.getElementById("modal-confirmation");
  modalForm.style.display = "";
  modalConfirmation.style.display = "none";

  const summaryEl = document.getElementById("modal-summary");
  summaryEl.innerHTML = `<div style="margin-bottom:0.5rem;color:#cbd5e1;"><strong>${studentName}</strong> (DA: ${studentDA})</div>` +
    cart.map((item) =>
      `<div class="summary-item"><span>#${item.article_no} — ${item.description.substring(0, 40)}</span><span>x${item.quantity}</span></div>`
    ).join("");

  submitModal.classList.add("open");
});

document.getElementById("modal-cancel").addEventListener("click", () => {
  submitModal.classList.remove("open");
});

submitModal.addEventListener("click", (e) => {
  if (e.target === submitModal) submitModal.classList.remove("open");
});

document.getElementById("modal-confirm").addEventListener("click", async () => {
  requestNotifPermission();
  const confirmBtn = document.getElementById("modal-confirm");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Envoi...";

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_da: studentDA,
        student_name: studentName,
        items: cart.map((c) => ({
          article_no: c.article_no,
          description: c.description,
          quantity: c.quantity,
          prix: c.prix,
          localisation: c.localisation,
        })),
      }),
    });

    if (!res.ok) throw new Error("Erreur serveur");
    const data = await res.json();
    lastOrderNumber = data.order_number;
    myOrders.push(data.order_number);
    saveMyOrders();
    refreshMyOrders();

    document.getElementById("modal-form").style.display = "none";
    document.getElementById("modal-confirmation").style.display = "";
    document.getElementById("order-number-display").textContent = `#${data.order_number}`;

    cart = [];
    renderCart();
  } catch (err) {
    alert("Erreur lors de la soumission. R\u00e9essayez.");
    console.error(err);
  }

  confirmBtn.disabled = false;
  confirmBtn.textContent = "Confirmer";
});

document.getElementById("cancel-order-btn").addEventListener("click", async () => {
  if (!lastOrderNumber) return;
  if (!confirm("Êtes-vous sûr de vouloir annuler votre demande?")) return;

  try {
    const res = await fetch(`/api/orders/${lastOrderNumber}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Impossible d'annuler");
      return;
    }
    submitModal.classList.remove("open");
    lastOrderNumber = null;
  } catch (err) {
    alert("Erreur lors de l'annulation.");
  }
});

document.getElementById("close-confirm-btn").addEventListener("click", () => {
  submitModal.classList.remove("open");
});

