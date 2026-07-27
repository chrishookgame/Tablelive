let adminToken = sessionStorage.getItem("admin_token");
let myAccessLevel = sessionStorage.getItem("admin_access_level") || "full"; // "full" si es el admin maestro
let isMasterAdmin = sessionStorage.getItem("admin_is_master") === "1";

const loginEl = document.getElementById("admin-login");
const panelEl = document.getElementById("admin-panel");

document.getElementById("tab-admin-login").addEventListener("click", () => {
  document.getElementById("tab-admin-login").classList.add("selected");
  document.getElementById("tab-staff-login").classList.remove("selected");
  document.getElementById("admin-login-form").classList.remove("hidden");
  document.getElementById("staff-login-form").classList.add("hidden");
});
document.getElementById("tab-staff-login").addEventListener("click", () => {
  document.getElementById("tab-staff-login").classList.add("selected");
  document.getElementById("tab-admin-login").classList.remove("selected");
  document.getElementById("staff-login-form").classList.remove("hidden");
  document.getElementById("admin-login-form").classList.add("hidden");
});

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
    myAccessLevel = "full";
    isMasterAdmin = true;
    sessionStorage.setItem("admin_token", adminToken);
    sessionStorage.setItem("admin_access_level", "full");
    sessionStorage.setItem("admin_is_master", "1");
    showPanel();
  } catch (e) {
    err.textContent = "Error de conexión.";
  }
});

