const f = (url, opts = {}) =>
  fetch(url, { credentials: "same-origin", ...opts }).then((r) => {
    if (r.status === 401 && !url.includes("/api/admin/me")) {
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }
    return r;
  });

const json = (url, opts) => f(url, opts).then((r) => (r.ok ? r.json() : null));
const post = (url, body) =>
  f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const postForm = (url, formData) =>
  f(url, { method: "POST", body: formData });

// ── Auth ──
export const login = (username, password) => post("/api/login", { username, password });
export const logout = () => f("/api/logout", { method: "POST" });
export const getMe = () => json("/api/admin/me");

// ── Students ──
export const getStudent = (da) => json(`/api/students/${da}`);
export const saveStudent = (da, name) => post("/api/students", { da, name });
export const getFrequent = (da) => json(`/api/students/${da}/frequent`);

// ── Search ──
export const search = (query) => post("/api/search", { query }).then((r) => r.json());
export const searchPhoto = (file) => {
  const fd = new FormData();
  fd.append("photo", file);
  return postForm("/api/search/photo", fd).then((r) => r.json());
};

// ── Orders ──
export const createOrder = (student_da, student_name, items) =>
  post("/api/orders", { student_da, student_name, items }).then((r) => r.json());
export const getOrdersByDA = (da, { limit = 20, offset = 0, q = "" } = {}) =>
  json(`/api/orders/by-da/${da}?limit=${limit}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
export const cancelOrder = (number) => f(`/api/orders/${number}`, { method: "DELETE" });

// ── Admin orders ──
export const getAdminOrders = () => json("/api/admin/orders");
export const getAdminOrdersAll = () => json("/api/admin/orders/all");
export const updateOrderStatus = (id, status) =>
  f(`/api/admin/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });

// ── Admin stats ──
export const getStats = () => json("/api/admin/stats");

// ── Admin users ──
export const getUsers = () => json("/api/admin/users");
export const createUser = (data) => post("/api/admin/users", data);
export const deleteUser = (id) => f(`/api/admin/users/${id}`, { method: "DELETE" });

// ── Item extras ──
export const getItemExtras = (articleNo) => json(`/api/items/${articleNo}/extras`);
export const uploadItemPhoto = (articleNo, file) => {
  const fd = new FormData();
  fd.append("photo", file);
  return postForm(`/api/admin/items/${articleNo}/photo`, fd);
};
export const saveItemDoc = (articleNo, doc_url) =>
  post(`/api/admin/items/${articleNo}/doc`, { doc_url });
export const learnPhoto = (articleNo, file) => {
  const fd = new FormData();
  fd.append("photo", file);
  return postForm(`/api/items/${articleNo}/learn-photo`, fd);
};
