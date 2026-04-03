// ── PWA ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ── State ──
let searchTimer = null;
let searchController = null;
let cart = JSON.parse(localStorage.getItem("cart") || "[]");
let lastOrderNumber = null;
let orderPollTimer = null;
let studentDA = localStorage.getItem("studentDA") || "";
let studentName = localStorage.getItem("studentName") || "";
let frequentArticles = new Map(); // article_no -> total_qty

const resultsEl = document.getElementById("results");
const resultCount = document.getElementById("result-count");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const myOrdersEl = document.getElementById("my-orders");
const myHistoryEl = document.getElementById("my-history");
const historyModal = document.getElementById("history-modal");
const historyBtn = document.getElementById("history-btn");
const daModal = document.getElementById("da-modal");
const userBadge = document.getElementById("user-badge");

// ── DA identification ──
function initDA() {
  if (studentDA && studentName) {
    daModal.classList.remove("open");
    userBadge.textContent = studentName;
    searchInput.focus();
    loadFrequentArticles();
  } else {
    daModal.classList.add("open");
    document.getElementById("da-input").focus();
  }
}

// Auto-fill name when DA is typed
document.getElementById("da-input").addEventListener("blur", async () => {
  const da = document.getElementById("da-input").value.trim();
  if (!da) return;
  try {
    const res = await fetch(`/api/students/${encodeURIComponent(da)}`);
    if (res.ok) {
      const student = await res.json();
      const nameInput = document.getElementById("name-input");
      if (!nameInput.value.trim()) nameInput.value = student.name;
    }
  } catch {}
});

document.getElementById("da-confirm").addEventListener("click", async () => {
  const da = document.getElementById("da-input").value.trim();
  const name = document.getElementById("name-input").value.trim();
  if (!da || !name) {
    alert("Veuillez entrer votre DA et votre nom.");
    return;
  }
  // Save to DB
  await fetch("/api/students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ da, name }),
  });
  studentDA = da;
  studentName = name;
  localStorage.setItem("studentDA", da);
  localStorage.setItem("studentName", name);
  daModal.classList.remove("open");
  userBadge.textContent = name;
  searchInput.focus();
  requestNotifPermission();
  connectSSE();
  refreshMyOrders();
  loadFrequentArticles();
});

// Allow Enter key in DA modal
document.getElementById("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("da-confirm").click();
});

initDA();

// ── Student logout ──
const logoutBtn = document.getElementById("student-logout");
if (studentDA) logoutBtn.style.display = "";
logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("studentDA");
  localStorage.removeItem("studentName");
  localStorage.removeItem("cart");
  window.location.reload();
});

// ── History modal ──
historyBtn.addEventListener("click", () => {
  historyModal.classList.add("open");
});
document.getElementById("history-close").addEventListener("click", () => {
  historyModal.classList.remove("open");
});
historyModal.addEventListener("click", (e) => {
  if (e.target === historyModal) historyModal.classList.remove("open");
});

let historySearchTimer = null;
document.getElementById("history-search").addEventListener("input", (e) => {
  if (historySearchTimer) clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    historySearch = e.target.value.trim();
    refreshMyOrders();
  }, 300);
});

const cartFab = document.getElementById("cart-fab");
const cartBadge = document.getElementById("cart-badge");
const cartItemsEl = document.getElementById("cart-items");
const cartModal = document.getElementById("cart-modal");
const submitOrderBtn = document.getElementById("submit-order-btn");
const submitModal = document.getElementById("submit-modal");

// ── Frequent articles ──
let frequentRows = [];

async function loadFrequentArticles() {
  if (!studentDA) return;
  try {
    const res = await fetch(`/api/students/${encodeURIComponent(studentDA)}/frequent`);
    if (!res.ok) return;
    frequentRows = await res.json();
    frequentArticles = new Map(frequentRows.map((r) => [r.article_no, r.total_qty]));
    showSuggestionsIfIdle();
  } catch {}
}

// ── Photo search ──
const photoBtn = document.getElementById("photo-search-btn");
const photoInput = document.getElementById("photo-input");
const photoStatus = document.getElementById("photo-status");

