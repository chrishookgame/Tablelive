let adminToken = sessionStorage.getItem("admin_token");

const loginEl = document.getElementById("admin-login");
const panelEl = document.getElementById("admin-panel");

document.getElementById("admin-login-btn").addEventListener("click", async () => {
  const password = document.getElementById("admin-password").value;
  const err = document.getElementById("admin-login-error");
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    adminToken = data.token;
    sessionStorage.setItem("admin_token", adminToken);
    showPanel();
  } catch (e) {
    err.textContent = "Error de conexión.";
  }
});

document.getElementById("refresh-btn").addEventListener("click", loadOverview);

if (adminToken) showPanel();

function showPanel() {
  loginEl.classList.add("hidden");
  panelEl.classList.remove("hidden");
  loadOverview();
}

function escapeHtml(s) {
  return (s || "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
}

async function loadOverview() {
  try {
    const res = await fetch("/api/admin/overview", { headers: { Authorization: "Bearer " + adminToken } });
    if (res.status === 401) {
      sessionStorage.removeItem("admin_token");
      loginEl.classList.remove("hidden");
      panelEl.classList.add("hidden");
      return;
    }
    const data = await res.json();
    renderMonetization(data.monetizationRequests);
    renderWithdrawals(data.withdrawals);
    renderUsers(data.users);
    renderRooms(data.rooms);
  } catch (e) {
    console.error(e);
  }
}

function renderWithdrawals(list) {
  const tbody = document.querySelector("#withdrawals-table tbody");
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">Todavía no hay pedidos de retiro.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((w, i) => `
    <tr>
      <td>${fmtDate(w.requestedAt)}</td>
      <td>${escapeHtml(w.name)}</td>
      <td>${escapeHtml(w.paypalEmail)}</td>
      <td>${w.gemsWithdrawn}</td>
      <td>USD $${w.payoutAmount}</td>
      <td>USD $${w.platformCut}</td>
      <td class="badge-${w.status}">${w.status}</td>
      <td>${w.status === "pendiente" ? `<button class="mini-btn" onclick="markPaid(${i})">Marcar pagado</button>` : ""}</td>
    </tr>
  `).join("");
}

function renderMonetization(list) {
  const tbody = document.querySelector("#monetization-table tbody");
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Todavía no hay solicitudes de monetización.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((r) => `
    <tr>
      <td>${fmtDate(r.submittedAt)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.legalName)}</td>
      <td>${r.followerCountAtApply}</td>
      <td><a href="/api/admin/kyc-document/${encodeURIComponent(r.documentFile)}?t=${adminToken}" target="_blank" style="color:#e0a63e;">Ver documento</a></td>
      <td class="badge-${r.status === 'aprobado' ? 'pagado' : 'pendiente'}">${r.status}</td>
      <td>${r.status === "pendiente" ? `
        <button class="mini-btn" onclick="decideMonetization('${escapeHtml(r.email)}','${r.submittedAt}',true)">Aprobar</button>
        <button class="mini-btn" onclick="decideMonetization('${escapeHtml(r.email)}','${r.submittedAt}',false)">Rechazar</button>
      ` : ""}</td>
    </tr>
  `).join("");
}

async function decideMonetization(email, submittedAt, approve) {
  await fetch("/api/admin/monetization/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
    body: JSON.stringify({ email, submittedAt, approve }),
  });
  loadOverview();
}

function renderUsers(list) {
  const tbody = document.querySelector("#users-table tbody");
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Todavía no hay usuarios registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((u) => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.paypalEmail)}</td>
      <td>💎 ${u.balance}</td>
      <td>${u.followerCount}</td>
      <td>${u.monetizationStatus}</td>
      <td>${fmtDate(u.createdAt)}</td>
    </tr>
  `).join("");
}

function renderRooms(list) {
  const tbody = document.querySelector("#rooms-table tbody");
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No hay salas activas en este momento.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((r) => `
    <tr>
      <td>${escapeHtml(r.code)}</td>
      <td>${r.capacity}</td>
      <td>${r.players.map(escapeHtml).join(", ") || "—"}</td>
      <td>${r.spectatorCount}</td>
      <td>${r.finished ? "Terminada" : (r.started ? "Jugando" : "Esperando jugadores")}</td>
    </tr>
  `).join("");
}

async function markPaid(index) {
  await fetch("/api/admin/mark-paid", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + adminToken },
    body: JSON.stringify({ index }),
  });
  loadOverview();
}
