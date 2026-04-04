const BASE = process.env.TEST_URL || "http://localhost:3000";
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

async function run() {
  console.log("\n=== API Tests ===\n");

  // Health
  await test("GET /api/health returns 200", async () => {
    const res = await fetch(`${BASE}/api/health`);
    assert(res.ok, `Status ${res.status}`);
    const data = await res.json();
    assert(data.server === "ok");
    assert(data.database === "ok");
    assert(data.inventoryItems > 0, "No inventory");
  });

  // Search
  await test("POST /api/search returns results", async () => {
    const res = await fetch(`${BASE}/api/search`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "arduino" }),
    });
    assert(res.ok);
    const data = await res.json();
    assert(Array.isArray(data), "Not array");
    assert(data.length > 0, "No results");
    assert(data[0]["No d'article"], "Missing article number");
  });

  await test("POST /api/search with empty query returns 400", async () => {
    const res = await fetch(`${BASE}/api/search`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "" }),
    });
    assert(res.status === 400);
  });

  await test("Search filters out-of-stock items", async () => {
    const res = await fetch(`${BASE}/api/search`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "raspberry" }),
    });
    const data = await res.json();
    for (const item of data) {
      assert(parseInt(item["Disponible"]) > 0, `${item["No d'article"]} has 0 dispo`);
    }
  });

  // Students
  await test("POST /api/students validates DA", async () => {
    const res = await fetch(`${BASE}/api/students`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ da: "abc", name: "Test" }),
    });
    assert(res.status === 400);
  });

  await test("POST /api/students creates student", async () => {
    const res = await fetch(`${BASE}/api/students`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ da: "99999", name: "Test API" }),
    });
    assert(res.ok);
  });

  await test("GET /api/students/:da returns student", async () => {
    const res = await fetch(`${BASE}/api/students/99999`);
    assert(res.ok);
    const data = await res.json();
    assert(data.name === "Test API");
  });

  // Orders
  await test("POST /api/orders creates order", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_da: "99999", student_name: "Test", items: [{ article_no: "TEST", description: "Test item", quantity: 1 }] }),
    });
    assert(res.ok);
    const data = await res.json();
    assert(data.order_number, "No order number");
  });

  await test("POST /api/orders validates DA", async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_da: "bad", student_name: "Test", items: [{ article_no: "X", description: "X", quantity: 1 }] }),
    });
    assert(res.status === 400);
  });

  await test("GET /api/orders/by-da/:da returns paginated", async () => {
    const res = await fetch(`${BASE}/api/orders/by-da/99999?limit=5`);
    assert(res.ok);
    const data = await res.json();
    assert(data.orders, "No orders array");
    assert(typeof data.total === "number", "No total");
  });

  // Admin (unauthenticated)
  await test("GET /api/admin/orders returns 401 without auth", async () => {
    const res = await fetch(`${BASE}/api/admin/orders`);
    assert(res.status === 401);
  });

  await test("GET /api/admin/stats returns 401 without auth", async () => {
    const res = await fetch(`${BASE}/api/admin/stats`);
    assert(res.status === 401);
  });

  await test("GET /api/admin/users returns 401/403 without auth", async () => {
    const res = await fetch(`${BASE}/api/admin/users`);
    assert(res.status === 401 || res.status === 403, `Got ${res.status}`);
  });

  // 404
  await test("GET /api/nonexistent returns 404 JSON", async () => {
    const res = await fetch(`${BASE}/api/nonexistent`);
    assert(res.status === 404);
    const data = await res.json();
    assert(data.error);
  });

  // SPA
  await test("GET / returns HTML", async () => {
    const res = await fetch(`${BASE}/`);
    assert(res.ok);
    const text = await res.text();
    assert(text.includes("root"), "No root div");
  });

  await test("GET /admin returns HTML (SPA)", async () => {
    const res = await fetch(`${BASE}/admin`);
    assert(res.ok);
    const text = await res.text();
    assert(text.includes("root"));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