photoBtn.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;
  photoInput.value = "";

  photoStatus.textContent = "Identification en cours...";
  photoStatus.classList.add("visible");
  emptyState.style.display = "none";

  try {
    const formData = new FormData();
    formData.append("photo", file);

    const res = await fetch("/api/search/photo", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Erreur");

    const data = await res.json();
    photoStatus.textContent = `Recherche : "${data.keywords}"`;
    searchInput.value = data.keywords;
    displayResults(data.results);
    resultCount.style.display = "block";
    resultCount.textContent = `${data.results.length} r\u00e9sultat${data.results.length > 1 ? "s" : ""} pour "${data.keywords}"`;

    setTimeout(() => { photoStatus.classList.remove("visible"); }, 3000);
  } catch (err) {
    photoStatus.textContent = "Erreur d'identification.";
    setTimeout(() => { photoStatus.classList.remove("visible"); }, 3000);
    console.error(err);
  }
});

function showSuggestionsIfIdle() {
  if (searchInput.value.trim()) return;
  if (frequentRows.length === 0) {
    emptyState.style.display = "";
    return;
  }
  emptyState.style.display = "none";
  resultCount.style.display = "block";
  resultCount.textContent = "Vous avez r\u00e9cemment emprunt\u00e9 :";
  resultCount.dataset.custom = "1";
  const items = frequentRows.filter((r) => r.item).map((r) => r.item);
  displayResults(items);
}

// ── Live search ──
const searchClear = document.getElementById("search-clear");

function updateClearBtn() {
  searchClear.classList.toggle("visible", searchInput.value.length > 0);
}

