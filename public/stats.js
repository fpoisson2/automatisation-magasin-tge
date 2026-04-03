async function loadStats() {
  try {
  const res = await fetch("/api/admin/stats");
  if (res.status === 401) { window.location.href = "/login"; return; }
  if (!res.ok) { document.getElementById("summary").textContent = "Erreur de chargement"; return; }
  const stats = await res.json();

  // Summary cards
  document.getElementById("summary").innerHTML = `
    <div class="stat-big"><div class="num">${stats.totalOrders}</div><div class="label">Commandes</div></div>
    <div class="stat-big"><div class="num">${stats.totalStudents}</div><div class="label">Étudiants</div></div>
    <div class="stat-big"><div class="num">${stats.avgPrepTimeMinutes} min</div><div class="label">Temps moyen</div></div>
  `;

  // Hours chart
  const maxHour = Math.max(...stats.ordersByHour.map((h) => h.count), 1);
  const hoursMap = {};
  stats.ordersByHour.forEach((h) => { hoursMap[parseInt(h.hour)] = h.count; });

  let barsHtml = "";
  let labelsHtml = "";
  for (let h = 0; h < 24; h++) {
    const count = hoursMap[h] || 0;
    const pct = (count / maxHour) * 100;
    barsHtml += `<div class="hour-bar" style="height:${Math.max(pct, 2)}%" title="${h}h: ${count}"></div>`;
    labelsHtml += `<span>${h}</span>`;
  }
  document.getElementById("hours-chart").innerHTML = barsHtml;
  document.getElementById("hours-labels").innerHTML = labelsHtml;

  // Top articles
  const maxQty = stats.topArticles[0]?.total_qty || 1;
  document.getElementById("top-articles").innerHTML = stats.topArticles.map((a) => `
    <tr>
      <td class="article-no">${a.article_no}</td>
      <td>${(a.description || "").substring(0, 40)}</td>
      <td><strong>${a.total_qty}</strong></td>
      <td>${a.order_count}</td>
      <td class="bar-cell"><div class="bar" style="width:${(a.total_qty / maxQty) * 100}%"></div></td>
    </tr>
  `).join("");
  } catch (err) {
    console.error("Stats error:", err);
    document.getElementById("summary").textContent = "Erreur: " + err.message;
  }
}

loadStats();