document.getElementById("staff-login-btn").addEventListener("click", async () => {
  const email = document.getElementById("staff-email").value;
  const password = document.getElementById("staff-password").value;
  const err = document.getElementById("admin-login-error");
  try {
    const res = await fetch("/api/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    adminToken = data.token;
    myAccessLevel = data.accessLevel;
    isMasterAdmin = !!data.isMasterAdmin;
    sessionStorage.setItem("admin_token", adminToken);
    sessionStorage.setItem("admin_access_level", myAccessLevel);
    sessionStorage.setItem("admin_is_master", isMasterAdmin ? "1" : "0");
    showPanel();
  } catch (e) {
    err.textContent = "Error de conexión.";
  }
});

document.getElementById("refresh-btn").addEventListener("click", loadEverything);

document.getElementById("announce-btn").addEventListener("click", async () => {
  const input = document.getElementById("announce-text");
  const msg = document.getElementById("announce-msg");
  const text = input.value.trim();
  if (!text) return;
  const res = await adminFetch("/api/admin/announce", { method: "POST", body: JSON.stringify({ text }) });
  if (res && res.ok) { msg.textContent = "¡Anuncio enviado a todos los conectados!"; input.value = ""; setTimeout(() => (msg.textContent = ""), 3000); }
});

if (adminToken) showPanel();

function showPanel() {
  loginEl.classList.add("hidden");
  panelEl.classList.remove("hidden");
  // Las acciones más sensibles (cambiar precios, borrar cuentas, anunciar a todos,
  // manejar el personal, pagos automáticos) solo las puede hacer el administrador
  // maestro — ni siquiera el personal con acceso "full" que él mismo asignó.
  applyAccessLevelVisibility();
  loadEverything();
}

function escapeHtml(s) {
  return (s || "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
}

// Wrapper: manda el token de admin, y si vence la sesión vuelve a la pantalla de login.
async function adminFetch(url, options) {
  options = options || {};
  options.headers = Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + adminToken }, options.headers || {});
  try {
    const res = await fetch(url, options);
    if (res.status === 401) {
      sessionStorage.removeItem("admin_token");
      loginEl.classList.remove("hidden");
      panelEl.classList.add("hidden");
      return null;
    }
    return res;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function loadEverything() {
  loadOverview();
  loadStats();
  loadAdminPosts();
  loadAdminSubscriptions();
  loadAdminReports();
  loadSupportMessages();
}

async function loadOverview() {
  const res = await adminFetch("/api/admin/overview");
  if (!res) return;
  const data = await res.json();
  renderMonetization(data.monetizationRequests);
  renderWithdrawals(data.withdrawals);
  renderUsers(data.users);
  renderRooms(data.rooms);
  loadMeetingPlansAdmin();
  if (isMasterAdmin) loadStaffList();
  applyAccessLevelVisibility();
}

// Esconde los botones de acciones que este nivel de acceso no puede usar. Se llama
// después de cada carga porque las tablas se vuelven a armar con innerHTML cada vez.
function applyAccessLevelVisibility() {
  document.querySelectorAll(".master-admin-only").forEach((el) => el.classList.toggle("hidden", !isMasterAdmin));
  document.querySelectorAll(".needs-full").forEach((el) => el.classList.toggle("hidden", myAccessLevel !== "full"));
  document.querySelectorAll(".needs-parcial").forEach((el) => el.classList.toggle("hidden", myAccessLevel === "limitado"));
}

async function loadStaffList() {
  const res = await adminFetch("/api/admin/staff/list");
  if (!res) return;
  const data = await res.json();
  const tbody = document.querySelector("#staff-table tbody");
  if (!data.staff.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Todavía no le asignaste un puesto a nadie.</td></tr>'; return; }
  const levelLabel = { full: "Full", parcial: "Parcial", limitado: "Limitado" };
  tbody.innerHTML = data.staff.map((s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.email)}</td>
      <td>${escapeHtml(s.roleName)}</td>
      <td>${levelLabel[s.accessLevel] || s.accessLevel}</td>
      <td class="user-actions">
        <button class="mini-btn" onclick="removeStaff('${escapeHtml(s.email)}')" style="background:#7a2020;color:#fff;">Quitar puesto</button>
      </td>
    </tr>
  `).join("");
}

document.getElementById("assign-staff-btn").addEventListener("click", async () => {
  const email = document.getElementById("new-staff-email").value.trim();
  const roleName = document.getElementById("new-staff-role-name").value.trim();
  const accessLevel = document.getElementById("new-staff-access-level").value;
  if (!email || !roleName) { alert("Completá el email y el nombre del puesto."); return; }
  const res = await adminFetch("/api/admin/staff/assign", { method: "POST", body: JSON.stringify({ email, roleName, accessLevel }) });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { alert(data.error || "No se pudo asignar."); return; }
  document.getElementById("new-staff-email").value = "";
  document.getElementById("new-staff-role-name").value = "";
  loadStaffList();
});

async function removeStaff(email) {
  if (!confirm("¿Quitarle el acceso al panel a " + email + "?")) return;
  await adminFetch("/api/admin/staff/remove", { method: "POST", body: JSON.stringify({ email }) });
  loadStaffList();
}

async function loadMeetingPlansAdmin() {
  const res = await adminFetch("/api/admin/meeting-plans");
  if (!res) return;
  const data = await res.json();
  const tbody = document.querySelector("#meeting-plans-table tbody");
  const entries = Object.entries(data.plans);
  if (!entries.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No hay planes cargados.</td></tr>'; return; }
  tbody.innerHTML = entries.map(([type, plan]) => `
    <tr>
      <td>${escapeHtml(type)}</td>
      <td><input value="${escapeHtml(plan.label)}" id="plan-label-${cssSafe(type)}" style="width:130px;" /></td>
      <td><input type="number" value="${plan.priceCoins}" id="plan-price-${cssSafe(type)}" style="width:100px;" /></td>
      <td><input type="number" value="${plan.hours}" id="plan-hours-${cssSafe(type)}" style="width:100px;" /></td>
      <td class="user-actions">
        <button class="mini-btn master-admin-only" onclick="saveMeetingPlan('${escapeHtml(type)}')">Guardar</button>
        <button class="mini-btn master-admin-only" onclick="deleteMeetingPlan('${escapeHtml(type)}')" style="background:#7a2020;color:#fff;">Borrar</button>
      </td>
    </tr>
  `).join("");
}

async function saveMeetingPlan(type) {
  const label = document.getElementById("plan-label-" + cssSafe(type)).value;
  const priceCoins = document.getElementById("plan-price-" + cssSafe(type)).value;
  const hours = document.getElementById("plan-hours-" + cssSafe(type)).value;
  await adminFetch("/api/admin/meeting-plans/update", { method: "POST", body: JSON.stringify({ type, label, priceCoins, hours }) });
  loadMeetingPlansAdmin();
}

async function deleteMeetingPlan(type) {
  if (!confirm("¿Borrar el plan '" + type + "'?")) return;
  await adminFetch("/api/admin/meeting-plans/delete", { method: "POST", body: JSON.stringify({ type }) });
  loadMeetingPlansAdmin();
}

document.getElementById("add-meeting-plan-btn").addEventListener("click", async () => {
  const type = document.getElementById("new-plan-type").value.trim();
  const label = document.getElementById("new-plan-label").value.trim();
  const priceCoins = document.getElementById("new-plan-price").value;
  const hours = document.getElementById("new-plan-hours").value;
  if (!type || !label || !priceCoins || !hours) { alert("Completá los 4 campos para agregar un plan nuevo."); return; }
  await adminFetch("/api/admin/meeting-plans/update", { method: "POST", body: JSON.stringify({ type, label, priceCoins, hours }) });
  document.getElementById("new-plan-type").value = "";
  document.getElementById("new-plan-label").value = "";
  document.getElementById("new-plan-price").value = "";
  document.getElementById("new-plan-hours").value = "";
  loadMeetingPlansAdmin();
});

async function loadStats() {
  const res = await adminFetch("/api/admin/stats");
  if (!res) return;
  const s = await res.json();
  const grid = document.getElementById("stats-grid");
  const cards = [
    ["Usuarios totales", s.totalUsers],
    ["Usuarios baneados", s.bannedUsers],
    ["🪙 Monedas en circulación", s.totalCoinsInCirculation],
    ["💎 Diamantes en circulación", s.totalDiamondsInCirculation],
    ["🎁 Regalos enviados", s.totalGiftsSent],
    ["🎁 Valor total regalado", s.totalGiftValue],
    ["🌟 Suscripciones activas", s.activeSubscriptions],
    ["📹 Publicaciones", s.totalPosts],
    ["🔴 Salas activas", s.activeRooms],
    ["💸 Retiros pendientes", s.pendingWithdrawals],
    ["🚩 Denuncias pendientes", s.pendingReports],
    ["💵 Pagado (USD)", "$" + s.paidOutUsd.toFixed(2)],
  ];
  grid.innerHTML = cards.map(([label, num]) => `
    <div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>
  `).join("");
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
      <td>💎 ${w.gemsWithdrawn}</td>
      <td>USD $${w.payoutAmount}</td>
      <td>USD $${w.platformCut}</td>
      <td class="badge-${w.status === 'pagado' ? 'pagado' : (w.status === 'rechazado' ? 'banned' : 'pendiente')}">${w.status}${w.paidAutomatically ? " ⚡" : ""}</td>
      <td>${w.status === "pendiente" ? `
        <button class="mini-btn master-admin-only" onclick="payAutomatic(${i})" style="background:#e0a63e;color:#1c1c1c;">⚡ Pagar automático</button>
        <button class="mini-btn needs-parcial" onclick="markPaid(${i})">Marcar pagado</button>
        <button class="mini-btn needs-parcial" onclick="rejectWithdrawal(${i})">Rechazar</button>
      ` : ""}</td>
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
  await adminFetch("/api/admin/monetization/decision", {
    method: "POST",
    body: JSON.stringify({ email, submittedAt, approve }),
  });
  loadOverview();
}

function renderUsers(list) {
  const tbody = document.querySelector("#users-table tbody");
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Todavía no hay usuarios registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((u) => {
    const giftsBlocked = u.giftsBlockedUntil && u.giftsBlockedUntil > Date.now();
    return `
    <tr>
      <td>${escapeHtml(u.name)}${u.isPlatformOwner ? " ★" : ""}${giftsBlocked ? ' <span title="Regalos bloqueados">🎁🚫</span>' : ""}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>🪙 ${u.coinBalance} · 💎 ${u.diamondBalance}</td>
      <td>${u.followerCount}</td>
      <td class="${u.blocked ? 'badge-banned' : u.suspended ? 'badge-banned' : u.banned ? 'badge-banned' : 'badge-active'}">${u.blocked ? "Bloqueado" : u.suspended ? "Suspendido" : u.banned ? "Baneado" : "Activo"}</td>
      <td class="user-actions">
        <button class="mini-btn" onclick="openUserDetail('${escapeHtml(u.email)}')">⚙️ Gestionar</button>
      </td>
    </tr>
  `;
  }).join("");
}
function cssSafe(email) { return (email || "").replace(/[^a-zA-Z0-9]/g, "_"); }

let currentDetailEmail = null;
async function openUserDetail(email) {
  currentDetailEmail = email;
  const modal = document.getElementById("user-detail-modal");
  modal.classList.remove("hidden");
  document.getElementById("user-detail-body").innerHTML = '<p class="empty-msg">Cargando...</p>';
  const res = await adminFetch("/api/admin/user/" + encodeURIComponent(email) + "/detail");
  if (!res) return;
  const u = await res.json();
  const giftsBlocked = u.giftsBlockedUntil && u.giftsBlockedUntil > Date.now();
  const giftsMinsLeft = giftsBlocked ? Math.ceil((u.giftsBlockedUntil - Date.now()) / 60000) : 0;
  document.getElementById("user-detail-body").innerHTML = `
    <h3 style="margin-bottom:2px;">${escapeHtml(u.name)}${u.isPlatformOwner ? " ★ Dueño de la plataforma" : ""}</h3>
    <p style="font-size:12px;color:#9fc9b8;margin-top:0;">${escapeHtml(u.email)} · registrado el ${new Date(u.createdAt).toLocaleDateString()}</p>

    <div class="detail-grid">
      <div><b>Nombre legal</b><br>${escapeHtml(u.legalName || "—")}</div>
      <div><b>Teléfono</b><br>${escapeHtml(u.phone || "—")}</div>
      <div><b>País</b><br>${escapeHtml(u.country || "—")}</div>
      <div><b>Email verificado</b><br>${u.emailVerified ? "✅ Sí" : "❌ No"}</div>
      <div><b>Seguidores</b><br>${u.followerCount}</div>
      <div><b>Siguiendo</b><br>${u.followingCount}</div>
      <div><b>Monetización</b><br>${escapeHtml(u.monetizationStatus)}</div>
      <div><b>Puesto de personal</b><br>${u.staffRole ? escapeHtml(u.staffRole.roleName) + " (" + u.staffRole.accessLevel + ")" : "—"}</div>
    </div>

    <p class="settings-label" style="margin-top:14px;">Datos de pago</p>
    <div class="detail-grid">
      <div><b>Email de PayPal</b><br>${escapeHtml(u.paypalEmail || "—")}</div>
      <div><b>Banco</b><br>${escapeHtml(u.bankName || "—")}</div>
      <div><b>Cuenta</b><br>${escapeHtml(u.bankAccountNumber || "—")}</div>
      <div><b>Titular</b><br>${escapeHtml(u.bankAccountHolder || "—")}</div>
    </div>

    <p class="settings-label master-admin-only" style="margin-top:14px;">Saldo</p>
    <div class="master-admin-only" style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">
      <input type="number" placeholder="🪙 ${u.coinBalance}" id="detail-coin" style="width:auto;flex:1;" />
      <input type="number" placeholder="💎 ${u.diamondBalance}" id="detail-diamond" style="width:auto;flex:1;" />
      <button class="mini-btn" style="width:auto;" onclick="adjustBalanceDetail('${escapeHtml(u.email)}')">Fijar</button>
    </div>

    <p class="settings-label needs-full" style="margin-top:14px;">🎁 Bloquear regalos por un tiempo</p>
    <div class="needs-full" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
      <select id="detail-gift-block-mins" style="width:auto;flex:1;">
        <option value="10">10 minutos</option>
        <option value="60">1 hora</option>
        <option value="1440">1 día</option>
        <option value="10080">1 semana</option>
      </select>
      <button class="mini-btn" style="width:auto;background:#8a6d1a;color:#fff;" onclick="blockGiftsDetail('${escapeHtml(u.email)}')">Bloquear</button>
      ${giftsBlocked ? `<button class="mini-btn" style="width:auto;" onclick="blockGiftsDetail('${escapeHtml(u.email)}', true)">Sacar bloqueo</button>` : ""}
    </div>
    ${giftsBlocked ? `<p style="font-size:11px;color:#e0a63e;margin-top:0;">🎁🚫 Bloqueado por ${giftsMinsLeft} minuto${giftsMinsLeft === 1 ? "" : "s"} más.</p>` : ""}

    <p class="settings-label" style="margin-top:14px;">Estado de la cuenta</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
      <button class="mini-btn needs-parcial" onclick="toggleBan('${escapeHtml(u.email)}', ${!u.banned})">${u.banned ? "Desbanear" : "Banear"}</button>
      <button class="mini-btn needs-full" style="background:#8a6d1a;color:#fff;" onclick="toggleSuspend('${escapeHtml(u.email)}', ${!u.suspended})">${u.suspended ? "Reactivar" : "Suspender"}</button>
      <button class="mini-btn needs-full" style="background:#943838;color:#fff;" onclick="toggleBlock('${escapeHtml(u.email)}', ${!u.blocked})">${u.blocked ? "Desbloquear" : "Bloquear"}</button>
      <button class="mini-btn needs-parcial" onclick="verifyEmailAdmin('${escapeHtml(u.email)}')">Verificar email</button>
      <button class="mini-btn master-admin-only" onclick="toggleOwner('${escapeHtml(u.email)}', ${!u.isPlatformOwner})">${u.isPlatformOwner ? "★ Quitar dueño" : "☆ Hacer dueño"}</button>
      <button class="mini-btn needs-full" style="background:#7a2020;color:#fff;" onclick="deleteUserAdmin('${escapeHtml(u.email)}')">Borrar cuenta</button>
    </div>
  `;
  applyAccessLevelVisibility();
}
document.getElementById("close-user-detail-modal").addEventListener("click", () => {
  document.getElementById("user-detail-modal").classList.add("hidden");
});

async function adjustBalanceDetail(email) {
  const coinInput = document.getElementById("detail-coin");
  const diamondInput = document.getElementById("detail-diamond");
  const body = { email };
  if (coinInput.value !== "") body.coinBalance = parseInt(coinInput.value, 10);
  if (diamondInput.value !== "") body.diamondBalance = parseInt(diamondInput.value, 10);
  await adminFetch("/api/admin/user/adjust-balance", { method: "POST", body: JSON.stringify(body) });
  openUserDetail(email);
  loadOverview();
}

async function blockGiftsDetail(email, clear) {
  const minutes = clear ? 0 : document.getElementById("detail-gift-block-mins").value;
  await adminFetch("/api/admin/user/block-gifts", { method: "POST", body: JSON.stringify({ email, minutes }) });
  openUserDetail(email);
  loadOverview();
}

async function toggleOwner(email, isPlatformOwner) {
  await adminFetch("/api/admin/user/set-owner", { method: "POST", body: JSON.stringify({ email, isPlatformOwner }) });
  if (currentDetailEmail === email) openUserDetail(email);
  loadOverview();
}

async function toggleBan(email, banned) {
  if (banned && !confirm("¿Seguro que querés banear a " + email + "? No va a poder iniciar sesión.")) return;
  await adminFetch("/api/admin/user/ban", { method: "POST", body: JSON.stringify({ email, banned }) });
  if (currentDetailEmail === email) openUserDetail(email);
  loadOverview();
}

// Suspender: pensado para algo temporal, fácil de revertir (ej: mientras se revisa una denuncia)
async function toggleSuspend(email, suspended) {
  if (suspended && !confirm("¿Suspender temporalmente a " + email + "? No va a poder iniciar sesión hasta que lo reactives.")) return;
  await adminFetch("/api/admin/user/suspend", { method: "POST", body: JSON.stringify({ email, suspended }) });
  if (currentDetailEmail === email) openUserDetail(email);
  loadOverview();
}

// Bloquear: más definitivo que suspender, para casos graves
async function toggleBlock(email, blocked) {
  if (blocked && !confirm("¿Bloquear a " + email + "? Es más definitivo que suspender, pensalo para casos graves.")) return;
  await adminFetch("/api/admin/user/block", { method: "POST", body: JSON.stringify({ email, blocked }) });
  if (currentDetailEmail === email) openUserDetail(email);
  loadOverview();
}

async function verifyEmailAdmin(email) {
  await adminFetch("/api/admin/user/verify-email", { method: "POST", body: JSON.stringify({ email }) });
  if (currentDetailEmail === email) openUserDetail(email);
  loadOverview();
}

async function deleteUserAdmin(email) {
  if (!confirm("¿Seguro que querés BORRAR la cuenta de " + email + "? Esto no se puede deshacer.")) return;
  await adminFetch("/api/admin/user/delete", { method: "POST", body: JSON.stringify({ email }) });
  document.getElementById("user-detail-modal").classList.add("hidden");
  loadOverview();
}

function renderRooms(list) {
  const tbody = document.querySelector("#rooms-table tbody");
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No hay salas activas en este momento.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((r) => `
    <tr>
      <td>${escapeHtml(r.code)}</td>
      <td>${r.capacity}</td>
      <td>${r.players.map(escapeHtml).join(", ") || "—"}</td>
      <td>${r.spectatorCount}</td>
      <td>${r.finished ? "Terminada" : (r.started ? "Jugando" : "Esperando jugadores")}</td>
      <td><button class="mini-btn" onclick="endRoom('${escapeHtml(r.code)}')" style="background:#7a2020;color:#fff;">Cerrar sala</button></td>
    </tr>
  `).join("");
}

async function endRoom(code) {
  if (!confirm("¿Cerrar la sala " + code + " y sacar a todos ahora mismo?")) return;
  await adminFetch("/api/admin/rooms/end", { method: "POST", body: JSON.stringify({ code }) });
  loadOverview();
}

async function loadAdminPosts() {
  const res = await adminFetch("/api/admin/posts");
  if (!res) return;
  const data = await res.json();
  const tbody = document.querySelector("#posts-table tbody");
  if (!data.posts.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Todavía no hay publicaciones.</td></tr>';
    return;
  }
  tbody.innerHTML = data.posts.map((p) => `
    <tr>
      <td>${fmtDate(p.createdAt)}</td>
      <td>${escapeHtml(p.authorName)}</td>
      <td>${p.type}</td>
      <td>${escapeHtml((p.caption || "").slice(0, 60))}</td>
      <td>${p.likeCount}</td>
      <td>${p.commentCount}</td>
      <td><button class="mini-btn" onclick="deletePostAdmin('${p.id}')" style="background:#7a2020;color:#fff;">Borrar</button></td>
    </tr>
  `).join("");
}

async function deletePostAdmin(id) {
  if (!confirm("¿Borrar esta publicación para siempre?")) return;
  await adminFetch("/api/admin/posts/delete", { method: "POST", body: JSON.stringify({ id }) });
  loadAdminPosts();
}

async function loadAdminSubscriptions() {
  const res = await adminFetch("/api/admin/subscriptions");
  if (!res) return;
  const data = await res.json();
  const tbody = document.querySelector("#subscriptions-table tbody");
  if (!data.subscriptions.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No hay suscripciones activas.</td></tr>';
    return;
  }
  tbody.innerHTML = data.subscriptions.map((s) => `
    <tr>
      <td>${escapeHtml(s.subscriberName)}</td>
      <td>${escapeHtml(s.creatorName)}</td>
      <td>${escapeHtml(s.tier)}</td>
      <td>${fmtDate(s.expiresAt)}</td>
      <td><button class="mini-btn" onclick="cancelSubAdmin('${s.id}')">Cancelar</button></td>
    </tr>
  `).join("");
}

async function cancelSubAdmin(id) {
  await adminFetch("/api/admin/subscriptions/cancel", { method: "POST", body: JSON.stringify({ id }) });
  loadAdminSubscriptions();
}

async function markPaid(index) {
  await adminFetch("/api/admin/mark-paid", { method: "POST", body: JSON.stringify({ index }) });
  loadOverview();
}

async function rejectWithdrawal(index) {
  if (!confirm("¿Rechazar este retiro? Los diamantes vuelven a la cuenta del usuario.")) return;
  await adminFetch("/api/admin/reject-withdrawal", { method: "POST", body: JSON.stringify({ index }) });
  loadOverview();
}

async function payAutomatic(index) {
  if (!confirm("Esto le manda plata DE VERDAD por PayPal ahora mismo. ¿Confirmás?")) return;
  const res = await adminFetch("/api/admin/pay-withdrawal-automatic", { method: "POST", body: JSON.stringify({ index }) });
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { alert("No se pudo pagar: " + data.error); return; }
  alert("¡Listo! PayPal aceptó el pago (lote " + data.batchId + ").");
  loadOverview();
}

async function loadSupportMessages() {
  const res = await adminFetch("/api/admin/support");
  if (!res) return;
  const data = await res.json();
  const tbody = document.querySelector("#support-table tbody");
  if (!data.messages.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No hay mensajes de soporte todavía.</td></tr>';
    return;
  }
  tbody.innerHTML = data.messages.map((m) => {
    const repliesHtml = (m.replies || []).map((r) =>
      `<div style="margin-top:6px;padding:6px 8px;border-radius:6px;background:${r.from === 'admin' ? 'rgba(224,166,62,0.12)' : 'rgba(255,255,255,0.05)'};">
        <b style="font-size:11px;color:${r.from === 'admin' ? '#e0a63e' : '#9fc9b8'};">${r.from === 'admin' ? '🛡️ ' + escapeHtml(r.byName) : escapeHtml(r.byName)}</b>
        <p style="margin:2px 0 0;white-space:pre-wrap;">${escapeHtml(r.text)}</p>
      </div>`
    ).join("");
    return `
    <tr>
      <td>${fmtDate(m.createdAt)}</td>
      <td>${escapeHtml(m.name)}<br><span style="font-size:11px;color:#9fc9b8;">${escapeHtml(m.email)}</span></td>
      <td>${escapeHtml(m.subject)}</td>
      <td style="max-width:320px;white-space:pre-wrap;">
        ${escapeHtml(m.message)}
        ${repliesHtml}
        <div style="margin-top:8px;display:flex;gap:4px;">
          <input type="text" placeholder="Escribir respuesta..." id="reply-input-${m.id}" style="flex:1;margin:0;font-size:11px;" />
          <button class="mini-btn" style="width:auto;" onclick="replySupport('${m.id}')">Responder</button>
        </div>
      </td>
      <td class="badge-${m.status === 'resuelto' ? 'pagado' : 'pendiente'}">${m.status}</td>
      <td>
        <button class="mini-btn" onclick="resolveSupport('${m.id}','${m.status === 'resuelto' ? 'abierto' : 'resuelto'}')">${m.status === 'resuelto' ? 'Reabrir' : 'Marcar resuelto'}</button>
      </td>
    </tr>
  `;
  }).join("");
}

async function replySupport(id) {
  const input = document.getElementById("reply-input-" + id);
  const text = input.value.trim();
  if (!text) return;
  await adminFetch("/api/admin/support/reply", { method: "POST", body: JSON.stringify({ id, text }) });
  loadSupportMessages();
}

async function resolveSupport(id, status) {
  await adminFetch("/api/admin/support/resolve", { method: "POST", body: JSON.stringify({ id, status }) });
  loadSupportMessages();
}

async function loadAdminReports() {
  const res = await adminFetch("/api/admin/reports");
  if (!res) return;
  const data = await res.json();
  const tbody = document.querySelector("#reports-table tbody");
  if (!data.reports.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No hay denuncias todavía.</td></tr>';
    return;
  }
  tbody.innerHTML = data.reports.map((r) => `
    <tr>
      <td>${fmtDate(r.createdAt)}</td>
      <td>${r.type === "post" ? "Publicación" : "Usuario"}</td>
      <td>${escapeHtml(r.reason)}</td>
      <td>${escapeHtml((r.details || "").slice(0, 60))}</td>
      <td>${escapeHtml(r.reporterName)}</td>
      <td class="badge-${r.status === 'resuelta' ? 'pagado' : (r.status === 'descartada' ? 'banned' : 'pendiente')}">${r.status}</td>
      <td>${r.status === "pendiente" ? `
        <button class="mini-btn" onclick="resolveReport('${r.id}','resuelta')">Resolver</button>
        <button class="mini-btn" onclick="resolveReport('${r.id}','descartada')">Descartar</button>
      ` : ""}</td>
    </tr>
  `).join("");
}

async function resolveReport(id, status) {
  await adminFetch("/api/admin/reports/resolve", { method: "POST", body: JSON.stringify({ id, status }) });
  loadAdminReports();
  loadStats();
}