searchInput.addEventListener("input", () => {
  updateClearBtn();
  const query = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (searchController) searchController.abort();

  if (!query) {
    resultsEl.innerHTML = "";
    resultCount.style.display = "none";
    showSuggestionsIfIdle();
    return;
  }

  searchTimer = setTimeout(() => liveSearch(query), 120);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  updateClearBtn();
  resultsEl.innerHTML = "";
  resultCount.style.display = "none";
  showSuggestionsIfIdle();
  searchInput.focus();
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
    let results = await res.json();
    // Boost frequently ordered items to top, keep original order for the rest
    if (frequentArticles.size > 0) {
      const freq = results.filter((r) => frequentArticles.has(r["No d'article"]));
      const rest = results.filter((r) => !frequentArticles.has(r["No d'article"]));
      freq.sort((a, b) => (frequentArticles.get(b["No d'article"]) || 0) - (frequentArticles.get(a["No d'article"]) || 0));
      results = [...freq, ...rest];
    }
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
  if (!resultCount.dataset.custom) {
    resultCount.textContent = `${items.length} r\u00e9sultat${items.length > 1 ? "s" : ""}`;
  }
  resultCount.dataset.custom = "";

  items.forEach((item) => {
    const dispo = parseInt(item["Disponible"]) || 0;
    const articleNo = item["No d'article"];
    const inCart = cart.find((c) => c.article_no === articleNo);
    const freq = frequentArticles.get(articleNo) || 0;
    const card = document.createElement("div");
    card.className = "item-card";
    card.dataset.article = articleNo;
    card.innerHTML = `
      <div class="card-photo-slot"></div>
      <div class="card-header">
        <div class="article-no">#${articleNo}</div>
        ${dispo > 0 ? `
          <div class="card-qty-control" data-article="${articleNo}" data-desc="${item["Description"]}" data-prix="${item["Prix"]}" data-loc="${item["Localisation"] || ""}">
            ${inCart
              ? `<button class="qty-minus">-</button><span class="qty-val">${inCart.quantity}</span><button class="qty-plus">+</button>`
              : `<button class="add-btn">+</button>`
            }
          </div>
        ` : ""}
      </div>
      <div class="description">${item["Description"]}${freq > 0 ? ` <span style="font-size:0.7rem;color:#888;font-style:italic;">(command\u00e9 ${freq}x)</span>` : ""}</div>
      <div class="meta">
        <span class="${dispo === 0 ? "out-of-stock" : ""}">Dispo: <strong>${dispo}</strong></span>
      </div>
      <div class="card-doc-slot"></div>
    `;
    resultsEl.appendChild(card);

    // Load photo + doc async
    loadItemExtras(articleNo, card);
  });

  // Bind quantity controls
  bindCardQtyControls();
}

function bindCardQtyControls() {
  resultsEl.querySelectorAll(".card-qty-control").forEach((ctrl) => {
    if (ctrl.dataset.bound) return;
    ctrl.dataset.bound = "1";

    ctrl.addEventListener("click", (e) => {
      const articleNo = ctrl.dataset.article;
      const target = e.target;

      if (target.classList.contains("add-btn") || target.classList.contains("qty-plus")) {
        addToCart(articleNo, ctrl.dataset.desc, ctrl.dataset.prix, ctrl.dataset.loc);
      } else if (target.classList.contains("qty-minus")) {
        updateCartQty(articleNo, -1);
      } else {
        return;
      }

      renderCardQty(ctrl, articleNo);
    });
  });
}

function renderCardQty(ctrl, articleNo) {
  const inCart = cart.find((c) => c.article_no === articleNo);
  if (inCart && inCart.quantity > 0) {
    ctrl.innerHTML = `<button class="qty-minus">-</button><span class="qty-val">${inCart.quantity}</span><button class="qty-plus">+</button>`;
  } else {
    ctrl.innerHTML = `<button class="add-btn">+</button>`;
  }
  renderCart();
}

async function loadItemExtras(articleNo, card) {
  try {
    const res = await fetch(`/api/items/${encodeURIComponent(articleNo)}/extras`);
    if (!res.ok) return;
    const extras = await res.json();
    if (extras.photo_path) {
      card.querySelector(".card-photo-slot").innerHTML = `<img class="item-photo" src="${extras.photo_path}" alt="" loading="lazy">`;
    }
    if (extras.doc_url) {
      card.querySelector(".card-doc-slot").innerHTML = `<a class="doc-link" href="${extras.doc_url}" target="_blank" rel="noopener">Documentation</a>`;
    }
  } catch {}
}

// ── Cart FAB + modal (mobile) ──
document.getElementById("cart-fab-btn").addEventListener("click", () => {
  cartModal.classList.add("open");
  renderCart();
});
document.getElementById("cart-modal-close").addEventListener("click", () => {
  cartModal.classList.remove("open");
});
cartModal.addEventListener("click", (e) => {
  if (e.target === cartModal) cartModal.classList.remove("open");
});

// ── Cart sidebar submit (desktop) ──
const cartSidebar = document.getElementById("cart-sidebar");
const cartSidebarItems = document.getElementById("cart-sidebar-items");
const cartSidebarCount = document.getElementById("cart-sidebar-count");

document.getElementById("submit-order-sidebar").addEventListener("click", () => {
  submitOrderBtn.click();
});

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
  // Reset card control back to "+"
  const ctrl = resultsEl.querySelector(`.card-qty-control[data-article="${articleNo}"]`);
  if (ctrl) {
    ctrl.innerHTML = `<button class="add-btn">+</button>`;
    bindCardQtyControls();
  }
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
  localStorage.setItem("cart", JSON.stringify(cart));
  const totalItems = cart.reduce((sum, c) => sum + c.quantity, 0);

  if (cart.length === 0) {
    cartFab.classList.remove("visible");
    cartModal.classList.remove("open");
    cartSidebar.classList.remove("has-items");
    document.querySelector(".page-layout").classList.remove("cart-open");
    cartSidebarItems.innerHTML = "";
    return;
  }

  cartFab.classList.add("visible");
  cartBadge.textContent = totalItems;

  // Sidebar (desktop)
  cartSidebar.classList.add("has-items");
  document.querySelector(".page-layout").classList.add("cart-open");
  cartSidebarCount.textContent = `(${totalItems})`;

  // Render items into both containers
  for (const container of [cartItemsEl, cartSidebarItems]) {
    container.innerHTML = "";
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-no">#${item.article_no}</div>
          <div class="cart-item-desc">${item.description}</div>
        </div>
        <div class="qty-control">
          <button class="qty-btn" data-article="${item.article_no}" data-delta="-1">-</button>
          <span class="qty-val">${item.quantity}</span>
          <button class="qty-btn" data-article="${item.article_no}" data-delta="1">+</button>
        </div>
        <button class="remove-btn" data-article="${item.article_no}">&times;</button>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll(".qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        updateCartQty(btn.dataset.article, parseInt(btn.dataset.delta));
      });
    });

    container.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromCart(btn.dataset.article);
      });
    });
  }
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


// ── Push notification permission ──
function updateNotifUI() {
  const modalBtn = document.getElementById("notif-btn");
  if (!("Notification" in window)) {
    if (modalBtn) { modalBtn.textContent = "Non support\u00e9"; modalBtn.disabled = true; }
    return;
  }
  if (Notification.permission === "granted") {
    if (modalBtn) { modalBtn.textContent = "Notifications activ\u00e9es"; modalBtn.style.borderColor = "#2e7d32"; modalBtn.style.color = "#2e7d32"; modalBtn.disabled = true; }
  } else if (Notification.permission === "denied") {
    if (modalBtn) { modalBtn.textContent = "Bloqu\u00e9es"; modalBtn.style.color = "#c62828"; modalBtn.disabled = true; }
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

  evtSource.addEventListener("connected", () => {
    document.body.classList.remove("sse-offline");
  });

  evtSource.addEventListener("order-update", (e) => {
    const data = JSON.parse(e.data);
    if (data.student_da !== studentDA) return;
    if (STATUS_NOTIF[data.status]) {
      sendPushNotif(`Commande #${data.order_number}`, STATUS_NOTIF[data.status]);
    }
    refreshMyOrders();
  });

  evtSource.onerror = () => {
    document.body.classList.add("sse-offline");
  };
}

function renderMyOrderCard(order, statusText, statusCls, faded) {
  const summary = (order.items || []).map((i) => `${i.quantity}x #${i.article_no}`).join(", ");
  const detail = (order.items || []).map((i) =>
    `<div class="order-item-row">
      <span class="order-item-qty">x${i.quantity}</span>
      <span class="order-item-no">#${i.article_no}</span>
      <span class="order-item-desc">${(i.description || "").substring(0, 40)}</span>
    </div>`
  ).join("");

  return `
    <div class="my-order ${faded ? "faded" : ""}">
      <div class="my-order-header" data-toggle="${order.order_number}">
        <div class="order-num">#${order.order_number}</div>
        <span class="order-status ${statusCls}">${statusText}</span>
        <div class="order-detail">${summary}</div>
        <span class="expand-arrow">&#9662;</span>
      </div>
      <div class="my-order-items" id="order-detail-${order.order_number}" style="display:none;">
        ${detail}
        <div class="my-order-actions">
          ${order.status === "pending" ? `<button class="cancel-link" data-order="${order.order_number}">Annuler la demande</button>` : ""}
          ${faded ? `<button class="reorder-btn" data-order-id="${order.id}">Recommander</button>` : ""}
        </div>
      </div>
    </div>
  `;
}

let allOrdersCache = [];
let historyOffset = 0;
let historyTotal = 0;
let historySearch = "";

async function refreshMyOrders() {
  if (!studentDA) { myOrdersEl.classList.remove("visible"); return; }
  try {
    const q = historySearch ? `&q=${encodeURIComponent(historySearch)}` : "";
    const res = await fetch(`/api/orders/by-da/${encodeURIComponent(studentDA)}?limit=20&offset=0${q}`);
    if (!res.ok) return;
    const data = await res.json();
    allOrdersCache = data.orders;
    historyTotal = data.total;
    historyOffset = data.orders.length;
    renderOrderLists();
  } catch (err) { console.error("Failed to load orders:", err); }
}

async function loadMoreHistory() {
  const q = historySearch ? `&q=${encodeURIComponent(historySearch)}` : "";
  const res = await fetch(`/api/orders/by-da/${encodeURIComponent(studentDA)}?limit=20&offset=${historyOffset}${q}`);
  if (!res.ok) return;
  const data = await res.json();
  allOrdersCache = [...allOrdersCache, ...data.orders];
  historyOffset += data.orders.length;
  renderOrderLists();
}

function renderOrderLists() {
  const allOrders = allOrdersCache;
  const active = allOrders.filter((o) => o.status !== "picked_up" && o.status !== "cancelled");
  const history = allOrders.filter((o) => o.status === "picked_up" || o.status === "cancelled");

  // Active at top of page
  if (active.length) {
    myOrdersEl.innerHTML = active.map((o) => renderMyOrderCard(o, STATUS_LABELS[o.status] || o.status, o.status, false)).join("");
    myOrdersEl.classList.add("visible");
  } else {
    myOrdersEl.innerHTML = "";
    myOrdersEl.classList.remove("visible");
  }

  // History in modal
  let historyHtml = history.map((o) => {
    const t = o.status === "cancelled" ? "Annul\u00e9e" : "Termin\u00e9e";
    return renderMyOrderCard(o, t, "history", true);
  }).join("");

  if (!historyHtml) historyHtml = `<div style="color:var(--color-text-faint);text-align:center;padding:1rem;">Aucune commande</div>`;
  if (historyOffset < historyTotal) {
    historyHtml += `<button id="load-more-btn" class="btn btn-secondary" style="width:100%;margin-top:var(--space-md);">Voir plus</button>`;
  }
  myHistoryEl.innerHTML = historyHtml;
  historyBtn.style.display = (historyTotal > 0 || active.length > 0) ? "" : "none";

  document.getElementById("load-more-btn")?.addEventListener("click", loadMoreHistory);

  // Bind events
  for (const container of [myOrdersEl, myHistoryEl]) {
    container.querySelectorAll(".cancel-link").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await confirmAction("\u00cates-vous s\u00fbr de vouloir annuler cette demande?")) return;
        try {
          const r = await fetch(`/api/orders/${btn.dataset.order}`, { method: "DELETE" });
          if (r.ok) refreshMyOrders();
          else { const d = await r.json(); alert(d.error || "Impossible d'annuler"); }
        } catch { alert("Erreur."); }
      });
    });

    container.querySelectorAll(".reorder-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const order = allOrders.find((o) => o.id == btn.dataset.orderId);
        if (!order) return;
        for (const item of order.items || []) addToCart(item.article_no, item.description, item.prix, item.localisation);
        renderCart();
        historyModal.classList.remove("open");
        cartModal.classList.add("open");
      });
    });

    container.querySelectorAll("[data-toggle]").forEach((header) => {
      header.addEventListener("click", (e) => {
        if (e.target.closest(".cancel-link") || e.target.closest(".reorder-btn")) return;
        const detail = document.getElementById(`order-detail-${header.dataset.toggle}`);
        const arrow = header.querySelector(".expand-arrow");
        if (detail.style.display === "none") { detail.style.display = ""; arrow.textContent = "\u25b4"; }
        else { detail.style.display = "none"; arrow.textContent = "\u25be"; }
      });
    });
  }
}

// Init: request notifications, connect SSE, load orders, restore cart
requestNotifPermission();
refreshMyOrders();
connectSSE();
if (cart.length > 0) renderCart();

// ── Confirm modal ──
function confirmAction(msg) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-modal");
    document.getElementById("confirm-msg").textContent = msg;
    overlay.classList.add("open");

    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");

    function cleanup() {
      overlay.classList.remove("open");
      yes.replaceWith(yes.cloneNode(true));
      no.replaceWith(no.cloneNode(true));
    }

    document.getElementById("confirm-yes").addEventListener("click", () => { cleanup(); resolve(true); });
    document.getElementById("confirm-no").addEventListener("click", () => { cleanup(); resolve(false); });
  });
}

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

  cartModal.classList.remove("open");
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
    refreshMyOrders();

    document.getElementById("modal-form").style.display = "none";
    document.getElementById("modal-confirmation").style.display = "";
    document.getElementById("order-number-display").textContent = `#${data.order_number}`;

    cart = [];
    renderCart();
    // Reset all card qty controls back to "+"
    resultsEl.querySelectorAll(".card-qty-control").forEach((ctrl) => {
      ctrl.innerHTML = `<button class="add-btn">+</button>`;
    });
    bindCardQtyControls();
  } catch (err) {
    alert("Erreur lors de la soumission. R\u00e9essayez.");
    console.error(err);
  }

  confirmBtn.disabled = false;
  confirmBtn.textContent = "Confirmer";
});

document.getElementById("cancel-order-btn").addEventListener("click", async () => {
  if (!lastOrderNumber) return;
  if (!await confirmAction("\u00cates-vous s\u00fbr de vouloir annuler votre demande?")) return;

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

