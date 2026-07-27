// ---------------- Pantalla de presentación al entrar ----------------
(function () {
  const splash = document.getElementById("splash-screen");
  if (!splash) return;
  let dismissed = false;
  function hideSplash() {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add("fade-out");
    setTimeout(() => splash.remove(), 650);
  }
  splash.addEventListener("click", hideSplash); // tocarla la salta
  setTimeout(hideSplash, 2800);
})();

// ---------------- Cartel chico de "Reconectando..." (no te saca de la cuenta) ----------------
let connectionBannerTimeout = null;
function showConnectionBanner(text) {
  const el = document.getElementById("connection-banner");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(connectionBannerTimeout);
}
function hideConnectionBanner() {
  const el = document.getElementById("connection-banner");
  if (!el) return;
  clearTimeout(connectionBannerTimeout);
  connectionBannerTimeout = setTimeout(() => el.classList.add("hidden"), 400);
}

let socket = null;
let authToken = localStorage.getItem("domino_token");
let myName = localStorage.getItem("domino_display_name") || "";
let myEmail = "";

// ---------------- PWA: hace que la app se pueda instalar (celular y computadora) ----------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById("install-app-btn");
  if (btn) btn.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById("install-app-btn");
  if (btn) btn.classList.add("hidden");
  showToastSafe("¡TableLive instalado! Ya la tenés como app.");
});
function showToastSafe(text) {
  if (typeof showToast === "function") showToast(text);
}

function initInstallSection() {
  const installBtn = document.getElementById("install-app-btn");
  const iosHint = document.getElementById("install-ios-hint");
  const alreadyHint = document.getElementById("install-already-hint");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  if (isStandalone) {
    alreadyHint.classList.remove("hidden");
  } else if (deferredInstallPrompt) {
    installBtn.classList.remove("hidden");
  } else if (isIOS) {
    iosHint.classList.remove("hidden");
  }
}

document.getElementById("send-support-btn").addEventListener("click", async () => {
  const subject = document.getElementById("support-subject").value.trim();
  const message = document.getElementById("support-message").value.trim();
  const msgEl = document.getElementById("support-msg");
  if (!message) { msgEl.style.color = "#ff8a80"; msgEl.textContent = "Escribí tu mensaje antes de enviarlo."; return; }
  try {
    const res = await fetch("/api/support/send", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ subject, message }),
    });
    const data = await res.json();
    if (!res.ok) { msgEl.style.color = "#ff8a80"; msgEl.textContent = data.error; return; }
    msgEl.style.color = "#8fd4a8";
    msgEl.textContent = "¡Listo! Tu mensaje le llegó al equipo de soporte.";
    document.getElementById("support-subject").value = "";
    document.getElementById("support-message").value = "";
    loadMySupportThreads();
  } catch (e) {
    msgEl.style.color = "#ff8a80";
    msgEl.textContent = "Error de conexión.";
  }
});

async function loadMySupportThreads() {
  const wrap = document.getElementById("my-support-threads");
  if (!wrap) return;
  try {
    const res = await fetch("/api/support/mine", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.messages.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no le escribiste a soporte.</p>'; return; }
    wrap.innerHTML = data.messages.map((m) => {
      const repliesHtml = (m.replies || []).map((r) =>
        `<div class="support-reply-row ${r.from === 'admin' ? 'support-reply-admin' : ''}">
          <b>${r.from === 'admin' ? '🛡️ ' + escapeHtml(r.byName) : 'Vos'}</b>
          <p>${escapeHtml(r.text)}</p>
        </div>`
      ).join("");
      return `<div class="support-thread-card">
        <p class="support-thread-subject">${escapeHtml(m.subject)} <span class="badge-${m.status === 'resuelto' ? 'pagado' : 'pendiente'}" style="font-size:10px;">${m.status}</span></p>
        <p class="support-thread-message">${escapeHtml(m.message)}</p>
        ${repliesHtml}
        <div style="display:flex;gap:4px;margin-top:8px;">
          <input type="text" placeholder="Escribir..." id="my-reply-${m.id}" style="flex:1;margin:0;font-size:12px;" />
          <button class="mini-btn-inline" onclick="sendMySupportReply('${m.id}')">Enviar</button>
        </div>
      </div>`;
    }).join("");
  } catch (e) {}
}

async function sendMySupportReply(id) {
  const input = document.getElementById("my-reply-" + id);
  const text = input.value.trim();
  if (!text) return;
  await fetch("/api/support/" + id + "/reply", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
    body: JSON.stringify({ text }),
  });
  loadMySupportThreads();
}
document.getElementById("go-to-admin-btn").addEventListener("click", () => {
  window.open("/admin.html", "_blank");
});
document.getElementById("install-app-btn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("install-app-btn").classList.add("hidden");
});

const countrySelect = document.getElementById("reg-country");
if (typeof WORLD_COUNTRIES !== "undefined") {
  WORLD_COUNTRIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    countrySelect.appendChild(opt);
  });
  countrySelect.value = "Chile";
}

// ---------------- Idioma ----------------

const savedLang = localStorage.getItem("domino_lang") || "es";
document.getElementById("lang-select").value = savedLang;
applyTranslations();

document.getElementById("lang-select").addEventListener("change", (e) => {
  localStorage.setItem("domino_lang", e.target.value);
  document.getElementById("reg-language").value = e.target.value;
  applyTranslations();
});

// Si elegís un país, sugerimos el idioma más probable (la persona lo puede cambiar igual)
document.getElementById("reg-country").addEventListener("change", (e) => {
  const suggested = guessLangForCountry(e.target.value);
  document.getElementById("reg-language").value = suggested;
});

const urlParams = new URLSearchParams(location.search);
let watchCode = urlParams.get("watch");
const joinMeetingCodeFromLink = urlParams.get("joinMeeting");

const authEl = document.getElementById("auth");
const lobbyEl = document.getElementById("lobby");
const waitingEl = document.getElementById("waiting");
const gameEl = document.getElementById("game");
const spectateEl = document.getElementById("spectate");

const capBtns = document.querySelectorAll(".cap-btn");
const createBtn = document.getElementById("create-btn");
const codeInput = document.getElementById("code-input");
const joinBtn = document.getElementById("join-btn");
const lobbyError = document.getElementById("lobby-error");

let selectedCap = 4;
let selectedHandSize = 9;
let mySeatIndex = null;
let myQueuePosition = null;
let amIModerator = false;
let mutedNamesSet = new Set();
let liveAdminNames = [];
function updateModeratorStatus() {
  amIModerator = mySeatIndex !== null || liveAdminNames.includes(myName);
}
let myHand = [];
let latestState = null;
let latestSpectatorsList = [];
let liveTimerInterval = null;
let liveTimerStartedFor = null;

function startLiveTimer(code, startedAt) {
  if (!startedAt || liveTimerStartedFor === code) return;
  liveTimerStartedFor = code;
  clearInterval(liveTimerInterval);
  const timerEl = document.getElementById("live-timer");
  function tick() {
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const hh = Math.floor(elapsed / 3600);
    const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = "🔴 " + (hh > 0 ? hh + ":" + mm + ":" + ss : mm + ":" + ss);
  }
  tick();
  liveTimerInterval = setInterval(tick, 1000);
}
let myCoinBalance = 0;
let myDiamondBalance = 0;
function updateWalletDisplay() {
  const coinsEl = document.getElementById("wallet-coins");
  const diamondsEl = document.getElementById("wallet-diamonds");
  if (coinsEl) coinsEl.textContent = myCoinBalance;
  if (diamondsEl) diamondsEl.textContent = myDiamondBalance;
}
let paypalConfig = null;

const HAND_SIZE_OPTIONS_CLIENT = { 2: [3, 6, 7, 9, 12], 3: [3, 6, 7, 9], 4: [6] };

capBtns.forEach((b) => {
  b.addEventListener("click", () => {
    capBtns.forEach((x) => x.classList.remove("selected"));
    b.classList.add("selected");
    selectedCap = parseInt(b.getAttribute("data-cap"), 10);
    renderHandSizeOptions();
  });
});
capBtns[2].classList.add("selected");

function renderHandSizeOptions() {
  const row = document.getElementById("handsize-row");
  if (selectedCap === 4) { row.classList.add("hidden"); return; }
  row.classList.remove("hidden");
  const options = HAND_SIZE_OPTIONS_CLIENT[selectedCap] || [9];
  row.innerHTML = '<label style="width:100%;">¿Cuántas fichas por mano?</label>' +
    options.map((n) => `<button class="handsize-btn" data-size="${n}">${n}</button>`).join("");
  selectedHandSize = options.includes(9) ? 9 : options[0];
  row.querySelectorAll(".handsize-btn").forEach((b) => {
    if (parseInt(b.dataset.size, 10) === selectedHandSize) b.classList.add("selected");
    b.addEventListener("click", () => {
      row.querySelectorAll(".handsize-btn").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      selectedHandSize = parseInt(b.dataset.size, 10);
    });
  });
}
renderHandSizeOptions();

// ---------------- Login / registro ----------------

document.getElementById("tab-login").addEventListener("click", () => switchTab("login"));
document.getElementById("tab-register").addEventListener("click", () => switchTab("register"));

function switchTab(which) {
  document.getElementById("tab-login").classList.toggle("selected", which === "login");
  document.getElementById("tab-register").classList.toggle("selected", which === "register");
  document.getElementById("login-form").classList.toggle("hidden", which !== "login");
  document.getElementById("register-form").classList.toggle("hidden", which !== "register");
  document.getElementById("auth-error").textContent = "";
}

document.getElementById("register-btn").addEventListener("click", async () => {
  const name = document.getElementById("reg-name").value.trim();
  const legalName = document.getElementById("reg-legalname").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const country = document.getElementById("reg-country").value;
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const paypalEmail = document.getElementById("reg-paypal").value.trim();
  const avatarFile = document.getElementById("reg-avatar").files[0];
  const err = document.getElementById("auth-error");
  err.textContent = "Creando cuenta...";
  try {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("legalName", legalName);
    formData.append("phone", phone);
    formData.append("country", country);
    formData.append("language", document.getElementById("reg-language").value);
    formData.append("email", email);
    formData.append("password", password);
    formData.append("paypalEmail", paypalEmail);
    if (avatarFile) formData.append("avatar", avatarFile);

    const res = await fetch("/api/register", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    localStorage.setItem("domino_lang", document.getElementById("reg-language").value);
    applyTranslations();
    onAuthSuccess(data.token, data.name, data.coinBalance, data.diamondBalance, data.emailVerified);
  } catch (e) {
    err.textContent = "Error de conexión.";
  }
});

document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const err = document.getElementById("auth-error");
  err.textContent = "Entrando...";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    if (data.language) {
      localStorage.setItem("domino_lang", data.language);
      document.getElementById("lang-select").value = data.language;
      applyTranslations();
    }
    onAuthSuccess(data.token, data.name, data.coinBalance, data.diamondBalance, data.emailVerified);
  } catch (e) {
    err.textContent = "Error de conexión.";
  }
});

// ---------------- Recuperar contraseña olvidada ----------------
document.getElementById("forgot-password-link").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("forgot-email").value = document.getElementById("login-email").value.trim();
  document.getElementById("forgot-step-email").classList.remove("hidden");
  document.getElementById("forgot-step-code").classList.add("hidden");
  document.getElementById("forgot-password-msg").textContent = "";
  document.getElementById("forgot-password-modal").classList.remove("hidden");
});
document.getElementById("close-forgot-password-modal").addEventListener("click", () => {
  document.getElementById("forgot-password-modal").classList.add("hidden");
});
document.getElementById("send-reset-code-btn").addEventListener("click", async () => {
  const email = document.getElementById("forgot-email").value.trim();
  const msg = document.getElementById("forgot-password-msg");
  if (!email) { msg.textContent = "Poné tu email."; return; }
  msg.style.color = "#cfe3da";
  msg.textContent = "Mandando el código...";
  try {
    await fetch("/api/forgot-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    msg.style.color = "#8fd4a8";
    msg.textContent = "Si ese email está registrado, te llegó un código. Revisá tu bandeja (y spam).";
    document.getElementById("forgot-step-email").classList.add("hidden");
    document.getElementById("forgot-step-code").classList.remove("hidden");
  } catch (e) {
    msg.style.color = "#ff8a80";
    msg.textContent = "Error de conexión.";
  }
});
document.getElementById("confirm-reset-btn").addEventListener("click", async () => {
  const email = document.getElementById("forgot-email").value.trim();
  const code = document.getElementById("reset-code").value.trim();
  const newPassword = document.getElementById("reset-new-password").value;
  const msg = document.getElementById("forgot-password-msg");
  if (!code || !newPassword) { msg.style.color = "#ff8a80"; msg.textContent = "Completá el código y la contraseña nueva."; return; }
  try {
    const res = await fetch("/api/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) { msg.style.color = "#ff8a80"; msg.textContent = data.error; return; }
    msg.style.color = "#8fd4a8";
    msg.textContent = "¡Contraseña cambiada! Ya podés iniciar sesión con la nueva.";
    document.getElementById("login-email").value = email;
    document.getElementById("login-password").value = "";
    setTimeout(() => document.getElementById("forgot-password-modal").classList.add("hidden"), 1800);
  } catch (e) {
    msg.style.color = "#ff8a80";
    msg.textContent = "Error de conexión.";
  }
});

function onAuthSuccess(token, name, coinBalance, diamondBalance, emailVerified) {
  authToken = token;
  myName = name;
  myCoinBalance = coinBalance;
  myDiamondBalance = diamondBalance;
  updateWalletDisplay();
  localStorage.setItem("domino_token", token);
  localStorage.setItem("domino_display_name", name);

  if (emailVerified === false) {
    authEl.classList.add("hidden");
    document.getElementById("verify-screen").classList.remove("hidden");
    return;
  }

  if (watchCode) {
    startSpectating(name);
  } else {
    connectSocket();
    showLobby();
  }
}

document.getElementById("verify-submit-btn").addEventListener("click", async () => {
  const code = document.getElementById("verify-code-input").value.trim();
  const err = document.getElementById("verify-error");
  err.textContent = "Verificando...";
  try {
    const res = await fetch("/api/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    document.getElementById("verify-screen").classList.add("hidden");
    if (watchCode) startSpectating(myName);
    else { connectSocket(); showLobby(); }
  } catch (e) {
    err.textContent = "Error de conexión.";
  }
});

document.getElementById("resend-code-link").addEventListener("click", async (e) => {
  e.preventDefault();
  const err = document.getElementById("verify-error");
  err.textContent = "Enviando...";
  try {
    const res = await fetch("/api/resend-verification", {
      method: "POST",
      headers: { Authorization: "Bearer " + authToken },
    });
    const data = await res.json();
    err.textContent = res.ok ? "Te mandamos un código nuevo." : data.error;
  } catch (e2) {
    err.textContent = "Error de conexión.";
  }
});

function showLobby() {
  authEl.classList.add("hidden");
  lobbyEl.classList.remove("hidden");
  document.getElementById("lobby-name-label").textContent = "Jugando como " + myName;
  switchLobbyTab(urlParams.get("openSearch") ? "search" : "feed");
  loadFollowing();
  loadProfile();
  loadLiveRooms();
  loadGiftCatalog();
  if (joinMeetingCodeFromLink) {
    // Vino de un enlace de invitación por email — lo mandamos directo a la reunión,
    // sin que tenga que copiar el código a mano.
    showToast("Entrando a la reunión...");
    socket.emit("joinMeeting", { code: joinMeetingCodeFromLink.toUpperCase() });
    history.replaceState(null, "", "/"); // sacamos el código de la URL, ya no hace falta
  } else if (!urlParams.get("openSearch")) {
    openFeedSwipeMode(); // arranca directo con el feed a pantalla completa, como TikTok
  }
}

let giftCatalogCache = null;
async function loadGiftCatalog() {
  try {
    const res = await fetch("/api/gift-catalog");
    const data = await res.json();
    giftCatalogCache = data.gifts;
  } catch (e) { giftCatalogCache = null; }
}

document.getElementById("logout-link").addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem("domino_token");
  localStorage.removeItem("domino_display_name");
  location.reload();
});

// ---------------- Nav inferior (Feed / Buscar / Perfil) y modal de Dominó ----------------

function switchLobbyTab(tab) {
  ["feed", "search", "messages", "profile"].forEach((t) => {
    document.getElementById(t + "-tab").classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll("#bottom-nav .nav-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.tab === tab);
  });
  if (tab === "messages") { loadConversations(); loadFollowing(); }
  else stopThreadPolling();
  if (tab === "profile") initInstallSection();
}
document.querySelectorAll("#bottom-nav .nav-btn").forEach((b) => {
  b.addEventListener("click", () => switchLobbyTab(b.dataset.tab));
});

function openDominoModal() { document.getElementById("domino-modal").classList.remove("hidden"); }
function closeDominoModal() { document.getElementById("domino-modal").classList.add("hidden"); }
document.getElementById("close-domino-modal").addEventListener("click", closeDominoModal);

// =====================================================================
// Feed de videos/fotos/texto (estilo TikTok) + crear contenido + mensajes
// =====================================================================

// ---------------- Toggle "En vivo" / "Videos" dentro de Inicio ----------------
document.querySelectorAll(".feed-switch-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".feed-switch-btn").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    const which = btn.dataset.feed;
    document.getElementById("feed-live-view").classList.toggle("hidden", which !== "live");
    document.getElementById("feed-videos-view").classList.toggle("hidden", which !== "videos");
    if (which === "videos") openFeedSwipeMode();
  });
});

// Entrar a "Para ti" abre directo la primera publicación a pantalla completa, y se
// desliza (arriba/abajo, con el dedo o con la rueda del mouse) para ver la siguiente,
// igual que en TikTok — en vez de mostrar una grilla de miniaturas para tocar.
// Además mezcla los "en vivo" que haya en ese momento adentro del mismo scroll,
// como hace TikTok, en vez de tenerlos en una pestaña aparte y separada.
async function openFeedSwipeMode() {
  const wrap = document.getElementById("feed-videos-view");
  try {
    const [postsRes, liveRes] = await Promise.all([
      fetch("/api/posts", { headers: { Authorization: "Bearer " + authToken } }),
      fetch("/api/live-rooms").catch(() => null),
    ]);
    const postsData = await postsRes.json();
    const posts = postsData.posts || [];
    let liveItems = [];
    if (liveRes && liveRes.ok) {
      const liveData = await liveRes.json();
      liveItems = (liveData.rooms || []).map((r) => ({ isLive: true, ...r }));
    }
    // Los en vivo van intercalados cada 4 publicaciones (no todos amontonados al
    // principio), para que se sientan mezclados de verdad y no como una lista aparte.
    const combined = [];
    let liveIdx = 0;
    posts.forEach((p, i) => {
      combined.push(p);
      if (i > 0 && i % 4 === 0 && liveIdx < liveItems.length) combined.push(liveItems[liveIdx++]);
    });
    while (liveIdx < liveItems.length) combined.push(liveItems[liveIdx++]);
    if (!combined.length) {
      wrap.innerHTML = '<p class="empty-msg-small" style="text-align:center;padding:20px;">Todavía no hay publicaciones. ¡Subí la primera con el botón ➕!</p>';
      return;
    }
    lastLoadedPosts = combined;
    wrap.innerHTML = "";
    openPostViewer(combined[0], combined, 0);
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando videos.</p>';
  }
}

// Pone el nombre, el estado del mic, la insignia de "Anfitrión" y los botones (destacar,
// silenciar, bajar, seguir) directo ENCIMA de cada video — así todo queda junto en el
// mismo cuadro, en vez de tener el video arriba y la info aparte abajo.
function updateVideoTileOverlays(state, hostSeat, people) {
  document.querySelectorAll("#video-bar .video-tile").forEach((tile) => {
    let overlay = tile.querySelector(".tile-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "tile-overlay";
      tile.appendChild(overlay);
    }
    const email = tile.dataset.email;
    if (!email) { overlay.innerHTML = ""; return; }
    const person = people.find((p) => p.email === email);
    const isHost = hostSeat && hostSeat.email === email;
    if (!person && !isHost) { overlay.innerHTML = ""; return; }
    const name = isHost ? (hostSeat.name || "Anfitrión") : person.name;
    const isFeatured = state.featuredEmail === email;
    const hostBadge = isHost ? `<span class="tile-host-badge">Anfitrión</span>` : "";
    const featureBtn = amIModerator
      ? `<button class="tile-icon-btn ${isFeatured ? "active" : ""}" data-feature-email="${escapeHtml(email)}" title="Destacar en pantalla grande">📌</button>`
      : "";
    const muteBtn = amIModerator && person && person.isGuest
      ? `<button class="tile-icon-btn" data-mute-email="${escapeHtml(email)}" title="Silenciar">🔇</button>`
      : "";
    const removeBtn = amIModerator && person && person.isGuest
      ? `<button class="tile-icon-btn tile-icon-danger" data-remove-email="${escapeHtml(email)}" title="Bajar de cámara">✖️</button>`
      : "";
    overlay.innerHTML = `
      ${hostBadge}
      <div class="tile-controls-row">${featureBtn}${muteBtn}${removeBtn}</div>
      <div class="tile-name-row"><span class="tile-name">${escapeHtml(name)}</span></div>
    `;
    overlay.querySelectorAll("[data-feature-email]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      socket.emit("setFeaturedParticipant", { email: isFeatured ? null : email });
    }));
    overlay.querySelectorAll("[data-mute-email]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      socket.emit("muteCameraGuest", { email });
      showToast("Le pediste a esa persona que se silencie.");
    }));
    overlay.querySelectorAll("[data-remove-email]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("¿Bajar a esta persona de cámara?")) return;
      socket.emit("removeCameraGuest", { email });
    }));
    overlay.querySelector(".tile-name-row").addEventListener("click", (e) => {
      e.stopPropagation();
      openUserProfile(email);
    });
  });
}

const MAX_VISIBLE_CAMERA_SLOTS = 10;

function renderOnCameraStrip(state, hostSeat) {
  const strip = document.getElementById("on-camera-strip");
  const others = state.seats.filter((s) => s.name && s !== hostSeat && s.email).map((s) => ({ ...s, isGuest: false }));
  const guests = (state.cameraGuests || []).map((g) => ({ ...g, isGuest: true }));
  const people = [...others, ...guests].filter((p) => p.email);
  updateVideoTileOverlays(state, hostSeat, people);

  // El interruptor para abrir/cerrar las ventanillas solo lo ve el anfitrión (o admin del live)
  const toggleBtn = document.getElementById("toggle-guests-open-btn");
  const limitSelect = document.getElementById("guests-limit-select");
  if (toggleBtn) {
    toggleBtn.classList.toggle("hidden", !amIModerator);
    toggleBtn.textContent = state.guestsOpen ? "🔓 Cerrar ventanillas de invitados" : "🔒 Abrir para invitados";
    toggleBtn.classList.toggle("guests-open-active", !!state.guestsOpen);
  }
  if (limitSelect) {
    limitSelect.classList.toggle("hidden", !amIModerator);
    if (document.activeElement !== limitSelect) limitSelect.value = String(state.guestsLimit || 10);
  }
  const commentsToggleBtn = document.getElementById("toggle-comments-closed-btn");
  if (commentsToggleBtn) {
    commentsToggleBtn.classList.toggle("hidden", !amIModerator);
    commentsToggleBtn.textContent = state.commentsClosed ? "💬 Abrir comentarios de nuevo" : "💬 Cerrar comentarios";
    commentsToggleBtn.classList.toggle("comments-closed-active", !!state.commentsClosed);
  }
  const chatInputEl = document.getElementById("chat-input");
  if (chatInputEl) {
    if (!chatInputEl.dataset.defaultPlaceholder) chatInputEl.dataset.defaultPlaceholder = chatInputEl.placeholder;
    const iAmBlockedFromChat = !!state.commentsClosed && !amIModerator;
    chatInputEl.disabled = iAmBlockedFromChat;
    chatInputEl.placeholder = iAmBlockedFromChat ? "El anfitrión cerró los comentarios" : chatInputEl.dataset.defaultPlaceholder;
  }

  const peopleHtml = people.map((p) => {
    const initial = (p.name || "?").trim().charAt(0).toUpperCase();
    const img = p.avatarUrl
      ? `<img src="${p.avatarUrl}" alt="" />`
      : `<span class="pill-fallback" style="background:${colorForName(p.name)}">${initial}</span>`;
    const isFeatured = state.featuredEmail === p.email;
    const featureBtn = amIModerator
      ? `<button class="pill-feature-btn ${isFeatured ? "active" : ""}" data-feature-email="${escapeHtml(p.email)}" title="Destacar en pantalla grande">📌</button>`
      : "";
    const removeBtn = amIModerator && p.isGuest
      ? `<button class="pill-remove-btn" data-remove-email="${escapeHtml(p.email)}" title="Bajar de cámara">✖️</button>`
      : "";
    const muteBtn = amIModerator && p.isGuest
      ? `<button class="pill-remove-btn pill-mute-btn" data-mute-email="${escapeHtml(p.email)}" title="Silenciar (sin bajarlo)">🔇</button>`
      : "";
    return `<div class="on-camera-pill" data-email="${escapeHtml(p.email)}">${img}<span class="pill-name">${escapeHtml(p.name)}</span>${featureBtn}${muteBtn}${removeBtn}</div>`;
  }).join("");

  // Ventanillas abiertas: solo aparecen si el anfitrión las abrió — no quedan siempre puestas.
  const guestsLimit = state.guestsLimit || 10;
  const openSlots = Math.max(0, guestsLimit - people.length);
  const openSlotsHtml = state.guestsOpen && mySeatIndex === null && authToken
    ? Array.from({ length: openSlots }).map(() => `<div class="on-camera-pill open-slot-pill" data-open-slot="1">+ TableUp</div>`).join("")
    : "";

  strip.innerHTML = peopleHtml + openSlotsHtml;

  strip.querySelectorAll(".on-camera-pill:not(.open-slot-pill)").forEach((pill) => {
    pill.addEventListener("click", (e) => {
      if (e.target.closest("[data-feature-email]")) return;
      openUserProfile(pill.dataset.email);
    });
  });
  strip.querySelectorAll("[data-feature-email]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const email = btn.dataset.featureEmail;
      const alreadyFeatured = state.featuredEmail === email;
      socket.emit("setFeaturedParticipant", { email: alreadyFeatured ? null : email });
    });
  });
  strip.querySelectorAll("[data-remove-email]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("¿Bajar a esta persona de cámara?")) return;
      socket.emit("removeCameraGuest", { email: btn.dataset.removeEmail });
    });
  });
  strip.querySelectorAll("[data-mute-email]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      socket.emit("muteCameraGuest", { email: btn.dataset.muteEmail });
      showToast("Le pediste a esa persona que se silencie.");
    });
  });
  strip.querySelectorAll("[data-open-slot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("requestJoinCamera", { withCamera: true });
      showToast("Le pediste al anfitrión hacer TableUp con cámara. Esperá que te aprueben.");
    });
  });

  // Marcamos con "featured" el video que corresponda (grande) — lo decide el anfitrión
  document.querySelectorAll("#video-bar .video-tile").forEach((tile) => {
    tile.classList.toggle("featured", !!state.featuredEmail && tile.dataset.email === state.featuredEmail);
  });
}

// ---------------- Perfil público de cualquier usuario, tocable desde el en vivo ----------------
async function openUserProfile(email) {
  const modal = document.getElementById("user-profile-modal");
  modal.classList.remove("hidden");
  document.getElementById("up-name").textContent = "Cargando...";
  document.getElementById("up-followers").textContent = "";
  document.getElementById("up-videos-grid").innerHTML = "";
  try {
    const [profileRes, postsRes] = await Promise.all([
      fetch("/api/users/" + encodeURIComponent(email) + "/profile", { headers: { Authorization: "Bearer " + authToken } }),
      fetch("/api/posts/user/" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + authToken } }),
    ]);
    if (!profileRes.ok) { document.getElementById("up-name").textContent = "No se pudo cargar este perfil."; return; }
    const profile = await profileRes.json();
    const postsData = await postsRes.json();

    const avatarEl = document.getElementById("up-avatar");
    const fallbackEl = document.getElementById("up-avatar-fallback");
    if (profile.avatarUrl) {
      avatarEl.src = profile.avatarUrl;
      avatarEl.style.display = "block";
      fallbackEl.style.display = "none";
    } else {
      avatarEl.style.display = "none";
      fallbackEl.style.display = "flex";
      fallbackEl.textContent = (profile.name || "?").trim().charAt(0).toUpperCase();
      fallbackEl.style.background = colorForName(profile.name || "?");
    }
    const badgeHtml = profile.badge ? profile.badge + " " : "";
    document.getElementById("up-name").textContent = badgeHtml + profile.name;
    document.getElementById("up-followers").textContent = profile.followerCount + " seguidores";
    document.getElementById("up-level-badge").textContent = "⭐ Nivel " + (profile.level || 1);

    const giftsGallery = document.getElementById("up-gifts-gallery");
    if (profile.gifts && profile.gifts.giftCount > 0) {
      giftsGallery.classList.remove("hidden");
      document.getElementById("up-gifts-total").textContent = "💎 " + profile.gifts.totalReceived + " diamantes recibidos en total (" + profile.gifts.giftCount + " regalos)";
      document.getElementById("up-gifts-top-list").innerHTML = profile.gifts.topGifters.map((g) =>
        `<div class="up-gift-row"><span>${escapeHtml(g.name)}</span><span>💎 ${g.amount}</span></div>`
      ).join("");
    } else {
      giftsGallery.classList.add("hidden");
    }

    const followBtn = document.getElementById("up-follow-btn");
    const blockBtn = document.getElementById("up-block-btn");
    const isMe = profile.email === myEmail;
    document.getElementById("up-actions").classList.toggle("hidden", isMe);
    if (!isMe) {
      blockBtn.textContent = profile.isBlockedByMe ? "✅ Desbloquear" : "🚫 Bloquear";
      blockBtn.onclick = async () => {
        if (!profile.isBlockedByMe && !confirm("¿Bloquear a " + profile.name + "? No va a poder seguirte, comentar en lo tuyo, ni mandarte mensajes.")) return;
        await fetch("/api/users/" + encodeURIComponent(profile.email) + "/block", {
          method: "POST", headers: { Authorization: "Bearer " + authToken },
        });
        openUserProfile(email); // refresca para actualizar el botón
      };
      followBtn.textContent = profile.isFollowing ? "Dejar de seguir" : "Seguir";
      followBtn.onclick = async () => {
        await fetch("/api/" + (profile.isFollowing ? "unfollow" : "follow"), {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
          body: JSON.stringify({ email: profile.email }),
        });
        openUserProfile(email); // refresca para actualizar el botón
      };
      document.getElementById("up-message-btn").onclick = () => {
        document.getElementById("user-profile-modal").classList.add("hidden");
        switchLobbyTab("messages");
        openThread(profile.email, profile.name);
      };
      document.getElementById("up-subscribe-btn").onclick = () => {
        document.getElementById("user-profile-modal").classList.add("hidden");
        openSubscribeModal(profile.email, profile.name);
      };
    }

    const gridEl = document.getElementById("up-videos-grid");
    if (!postsData.posts.length) {
      gridEl.innerHTML = '<p class="empty-msg-small">Todavía no publicó nada.</p>';
    } else {
      gridEl.innerHTML = postsData.posts.map(videoCardHtml).join("");
      gridEl.querySelectorAll(".video-card").forEach((cardEl) => {
        cardEl.addEventListener("click", () => {
          const idx = postsData.posts.findIndex((p) => p.id === cardEl.dataset.postId);
          if (idx !== -1) { document.getElementById("user-profile-modal").classList.add("hidden"); openPostViewer(postsData.posts[idx], postsData.posts, idx); }
        });
      });
    }
  } catch (e) {
    document.getElementById("up-name").textContent = "Error cargando el perfil.";
  }
}
document.getElementById("close-user-profile").addEventListener("click", () => {
  document.getElementById("user-profile-modal").classList.add("hidden");
});

// ---------------- Quién está mirando (como TikTok: tocás el contador y ves la lista) ----------------
document.getElementById("spectator-count").addEventListener("click", () => {
  const wrap = document.getElementById("viewers-list-content");
  if (!latestSpectatorsList.length) {
    wrap.innerHTML = '<p class="empty-msg-small">Todavía no hay nadie mirando.</p>';
  } else {
    wrap.innerHTML = latestSpectatorsList.map((v) => {
      const initial = (v.name || "?").trim().charAt(0).toUpperCase();
      const clickable = v.email ? ` data-open-profile="${escapeHtml(v.email)}"` : "";
      return `<div class="viewer-row"${clickable}>
        <span class="viewer-row-avatar" style="background:${colorForName(v.name || "?")}">${initial}</span>
        <span>${escapeHtml(v.name || "Espectador")}</span>
      </div>`;
    }).join("");
    wrap.querySelectorAll("[data-open-profile]").forEach((el) => {
      el.addEventListener("click", () => {
        document.getElementById("viewers-list-modal").classList.add("hidden");
        openUserProfile(el.dataset.openProfile);
      });
    });
  }
  document.getElementById("viewers-list-modal").classList.remove("hidden");
});
document.getElementById("close-viewers-list").addEventListener("click", () => {
  document.getElementById("viewers-list-modal").classList.add("hidden");
});

function videoCardHtml(p) {
  const badge = p.type === "video" ? "🎬" : p.type === "photo" ? "🖼️" : "📝";
  let inner;
  if (p.type === "video") inner = `<video src="${p.fileUrl}" muted preload="metadata"></video>`;
  else if (p.type === "photo") inner = `<img src="${p.fileUrl}" alt="" />`;
  else inner = `<div class="video-card-text">${escapeHtml((p.caption || "").slice(0, 80))}</div>`;
  return `<div class="video-card" data-post-id="${p.id}">
    ${inner}
    <span class="video-card-badge">${badge}</span>
    <span class="video-card-meta">❤️ ${p.likeCount}</span>
  </div>`;
}

let lastLoadedPosts = [];
async function loadVideosFeed() {
  const wrap = document.getElementById("videos-feed");
  try {
    const res = await fetch("/api/posts", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    lastLoadedPosts = data.posts || [];
    if (!lastLoadedPosts.length) {
      wrap.innerHTML = '<p class="empty-msg-small" style="grid-column:1/-1;text-align:center;padding:20px;">Todavía no hay publicaciones. ¡Subí la primera con el botón ➕!</p>';
      return;
    }
    wrap.innerHTML = lastLoadedPosts.map(videoCardHtml).join("");
    wrap.querySelectorAll(".video-card").forEach((card) => {
      card.addEventListener("click", () => {
        const post = lastLoadedPosts.find((p) => p.id === card.dataset.postId);
        if (post) openPostViewer(post);
      });
    });
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando videos.</p>';
  }
}

async function loadMyVideos() {
  if (!myEmail) return;
  const wrap = document.getElementById("my-videos-grid");
  try {
    const res = await fetch("/api/posts/user/" + encodeURIComponent(myEmail), { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.posts.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no subiste nada.</p>'; return; }
    wrap.innerHTML = data.posts.map(videoCardHtml).join("");
    wrap.querySelectorAll(".video-card").forEach((card, i) => {
      card.addEventListener("click", () => {
        const idx = data.posts.findIndex((p) => p.id === card.dataset.postId);
        if (idx !== -1) openPostViewer(data.posts[idx], data.posts, idx);
      });
    });
  } catch (e) {}
}

// ---------------- Modal de crear contenido (+) ----------------
document.getElementById("create-fab-btn").addEventListener("click", () => {
  document.getElementById("create-modal").classList.remove("hidden");
  document.getElementById("create-menu").classList.remove("hidden");
  document.getElementById("create-upload-form").classList.add("hidden");
});
document.getElementById("close-create-modal").addEventListener("click", () => {
  stopRecording(true);
  document.getElementById("create-modal").classList.add("hidden");
});
function goLiveNow() {
  iAmCreatingRoom = true;
  if (socket) socket.emit("createRoom", { capacity: 4 });
}
document.getElementById("create-opt-live").addEventListener("click", () => {
  document.getElementById("create-modal").classList.add("hidden");
  // "Ir en vivo" prende la transmisión al toque, sin pedir cuántos van a jugar al dominó:
  // esa elección solo aparece después, si la persona decide abrir el panel de 🎲 Dominó.
  goLiveNow();
});
document.getElementById("create-opt-join-domino").addEventListener("click", () => {
  document.getElementById("create-modal").classList.add("hidden");
  openDominoModal();
});
document.getElementById("start-live-from-feed-btn").addEventListener("click", goLiveNow);
document.getElementById("create-form-back").addEventListener("click", () => {
  stopRecording(true);
  document.getElementById("create-record-box").classList.add("hidden");
  document.getElementById("create-menu").classList.remove("hidden");
  document.getElementById("create-upload-form").classList.add("hidden");
});

let createPostType = null;
let createSelectedFile = null;
let createVideoDurationOk = true;

async function openCreateForm(type) {
  createPostType = type;
  createSelectedFile = null;
  createRecordedDurationSeconds = null;
  createVideoDurationOk = true;
  document.getElementById("create-menu").classList.add("hidden");
  document.getElementById("create-upload-form").classList.remove("hidden");
  document.getElementById("create-error").textContent = "";
  document.getElementById("create-caption-input").value = "";
  const fileInput = document.getElementById("create-file-input");
  fileInput.value = "";
  const videoPreview = document.getElementById("create-video-preview");
  const photoPreview = document.getElementById("create-photo-preview");
  videoPreview.classList.add("hidden");
  photoPreview.classList.add("hidden");
  videoPreview.removeAttribute("src");
  photoPreview.removeAttribute("src");
  Object.keys(POST_FILTER_RECIPES).forEach((id) => { videoPreview.classList.remove("pf-" + id); photoPreview.classList.remove("pf-" + id); });
  createSelectedFilterId = "natural";
  document.getElementById("create-filter-row").classList.add("hidden");
  document.querySelectorAll(".create-filter-swatch").forEach((b) => b.classList.toggle("selected", b.dataset.filter === "natural"));
  const hint = document.getElementById("create-video-limit-hint");
  stopRecording(true);
  document.getElementById("create-record-box").classList.add("hidden");
  document.getElementById("create-video-source-row").classList.add("hidden");

  if (type === "video") {
    document.getElementById("create-form-title").textContent = "🎥 Subir video";
    fileInput.accept = "video/*";
    fileInput.classList.add("hidden"); // se dispara con el botón "Elegir de la galería"
    document.getElementById("create-video-source-row").classList.remove("hidden");
    try {
      const res = await fetch("/api/video-limit", { headers: { Authorization: "Bearer " + authToken } });
      const data = await res.json();
      const mins = Math.floor(data.maxDurationSeconds / 60);
      hint.textContent = "Con " + data.followerCount + " seguidores, podés subir o grabar videos de hasta " + mins + " minutos" +
        (data.followerCount < data.threshold ? " (llegá a " + data.threshold + " seguidores para subir hasta 10 minutos)." : ".");
      hint.dataset.maxDuration = data.maxDurationSeconds;
      hint.classList.remove("hidden");
    } catch (e) { hint.classList.add("hidden"); }
  } else if (type === "photo") {
    document.getElementById("create-form-title").textContent = "🖼️ Subir foto";
    fileInput.accept = "image/*";
    fileInput.classList.remove("hidden");
    hint.classList.add("hidden");
  } else {
    document.getElementById("create-form-title").textContent = "📝 Publicar texto";
    fileInput.classList.add("hidden");
    hint.classList.add("hidden");
  }
}
document.getElementById("create-opt-video").addEventListener("click", () => openCreateForm("video"));
document.getElementById("create-opt-photo").addEventListener("click", () => openCreateForm("photo"));
document.getElementById("create-opt-text").addEventListener("click", () => openCreateForm("text"));

document.getElementById("create-choose-file-btn").addEventListener("click", () => {
  document.getElementById("create-file-input").click();
});

// ---------------- Grabar video directo desde la cámara (MediaRecorder) ----------------
let recordStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordTimerInterval = null;
let recordStartedAt = 0;

function stopRecording(discard) {
  if (recordTimerInterval) { clearInterval(recordTimerInterval); recordTimerInterval = null; }
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch (e) {}
  }
  if (recordStream) {
    recordStream.getTracks().forEach((t) => t.stop());
    recordStream = null;
  }
  mediaRecorder = null;
  if (discard) recordedChunks = [];
  const preview = document.getElementById("create-record-preview");
  if (preview) preview.srcObject = null;
}

document.getElementById("create-record-toggle-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("create-error");
  errEl.textContent = "";
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    errEl.textContent = "Tu navegador no permite grabar video directamente acá. Usá 'Elegir de la galería'.";
    return;
  }
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    errEl.textContent = "No pudimos acceder a tu cámara/micrófono. Revisá los permisos del navegador.";
    return;
  }
  document.getElementById("create-video-source-row").classList.add("hidden");
  document.getElementById("create-record-box").classList.remove("hidden");
  document.getElementById("create-record-start-btn").classList.remove("hidden");
  document.getElementById("create-record-stop-btn").classList.add("hidden");
  document.getElementById("create-record-timer").textContent = "";
  const preview = document.getElementById("create-record-preview");
  preview.srcObject = recordStream;
});

document.getElementById("create-record-cancel-btn").addEventListener("click", () => {
  stopRecording(true);
  document.getElementById("create-record-box").classList.add("hidden");
  document.getElementById("create-video-source-row").classList.remove("hidden");
});

document.getElementById("create-record-start-btn").addEventListener("click", () => {
  if (!recordStream) return;
  const errEl = document.getElementById("create-error");
  errEl.textContent = "";
  recordedChunks = [];
  const hint = document.getElementById("create-video-limit-hint");
  const maxDuration = parseFloat(hint.dataset.maxDuration) || 180;

  let options = { mimeType: "video/webm;codecs=vp8,opus" };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) options = {};
  try {
    mediaRecorder = new MediaRecorder(recordStream, options);
  } catch (e) {
    errEl.textContent = "No se pudo empezar a grabar en este navegador.";
    return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const file = new File([blob], "grabacion_" + Date.now() + ".webm", { type: "video/webm" });
    createSelectedFile = file;
    createVideoDurationOk = true; // ya se cortó sola al llegar al límite permitido
    createRecordedDurationSeconds = Math.max(1, Math.round((Date.now() - recordStartedAt) / 1000));

    const videoPreview = document.getElementById("create-video-preview");
    videoPreview.src = URL.createObjectURL(file);
    videoPreview.classList.remove("hidden");
    document.getElementById("create-record-box").classList.add("hidden");
  };
  mediaRecorder.start();
  recordStartedAt = Date.now();
  document.getElementById("create-record-start-btn").classList.add("hidden");
  document.getElementById("create-record-stop-btn").classList.remove("hidden");

  const timerEl = document.getElementById("create-record-timer");
  recordTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordStartedAt) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = "🔴 " + mm + ":" + ss + " / " + Math.floor(maxDuration / 60) + ":" + String(maxDuration % 60).padStart(2, "0");
    if (elapsed >= maxDuration) {
      clearInterval(recordTimerInterval);
      recordTimerInterval = null;
      document.getElementById("create-record-stop-btn").click();
    }
  }, 500);
});

document.getElementById("create-record-stop-btn").addEventListener("click", () => {
  if (recordTimerInterval) { clearInterval(recordTimerInterval); recordTimerInterval = null; }
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  if (recordStream) { recordStream.getTracks().forEach((t) => t.stop()); recordStream = null; }
});

let createRecordedDurationSeconds = null;

// Mismas recetas que los filtros de la cámara en vivo, reutilizadas acá para hornear
// el efecto de verdad en el archivo antes de subirlo (no es solo cosmético).
const POST_FILTER_RECIPES = {
  natural: "",
  warm: "saturate(1.2) hue-rotate(-8deg) brightness(1.06) sepia(0.12)",
  golden: "sepia(0.32) saturate(1.45) hue-rotate(-12deg) brightness(1.12) contrast(1.05)",
  vintage: "sepia(0.35) contrast(0.95) brightness(0.96) saturate(0.8)",
  cinematic: "contrast(1.18) saturate(0.88) brightness(0.95) hue-rotate(-5deg)",
  vivid: "saturate(1.6) contrast(1.15) brightness(1.03)",
  cool: "saturate(1.1) hue-rotate(15deg) brightness(1.02) contrast(1.05)",
  bw: "grayscale(1) contrast(1.1)",
  softglow: "brightness(1.14) contrast(0.9) saturate(1.08) blur(0.4px)",
  retro: "sepia(0.28) saturate(1.3) contrast(1.1) hue-rotate(-8deg) brightness(0.97)",
};
let createSelectedFilterId = "natural";

document.querySelectorAll(".create-filter-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".create-filter-swatch").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    createSelectedFilterId = btn.dataset.filter;
    const videoPreview = document.getElementById("create-video-preview");
    const photoPreview = document.getElementById("create-photo-preview");
    [videoPreview, photoPreview].forEach((el) => {
      Object.keys(POST_FILTER_RECIPES).forEach((id) => el.classList.remove("pf-" + id));
      if (createSelectedFilterId !== "natural") el.classList.add("pf-" + createSelectedFilterId);
    });
  });
});

// Aplica el filtro elegido a una FOTO de verdad (no solo cosmético), dibujándola en un
// canvas con el efecto puesto, y devuelve un archivo nuevo listo para subir.
function bakePhotoFilter(file, filterId) {
  return new Promise((resolve) => {
    const recipe = POST_FILTER_RECIPES[filterId];
    if (!recipe) return resolve(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.filter = recipe;
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.9);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

// Igual que la de foto, pero para VIDEO: reproduce el original en segundo plano, dibuja
// cada cuadro en un canvas con el efecto puesto, y graba el resultado con el audio
// original — así el efecto queda de verdad grabado en el video, no solo en la vista previa.
function bakeVideoFilter(file, filterId) {
  return new Promise((resolve) => {
    const recipe = POST_FILTER_RECIPES[filterId];
    if (!recipe) return resolve(file);
    const video = document.createElement("video");
    video.src = URL.createObjectURL(file);
    video.muted = false;
    video.playsInline = true;
    video.onloadedmetadata = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        const sourceStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        const audioTracks = sourceStream.getAudioTracks();
        const outStream = canvas.captureStream(30);
        audioTracks.forEach((t) => outStream.addTrack(t));
        const chunks = [];
        const recorder = new MediaRecorder(outStream, { mimeType: "video/webm;codecs=vp9,opus" });
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".webm", { type: "video/webm" }));
        };
        let stopped = false;
        function drawFrame() {
          if (stopped) return;
          ctx.filter = recipe;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawFrame);
        }
        video.onended = () => { stopped = true; recorder.stop(); };
        recorder.start();
        drawFrame();
        await video.play();
      } catch (e) {
        resolve(file); // si algo falla, subimos el video original sin el efecto antes que perderlo
      }
    };
    video.onerror = () => resolve(file);
  });
}

document.getElementById("create-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  createSelectedFile = file || null;
  createRecordedDurationSeconds = null; // es un archivo elegido, no una grabación
  const errEl = document.getElementById("create-error");
  errEl.textContent = "";
  if (!file) return;

  document.getElementById("create-filter-row").classList.remove("hidden");
  createSelectedFilterId = "natural";
  document.querySelectorAll(".create-filter-swatch").forEach((b) => b.classList.toggle("selected", b.dataset.filter === "natural"));

  if (createPostType === "video") {
    const preview = document.getElementById("create-video-preview");
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    createVideoDurationOk = false; // se confirma cuando cargue la metadata
    preview.onloadedmetadata = () => {
      const hint = document.getElementById("create-video-limit-hint");
      const maxDuration = parseFloat(hint.dataset.maxDuration) || 180;
      if (preview.duration > maxDuration + 1) {
        createVideoDurationOk = false;
        errEl.textContent = "Ese video dura " + Math.ceil(preview.duration) + " segundos, y tu límite actual es de " + Math.floor(maxDuration / 60) + " minutos.";
      } else {
        createVideoDurationOk = true;
      }
    };
  } else if (createPostType === "photo") {
    const preview = document.getElementById("create-photo-preview");
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
  }
});

document.getElementById("create-publish-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("create-error");
  errEl.textContent = "";
  const caption = document.getElementById("create-caption-input").value.trim();

  if ((createPostType === "video" || createPostType === "photo") && !createSelectedFile) {
    errEl.textContent = "Elegí un archivo primero."; return;
  }
  if (createPostType === "text" && !caption) {
    errEl.textContent = "Escribí algo para publicar."; return;
  }
  if (createPostType === "video" && !createVideoDurationOk) {
    errEl.textContent = "Ese video dura más de lo permitido para tu cuenta."; return;
  }

  let fileToUpload = createSelectedFile;
  if (fileToUpload && createSelectedFilterId && createSelectedFilterId !== "natural") {
    document.getElementById("create-processing-msg").classList.remove("hidden");
    try {
      fileToUpload = createPostType === "photo"
        ? await bakePhotoFilter(createSelectedFile, createSelectedFilterId)
        : await bakeVideoFilter(createSelectedFile, createSelectedFilterId);
    } catch (e) { /* si falla, seguimos con el archivo original */ }
    document.getElementById("create-processing-msg").classList.add("hidden");
  }

  const fd = new FormData();
  fd.append("type", createPostType);
  fd.append("caption", caption);
  if (fileToUpload) fd.append("file", fileToUpload);
  if (createPostType === "video") {
    let seconds;
    if (createRecordedDurationSeconds != null) {
      seconds = createRecordedDurationSeconds; // grabado acá mismo: usamos el tiempo medido, no video.duration
    } else {
      const preview = document.getElementById("create-video-preview");
      seconds = Number.isFinite(preview.duration) ? Math.ceil(preview.duration) : 0;
    }
    fd.append("durationSeconds", String(seconds));
  }

  const btn = document.getElementById("create-publish-btn");
  btn.disabled = true;
  btn.textContent = "Publicando...";
  try {
    const res = await fetch("/api/posts", { method: "POST", headers: { Authorization: "Bearer " + authToken }, body: fd });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "No se pudo publicar."; return; }
    document.getElementById("create-modal").classList.add("hidden");
    loadVideosFeed();
    loadMyVideos();
  } catch (e) {
    errEl.textContent = "Error de conexión.";
  } finally {
    btn.disabled = false;
    btn.textContent = t("btn_publish");
  }
});

// ---------------- Visor de publicaciones a pantalla completa ---------------
let currentViewedPost = null;

let currentSwipeList = [];
let currentSwipeIndex = 0;

function openPostViewer(post, list, index) {
  currentViewedPost = post;
  currentSwipeList = list || [post];
  currentSwipeIndex = index !== undefined ? index : 0;
  const mediaWrap = document.getElementById("post-viewer-media");
  mediaWrap.className = "";
  const railEl = document.getElementById("post-viewer-rail");

  if (post.isLive) {
    // Esto no es una publicación, es un en vivo mezclado en el feed — se muestra distinto,
    // con un botón grande para entrar, en vez de la barra de like/comentar/etc.
    railEl.classList.add("hidden");
    mediaWrap.classList.add("live-preview-card");
    mediaWrap.innerHTML = `
      <div class="live-preview-badge">🔴 EN VIVO · ${post.spectatorCount} mirando</div>
      <div class="live-preview-players">${(post.players || []).map(escapeHtml).join(" · ")}</div>
      <div class="live-preview-meta">Sala ${escapeHtml(post.code)} · ${(post.players || []).length}/${post.capacity} jugadores</div>
      <button class="btn-watch" id="live-preview-enter-btn">▶ Entrar al vivo</button>
    `;
    document.getElementById("live-preview-enter-btn").addEventListener("click", () => {
      location.href = "/?watch=" + post.code;
    });
    document.getElementById("post-viewer-author").textContent = "";
    document.getElementById("post-viewer-caption").textContent = "";
    document.getElementById("post-viewer-avatar").style.display = "none";
    document.getElementById("post-viewer-avatar-fallback").style.display = "none";
    document.getElementById("post-viewer").classList.remove("hidden");
    return;
  }
  railEl.classList.remove("hidden");
  mediaWrap.classList.remove("live-preview-card");

  if (post.type === "video") {
    mediaWrap.innerHTML = `<video src="${post.fileUrl}" autoplay loop playsinline></video>`;
    const videoEl = mediaWrap.querySelector("video");
    videoEl.addEventListener("click", () => { if (videoEl.paused) videoEl.play(); else videoEl.pause(); });
  } else if (post.type === "photo") {
    mediaWrap.innerHTML = `<img src="${post.fileUrl}" alt="" />`;
  } else {
    mediaWrap.classList.add("text-post");
    mediaWrap.innerHTML = `<p>${escapeHtml(post.caption)}</p>`;
  }
  document.getElementById("post-viewer-author").textContent = post.authorName;
  const pvAvatar = document.getElementById("post-viewer-avatar");
  const pvAvatarFallback = document.getElementById("post-viewer-avatar-fallback");
  if (post.authorAvatar) {
    pvAvatar.src = post.authorAvatar;
    pvAvatar.style.display = "block";
    pvAvatarFallback.style.display = "none";
  } else {
    pvAvatar.style.display = "none";
    pvAvatarFallback.style.display = "flex";
    pvAvatarFallback.textContent = (post.authorName || "?").trim().charAt(0).toUpperCase();
    pvAvatarFallback.style.background = colorForName(post.authorName || "?");
  }
  document.getElementById("post-viewer-caption").textContent = post.type === "text" ? "" : (post.caption || "");
  document.getElementById("post-like-count").textContent = post.likeCount;
  document.getElementById("post-like-btn").classList.toggle("active", post.likedByMe);
  document.getElementById("post-comment-count").textContent = (post.comments || []).length;
  const toggleCommentsBtn = document.getElementById("post-toggle-comments-btn");
  const isMyOwnPostForComments = post.authorEmail === myEmail;
  toggleCommentsBtn.classList.toggle("hidden", !isMyOwnPostForComments);
  if (isMyOwnPostForComments) {
    toggleCommentsBtn.textContent = post.commentsClosed ? "🔓" : "🔒";
    toggleCommentsBtn.title = post.commentsClosed ? "Abrir comentarios de nuevo" : "Cerrar comentarios";
  }
  document.getElementById("post-save-btn").classList.toggle("active", !!post.savedByMe);
  const followBtn = document.getElementById("post-follow-btn");
  const isMyOwnPost = post.authorEmail === myEmail;
  followBtn.classList.toggle("hidden", isMyOwnPost);
  followBtn.innerHTML = post.isFollowingAuthor ? "✓" : '<span class="fab-plus-mini"></span>';
  followBtn.classList.toggle("active", !!post.isFollowingAuthor);
  document.getElementById("post-viewer").classList.remove("hidden");

  // Avisamos al servidor que se vio esta publicación (alimenta el algoritmo "Para ti")
  fetch("/api/posts/" + post.id + "/view", { method: "POST", headers: { Authorization: "Bearer " + authToken } }).catch(() => {});
}

// ---------------- Deslizar entre publicaciones (como TikTok) ----------------
function swipeToPost(direction) {
  if (!currentSwipeList.length) return;
  const nextIndex = currentSwipeIndex + direction;
  if (nextIndex < 0 || nextIndex >= currentSwipeList.length) {
    if (nextIndex >= currentSwipeList.length) showToast("Ya viste todo por ahora, ¡volvé más tarde por más!");
    return;
  }
  openPostViewer(currentSwipeList[nextIndex], currentSwipeList, nextIndex);
}

document.getElementById("post-nav-up").addEventListener("click", () => swipeToPost(-1));
document.getElementById("post-nav-down").addEventListener("click", () => swipeToPost(1));

(function setupPostSwipeGestures() {
  const viewer = document.getElementById("post-viewer");
  let touchStartY = null;
  let touchStartX = null;
  let isDraggingVertically = false;
  let wheelLocked = false;

  viewer.addEventListener("touchstart", (e) => {
    if (e.target.closest("#post-comments-sheet") || e.target.closest("#post-viewer-rail") || e.target.closest("#post-viewer-nav")) { touchStartY = null; return; }
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    isDraggingVertically = false;
  }, { passive: true });

  viewer.addEventListener("touchmove", (e) => {
    if (touchStartY === null) return;
    const dy = e.touches[0].clientY - touchStartY;
    const dx = e.touches[0].clientX - touchStartX;
    if (!isDraggingVertically && Math.abs(dy) > 15 && Math.abs(dy) > Math.abs(dx)) {
      isDraggingVertically = true;
    }
    if (isDraggingVertically && e.cancelable) e.preventDefault(); // frena el scroll/gesto nativo del navegador mientras deslizamos
  }, { passive: false });

  viewer.addEventListener("touchend", (e) => {
    if (touchStartY === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    if (!isDraggingVertically || Math.abs(deltaY) < 45) return; // deslizamiento muy chico, lo ignoramos
    swipeToPost(deltaY < 0 ? 1 : -1); // deslizar hacia arriba = siguiente publicación
  }, { passive: true });

  viewer.addEventListener("wheel", (e) => {
    if (e.target.closest("#post-comments-sheet")) return;
    if (wheelLocked) return;
    wheelLocked = true;
    setTimeout(() => (wheelLocked = false), 500);
    swipeToPost(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
})();

function closePostViewer() {
  document.getElementById("post-viewer").classList.add("hidden");
  document.getElementById("post-viewer-media").innerHTML = "";
  document.getElementById("post-comments-sheet").classList.add("hidden");
  currentViewedPost = null;
  currentSwipeList = [];
  currentSwipeIndex = 0;
  // Volvemos a la pestaña "En vivo" (la de "Para ti" ya no tiene grilla que mostrar,
  // ahora es directamente el visor de pantalla completa que se acaba de cerrar).
  document.querySelectorAll(".feed-switch-btn").forEach((b) => b.classList.toggle("selected", b.dataset.feed === "live"));
  document.getElementById("feed-live-view").classList.remove("hidden");
  document.getElementById("feed-videos-view").classList.add("hidden");
}
document.getElementById("post-viewer-close").addEventListener("click", closePostViewer);
document.getElementById("post-viewer-search-btn").addEventListener("click", () => {
  closePostViewer();
  switchLobbyTab("search");
});

document.getElementById("post-like-btn").addEventListener("click", async () => {
  if (!currentViewedPost) return;
  try {
    const res = await fetch("/api/posts/" + currentViewedPost.id + "/like", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    document.getElementById("post-like-count").textContent = data.likeCount;
    document.getElementById("post-like-btn").classList.toggle("active", data.liked);
    currentViewedPost.likeCount = data.likeCount;
    currentViewedPost.likedByMe = data.liked;
  } catch (e) {}
});

document.getElementById("post-save-btn").addEventListener("click", async () => {
  if (!currentViewedPost) return;
  try {
    const res = await fetch("/api/posts/" + currentViewedPost.id + "/save", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    document.getElementById("post-save-btn").classList.toggle("active", data.saved);
    currentViewedPost.savedByMe = data.saved;
    showToast(data.saved ? "Guardado en tu perfil." : "Lo sacaste de guardados.");
  } catch (e) {}
});

document.getElementById("post-follow-btn").addEventListener("click", async () => {
  if (!currentViewedPost) return;
  const btn = document.getElementById("post-follow-btn");
  const nowFollowing = !currentViewedPost.isFollowingAuthor;
  try {
    await fetch("/api/" + (nowFollowing ? "follow" : "unfollow"), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ email: currentViewedPost.authorEmail }),
    });
    currentViewedPost.isFollowingAuthor = nowFollowing;
    btn.innerHTML = nowFollowing ? "✓" : '<span class="fab-plus-mini"></span>';
    btn.classList.toggle("active", nowFollowing);
    showToast(nowFollowing ? "Ahora seguís a " + currentViewedPost.authorName : "Dejaste de seguir a " + currentViewedPost.authorName);
  } catch (e) {}
});

document.getElementById("post-message-btn").addEventListener("click", () => {
  if (!currentViewedPost) return;
  closePostViewer();
  switchLobbyTab("messages");
  openThread(currentViewedPost.authorEmail, currentViewedPost.authorName);
});

document.getElementById("post-subscribe-btn").addEventListener("click", () => {
  if (!currentViewedPost) return;
  const email = currentViewedPost.authorEmail;
  const name = currentViewedPost.authorName;
  closePostViewer();
  openSubscribeModal(email, name);
});

// ---------------- Descargar con marca de agua ----------------
document.getElementById("post-download-btn").addEventListener("click", async () => {
  if (!currentViewedPost) return;
  if (currentViewedPost.type === "text") { showToast("Las publicaciones de texto no se pueden descargar."); return; }
  showToast("Preparando la descarga con marca de agua...");
  try {
    const res = await fetch("/api/posts/" + currentViewedPost.id + "/download", { headers: { Authorization: "Bearer " + authToken } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || "No se pudo descargar.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tablelive_" + currentViewedPost.id + (currentViewedPost.type === "video" ? ".mp4" : ".jpg");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    showToast("Error de conexión al descargar.");
  }
});

// ---------------- Denunciar ----------------
document.getElementById("post-report-btn").addEventListener("click", () => {
  if (!currentViewedPost) return;
  document.getElementById("report-details").value = "";
  document.getElementById("report-msg").textContent = "";
  document.getElementById("report-modal").classList.remove("hidden");
});
document.getElementById("close-report-modal").addEventListener("click", () => {
  document.getElementById("report-modal").classList.add("hidden");
});
document.getElementById("submit-report-btn").addEventListener("click", async () => {
  if (!currentViewedPost) return;
  const reason = document.getElementById("report-reason").value;
  const details = document.getElementById("report-details").value.trim();
  const msgEl = document.getElementById("report-msg");
  msgEl.textContent = "Enviando...";
  msgEl.style.color = "#cfe3da";
  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ type: "post", targetId: currentViewedPost.id, reason, details }),
    });
    const data = await res.json();
    if (!res.ok) { msgEl.textContent = data.error || "No se pudo denunciar."; msgEl.style.color = "#ff8a80"; return; }
    msgEl.textContent = "Gracias, la vamos a revisar.";
    msgEl.style.color = "#8fd4a8";
    setTimeout(() => document.getElementById("report-modal").classList.add("hidden"), 1200);
  } catch (e) {
    msgEl.textContent = "Error de conexión.";
    msgEl.style.color = "#ff8a80";
  }
});

// ---------------- Compartir por mensaje privado ----------------
let sharePostSearchTimeout = null;
document.getElementById("post-share-btn").addEventListener("click", () => {
  if (!currentViewedPost) return;
  document.getElementById("share-post-search").value = "";
  document.getElementById("share-post-results").innerHTML = '<p class="empty-msg-small">Escribí un nombre para buscar a quién mandársela.</p>';
  document.getElementById("share-post-msg").textContent = "";
  document.getElementById("share-post-modal").classList.remove("hidden");
});
document.getElementById("close-share-post-modal").addEventListener("click", () => {
  document.getElementById("share-post-modal").classList.add("hidden");
});
document.getElementById("share-post-search").addEventListener("input", (e) => {
  clearTimeout(sharePostSearchTimeout);
  const q = e.target.value.trim();
  const wrap = document.getElementById("share-post-results");
  if (!q) { wrap.innerHTML = ""; return; }
  sharePostSearchTimeout = setTimeout(async () => {
    try {
      const res = await fetch("/api/search-players?q=" + encodeURIComponent(q), { headers: { Authorization: "Bearer " + authToken } });
      const data = await res.json();
      if (!data.results.length) { wrap.innerHTML = '<p class="empty-msg-small">Nadie encontrado.</p>'; return; }
      wrap.innerHTML = data.results.map((p) => `
        <div class="share-post-result-row">
          <span>${escapeHtml(p.name)}</span>
          <button data-share-to="${escapeHtml(p.email)}">Mandar</button>
        </div>
      `).join("");
      wrap.querySelectorAll("[data-share-to]").forEach((btn) => {
        btn.addEventListener("click", () => sendSharedPost(btn.dataset.shareTo));
      });
    } catch (e) {
      wrap.innerHTML = '<p class="empty-msg-small">Error buscando.</p>';
    }
  }, 350);
});
async function sendSharedPost(toEmail) {
  if (!currentViewedPost) return;
  const msgEl = document.getElementById("share-post-msg");
  msgEl.textContent = "Enviando...";
  try {
    const res = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ to: toEmail, text: "Te compartí una publicación 👀", sharedPostId: currentViewedPost.id }),
    });
    const data = await res.json();
    if (!res.ok) { msgEl.textContent = data.error || "No se pudo enviar."; return; }
    msgEl.textContent = "¡Enviado!";
    setTimeout(() => document.getElementById("share-post-modal").classList.add("hidden"), 900);
  } catch (e) {
    msgEl.textContent = "Error de conexión.";
  }
}

function renderPostComments() {
  const wrap = document.getElementById("post-comments-list");
  const comments = (currentViewedPost && currentViewedPost.comments) || [];
  if (!comments.length) { wrap.innerHTML = '<p class="empty-msg-small">Sé el primero en comentar.</p>'; return; }
  wrap.innerHTML = comments.map((c) => {
    const initial = (c.name || "?").trim().charAt(0).toUpperCase();
    return `<div class="post-comment-row">
      <span class="chat-line-avatar" style="background:${colorForName(c.name || "?")}">${initial}</span>
      <span class="post-comment-text"><b>${escapeHtml(c.name)}</b> ${escapeHtml(c.text)}</span>
    </div>`;
  }).join("");
  wrap.scrollTop = wrap.scrollHeight;
}

document.getElementById("post-comment-btn").addEventListener("click", () => {
  if (!currentViewedPost) return;
  renderPostComments();
  document.getElementById("post-comments-sheet").classList.remove("hidden");
});
document.getElementById("post-toggle-comments-btn").addEventListener("click", async () => {
  if (!currentViewedPost) return;
  const nowClosed = !currentViewedPost.commentsClosed;
  if (nowClosed && !confirm("¿Cerrar los comentarios de esta publicación? Nadie va a poder comentar.")) return;
  try {
    const res = await fetch("/api/posts/" + currentViewedPost.id + "/toggle-comments", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    currentViewedPost.commentsClosed = data.commentsClosed;
    const btn = document.getElementById("post-toggle-comments-btn");
    btn.textContent = data.commentsClosed ? "🔓" : "🔒";
    showToast(data.commentsClosed ? "Comentarios cerrados." : "Comentarios abiertos de nuevo.");
  } catch (e) {}
});
document.getElementById("post-comments-close").addEventListener("click", () => {
  document.getElementById("post-comments-sheet").classList.add("hidden");
});
document.getElementById("post-comment-send-btn").addEventListener("click", sendPostComment);
document.getElementById("post-comment-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendPostComment(); });
async function sendPostComment() {
  const input = document.getElementById("post-comment-input");
  const text = input.value.trim();
  if (!text || !currentViewedPost) return;
  try {
    const res = await fetch("/api/posts/" + currentViewedPost.id + "/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) return;
    input.value = "";
    currentViewedPost.comments.push(data.comment);
    document.getElementById("post-comment-count").textContent = data.commentCount;
    renderPostComments();
  } catch (e) {}
}

// ---------------- Mensajes (bandeja persistente, tipo TikTok) ----------------
let currentThreadEmail = null;
let threadPollInterval = null;

function stopThreadPolling() {
  if (threadPollInterval) { clearInterval(threadPollInterval); threadPollInterval = null; }
}

async function loadConversations() {
  const wrap = document.getElementById("conversations-list");
  try {
    const res = await fetch("/api/messages/conversations", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.conversations.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no tenés conversaciones. Escribile a alguien desde Buscar.</p>'; return; }
    wrap.innerHTML = data.conversations.map((c) => {
      const avatar = c.avatarUrl
        ? `<img class="conversation-avatar" src="${c.avatarUrl}" />`
        : `<span class="conversation-avatar-fallback">${escapeHtml((c.name || "?").charAt(0).toUpperCase())}</span>`;
      const prefix = c.lastFromMe ? "Vos: " : "";
      return `<div class="conversation-row" data-email="${escapeHtml(c.email)}" data-name="${escapeHtml(c.name)}">
        ${avatar}
        <div class="conversation-body">
          <div class="conversation-name">${escapeHtml(c.name)}</div>
          <div class="conversation-preview">${escapeHtml(prefix + c.lastText)}</div>
        </div>
      </div>`;
    }).join("");
    wrap.querySelectorAll(".conversation-row").forEach((row) => {
      row.addEventListener("click", () => openThread(row.dataset.email, row.dataset.name));
    });
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando mensajes.</p>';
  }
}

// ---------------- Suscripciones: elegir nivel, confirmar, cancelar ----------------
async function openSubscribeModal(email, name) {
  document.getElementById("subscribe-target-name").textContent = name;
  document.getElementById("subscribe-msg").textContent = "";
  document.getElementById("subscribe-modal").classList.remove("hidden");
  const tiersWrap = document.getElementById("subscribe-tiers");
  tiersWrap.innerHTML = '<p class="empty-msg-small">Cargando...</p>';
  try {
    const [tiersRes, statusRes] = await Promise.all([
      fetch("/api/subscriptions/tiers", { headers: { Authorization: "Bearer " + authToken } }),
      fetch("/api/subscriptions/status/" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + authToken } }),
    ]);
    const tiersData = await tiersRes.json();
    const statusData = await statusRes.json();
    if (statusData.subscribed) {
      const exp = new Date(statusData.subscription.expiresAt).toLocaleDateString();
      tiersWrap.innerHTML = '<p style="font-size:13px;color:#8fd4a8;">Ya estás suscripto (' + statusData.subscription.tierLabel + '). Se renueva el ' + exp + '.</p>';
      return;
    }
    tiersWrap.innerHTML = Object.entries(tiersData.tiers).map(([key, t]) => `
      <div class="sub-tier-card">
        <span><span class="sub-tier-name">${t.label}</span><br><span class="sub-tier-price">${t.priceGems} 🪙 / mes</span></span>
        <button data-tier-btn="${key}">Suscribirme</button>
      </div>
    `).join("");
    tiersWrap.querySelectorAll("[data-tier-btn]").forEach((btn) => {
      btn.addEventListener("click", () => confirmSubscribe(email, btn.dataset.tierBtn));
    });
  } catch (e) {
    tiersWrap.innerHTML = '<p class="empty-msg-small">Error cargando los niveles.</p>';
  }
}

async function confirmSubscribe(creatorEmail, tier) {
  const msgEl = document.getElementById("subscribe-msg");
  msgEl.textContent = "Procesando...";
  msgEl.style.color = "#cfe3da";
  try {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ creatorEmail, tier }),
    });
    const data = await res.json();
    if (!res.ok) { msgEl.textContent = data.error || "No se pudo suscribir."; msgEl.style.color = "#ff8a80"; return; }
    myCoinBalance = data.balance;
    updateWalletDisplay();
    msgEl.textContent = "¡Listo! Ya estás suscripto.";
    msgEl.style.color = "#8fd4a8";
    setTimeout(() => document.getElementById("subscribe-modal").classList.add("hidden"), 1200);
  } catch (e) {
    msgEl.textContent = "Error de conexión.";
    msgEl.style.color = "#ff8a80";
  }
}
document.getElementById("close-subscribe-modal").addEventListener("click", () => {
  document.getElementById("subscribe-modal").classList.add("hidden");
});

async function loadMySubscriptions() {
  const wrap = document.getElementById("my-subscriptions-list");
  if (!wrap) return;
  try {
    const res = await fetch("/api/subscriptions/mine", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.subscriptions.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no apoyás a ningún creador.</p>'; return; }
    wrap.innerHTML = data.subscriptions.map((s) => `
      <div class="sub-row">
        <span>${s.tierLabel} a <b>${escapeHtml(s.creatorName)}</b><br>
          <span style="color:#9fc9b8;">${s.autoRenew ? "Se renueva" : "Vence"} el ${new Date(s.expiresAt).toLocaleDateString()}</span></span>
        ${s.autoRenew ? `<button data-cancel-sub="${s.id}">Cancelar</button>` : ""}
      </div>
    `).join("");
    wrap.querySelectorAll("[data-cancel-sub]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await fetch("/api/subscriptions/" + btn.dataset.cancelSub + "/cancel", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
        loadMySubscriptions();
      });
    });
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

// ---------------- Tienda: insignias, colores de nombre, marcos de perfil ----------------
let storeItemsCache = null;
let storeInventory = [];
let storeEquipped = {};
let selectedStoreCategory = "badge";

async function loadStoreItems() {
  try {
    const res = await fetch("/api/store/items", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    storeItemsCache = data.items;
    storeInventory = data.inventory || [];
    storeEquipped = data.equipped || {};
    renderStoreGrid();
  } catch (e) {}
}

function renderStoreGrid() {
  const wrap = document.getElementById("store-items-grid");
  if (!wrap || !storeItemsCache) return;
  const entries = Object.entries(storeItemsCache).filter(([, item]) => item.category === selectedStoreCategory);
  wrap.innerHTML = entries.map(([id, item]) => {
    const owned = storeInventory.includes(id);
    const isEquipped = storeEquipped[selectedStoreCategory] === id;
    let preview = "🏅";
    if (item.category === "badge") preview = item.emoji;
    else if (item.category === "color") preview = `<span style="color:${item.value};">●●●</span>`;
    else if (item.category === "frame") preview = `<span class="${item.cssClass}" style="display:inline-block;width:26px;height:26px;border-radius:50%;background:#1c473c;"></span>`;

    let btnHtml;
    if (!owned) btnHtml = `<button data-buy="${id}">${item.priceGems} 🪙 Comprar</button>`;
    else if (isEquipped) btnHtml = `<button class="equipped-btn" data-unequip="${selectedStoreCategory}">✅ Puesto</button>`;
    else btnHtml = `<button data-equip="${id}" data-equip-cat="${item.category}">Usar</button>`;

    return `<div class="store-item-card ${owned ? "owned" : ""}">
      <div class="store-item-preview">${preview}</div>
      <div class="store-item-name">${escapeHtml(item.name)}</div>
      <div class="store-item-price">${owned ? "Ya lo tenés" : item.priceGems + " 🪙"}</div>
      ${btnHtml}
    </div>`;
  }).join("");

  wrap.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyStoreItem(btn.dataset.buy));
  });
  wrap.querySelectorAll("[data-equip]").forEach((btn) => {
    btn.addEventListener("click", () => equipStoreItem(btn.dataset.equip, btn.dataset.equipCat));
  });
  wrap.querySelectorAll("[data-unequip]").forEach((btn) => {
    btn.addEventListener("click", () => equipStoreItem(null, btn.dataset.unequip));
  });
}

document.querySelectorAll("#store-category-tabs .cam-filter-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#store-category-tabs .cam-filter-swatch").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedStoreCategory = btn.dataset.cat;
    renderStoreGrid();
  });
});

async function buyStoreItem(itemId) {
  try {
    const res = await fetch("/api/store/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ itemId }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "No se pudo comprar."); return; }
    storeInventory = data.inventory;
    myCoinBalance = data.balance;
    updateWalletDisplay();
    showToast("¡Comprado!");
    renderStoreGrid();
  } catch (e) {
    showToast("Error de conexión.");
  }
}

async function equipStoreItem(itemId, category) {
  try {
    const res = await fetch("/api/store/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ itemId, category }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || "No se pudo usar."); return; }
    storeEquipped = data.equipped;
    renderStoreGrid();
  } catch (e) {
    showToast("Error de conexión.");
  }
}

async function loadMySubscribers() {
  const wrap = document.getElementById("my-subscribers-list");
  const summaryEl = document.getElementById("my-subscribers-summary");
  if (!wrap) return;
  try {
    const res = await fetch("/api/subscriptions/my-subscribers", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    summaryEl.textContent = data.count + " suscriptor" + (data.count === 1 ? "" : "es") + " · " + data.totalGems + " 💎/mes";
    if (!data.subscribers.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no tenés suscriptores.</p>'; return; }
    wrap.innerHTML = data.subscribers.map((s) => `
      <div class="sub-row"><span>${s.tierLabel} — <b>${escapeHtml(s.subscriberName)}</b></span></div>
    `).join("");
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

async function loadMyEarnings() {
  const activityWrap = document.getElementById("earnings-activity");
  if (!activityWrap) return;
  try {
    const res = await fetch("/api/my-earnings", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    document.getElementById("earnings-balance").textContent = data.diamondBalance;
    document.getElementById("earnings-gifts").textContent = data.giftTotal;
    document.getElementById("earnings-subs").textContent = data.subscriptionTotal;
    if (!data.recentActivity.length) {
      activityWrap.innerHTML = '<p class="empty-msg-small">Todavía no recibiste nada.</p>';
    } else {
      activityWrap.innerHTML = data.recentActivity.map((a) => `
        <div class="earnings-row">
          <span>🎁 Regalo de <b>${escapeHtml(a.fromName)}</b></span>
          <span>+${a.amount} 💎</span>
        </div>
      `).join("");
    }
  } catch (e) {
    activityWrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

async function loadMyWithdrawals() {
  const wrap = document.getElementById("my-withdrawals-list");
  if (!wrap) return;
  try {
    const res = await fetch("/api/my-withdrawals", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.withdrawals.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no pediste ningún retiro.</p>'; return; }
    wrap.innerHTML = data.withdrawals.map((w) => `
      <div class="withdrawal-row">
        <span>${new Date(w.requestedAt).toLocaleDateString()} · ${w.gemsWithdrawn} 💎 → USD $${w.payoutAmount}</span>
        <span class="withdrawal-status ${w.status}">${w.status}</span>
      </div>
    `).join("");
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

async function openThread(email, name) {
  currentThreadEmail = email;
  document.getElementById("messages-list-card").classList.add("hidden");
  document.getElementById("thread-card").classList.remove("hidden");
  document.getElementById("thread-with-name").textContent = name;
  await loadThreadMessages();
  stopThreadPolling();
  threadPollInterval = setInterval(loadThreadMessages, 4000);
}

async function loadThreadMessages() {
  if (!currentThreadEmail) return;
  try {
    const res = await fetch("/api/messages/with/" + encodeURIComponent(currentThreadEmail), { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    const wrap = document.getElementById("thread-messages");
    wrap.innerHTML = data.messages.map((m) => {
      if (m.deleted) {
        return `<div class="msg-bubble ${m.from === myEmail ? "mine" : "theirs"} msg-deleted"><i>Mensaje eliminado</i></div>`;
      }
      const sharedHtml = m.sharedPost ? renderSharedPostCard(m.sharedPost) : "";
      const deleteBtn = m.from === myEmail ? `<button class="msg-delete-btn" data-delete-msg="${m.id}" title="Borrar">🗑️</button>` : "";
      return `<div class="msg-bubble ${m.from === myEmail ? "mine" : "theirs"}">${escapeHtml(m.text)}${sharedHtml}${deleteBtn}</div>`;
    }).join("");
    wrap.scrollTop = wrap.scrollHeight;
    wrap.querySelectorAll("[data-shared-post-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const post = threadSharedPostsCache[el.dataset.sharedPostId];
        if (post) openPostViewer(post, [post], 0);
      });
    });
    wrap.querySelectorAll("[data-delete-msg]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("¿Borrar este mensaje?")) return;
        await fetch("/api/messages/" + btn.dataset.deleteMsg + "/delete", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
        loadThreadMessages();
      });
    });
  } catch (e) {}
}

let threadSharedPostsCache = {};
function renderSharedPostCard(sp) {
  threadSharedPostsCache[sp.id] = { id: sp.id, type: sp.type, authorName: sp.authorName, caption: sp.caption, fileUrl: sp.fileUrl, likeCount: 0, likedByMe: false, comments: [] };
  const preview = sp.type === "video"
    ? `<video src="${sp.fileUrl}" muted></video>`
    : sp.type === "photo" ? `<img src="${sp.fileUrl}" alt="" />` : "";
  return `<div class="shared-post-card" data-shared-post-id="${sp.id}">
    ${preview}
    <span class="shared-post-card-text">📹 De ${escapeHtml(sp.authorName)}</span>
  </div>`;
}

document.getElementById("thread-back-btn").addEventListener("click", () => {
  stopThreadPolling();
  currentThreadEmail = null;
  document.getElementById("thread-card").classList.add("hidden");
  document.getElementById("messages-list-card").classList.remove("hidden");
  loadConversations();
});

document.getElementById("thread-send-btn").addEventListener("click", sendThreadMessage);
document.getElementById("thread-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendThreadMessage(); });
async function sendThreadMessage() {
  const input = document.getElementById("thread-input");
  const text = input.value.trim();
  if (!text || !currentThreadEmail) return;
  input.value = "";
  try {
    await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ to: currentThreadEmail, text }),
    });
    loadThreadMessages();
  } catch (e) {}
}


async function loadLiveRooms() {
  const wrap = document.getElementById("live-rooms-list");
  try {
    const res = await fetch("/api/live-rooms");
    const data = await res.json();
    if (!data.rooms.length) {
      wrap.innerHTML = '<div class="feed-empty"><p>No hay ninguna partida en vivo en este momento.</p><p style="font-size:12px;color:#9fc9b8;">Tocá 🎲 abajo para armar tu propia mesa.</p></div>';
      return;
    }
    wrap.innerHTML = data.rooms.map((r) => `
      <div class="feed-card" onclick="location.href='/?watch=${r.code}'">
        <div class="feed-card-top"><span class="live-dot"></span> EN VIVO · ${r.spectatorCount} mirando</div>
        <div class="feed-card-players">${r.players.map(escapeHtml).join(" · ")}</div>
        <div class="feed-card-meta">Sala ${r.code} · ${r.players.length}/${r.capacity} jugadores</div>
        <button class="btn-watch">▶ Mirar en vivo</button>
      </div>
    `).join("");
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}
// Refresca el feed solo mientras la persona lo está mirando (pestaña "feed" activa)
setInterval(() => {
  if (lobbyEl && !lobbyEl.classList.contains("hidden") && !document.getElementById("feed-tab").classList.contains("hidden")) {
    loadLiveRooms();
  }
}, 15000);

let searchTimeout = null;
document.getElementById("search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  searchTimeout = setTimeout(() => runSearch(q, "search-results", "search-input"), 350);
});

async function runSearch(q, targetId, inputId) {
  const wrap = document.getElementById(targetId);
  if (!q) { wrap.innerHTML = ""; return; }
  try {
    const res = await fetch("/api/search-players?q=" + encodeURIComponent(q), {
      headers: { Authorization: "Bearer " + authToken },
    });
    const data = await res.json();
    if (!data.results.length) { wrap.innerHTML = '<p class="empty-msg-small">Nadie encontrado con ese nombre.</p>'; return; }
    wrap.innerHTML = data.results.map(playerRowHtml).join("");
    attachPlayerRowHandlers(wrap, inputId, targetId);
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error buscando.</p>';
  }
}

async function loadFollowing() {
  const wrap = document.getElementById("following-list");
  try {
    const res = await fetch("/api/following", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.results.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no seguís a nadie. Buscá jugadores arriba.</p>'; return; }
    wrap.innerHTML = data.results.map((r) => playerRowHtml({ ...r, isFollowing: true })).join("");
    attachPlayerRowHandlers(wrap);
    renderFollowingLiveRow(data.results);
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

// Como en TikTok: círculos arriba de Mensajes mostrando a quién de los que seguís
// está en vivo ahora mismo, tocable para entrar directo.
function renderFollowingLiveRow(list) {
  const row = document.getElementById("following-live-row");
  if (!row) return;
  const liveOnes = (list || []).filter((p) => p.isLive);
  if (!liveOnes.length) { row.classList.add("hidden"); row.innerHTML = ""; return; }
  row.classList.remove("hidden");
  row.innerHTML = liveOnes.map((p) => {
    const initial = (p.name || "?").trim().charAt(0).toUpperCase();
    const avatarHtml = p.avatarUrl
      ? `<img src="${p.avatarUrl}" alt="" />`
      : `<span class="following-live-fallback" style="background:${colorForName(p.name || "?")}">${initial}</span>`;
    return `<div class="following-live-circle" data-watch-live="${p.roomCode}">
      <div class="following-live-ring">${avatarHtml}</div>
      <span>${escapeHtml((p.name || "").slice(0, 10))}</span>
    </div>`;
  }).join("");
  row.querySelectorAll("[data-watch-live]").forEach((el) => {
    el.addEventListener("click", () => { location.href = "/?watch=" + el.dataset.watchLive; });
  });
}

function playerRowHtml(p) {
  const liveTag = p.isLive ? '<span class="live-dot"></span> en vivo' : '';
  const watchBtn = p.isLive ? `<button class="btn-watch" data-watch="${p.roomCode}">Mirar</button>` : "";
  const followBtn = p.isFollowing
    ? `<button class="btn-unfollow" data-unfollow="${escapeHtml(p.email)}">Dejar de seguir</button>`
    : `<button class="btn-follow" data-follow="${escapeHtml(p.email)}">Seguir</button>`;
  const messageBtn = `<button class="btn-message" data-message-email="${escapeHtml(p.email)}" data-message-name="${escapeHtml(p.name)}">✉️</button>`;
  const subscribeBtn = `<button class="btn-subscribe" data-sub-email="${escapeHtml(p.email)}" data-sub-name="${escapeHtml(p.name)}">🌟</button>`;
  return `<div class="player-row">
    <span class="player-name player-name-clickable" data-open-profile="${escapeHtml(p.email)}">${escapeHtml(p.name)} ${liveTag ? '· ' + liveTag : ''}</span>
    <span class="player-actions">${watchBtn}${followBtn}${messageBtn}${subscribeBtn}</span>
  </div>`;
}

function attachPlayerRowHandlers(wrap, inputId, resultsId) {
  inputId = inputId || "search-input";
  resultsId = resultsId || "search-results";
  wrap.querySelectorAll("[data-open-profile]").forEach((el) => {
    el.addEventListener("click", () => openUserProfile(el.dataset.openProfile));
  });
  wrap.querySelectorAll("[data-message-email]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchLobbyTab("messages");
      openThread(btn.dataset.messageEmail, btn.dataset.messageName);
    });
  });
  wrap.querySelectorAll("[data-follow]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch("/api/follow", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken }, body: JSON.stringify({ email: btn.dataset.follow }) });
      runSearch(document.getElementById(inputId).value.trim(), resultsId);
      loadFollowing();
    });
  });
  wrap.querySelectorAll("[data-unfollow]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch("/api/unfollow", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken }, body: JSON.stringify({ email: btn.dataset.unfollow }) });
      runSearch(document.getElementById(inputId).value.trim(), resultsId);
      loadFollowing();
    });
  });
  wrap.querySelectorAll("[data-watch]").forEach((btn) => {
    btn.addEventListener("click", () => { location.href = "/?watch=" + btn.dataset.watch; });
  });
  wrap.querySelectorAll("[data-sub-email]").forEach((btn) => {
    btn.addEventListener("click", () => openSubscribeModal(btn.dataset.subEmail, btn.dataset.subName));
  });
}

// Actualizamos quién está en vivo cada 8 segundos mientras estás en el lobby
setInterval(() => {
  if (!lobbyEl.classList.contains("hidden")) {
    loadFollowing();
    loadLiveRooms();
    const q = document.getElementById("search-input").value.trim();
    if (q) runSearch(q, "search-results", "search-input");
  }
}, 8000);

function connectSocket() {
  socket = io({ auth: { token: authToken } });
  attachSocketHandlers();
  socket.on("platformAnnouncement", (data) => {
    alert("📢 Aviso de TableLive:\n\n" + data.text);
  });
}

let watchingAsGuest = false;

// ---------------- Deslizar para pasar a otra transmisión en vivo (como TikTok LIVE) ----------------
let liveSwipeList = []; // ahora guarda {code, hostName} de cada sala, no solo el código
let liveSwipeLocked = false;

async function setupLiveSwipeGestures() {
  try {
    const res = await fetch("/api/live-rooms");
    const data = await res.json();
    liveSwipeList = (data.rooms || []).map((r) => ({ code: r.code, hostName: (r.players && r.players[0]) || "En vivo" }));
  } catch (e) { liveSwipeList = []; }

  document.getElementById("live-nav").classList.add("visible");
  document.getElementById("live-nav-up").addEventListener("click", () => goToNextLive(-1));
  document.getElementById("live-nav-down").addEventListener("click", () => goToNextLive(1));

  const target = document.getElementById("video-bar");
  if (!target || target.dataset.swipeWired) return;
  target.dataset.swipeWired = "1";

  let touchStartY = null;
  let touchStartX = null;
  let isDraggingVertically = false;

  target.addEventListener("touchstart", (e) => {
    if (mySeatIndex !== null) { touchStartY = null; return; } // si estás jugando, no deslizamos para no interrumpirte
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
    isDraggingVertically = false;
  }, { passive: true });

  target.addEventListener("touchmove", (e) => {
    if (touchStartY === null) return;
    const dy = e.touches[0].clientY - touchStartY;
    const dx = e.touches[0].clientX - touchStartX;
    if (!isDraggingVertically && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) isDraggingVertically = true;
    if (isDraggingVertically && e.cancelable) e.preventDefault();
  }, { passive: false });

  target.addEventListener("touchend", (e) => {
    if (mySeatIndex !== null || touchStartY === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    if (!isDraggingVertically || Math.abs(deltaY) < 30) return; // deslizamiento muy chico, lo ignoramos
    goToNextLive(deltaY < 0 ? 1 : -1);
  }, { passive: true });

  target.addEventListener("wheel", (e) => {
    if (mySeatIndex !== null) return;
    if (liveSwipeLocked) return;
    liveSwipeLocked = true;
    setTimeout(() => (liveSwipeLocked = false), 700);
    goToNextLive(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
}

function goToNextLive(direction) {
  if (!liveSwipeList.length) { showToast("No hay otras transmisiones en vivo ahora mismo."); return; }
  const currentIdx = liveSwipeList.findIndex((r) => r.code === watchCode);
  let nextIdx = (currentIdx === -1 ? 0 : currentIdx) + direction;
  if (nextIdx < 0) nextIdx = liveSwipeList.length - 1;
  if (nextIdx >= liveSwipeList.length) nextIdx = 0;
  const next = liveSwipeList[nextIdx];
  if (!next || next.code === watchCode) { showToast("No hay otra transmisión para mostrar todavía."); return; }
  switchToLive(next.code, next.hostName);
}

// Cambia de transmisión SIN recargar la página entera — mucho más rápido y sin el
// "pantallazo" en blanco de una recarga completa. Reusa la misma conexión de socket.
function switchToLive(newCode, hostNameHint) {
  leaveVideo(); // corta el video de la sala anterior antes de irnos
  document.getElementById("chat-messages").innerHTML = "";
  document.getElementById("on-camera-strip").innerHTML = "";
  document.getElementById("battle-bar").classList.add("hidden");
  document.getElementById("battle-result-overlay").classList.add("hidden");
  clearInterval(battleTimerInterval);
  lastBattleId = null;
  currentBattleInfo = null;
  clearInterval(liveTimerInterval);
  liveTimerStartedFor = null;
  mySeatIndex = null;
  myQueuePosition = null;

  // Vista previa instantánea: mostramos el nombre de quien transmite ya mismo, sin
  // esperar a que llegue el estado nuevo por el socket (se siente inmediato).
  if (hostNameHint) document.getElementById("room-label").textContent = "🔴 " + hostNameHint + " · " + newCode;

  watchCode = newCode;
  document.getElementById("spectate-code").textContent = watchCode;
  history.replaceState(null, "", "/?watch=" + newCode);
  socket.emit("spectateRoom", { code: newCode, name: myName || "Espectador" });
}

function startSpectating(name) {
  authEl.classList.add("hidden");
  document.getElementById("spectate-prompt").classList.add("hidden");
  spectateEl.classList.remove("hidden");
  document.getElementById("spectate-code").textContent = watchCode;
  setupLiveSwipeGestures();

  if (authToken) {
    socket = io({ auth: { token: authToken } });
  } else {
    watchingAsGuest = true;
    socket = io({ auth: {} });
  }
  socket.on("connect", () => socket.emit("spectateRoom", { code: watchCode, name: name || myName || "Espectador" }));
  wireBattleSocketEvents(socket);
  wireModerationSocketEvents(socket);
  wireRtcSocketEvents(socket);
  wireMeetingSocketEvents(socket);
  socket.on("errorMsg", (msg) => { document.getElementById("spectate-info").textContent = msg; });
  socket.on("balance", (bal) => {
    myCoinBalance = bal.coins;
    myDiamondBalance = bal.diamonds;
    updateWalletDisplay();
  });
  socket.on("giftError", (msg) => showToast(msg));
  socket.on("giftEvent", (g) => showToast(g.from + " le regaló " + g.amount + " 💎 a " + g.to + "!"));
  socket.on("likeEvent", (l) => { if (l.from !== myName) showToast(l.from + " le dio ❤️ a alguien"); });
  socket.on("reactionEvent", (r) => spawnFloatingEmoji(r.emoji));
  socket.on("privateMessageEvent", (p) => { renderPrivateMessage(p); if (p.to === myName && p.from !== myName && privateChatWith !== p.from) showToast(p.from + " te mandó un mensaje privado"); });
  socket.on("cameraRequestEvent", (data) => renderCameraPanel(data));
  socket.on("commentEvent", (c) => appendChatLine(c));
  socket.on("joined", (data) => {
    // El espectador pidió un asiento (botón "Quiero jugar") y se lo dieron: pasa a jugar
    // sin salir de la pantalla en vivo.
    mySeatIndex = data.seatIndex;
    myQueuePosition = null;
    updateModeratorStatus();
    document.getElementById("my-area").classList.remove("hidden");
    document.getElementById("wallet-bar").classList.remove("hidden");
  });
  socket.on("hand", (hand) => { myHand = hand; renderHand(); });
  socket.on("queued", () => {
    document.getElementById("request-seat-btn").classList.add("hidden");
    showToast("La mesa está llena por ahora. Te avisamos si se libera un lugar.");
  });
  socket.on("state", (state) => {
    latestState = state;
    renderSpectatorView(state);
  });
}

if (watchCode) {
  if (authToken) {
    startSpectating(myName);
  } else {
    authEl.classList.add("hidden");
    lobbyEl.classList.add("hidden");
    document.getElementById("spectate-prompt").classList.remove("hidden");
    document.getElementById("spectate-name-input").value = localStorage.getItem("domino_last_guest_name") || "";
    document.getElementById("spectate-enter-btn").addEventListener("click", () => {
      const name = document.getElementById("spectate-name-input").value.trim() || "Espectador";
      localStorage.setItem("domino_last_guest_name", name);
      startSpectating(name);
    });
    document.getElementById("spectate-login-link").addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("spectate-prompt").classList.add("hidden");
      authEl.classList.remove("hidden");
      switchTab("login");
    });
  }
} else if (authToken) {
  connectSocket();
  showLobby();
} else {
  switchTab("login");
}

function renderSpectatorView(state) {
  const amPlaying = mySeatIndex !== null;
  document.getElementById("spectate-info").innerHTML =
    (state.started ? "Partida en curso" : "Esperando que se complete la mesa (" + state.seats.filter((s) => s.name).length + "/" + state.capacity + ")") +
    " · " + (state.spectatorCount || 0) + " personas mirando";
  gameEl.classList.remove("hidden");
  document.getElementById("my-area").classList.toggle("hidden", !amPlaying);
  if (!amPlaying) document.getElementById("play-actions").classList.add("hidden");
  if (authToken) {
    document.getElementById("wallet-bar").classList.remove("hidden");
  } else {
    document.getElementById("wallet-bar").classList.add("hidden");
  }
  // Arreglo importante: quien mira necesita estar conectado al video para poder
  // ESCUCHAR al que transmite (aunque su propio mic/cámara sigan apagados). Por eso
  // esto ya no es opcional para quien mira — se conecta solo, en silencio.
  setupVideoIfNeeded(state.code);
  startLiveTimer(state.code, state.liveStartedAt);
  renderGame(state, !amPlaying);
}

// ---------------- Aviso de "alguien que seguís se puso en vivo" ----------------
function showFollowedLiveBanner(data) {
  const existing = document.getElementById("followed-live-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.id = "followed-live-banner";
  const initial = (data.hostName || "?").trim().charAt(0).toUpperCase();
  const avatarHtml = data.hostAvatar
    ? `<img src="${data.hostAvatar}" alt="" />`
    : `<span class="followed-live-avatar-fallback" style="background:${colorForName(data.hostName || "?")}">${initial}</span>`;
  banner.innerHTML = `
    ${avatarHtml}
    <span class="followed-live-text">🔴 <b>${escapeHtml(data.hostName)}</b> se puso en vivo</span>
    <button id="followed-live-close">✕</button>
  `;
  banner.addEventListener("click", (e) => {
    if (e.target.id === "followed-live-close") { banner.remove(); return; }
    location.href = "/?watch=" + data.code;
  });
  document.body.appendChild(banner);
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 12000);
}

function attachSocketHandlers() {
  wireBattleSocketEvents(socket);
  wireModerationSocketEvents(socket);
  wireRtcSocketEvents(socket);
  wireMeetingSocketEvents(socket);
  socket.on("followedUserWentLive", (data) => {
    showFollowedLiveBanner(data);
  });
  socket.on("connect_error", () => {
    // Esto NO significa que la sesión venció — el servidor nunca rechaza la conexión
    // por un token viejo, así que esto es casi siempre un corte de red momentáneo
    // (wifi que se corta un instante, el servidor recién despertando, etc). Por eso
    // ya no te saca de la cuenta ni te pide entrar de nuevo: el socket reintenta solo.
    showConnectionBanner("Reconectando...");
  });
  socket.on("connect", () => {
    hideConnectionBanner();
  });
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect" || reason === "io client disconnect") return; // fue algo intencional, no un corte
    showConnectionBanner("Reconectando...");
  });

  createBtn.addEventListener("click", () => { closeDominoModal(); iAmCreatingRoom = true; socket.emit("createRoom", { capacity: selectedCap, handSize: selectedHandSize }); });
  joinBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) return;
    lobbyError.textContent = "Buscando la sala...";
    try {
      const res = await fetch("/api/room-status/" + encodeURIComponent(code.toUpperCase()));
      const data = await res.json();
      lobbyError.textContent = "";
      if (!data.exists) { lobbyError.textContent = "Esa sala no existe. Revisá el código."; return; }
      if (data.full) {
        showQueueConfirm(
          "Esa sala ya está llena (" + data.playersCount + "/" + data.capacity + " jugadores). ¿Querés entrar a la fila de espera? Vas a entrar a jugar automáticamente apenas alguien se vaya.",
          () => { closeDominoModal(); socket.emit("joinRoom", { code }); }
        );
      } else {
        closeDominoModal();
        socket.emit("joinRoom", { code });
      }
    } catch (e) {
      lobbyError.textContent = "Error de conexión.";
    }
  });

  function showQueueConfirm(text, onYes) {
    const modal = document.getElementById("queue-confirm");
    document.getElementById("queue-confirm-text").textContent = text;
    modal.classList.remove("hidden");
    document.getElementById("queue-confirm-yes").onclick = () => { modal.classList.add("hidden"); onYes(); };
    document.getElementById("queue-confirm-no").onclick = () => { modal.classList.add("hidden"); };
  }

  socket.on("errorMsg", (msg) => { lobbyError.textContent = msg; });

  socket.on("joined", (data) => {
    mySeatIndex = data.seatIndex;
    myQueuePosition = null;
    updateModeratorStatus();
    lobbyEl.classList.add("hidden");
    document.getElementById("waiting-code").textContent = data.code;
    document.getElementById("waiting-code-big").textContent = data.code;
    document.getElementById("copy-spectate-link").onclick = () => {
      const link = location.origin + "/?watch=" + data.code;
      navigator.clipboard.writeText(link).then(() => {
        document.getElementById("spectate-link-msg").textContent = "¡Copiado! Cualquiera que lo abra puede mirar la partida en vivo, sin necesitar cuenta.";
      }).catch(() => {
        document.getElementById("spectate-link-msg").textContent = link;
      });
    };
  });

  socket.on("queued", (data) => {
    // Estar en la fila ya NO tapa la pantalla: la persona sigue viendo el video, el chat
    // y el tablero (en modo mirar) con total normalidad mientras espera su turno de jugar.
    myQueuePosition = data.position;
    showToast("Estás en la fila de espera (posición " + data.position + "). Te avisamos apenas se libere un lugar.");
  });

  socket.on("hand", (hand) => { myHand = hand; renderHand(); });

  socket.on("balance", (bal) => {
    myCoinBalance = bal.coins;
    myDiamondBalance = bal.diamonds;
    updateWalletDisplay();
  });

  socket.on("giftError", (msg) => showToast(msg));
  socket.on("giftEvent", (g) => showToast(g.from + " le regaló " + g.amount + " 💎 a " + g.to + "!"));
  socket.on("likeEvent", (l) => {
    if (l.from !== myName) showToast(l.from + " le dio ❤️ a alguien");
  });
  socket.on("reactionEvent", (r) => spawnFloatingEmoji(r.emoji));
  socket.on("privateMessageEvent", (p) => { renderPrivateMessage(p); if (p.to === myName && p.from !== myName && privateChatWith !== p.from) showToast(p.from + " te mandó un mensaje privado"); });
  socket.on("cameraRequestEvent", (data) => renderCameraPanel(data));
  socket.on("commentEvent", (c) => appendChatLine(c));

  socket.on("state", (state) => {
    latestState = state;
    // El chat, los regalos y el dominó se ven apenas entrás a la sala. Si vos creaste
    // esta transmisión, el video se conecta solo, con mic y cámara activados, para que
    // te escuchen y te vean claro desde el primer segundo. Si solo te uniste a jugar
    // (no la creaste vos), el video queda opcional, se conecta desde ⚙️ Ajustes.
    waitingEl.classList.add("hidden");
    gameEl.classList.remove("hidden");
    currentVideoRoomCode = state.code;
    // Todos los que entran (creen la sala o se sumen a jugar) se conectan al video para
    // poder escucharse entre sí. Si vos la creaste, arrancás con mic/cámara prendidos
    // (sos quien transmite); si te sumaste a jugar, arrancás en silencio hasta que
    // decidas mostrarte, pero igual escuchás todo desde el primer segundo.
    setupVideoIfNeeded(state.code, iAmCreatingRoom);
    iAmCreatingRoom = false;
    startLiveTimer(state.code, state.liveStartedAt);
    renderGame(state);
  });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Cada valor de ficha (0 al 6) tiene su propio color fijo, así cada combinación
// de dos números se ve como una mezcla única de esos dos colores.
const PIP_COLORS = {
  0: "#7d8b99", 1: "#f0a63e", 2: "#2f9e73", 3: "#4d76e0",
  4: "#e0524a", 5: "#a15ae0", 6: "#1fb3a8",
};
function tileColors(tile) {
  return [PIP_COLORS[tile[0]], PIP_COLORS[tile[1]]];
}

let tileStyle = localStorage.getItem("domino_tile_style") || "numbers";

const PIP_PATTERNS = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function pipGridHtml(value) {
  const dots = PIP_PATTERNS[value] || [];
  const cells = dots.map(([r, c]) => `<span class="pip-dot" style="grid-row:${r + 1};grid-column:${c + 1};"></span>`).join("");
  return '<div class="pip-grid">' + cells + "</div>";
}

// Dibuja una mitad de ficha con el estilo elegido: números con color, o puntitos sobre color
function renderHalf(value, color) {
  if (tileStyle === "dots") {
    return `<div class="domino-half dots" style="background:${color};">${pipGridHtml(value)}</div>`;
  }
  return `<div class="domino-half" style="background:${color};">${value}</div>`;
}

// La transmisión (el video en sí) se conecta sola apenas entrás a una sala en vivo, así
// cualquiera puede MIRAR sin tener que prender nada propio — como en TikTok Live.
// Lo que sí es opcional es prender TU cámara/micrófono para aparecer vos en el video.
// ==================== Video propio (WebRTC), sin Jitsi ====================
// Conecta a la gente directo entre sí (audio/video viaja de celular a celular,
// nunca pasa por nuestro servidor). El servidor solo ayuda a "presentarse" al
// principio (ver los eventos rtc-* del socket).
const RTC_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

let localStream = null;
let peerConnections = {}; // socketId -> RTCPeerConnection (mi propia sala)
let opponentPeerConnections = {}; // socketId -> RTCPeerConnection (sala del rival, durante una batalla)
let rtcRoomCode = null;
let rtcOpponentRoomCode = null;
let myMicOn = false;
let myCamOn = false;

async function getLocalStream(wantMic, wantCam) {
  if (localStream) {
    localStream.getAudioTracks().forEach((t) => (t.enabled = !!wantMic));
    localStream.getVideoTracks().forEach((t) => (t.enabled = !!wantCam));
    return localStream;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch (e2) {
      try { localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }); }
      catch (e3) { return null; } // sin permiso de cámara/mic: igual podemos escuchar/ver a otros
    }
  }
  localStream.getAudioTracks().forEach((t) => (t.enabled = !!wantMic));
  localStream.getVideoTracks().forEach((t) => (t.enabled = !!wantCam));
  return localStream;
}

function renderLocalVideoTile() {
  const bar = document.getElementById("video-bar");
  let tile = document.getElementById("local-video-tile");
  if (!tile) {
    tile = document.createElement("div");
    tile.id = "local-video-tile";
    tile.className = "video-tile";
    if (myEmail) tile.dataset.email = myEmail;
    const savedFilterNow = localStorage.getItem("domino_cam_filter");
    if (savedFilterNow && savedFilterNow !== "natural") tile.classList.add("cam-filter-" + savedFilterNow);
    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.muted = true; // nunca reproducimos nuestro propio audio (se escucharía eco)
    tile.appendChild(videoEl);
    bar.appendChild(tile);
  }
  if (localStream) tile.querySelector("video").srcObject = localStream;
  tile.classList.toggle("cam-off", !myCamOn);
}

function streamForRoomTag(roomTag) {
  return roomTag === "meeting" ? meetingLocalStream : localStream;
}
function storeForRoomTag(roomTag) {
  if (roomTag === "own") return peerConnections;
  if (roomTag === "meeting") return meetingPeerConnections;
  return opponentPeerConnections;
}

function createPeerConnection(peerSocketId, roomTag, sendLocalTracks) {
  const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
  const stream = streamForRoomTag(roomTag);
  if (sendLocalTracks && stream) {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  } else {
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addTransceiver("video", { direction: "recvonly" });
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("rtc-signal", { to: peerSocketId, data: { type: "ice", candidate: e.candidate, roomTag } });
  };
  pc.ontrack = (e) => {
    renderRemoteVideoTile(peerSocketId, roomTag, e.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) removeRemoteVideoTile(peerSocketId);
  };
  return pc;
}

async function callPeer(peerSocketId, roomTag, sendLocalTracks) {
  const store = storeForRoomTag(roomTag);
  if (store[peerSocketId]) return;
  const pc = createPeerConnection(peerSocketId, roomTag, sendLocalTracks);
  store[peerSocketId] = pc;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("rtc-signal", { to: peerSocketId, data: { type: "offer", sdp: offer, roomTag } });
}

async function handleRtcSignal({ from, data }) {
  const sendLocalTracks = data.roomTag === "own" || data.roomTag === "meeting"; // en la sala del rival solo escuchamos, no mandamos nuestra cámara
  const store = storeForRoomTag(data.roomTag);
  if (data.type === "offer") {
    const pc = createPeerConnection(from, data.roomTag, sendLocalTracks);
    store[from] = pc;
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("rtc-signal", { to: from, data: { type: "answer", sdp: answer, roomTag: data.roomTag } });
  } else if (data.type === "answer") {
    if (store[from]) await store[from].setRemoteDescription(new RTCSessionDescription(data.sdp));
  } else if (data.type === "ice") {
    if (store[from]) { try { await store[from].addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {} }
  }
}

function renderRemoteVideoTile(peerSocketId, roomTag, stream) {
  const bar = roomTag === "meeting" ? document.getElementById("meeting-video-grid") : document.getElementById("video-bar");
  const tileId = (roomTag === "own" ? "remote-tile-" : roomTag === "meeting" ? "meeting-remote-tile-" : "remote-opp-tile-") + peerSocketId;
  let tile = document.getElementById(tileId);
  if (!tile) {
    tile = document.createElement("div");
    tile.id = tileId;
    tile.className = "video-tile";
    if (roomTag === "opponent") tile.classList.add("opponent-remote-tile");
    if (peerEmailBySocketId[peerSocketId]) tile.dataset.email = peerEmailBySocketId[peerSocketId];
    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    tile.appendChild(videoEl);
    // En reuniones, el anfitrión puede silenciar o expulsar a cualquiera, en cualquier momento
    if (roomTag === "meeting" && amIMeetingHost) {
      const controls = document.createElement("div");
      controls.className = "meeting-tile-controls";
      controls.innerHTML =
        '<button class="meeting-tile-btn" data-meeting-mute="' + peerSocketId + '" title="Silenciar">🔇</button>' +
        '<button class="meeting-tile-btn meeting-tile-kick" data-meeting-kick="' + peerSocketId + '" title="Expulsar">✖️</button>';
      tile.appendChild(controls);
    }
    bar.appendChild(tile);
  }
  tile.querySelector("video").srcObject = stream;
}
document.getElementById("meeting-video-grid").addEventListener("click", (e) => {
  const muteBtn = e.target.closest("[data-meeting-mute]");
  if (muteBtn) { socket.emit("muteMeetingParticipant", { socketId: muteBtn.dataset.meetingMute }); showToast("Le pediste a esa persona que se silencie."); return; }
  const kickBtn = e.target.closest("[data-meeting-kick]");
  if (kickBtn) {
    if (!confirm("¿Expulsar a esta persona de la reunión?")) return;
    socket.emit("kickMeetingParticipant", { socketId: kickBtn.dataset.meetingKick });
  }
});

function removeRemoteVideoTile(peerSocketId) {
  const t1 = document.getElementById("remote-tile-" + peerSocketId);
  if (t1) t1.remove();
  const t2 = document.getElementById("remote-opp-tile-" + peerSocketId);
  if (t2) t2.remove();
  const t3 = document.getElementById("meeting-remote-tile-" + peerSocketId);
  if (t3) t3.remove();
  if (peerConnections[peerSocketId]) { try { peerConnections[peerSocketId].close(); } catch (e) {} delete peerConnections[peerSocketId]; }
  if (opponentPeerConnections[peerSocketId]) { try { opponentPeerConnections[peerSocketId].close(); } catch (e) {} delete opponentPeerConnections[peerSocketId]; }
  if (meetingPeerConnections[peerSocketId]) { try { meetingPeerConnections[peerSocketId].close(); } catch (e) {} delete meetingPeerConnections[peerSocketId]; }
}

let peerEmailBySocketId = {};

function wireRtcSocketEvents(sock) {
  sock.on("rtc-existing-peers", ({ roomCode, peers }) => {
    peers.forEach((p) => { if (p.email) peerEmailBySocketId[p.socketId] = p.email; });
    if (roomCode === rtcRoomCode) peers.forEach((p) => callPeer(p.socketId, "own", true));
    else if (roomCode === rtcOpponentRoomCode) peers.forEach((p) => callPeer(p.socketId, "opponent", false));
    else if (roomCode === meetingCode) peers.forEach((p) => callPeer(p.socketId, "meeting", true));
  });
  sock.on("rtc-peer-joined", ({ socketId, email }) => { if (email) peerEmailBySocketId[socketId] = email; });
  sock.on("rtc-peer-left", ({ socketId }) => { removeRemoteVideoTile(socketId); delete peerEmailBySocketId[socketId]; });
  sock.on("rtc-signal", handleRtcSignal);
}

let currentVideoRoomCode = null;
let iAmCreatingRoom = false; // se pone en true justo antes de emitir "createRoom"

async function setupVideoIfNeeded(code, startUnmuted, cameraOn) {
  currentVideoRoomCode = code;
  const bar = document.getElementById("video-bar");
  if (bar.dataset.setupDone) return;
  bar.dataset.setupDone = "1";
  const wantsCameraOn = cameraOn === undefined ? startUnmuted : cameraOn;
  myMicOn = !!startUnmuted;
  myCamOn = !!wantsCameraOn;
  try {
    await getLocalStream(myMicOn, myCamOn);
    renderLocalVideoTile();
    updateJitsiMicCamButtons();
    rtcRoomCode = code;
    socket.emit("rtc-join", { roomCode: code });
  } catch (e) {
    bar.innerHTML = '<p style="font-size:12px;color:#cfe3da;padding:8px;">No se pudo cargar el video. Pueden seguir jugando sin él.</p>';
  }
}

function leaveVideo() {
  if (vbgActive && vbgContext === "own") { vbgActive = false; if (vbgAnimationFrame) cancelAnimationFrame(vbgAnimationFrame); if (vbgProcessedStream) { vbgProcessedStream.getTracks().forEach((t) => t.stop()); vbgProcessedStream = null; } }
  if (mediaRecorderTL && mediaRecorderTL.state !== "inactive" && recordingSourceType === "live") stopRecordingTL();
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  Object.keys(peerConnections).forEach((sid) => { try { peerConnections[sid].close(); } catch (e) {} });
  peerConnections = {};
  if (rtcRoomCode) { socket.emit("rtc-leave", { roomCode: rtcRoomCode }); rtcRoomCode = null; }
  const bar = document.getElementById("video-bar");
  bar.innerHTML = "";
  delete bar.dataset.setupDone;
  myMicOn = false;
  myCamOn = false;
  updateJitsiMicCamButtons();
}
document.getElementById("leave-video-btn").addEventListener("click", () => {
  leaveVideo();
  showToast("Saliste del video. Podés reconectarte cuando quieras.");
});
document.getElementById("connect-video-btn").addEventListener("click", () => {
  if (!currentVideoRoomCode) { showToast("Todavía no estás en ninguna sala."); return; }
  const bar = document.getElementById("video-bar");
  if (bar.dataset.setupDone) { showToast("El video ya está conectado."); return; }
  setupVideoIfNeeded(currentVideoRoomCode);
});

// ---------------- Batalla LIVE: video del rival, en la otra mitad de la pantalla ----------------
function mountOpponentVideo(code) {
  const bar = document.getElementById("video-bar");
  if (bar.dataset.opponentCode === code) return; // ya está montado
  bar.classList.add("battle-split");
  bar.dataset.opponentCode = code;
  rtcOpponentRoomCode = code;
  socket.emit("rtc-join", { roomCode: code });
}

function unmountOpponentVideo() {
  const bar = document.getElementById("video-bar");
  Object.keys(opponentPeerConnections).forEach((sid) => {
    try { opponentPeerConnections[sid].close(); } catch (e) {}
    const t = document.getElementById("remote-opp-tile-" + sid);
    if (t) t.remove();
  });
  opponentPeerConnections = {};
  if (rtcOpponentRoomCode) { socket.emit("rtc-leave", { roomCode: rtcOpponentRoomCode }); rtcOpponentRoomCode = null; }
  bar.classList.remove("battle-split");
  delete bar.dataset.opponentCode;
}

// ---------------- Mi cámara / mi micrófono: un solo botón cada uno, apagados por defecto ----------------
function updateJitsiMicCamButtons() {
  const micBtn = document.getElementById("jitsi-mic-btn");
  const camBtn = document.getElementById("jitsi-cam-btn");
  if (micBtn) micBtn.textContent = myMicOn ? "🎙️ Micrófono activado (tocá para apagar)" : "🔇 Activar mi micrófono";
  if (camBtn) camBtn.textContent = myCamOn ? "📷 Cámara activada (tocá para apagar)" : "🎥 Activar mi cámara";
}
document.getElementById("jitsi-mic-btn").addEventListener("click", () => {
  if (!localStream) { showToast("Esperá a que termine de conectar el video."); return; }
  myMicOn = !myMicOn;
  localStream.getAudioTracks().forEach((t) => (t.enabled = myMicOn));
  updateJitsiMicCamButtons();
});
document.getElementById("jitsi-cam-btn").addEventListener("click", () => {
  if (!localStream) { showToast("Esperá a que termine de conectar el video."); return; }
  myCamOn = !myCamOn;
  localStream.getVideoTracks().forEach((t) => (t.enabled = myCamOn));
  const tile = document.getElementById("local-video-tile");
  if (tile) tile.classList.toggle("cam-off", !myCamOn);
  updateJitsiMicCamButtons();
});

// ==================== Reuniones privadas (tipo Zoom) ====================
let meetingCode = null;
let meetingLocalStream = null;
let meetingPeerConnections = {};
let meetingMicOn = false;
let meetingCamOn = false;
let meetingTimerInterval = null;
let meetingStartedAt = null;
let meetingIsUnlimited = false;
let amIMeetingHost = false;

function renderMeetingLocalTile() {
  const grid = document.getElementById("meeting-video-grid");
  let tile = document.getElementById("meeting-local-tile");
  if (!tile) {
    tile = document.createElement("div");
    tile.id = "meeting-local-tile";
    tile.className = "video-tile";
    const savedFilterNow = localStorage.getItem("domino_cam_filter");
    if (savedFilterNow && savedFilterNow !== "natural") tile.classList.add("cam-filter-" + savedFilterNow);
    const v = document.createElement("video");
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true; // nunca reproducimos nuestro propio audio
    tile.appendChild(v);
    grid.appendChild(tile);
  }
  if (meetingLocalStream) tile.querySelector("video").srcObject = meetingLocalStream;
  tile.classList.toggle("cam-off", !meetingCamOn);
}

function updateMeetingMicCamButtons() {
  document.getElementById("meeting-mic-btn").textContent = meetingMicOn ? "🎙️ Micrófono activado" : "🔇 Prender mi micrófono";
  document.getElementById("meeting-cam-btn").textContent = meetingCamOn ? "📷 Cámara activada" : "🎥 Prender mi cámara";
}

async function enterMeetingScreen(summary) {
  meetingCode = summary.code;
  meetingStartedAt = summary.startedAt;
  meetingIsUnlimited = !summary.freeLimited;
  amIMeetingHost = myEmail && summary.hostEmail === myEmail;
  document.getElementById("create-modal").classList.add("hidden");
  document.getElementById("join-meeting-modal").classList.add("hidden");
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("meeting-screen").classList.remove("hidden");
  document.getElementById("meeting-code-label").textContent = "🤝 " + summary.code;
  document.getElementById("meeting-video-grid").innerHTML = "";
  document.getElementById("meeting-limit-msg").classList.add("hidden");

  try {
    meetingLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  } catch (e) {
    try { meetingLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch (e2) { meetingLocalStream = null; }
  }
  meetingMicOn = !!(meetingLocalStream && meetingLocalStream.getAudioTracks().length);
  meetingCamOn = !!(meetingLocalStream && meetingLocalStream.getVideoTracks().length);
  if (meetingLocalStream) {
    meetingLocalStream.getAudioTracks().forEach((t) => (t.enabled = meetingMicOn));
    meetingLocalStream.getVideoTracks().forEach((t) => (t.enabled = meetingCamOn));
  }
  renderMeetingLocalTile();
  updateMeetingMicCamButtons();

  startMeetingTimer();
  socket.emit("rtc-join", { roomCode: summary.code });
}

function startMeetingTimer() {
  clearInterval(meetingTimerInterval);
  function tick() {
    const elapsed = Math.floor((Date.now() - meetingStartedAt) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    if (meetingIsUnlimited) {
      document.getElementById("meeting-timer").textContent = "🟢 " + mm + ":" + ss;
    } else {
      const remaining = Math.max(0, 30 * 60 - elapsed);
      const rmm = String(Math.floor(remaining / 60)).padStart(2, "0");
      const rss = String(remaining % 60).padStart(2, "0");
      document.getElementById("meeting-timer").textContent = "⏳ " + rmm + ":" + rss;
      if (remaining <= 5 * 60) {
        const msgEl = document.getElementById("meeting-limit-msg");
        msgEl.classList.remove("hidden");
        msgEl.textContent = "Te quedan " + rmm + ":" + rss + " de la reunión gratis. Comprá un plan en tu Perfil para reuniones sin límite.";
      }
    }
  }
  tick();
  meetingTimerInterval = setInterval(tick, 1000);
}

function leaveMeetingScreen(message) {
  clearInterval(meetingTimerInterval);
  if (vbgActive && vbgContext === "meeting") { vbgActive = false; if (vbgAnimationFrame) cancelAnimationFrame(vbgAnimationFrame); if (vbgProcessedStream) { vbgProcessedStream.getTracks().forEach((t) => t.stop()); vbgProcessedStream = null; } }
  if (mediaRecorderTL && mediaRecorderTL.state !== "inactive" && recordingSourceType === "meeting") stopRecordingTL();
  if (meetingLocalStream) { meetingLocalStream.getTracks().forEach((t) => t.stop()); meetingLocalStream = null; }
  Object.keys(meetingPeerConnections).forEach((sid) => { try { meetingPeerConnections[sid].close(); } catch (e) {} });
  meetingPeerConnections = {};
  if (meetingCode) socket.emit("leaveMeeting");
  meetingCode = null;
  document.getElementById("meeting-video-grid").innerHTML = "";
  document.getElementById("meeting-screen").classList.add("hidden");
  document.getElementById("lobby").classList.remove("hidden");
  if (message) showToast(message);
}

document.getElementById("create-opt-meeting").addEventListener("click", () => {
  socket.emit("createMeeting");
});
document.getElementById("create-opt-join-meeting").addEventListener("click", () => {
  document.getElementById("create-modal").classList.add("hidden");
  document.getElementById("join-meeting-code").value = "";
  document.getElementById("join-meeting-msg").textContent = "";
  document.getElementById("join-meeting-modal").classList.remove("hidden");
});
document.getElementById("meeting-leave-btn").addEventListener("click", () => leaveMeetingScreen());
document.getElementById("meeting-share-btn").addEventListener("click", () => {
  if (!meetingCode) return;
  const text = "Unite a mi reunión en TableLive con el código: " + meetingCode;
  if (navigator.share) navigator.share({ text });
  else { navigator.clipboard.writeText(text); showToast("Copiado — mandaselo a quien quieras invitar."); }
});
document.getElementById("meeting-mic-btn").addEventListener("click", () => {
  if (!meetingLocalStream) { showToast("No se pudo activar el micrófono."); return; }
  meetingMicOn = !meetingMicOn;
  meetingLocalStream.getAudioTracks().forEach((t) => (t.enabled = meetingMicOn));
  updateMeetingMicCamButtons();
});
document.getElementById("meeting-cam-btn").addEventListener("click", () => {
  if (!meetingLocalStream) { showToast("No se pudo activar la cámara."); return; }
  meetingCamOn = !meetingCamOn;
  meetingLocalStream.getVideoTracks().forEach((t) => (t.enabled = meetingCamOn));
  renderMeetingLocalTile();
  updateMeetingMicCamButtons();
});

document.getElementById("join-meeting-code").addEventListener("keyup", (e) => { if (e.key === "Enter") submitJoinMeeting(); });
document.getElementById("submit-join-meeting").addEventListener("click", submitJoinMeeting);
document.getElementById("close-join-meeting-modal").addEventListener("click", () => {
  document.getElementById("join-meeting-modal").classList.add("hidden");
});
function submitJoinMeeting() {
  const code = document.getElementById("join-meeting-code").value.trim().toUpperCase();
  if (!code) return;
  socket.emit("joinMeeting", { code });
}

function wireMeetingSocketEvents(sock) {
  sock.on("meetingJoined", (summary) => enterMeetingScreen(summary));
  sock.on("meetingRoster", () => {}); // por ahora no mostramos lista de nombres aparte, ya se ve el video de cada uno
  sock.on("meetingEnded", (data) => leaveMeetingScreen("📴 " + (data.reason || "La reunión terminó.")));
  sock.on("youWereKickedFromMeeting", () => leaveMeetingScreen("🚪 El anfitrión te expulsó de la reunión."));
  sock.on("hostMutedYouInMeetingEvent", () => {
    showToast("El anfitrión te silenció el micrófono.");
    if (meetingLocalStream) {
      meetingMicOn = false;
      meetingLocalStream.getAudioTracks().forEach((t) => (t.enabled = false));
      updateMeetingMicCamButtons();
    }
  });
  sock.on("errorMsg", (msg) => {
    const joinModal = document.getElementById("join-meeting-modal");
    if (joinModal && !joinModal.classList.contains("hidden")) {
      document.getElementById("join-meeting-msg").textContent = msg;
    }
  });
}

// ==================== Grabar (en vivo o reunión) ====================
let mediaRecorderTL = null;
let recordedChunksTL = [];
let recordingSourceType = null;

function startRecordingTL(stream, sourceType, labelHint) {
  if (!stream || !stream.getTracks().length) { showToast("Todavía no hay cámara/mic conectados para grabar."); return; }
  if (mediaRecorderTL && mediaRecorderTL.state !== "inactive") { showToast("Ya estás grabando."); return; }
  recordedChunksTL = [];
  recordingSourceType = sourceType;
  try {
    mediaRecorderTL = new MediaRecorder(stream, { mimeType: "video/webm" });
  } catch (e) {
    showToast("Tu navegador no puede grabar video.");
    return;
  }
  mediaRecorderTL.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksTL.push(e.data); };
  mediaRecorderTL.onstop = () => uploadRecordingTL(sourceType, labelHint);
  mediaRecorderTL.start();
  updateRecordButtonsTL(true);
  showToast("🔴 Grabando tu cámara y mic. Ojo: no graba lo de las otras personas, solo lo tuyo.");
}

function stopRecordingTL() {
  if (mediaRecorderTL && mediaRecorderTL.state !== "inactive") mediaRecorderTL.stop();
  updateRecordButtonsTL(false);
}

function updateRecordButtonsTL(isRecording) {
  const liveBtn = document.getElementById("live-record-btn");
  const meetingBtn = document.getElementById("meeting-record-btn");
  if (liveBtn) liveBtn.textContent = isRecording ? "⏹️ Cortar grabación" : "⏺️ Grabar mi cámara";
  if (meetingBtn) meetingBtn.textContent = isRecording ? "⏹️ Cortar" : "⏺️ Grabar";
}

async function uploadRecordingTL(sourceType, labelHint) {
  if (!recordedChunksTL.length) return;
  const blob = new Blob(recordedChunksTL, { type: "video/webm" });
  recordedChunksTL = [];
  const fd = new FormData();
  fd.append("recording", blob, "grabacion.webm");
  fd.append("label", labelHint || (sourceType === "meeting" ? "Reunión" : "En vivo"));
  fd.append("sourceType", sourceType);
  showToast("Subiendo tu grabación...");
  try {
    const res = await fetch("/api/recordings/upload", { method: "POST", headers: { Authorization: "Bearer " + authToken }, body: fd });
    const data = await res.json();
    if (res.ok) showToast("✅ Grabación guardada — la tenés 5 días en tu Perfil.");
    else showToast(data.error || "No se pudo guardar la grabación.");
  } catch (e) {
    showToast("Error subiendo la grabación.");
  }
}

document.getElementById("live-record-btn").addEventListener("click", () => {
  if (mediaRecorderTL && mediaRecorderTL.state !== "inactive") { stopRecordingTL(); return; }
  startRecordingTL(localStream, "live", "En vivo " + (currentVideoRoomCode || ""));
});
document.getElementById("meeting-record-btn").addEventListener("click", () => {
  if (mediaRecorderTL && mediaRecorderTL.state !== "inactive") { stopRecordingTL(); return; }
  startRecordingTL(meetingLocalStream, "meeting", "Reunión " + (meetingCode || ""));
});

async function loadMyRecordings() {
  const wrap = document.getElementById("my-recordings-list");
  if (!wrap) return;
  try {
    const res = await fetch("/api/recordings/mine", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.recordings.length) { wrap.innerHTML = '<p class="empty-msg-small">Todavía no grabaste nada.</p>'; return; }
    wrap.innerHTML = data.recordings.map((r) => `
      <div class="recording-row">
        <span>${r.sourceType === "meeting" ? "🤝" : "🔴"} ${escapeHtml(r.label)}<br>
          <span style="color:#9fc9b8;font-size:11px;">${new Date(r.createdAt).toLocaleString()} · ${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB</span></span>
        <span class="recording-row-actions">
          <button data-dl-rec="${r.id}">⬇️</button>
          <button data-del-rec="${r.id}">🗑️</button>
        </span>
      </div>
    `).join("");
    wrap.querySelectorAll("[data-dl-rec]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res2 = await fetch("/api/recordings/" + btn.dataset.dlRec + "/download", { headers: { Authorization: "Bearer " + authToken } });
        if (!res2.ok) { showToast("No se pudo descargar."); return; }
        const blob = await res2.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "grabacion.webm";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
    });
    wrap.querySelectorAll("[data-del-rec]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Borrar esta grabación?")) return;
        await fetch("/api/recordings/" + btn.dataset.delRec + "/delete", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
        loadMyRecordings();
      });
    });
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

// ==================== Reuniones programadas (para más adelante, con código de reserva) ====================
document.getElementById("create-opt-schedule-meeting").addEventListener("click", () => {
  document.getElementById("create-modal").classList.add("hidden");
  document.getElementById("schedule-meeting-label").value = "";
  document.getElementById("schedule-meeting-date").value = "";
  document.getElementById("schedule-meeting-time").value = "";
  document.getElementById("schedule-meeting-emails").value = "";
  document.getElementById("schedule-meeting-msg").textContent = "";
  document.getElementById("schedule-meeting-link-box").classList.add("hidden");
  document.getElementById("schedule-meeting-date").min = new Date().toISOString().slice(0, 10);
  document.getElementById("schedule-meeting-modal").classList.remove("hidden");
});
document.getElementById("close-schedule-meeting-modal").addEventListener("click", () => {
  document.getElementById("schedule-meeting-modal").classList.add("hidden");
});
document.getElementById("submit-schedule-meeting").addEventListener("click", async () => {
  const label = document.getElementById("schedule-meeting-label").value.trim();
  const date = document.getElementById("schedule-meeting-date").value;
  const time = document.getElementById("schedule-meeting-time").value;
  const emailsRaw = document.getElementById("schedule-meeting-emails").value.trim();
  const participantEmails = emailsRaw ? emailsRaw.split(",").map((e) => e.trim()).filter(Boolean) : [];
  const msgEl = document.getElementById("schedule-meeting-msg");
  if (!label) { msgEl.style.color = "#ff8a80"; msgEl.textContent = "Ponele un nombre a la reunión."; return; }
  if (!date || !time) { msgEl.style.color = "#ff8a80"; msgEl.textContent = "Elegí una fecha y un horario."; return; }
  msgEl.style.color = "#cfe3da";
  msgEl.textContent = "Reservando...";
  try {
    const res = await fetch("/api/meetings/schedule", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ label, date, time, participantEmails }),
    });
    const data = await res.json();
    if (!res.ok) { msgEl.style.color = "#ff8a80"; msgEl.textContent = data.error; return; }
    msgEl.style.color = "#8fd4a8";
    const inviteMsg = data.invitedCount ? (" Se les mandó la invitación a " + data.invitedCount + " persona" + (data.invitedCount > 1 ? "s" : "") + " por email.") : "";
    msgEl.textContent = "¡Reservada! Tu código es " + data.meeting.code + "." + inviteMsg;
    const link = location.origin + "/?joinMeeting=" + data.meeting.code;
    document.getElementById("schedule-meeting-link-input").value = link;
    document.getElementById("schedule-meeting-link-box").classList.remove("hidden");
    showToast("Reunión programada. Código: " + data.meeting.code);
    loadMyScheduledMeetings();
  } catch (e) {
    msgEl.style.color = "#ff8a80";
    msgEl.textContent = "Error de conexión.";
  }
});
document.getElementById("copy-schedule-meeting-link").addEventListener("click", () => {
  const input = document.getElementById("schedule-meeting-link-input");
  input.select();
  navigator.clipboard.writeText(input.value).then(() => showToast("¡Enlace copiado! Ya lo podés mandar por donde quieras."));
});

async function loadMyScheduledMeetings() {
  const wrap = document.getElementById("my-scheduled-meetings-list");
  if (!wrap) return;
  try {
    const res = await fetch("/api/meetings/scheduled/mine", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (!data.meetings.length) { wrap.innerHTML = '<p class="empty-msg-small">No tenés reuniones programadas.</p>'; return; }
    wrap.innerHTML = data.meetings.map((m) => {
      const when = new Date(m.scheduledFor);
      return `
      <div class="recording-row">
        <span>📅 ${escapeHtml(m.label)}<br>
          <span style="color:#9fc9b8;font-size:11px;">${when.toLocaleDateString("es")} · ${when.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} · código ${m.code}</span></span>
        <span class="recording-row-actions">
          <button data-start-sched="${m.code}">▶️ Iniciar</button>
          <button data-copy-sched="${m.code}">📋 Enlace</button>
          <button data-cancel-sched="${m.code}">🗑️</button>
        </span>
      </div>`;
    }).join("");
    wrap.querySelectorAll("[data-start-sched]").forEach((btn) => {
      btn.addEventListener("click", () => socket.emit("startScheduledMeeting", { code: btn.dataset.startSched }));
    });
    wrap.querySelectorAll("[data-copy-sched]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const link = location.origin + "/?joinMeeting=" + btn.dataset.copySched;
        navigator.clipboard.writeText(link).then(() => showToast("¡Enlace copiado!"));
      });
    });
    wrap.querySelectorAll("[data-cancel-sched]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Cancelar esta reunión programada?")) return;
        await fetch("/api/meetings/scheduled/" + btn.dataset.cancelSched + "/cancel", { method: "POST", headers: { Authorization: "Bearer " + authToken } });
        loadMyScheduledMeetings();
      });
    });
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error cargando.</p>';
  }
}

async function loadMeetingPlans() {
  const statusEl = document.getElementById("meeting-plan-status");
  const gridEl = document.getElementById("meeting-plans-grid");
  if (!statusEl || !gridEl) return;
  try {
    const res = await fetch("/api/meetings/plans", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    if (data.active) {
      const exp = new Date(data.myPlan.expiresAt).toLocaleDateString();
      statusEl.textContent = "✅ Tenés " + data.myPlan.label + " activo, vence el " + exp + ".";
    } else {
      statusEl.textContent = "Hoy tenés " + data.freeMinutes + " minutos gratis por reunión.";
    }
    gridEl.innerHTML = Object.entries(data.plans).map(([type, plan]) => `
      <div class="meeting-plan-card">
        <span>${plan.label} — ${plan.priceCoins} 🪙</span>
        <button data-buy-plan="${type}">Comprar</button>
      </div>
    `).join("");
    gridEl.querySelectorAll("[data-buy-plan]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res2 = await fetch("/api/meetings/buy-plan", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
          body: JSON.stringify({ type: btn.dataset.buyPlan }),
        });
        const data2 = await res2.json();
        if (!res2.ok) { showToast(data2.error || "No se pudo comprar."); return; }
        myCoinBalance = data2.balance;
        updateWalletDisplay();
        showToast("¡Listo! Ya tenés reuniones sin límite de tiempo.");
        loadMeetingPlans();
      });
    });
  } catch (e) {}
}

// ==================== Fondos virtuales (sin pantalla verde) ====================
// Usa MediaPipe Selfie Segmentation (se carga desde internet la primera vez que se
// usa un fondo) para separar a la persona del fondo real, cuadro por cuadro, y
// reemplazar el fondo por la imagen elegida — todo se procesa en tu propio
// celular/computadora, nunca en nuestro servidor.
const VIRTUAL_BACKGROUNDS = [
  { id: "none", type: "none" },
  { id: "blur", type: "blur" },
  { id: "studio-verde", type: "image", url: "/virtual-backgrounds/studio-verde.jpg" },
  { id: "casino-night", type: "image", url: "/virtual-backgrounds/casino-night.jpg" },
  { id: "atardecer", type: "image", url: "/virtual-backgrounds/atardecer.jpg" },
  { id: "oficina-azul", type: "image", url: "/virtual-backgrounds/oficina-azul.jpg" },
  { id: "bokeh-dorado", type: "image", url: "/virtual-backgrounds/bokeh-dorado.jpg" },
  { id: "restaurante-dorado", type: "image", url: "/virtual-backgrounds/restaurante-dorado.jpg" },
  { id: "skyline-verde", type: "image", url: "/virtual-backgrounds/skyline-verde.jpg" },
  { id: "mundo-dorado", type: "image", url: "/virtual-backgrounds/mundo-dorado.jpg" },
  { id: "red-mundial", type: "animated" },
  { id: "presentacion", type: "image", url: "/splash-presentacion.jpg" },
];

let vbgCanvas = null;
let vbgCtx = null;
let vbgProcessedStream = null;
let vbgActive = false;
let vbgImageEl = null;
let vbgSegmentation = null;
let vbgAnimationFrame = null;
let vbgSourceVideoEl = null;
let vbgHiddenSourceVideo = null; // <video> propio y oculto, conectado directo a la cámara cruda
let vbgDisplayVideoEl = null; // el <video> que se ve en pantalla (donde se muestra el resultado)
let vbgContext = null; // "own" o "meeting"
let vbgLoadingLib = false;

// ---------------- Fondo animado "Red mundial" (estrellas + red de nodos) ----------------
// Se dibuja solo, en un canvas propio aparte, y se usa como si fuera una imagen más al
// componer el video de la persona encima.
let vbgAnimCanvas = null;
let vbgAnimCtx = null;
let vbgAnimNodes = null;
let vbgAnimStars = null;
let vbgAnimFrameId = null;

function ensureAnimatedBackgroundRunning() {
  if (vbgAnimCanvas) return; // ya está corriendo
  vbgAnimCanvas = document.createElement("canvas");
  vbgAnimCanvas.width = 640;
  vbgAnimCanvas.height = 480;
  vbgAnimCtx = vbgAnimCanvas.getContext("2d");

  vbgAnimStars = Array.from({ length: 90 }).map(() => ({
    x: Math.random() * vbgAnimCanvas.width,
    y: Math.random() * vbgAnimCanvas.height * 0.55,
    r: Math.random() * 1.3 + 0.3,
    tw: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.02 + 0.01,
  }));
  vbgAnimNodes = Array.from({ length: 26 }).map(() => ({
    x: Math.random() * vbgAnimCanvas.width,
    y: vbgAnimCanvas.height * 0.12 + Math.random() * vbgAnimCanvas.height * 0.8,
    vx: (Math.random() - 0.5) * 0.12,
    vy: (Math.random() - 0.5) * 0.08,
    r: Math.random() * 1.6 + 1,
    pulse: Math.random() * Math.PI * 2,
  }));

  function step(t) {
    const c = vbgAnimCtx, w = vbgAnimCanvas.width, h = vbgAnimCanvas.height;
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#010403");
    grad.addColorStop(0.45, "#041a12");
    grad.addColorStop(1, "#010403");
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);

    vbgAnimStars.forEach((s) => {
      const a = 0.35 + Math.sin(t * s.speed + s.tw) * 0.35;
      c.fillStyle = `rgba(200,240,225,${Math.max(a, 0.05)})`;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();
    });

    vbgAnimNodes.forEach((n) => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < h * 0.08 || n.y > h * 0.96) n.vy *= -1;
    });
    for (let i = 0; i < vbgAnimNodes.length; i++) {
      for (let j = i + 1; j < vbgAnimNodes.length; j++) {
        const a = vbgAnimNodes[i], b = vbgAnimNodes[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < 150) {
          c.strokeStyle = `rgba(120,230,190,${(1 - dist / 150) * 0.22})`;
          c.lineWidth = 0.7;
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.stroke();
        }
      }
    }
    vbgAnimNodes.forEach((n) => {
      const glow = 0.5 + Math.sin(t * 0.0015 + n.pulse) * 0.5;
      c.beginPath();
      c.fillStyle = `rgba(212,163,51,${0.35 + glow * 0.5})`;
      c.shadowColor = "rgba(212,163,51,0.8)";
      c.shadowBlur = 6;
      c.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    });

    vbgAnimFrameId = requestAnimationFrame(step);
  }
  vbgAnimFrameId = requestAnimationFrame(step);
}

function loadSelfieSegmentationLib() {
  if (window.SelfieSegmentation) return Promise.resolve(true);
  if (vbgLoadingLib) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (window.SelfieSegmentation) { clearInterval(check); resolve(true); }
      }, 200);
      setTimeout(() => { clearInterval(check); resolve(!!window.SelfieSegmentation); }, 15000);
    });
  }
  vbgLoadingLib = true;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

async function applyVirtualBackground(bgId, context) {
  const bg = VIRTUAL_BACKGROUNDS.find((b) => b.id === bgId);
  if (!bg) return;
  const msgEl = document.getElementById("vbg-msg-" + context);

  if (bg.type === "none") {
    stopVirtualBackground();
    if (msgEl) msgEl.textContent = "";
    return;
  }

  if (msgEl) msgEl.textContent = "Cargando fondo virtual...";
  const ok = await loadSelfieSegmentationLib();
  if (!ok || !window.SelfieSegmentation) {
    if (msgEl) msgEl.textContent = "No se pudo cargar el fondo virtual — necesitás conexión a internet la primera vez que lo usás.";
    return;
  }

  const stream = context === "meeting" ? meetingLocalStream : localStream;
  if (!stream || !stream.getVideoTracks().length) {
    if (msgEl) msgEl.textContent = "Prendé tu cámara primero para poder usar un fondo virtual.";
    return;
  }

  const tileId = context === "meeting" ? "meeting-local-tile" : "local-video-tile";
  const sourceVideo = document.querySelector("#" + tileId + " video");
  if (!sourceVideo) { if (msgEl) msgEl.textContent = "Prendé tu cámara primero."; return; }

  vbgContext = context;
  // OJO: usamos un <video> propio y OCULTO conectado directo a tu cámara cruda para
  // leer los cuadros a procesar. Antes se usaba el mismo <video> que se ve en pantalla,
  // pero ese termina mostrando el resultado YA procesado — si seguíamos leyendo de ahí,
  // el fondo virtual terminaba procesando su propia salida en bucle (se iba a negro o
  // se congelaba). Con un video aparte, cámara cruda y vista en pantalla quedan separadas.
  if (!vbgHiddenSourceVideo) {
    vbgHiddenSourceVideo = document.createElement("video");
    vbgHiddenSourceVideo.autoplay = true;
    vbgHiddenSourceVideo.playsInline = true;
    vbgHiddenSourceVideo.muted = true;
    vbgHiddenSourceVideo.style.display = "none";
    document.body.appendChild(vbgHiddenSourceVideo);
  }
  if (vbgHiddenSourceVideo.srcObject !== stream) vbgHiddenSourceVideo.srcObject = stream;
  vbgSourceVideoEl = vbgHiddenSourceVideo;
  vbgDisplayVideoEl = sourceVideo;

  if (!vbgCanvas) {
    vbgCanvas = document.createElement("canvas");
    vbgCtx = vbgCanvas.getContext("2d");
  }
  vbgCanvas.width = sourceVideo.videoWidth || 640;
  vbgCanvas.height = sourceVideo.videoHeight || 480;

  if (bg.type === "image") {
    vbgImageEl = new Image();
    vbgImageEl.crossOrigin = "anonymous";
    vbgImageEl.src = bg.url;
    await new Promise((res) => { vbgImageEl.onload = res; vbgImageEl.onerror = res; });
  } else if (bg.type === "animated") {
    vbgImageEl = null;
    ensureAnimatedBackgroundRunning(); // arranca solo una vez, se reusa siempre
  } else {
    vbgImageEl = null; // "blur" desenfoca tu propio fondo real, no usa una imagen
  }

  if (!vbgSegmentation) {
    try {
      vbgSegmentation = new window.SelfieSegmentation({
        locateFile: (file) => "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/" + file,
      });
      vbgSegmentation.setOptions({ modelSelection: 1 });
    } catch (e) {
      if (msgEl) msgEl.textContent = "No se pudo iniciar el fondo virtual en este dispositivo.";
      return;
    }
  }

  let gotFirstFrame = false;
  let firstFrameResolve;
  const firstFramePromise = new Promise((res) => { firstFrameResolve = res; });

  vbgSegmentation.onResults((results) => {
    if (!vbgActive) return;
    const w = vbgCanvas.width, h = vbgCanvas.height;
    vbgCtx.save();
    vbgCtx.clearRect(0, 0, w, h);
    vbgCtx.drawImage(results.segmentationMask, 0, 0, w, h);
    vbgCtx.globalCompositeOperation = "source-in";
    vbgCtx.drawImage(results.image, 0, 0, w, h);
    vbgCtx.globalCompositeOperation = "destination-over";
    if (bg.type === "blur") {
      vbgCtx.filter = "blur(14px)";
      vbgCtx.drawImage(results.image, 0, 0, w, h);
      vbgCtx.filter = "none";
    } else if (bg.type === "animated" && vbgAnimCanvas) {
      vbgCtx.drawImage(vbgAnimCanvas, 0, 0, w, h);
    } else if (vbgImageEl) {
      vbgCtx.drawImage(vbgImageEl, 0, 0, w, h);
    }
    vbgCtx.restore();
    if (!gotFirstFrame) { gotFirstFrame = true; firstFrameResolve(); }
  });

  vbgActive = true;
  async function frameLoop() {
    if (!vbgActive) return;
    if (vbgSourceVideoEl.readyState >= 2) {
      try { await vbgSegmentation.send({ image: vbgSourceVideoEl }); } catch (e) {}
    }
    vbgAnimationFrame = requestAnimationFrame(frameLoop);
  }
  frameLoop();

  // No mandamos el video hasta confirmar que la segmentación de verdad dibujó algo —
  // si no lo hace en 8 segundos, avisamos claro y volvemos a la cámara normal, en vez
  // de quedar en negro para siempre sin explicación.
  const timedOut = await Promise.race([
    firstFramePromise.then(() => false),
    new Promise((res) => setTimeout(() => res(true), 8000)),
  ]);
  if (timedOut || !vbgActive) {
    vbgActive = false;
    if (vbgAnimationFrame) cancelAnimationFrame(vbgAnimationFrame);
    if (msgEl) msgEl.textContent = "No se pudo activar el fondo virtual en este dispositivo/navegador. Probá con otro navegador (Chrome funciona mejor para esto) o dejalo sin fondo.";
    document.querySelectorAll('.vbg-swatch[data-vbg-ctx="' + context + '"]').forEach((b) => b.classList.toggle("active", b.dataset.vbg === "none"));
    return;
  }

  vbgProcessedStream = vbgCanvas.captureStream(24);
  const processedTrack = vbgProcessedStream.getVideoTracks()[0];

  // Reemplazamos el video que se manda por WebRTC en el momento, sin cortar la llamada
  const store = context === "meeting" ? meetingPeerConnections : peerConnections;
  Object.values(store).forEach((pc) => {
    const sender = pc.getSenders && pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(processedTrack);
  });

  sourceVideo.srcObject = vbgProcessedStream; // tu propia vista previa también cambia
  if (msgEl) msgEl.textContent = "✅ Fondo virtual activado.";
}

function stopVirtualBackground() {
  if (!vbgActive) return;
  vbgActive = false;
  if (vbgAnimationFrame) cancelAnimationFrame(vbgAnimationFrame);

  const store = vbgContext === "meeting" ? meetingPeerConnections : peerConnections;
  const rawStream = vbgContext === "meeting" ? meetingLocalStream : localStream;
  if (rawStream && rawStream.getVideoTracks().length) {
    const rawTrack = rawStream.getVideoTracks()[0];
    Object.values(store).forEach((pc) => {
      const sender = pc.getSenders && pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(rawTrack);
    });
    if (vbgDisplayVideoEl) vbgDisplayVideoEl.srcObject = rawStream;
  }
  if (vbgProcessedStream) {
    vbgProcessedStream.getTracks().forEach((t) => t.stop());
    vbgProcessedStream = null;
  }
}

document.querySelectorAll(".vbg-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ctx = btn.dataset.vbgCtx;
    document.querySelectorAll('.vbg-swatch[data-vbg-ctx="' + ctx + '"]').forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    applyVirtualBackground(btn.dataset.vbg, ctx);
  });
});

function renderBoneyardVisual(state) {
  const pile = document.getElementById("boneyard-pile");
  if (state.boneyardCount > 0) {
    pile.classList.remove("hidden");
    document.getElementById("boneyard-count-label").textContent = state.boneyardCount + " en el montón";
    const row = document.getElementById("boneyard-row");
    if (row.children.length !== state.boneyardCount) {
      row.innerHTML = "";
      for (let i = 0; i < state.boneyardCount; i++) {
        const t = document.createElement("div");
        t.className = "boneyard-tile";
        t.dataset.pileIndex = i;
        row.appendChild(t);
      }
    }
  } else {
    pile.classList.add("hidden");
  }
}

function renderGame(state, readOnly) {
  const hostSeat = state.seats.find((s) => s.name);
  document.getElementById("room-label").textContent =
    (hostSeat ? "🔴 " + hostSeat.name : "Sala " + state.code) + " · " + state.code;
  const hostAvatarEl = document.getElementById("host-badge-avatar");
  const hostFallbackEl = document.getElementById("host-badge-fallback");
  const hostBadgeEl = document.getElementById("host-badge");
  if (hostSeat && hostSeat.avatarUrl) {
    hostAvatarEl.src = hostSeat.avatarUrl;
    hostAvatarEl.style.display = "block";
    hostFallbackEl.style.display = "none";
  } else if (hostSeat) {
    hostAvatarEl.style.display = "none";
    hostFallbackEl.style.display = "flex";
    hostFallbackEl.textContent = hostSeat.name.trim().charAt(0).toUpperCase();
    hostFallbackEl.style.background = colorForName(hostSeat.name);
  } else {
    hostAvatarEl.style.display = "none";
    hostFallbackEl.style.display = "none";
  }
  hostBadgeEl.onclick = hostSeat && hostSeat.email ? () => openUserProfile(hostSeat.email) : null;
  renderOnCameraStrip(state, hostSeat);
  renderBattle(state);
  const turnSeat = state.seats.find((s) => s.seatIndex === state.turnSeatIndex);
  const isMyTurn = !readOnly && state.turnSeatIndex === mySeatIndex && mySeatIndex !== null;

  const filledSeats = state.seats.filter((s) => s.name).length;
  const missingSeats = state.capacity - filledSeats;
  const waitingText = missingSeats === 1
    ? "🎲 Falta 1 jugador para arrancar el dominó"
    : "🎲 Faltan " + missingSeats + " jugadores para arrancar el dominó";

  document.getElementById("turn-label").textContent = state.finished
    ? "Partida terminada"
    : !state.started
    ? ""
    : (isMyTurn ? "Tu turno" : "Turno de " + (turnSeat ? turnSeat.name : "..."));

  // El aviso de "faltan jugadores" va adentro de la mesa (no arriba, donde estorbaba)
  const tableMsgEl = document.getElementById("table-waiting-msg");
  if (!state.started && !state.finished) {
    tableMsgEl.textContent = waitingText;
    tableMsgEl.classList.remove("hidden");
  } else {
    tableMsgEl.classList.add("hidden");
  }

  document.getElementById("spectator-count").textContent =
    state.spectatorCount ? "👁 " + state.spectatorCount + " mirando" : "";
  latestSpectatorsList = state.spectatorsList || [];

  const queueLen = (state.queue || []).length;
  const queueEl = document.getElementById("queue-count");
  if (!queueLen) {
    queueEl.textContent = "";
  } else if (myQueuePosition !== null && mySeatIndex === null) {
    queueEl.textContent = "🕒 Estás en la fila (posición " + myQueuePosition + " de " + queueLen + ")";
  } else {
    queueEl.textContent = "🕒 " + queueLen + (queueLen === 1 ? " persona esperando lugar" : " personas esperando lugar");
  }

  const openSeat = state.seats.some((s) => s.name === null);
  const canRequestSeat = mySeatIndex === null && openSeat && !!authToken;
  document.getElementById("request-seat-btn").classList.toggle("hidden", !canRequestSeat);
  // Si todavía no tenés asiento (y hay lugar libre), mostramos SOLO el botón de sumarte a jugar,
  // para que no se confunda con "Jugar dominó" (que para un espectador solo abre el tablero para mirar).
  document.getElementById("toggle-domino-btn").classList.toggle("hidden", canRequestSeat);

  const totalLikes = state.likes ? Object.values(state.likes).reduce((a, b) => a + b, 0) : 0;
  document.getElementById("rail-like-count").textContent = totalLikes;

  // Orden de turno: la secuencia de asientos con quien juega ahora resaltado
  const orderWrap = document.getElementById("turn-order");
  orderWrap.innerHTML = "";
  state.seats.forEach((s, i) => {
    if (i > 0) {
      const arrow = document.createElement("span");
      arrow.className = "turn-order-arrow";
      arrow.textContent = "→";
      orderWrap.appendChild(arrow);
    }
    const item = document.createElement("span");
    item.className = "turn-order-item" + (s.seatIndex === state.turnSeatIndex ? " current" : "");
    item.textContent = s.name ? s.name + (s.seatIndex === mySeatIndex ? " (vos)" : "") : "—";
    orderWrap.appendChild(item);
  });

  const oppWrap = document.getElementById("opponents");
  oppWrap.innerHTML = "";
  state.seats.filter((s) => s.seatIndex !== mySeatIndex && s.name).forEach((s) => {
    const active = s.seatIndex === state.turnSeatIndex ? "active" : "";
    const div = document.createElement("div");
    div.className = "opp-badge " + active;
    const label = s.name ? escapeHtml(s.name) : "esperando...";
    const status = s.name && !s.connected ? " (se cayó, esperando reemplazo)" : "";
    div.innerHTML = label + " · " + s.tileCount + " fichas" + status;

    const likeBtn = document.createElement("button");
    likeBtn.className = "like-btn";
    likeBtn.textContent = "❤️" + (state.likes && state.likes[s.seatIndex] ? " " + state.likes[s.seatIndex] : "");
    likeBtn.title = "Dar me gusta";
    likeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      socket.emit("sendLike", { toSeatIndex: s.seatIndex });
      likeBtn.classList.remove("pop");
      void likeBtn.offsetWidth;
      likeBtn.classList.add("pop");
    });
    div.appendChild(likeBtn);

    if ((!readOnly || authToken) && s.name && s.connected) {
      const giftBtn = document.createElement("button");
      giftBtn.className = "gift-btn";
      giftBtn.textContent = "🎁";
      giftBtn.title = "Mandarle un regalo";
      giftBtn.addEventListener("click", (e) => { e.stopPropagation(); openGiftPicker(giftBtn, s.seatIndex); });
      div.appendChild(giftBtn);
      const whisperBtn = document.createElement("button");
      whisperBtn.className = "gift-btn";
      whisperBtn.textContent = "✉️";
      whisperBtn.title = "Hablar en privado";
      whisperBtn.addEventListener("click", (e) => { e.stopPropagation(); openPrivateChat(s.name); });
      div.appendChild(whisperBtn);
    }
    oppWrap.appendChild(div);
  });
  if (state.queue && state.queue.length) {
    const q = document.createElement("div");
    q.className = "opp-badge";
    q.textContent = "En fila: " + state.queue.map(escapeHtml).join(", ");
    oppWrap.appendChild(q);
  }

  renderSpiralBoard(state.board);

  syncChatHistory(state.comments);

  // Esto lo vemos todos, jugadores y espectadores por igual
  renderBoneyardVisual(state);

  if (readOnly) { renderHand(); return; }

  selectedTile = null;
  updatePlayActions();

  const canPlay = isMyTurn && myHand.some((t) =>
    state.board.length === 0 || t[0] === state.leftEnd || t[1] === state.leftEnd || t[0] === state.rightEnd || t[1] === state.rightEnd
  );
  const passBtn = document.getElementById("pass-btn");
  const pile = document.getElementById("boneyard-pile");

  if (isMyTurn && !state.finished && !canPlay) {
    if (state.boneyardCount > 0) {
      passBtn.classList.add("hidden");
      pile.classList.add("drawable");
      pile.querySelectorAll(".boneyard-tile").forEach((t) => {
        t.onclick = () => socket.emit("drawTile", { pileIndex: parseInt(t.dataset.pileIndex, 10) });
      });
      if (autoPassTimeout) { clearTimeout(autoPassTimeout); autoPassTimeout = null; }
    } else {
      pile.classList.remove("drawable");
      passBtn.textContent = "Pasando automáticamente...";
      passBtn.classList.remove("hidden");
      passBtn.disabled = true;
      passBtn.onclick = null;
      if (autoPassTimeout) clearTimeout(autoPassTimeout);
      autoPassTimeout = setTimeout(() => { socket.emit("passTurn"); }, 1800);
    }
  } else {
    passBtn.classList.add("hidden");
    passBtn.disabled = false;
    passBtn.onclick = null;
    pile.classList.remove("drawable");
    pile.querySelectorAll(".boneyard-tile").forEach((t) => { t.onclick = null; });
    if (autoPassTimeout) { clearTimeout(autoPassTimeout); autoPassTimeout = null; }
  }

  updateUndoButton(state);

  const overWrap = document.getElementById("gameover-wrap");
  if (state.finished) {
    overWrap.classList.remove("hidden");
    const w = state.winner;
    document.getElementById("gameover-text").textContent = w.seatIndex === mySeatIndex
      ? "¡Ganaste vos! (" + (w.reason === "sin_fichas" ? "te quedaste sin fichas" : "menos puntos al bloquearse") + ")"
      : (w.name || "Un jugador") + " ganó la partida.";

    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    const rankingEl = document.getElementById("ranking-list");
    rankingEl.innerHTML = (w.ranking || []).map((r) => {
      const tilesHtml = r.hand.map((t) => {
        const [c1, c2] = tileColors(t);
        return `<span style="display:flex;width:32px;height:16px;border-radius:4px;overflow:hidden;margin:1px;box-shadow:0 1px 3px rgba(0,0,0,0.4);">
          <span style="flex:1;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;background:${c1};">${t[0]}</span>
          <span style="flex:1;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;background:${c2};">${t[1]}</span>
        </span>`;
      }).join("") || '<span style="font-size:12px;color:#9fc9b8;">sin fichas</span>';
      return `<div style="text-align:left;padding:8px 0;border-bottom:1px solid #2f6b58;">
        <p style="margin:0 0 4px;font-size:14px;">${medals[r.place - 1] || (r.place + "°")} <b>${escapeHtml(r.name || "")}</b> — ${r.pipSum} puntos</p>
        <div style="display:flex;flex-wrap:wrap;">${tilesHtml}</div>
      </div>`;
    }).join("");
  } else {
    overWrap.classList.add("hidden");
  }
  renderHand();
}

function renderTile(tile, cls) {
  return '<div class="domino ' + cls + '"><div class="domino-half">' + tile[0] + '</div><div class="domino-half">' + tile[1] + "</div></div>";
}

let selectedTile = null;
let autoPassTimeout = null;

function renderHand() {
  const handEl = document.getElementById("my-hand");
  const isMyTurn = latestState && latestState.turnSeatIndex === mySeatIndex && !latestState.finished;
  handEl.innerHTML = "";
  myHand.forEach((tile) => {
    const div = document.createElement("div");
    const playable = !latestState || latestState.board.length === 0 ||
      tile[0] === latestState.leftEnd || tile[1] === latestState.leftEnd ||
      tile[0] === latestState.rightEnd || tile[1] === latestState.rightEnd;
    div.className = "domino hand-tile" + (!playable ? " disabled" : "");
    if (selectedTile && selectedTile[0] === tile[0] && selectedTile[1] === tile[1]) div.classList.add("selected");
    const [c1, c2] = tileColors(tile);
    div.innerHTML = renderHalf(tile[0], c1) + renderHalf(tile[1], c2);
    if (isMyTurn && playable) div.addEventListener("click", () => onTileClick(tile));
    else if (!isMyTurn) div.style.opacity = "0.7";
    handEl.appendChild(div);
  });
}

function onTileClick(tile) {
  if (!latestState) return;
  selectedTile = tile;
  renderHand();
  updatePlayActions();
}

function updatePlayActions() {
  const wrap = document.getElementById("play-actions");
  const label = document.getElementById("play-actions-label");
  const buttons = document.getElementById("play-actions-buttons");
  buttons.innerHTML = "";

  if (!selectedTile || !latestState) { wrap.classList.add("hidden"); return; }
  const tile = selectedTile;

  if (latestState.board.length === 0) {
    label.textContent = "Ficha " + tile[0] + " | " + tile[1] + " seleccionada — es la primera del tablero";
    const b = document.createElement("button");
    b.textContent = "Jugar esta ficha";
    b.addEventListener("click", () => { socket.emit("playTile", { tile, end: "right" }); selectedTile = null; });
    buttons.appendChild(b);
    wrap.classList.remove("hidden");
    return;
  }

  const matchesLeft = tile[0] === latestState.leftEnd || tile[1] === latestState.leftEnd;
  const matchesRight = tile[0] === latestState.rightEnd || tile[1] === latestState.rightEnd;

  if (!matchesLeft && !matchesRight) {
    label.textContent = "Esa ficha no encaja en ningún extremo del tablero.";
    wrap.classList.remove("hidden");
    return;
  }

  label.textContent = "Ficha " + tile[0] + " | " + tile[1] + " — ¿de qué lado la jugás?";
  if (matchesLeft) {
    const b = document.createElement("button");
    b.textContent = "‹ Lado izquierdo";
    b.addEventListener("click", () => { socket.emit("playTile", { tile, end: "left" }); selectedTile = null; });
    buttons.appendChild(b);
  }
  if (matchesRight) {
    const b = document.createElement("button");
    b.textContent = "Lado derecho ›";
    b.addEventListener("click", () => { socket.emit("playTile", { tile, end: "right" }); selectedTile = null; });
    buttons.appendChild(b);
  }
  wrap.classList.remove("hidden");
}

let undoInterval = null;

function updateUndoButton(state) {
  const btn = document.getElementById("undo-btn");
  if (undoInterval) { clearInterval(undoInterval); undoInterval = null; }

  if (state.lastMoveSeatIndex !== mySeatIndex || mySeatIndex === null || !state.lastMoveExpiresAt) {
    btn.classList.add("hidden");
    return;
  }

  btn.classList.remove("hidden");
  const tick = () => {
    const secondsLeft = Math.max(0, Math.ceil((state.lastMoveExpiresAt - Date.now()) / 1000));
    btn.textContent = "Deshacer última jugada (" + secondsLeft + "s)";
    if (secondsLeft <= 0) {
      btn.classList.add("hidden");
      clearInterval(undoInterval);
    }
  };
  tick();
  undoInterval = setInterval(tick, 500);
  btn.onclick = () => socket.emit("undoLastMove");
}

// ---------------- Mesa: fichas en espiral + tapete elegible ----------------

const STEP = 60; // distancia entre el centro de una ficha y la siguiente

function renderSpiralBoard(board) {
  const inner = document.getElementById("board-inner");
  const mesa = document.getElementById("table-mesa");
  if (!board.length) { inner.innerHTML = ""; inner.style.transform = ""; return; }

  const mesaRect = mesa.getBoundingClientRect();
  // El margen interno que dejamos antes del borde de la mesa
  const halfW = Math.max(60, mesaRect.width / 2 - 40);
  const halfH = Math.max(60, mesaRect.height / 2 - 40);

  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // derecha, abajo, izquierda, arriba
  let x = 0, y = 0, dirIndex = 0;
  let html = "";

  board.forEach((entry) => {
    // Esta ficha se dibuja en (x,y) con la direccion actual (de donde viene)
    const swap = dirIndex === 2 || dirIndex === 3;
    const rotate = (dirIndex === 1 || dirIndex === 3) ? 90 : 0;
    const values = swap ? [entry.tile[1], entry.tile[0]] : [entry.tile[0], entry.tile[1]];
    const colors = tileColors(swap ? [entry.tile[1], entry.tile[0]] : entry.tile);

    html += `<div class="domino board-tile" style="left:${x}px;top:${y}px;transform:translate(-50%,-50%) rotate(${rotate}deg);">
      ${renderHalf(values[0], colors[0])}${renderHalf(values[1], colors[1])}
    </div>`;

    // Medimos si el próximo paso en esta dirección todavía entra en la mesa;
    // si no entra, giramos primero (así nunca se sale del borde)
    let nx = x + dirs[dirIndex][0] * STEP;
    let ny = y + dirs[dirIndex][1] * STEP;
    if (Math.abs(nx) > halfW || Math.abs(ny) > halfH) {
      dirIndex = (dirIndex + 1) % 4;
      nx = x + dirs[dirIndex][0] * STEP;
      ny = y + dirs[dirIndex][1] * STEP;
    }
    x = nx; y = ny;
  });

  inner.innerHTML = html;
  inner.style.transform = "";
  mesa.style.overflow = "hidden";
}

document.querySelectorAll(".mesa-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mesa-swatch").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const felt = btn.getAttribute("data-felt");
    applyFelt(felt);
    localStorage.setItem("domino_felt", felt);
  });
});

function applyFelt(felt) {
  const mesa = document.getElementById("table-mesa");
  const feltGradients = {
    green: "linear-gradient(160deg, #1B4332 0%, #0f2b23 100%)",
    red: "linear-gradient(160deg, #7a2020 0%, #4a1010 100%)",
    blue: "linear-gradient(160deg, #1e3a5f 0%, #10223a 100%)",
    purple: "linear-gradient(160deg, #4a2160 0%, #2a1038 100%)",
  };
  mesa.style.background =
    "radial-gradient(ellipse at center, rgba(255,255,255,0.05) 0%, transparent 70%), " + (feltGradients[felt] || feltGradients.green);
}

const savedFelt = localStorage.getItem("domino_felt");
if (savedFelt) {
  applyFelt(savedFelt);
  document.querySelectorAll(".mesa-swatch").forEach((b) => b.classList.toggle("active", b.getAttribute("data-felt") === savedFelt));
}

document.querySelectorAll(".style-swatch").forEach((btn) => {
  if (btn.getAttribute("data-style") === tileStyle) btn.classList.add("active");
  btn.addEventListener("click", () => {
    document.querySelectorAll(".style-swatch").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tileStyle = btn.getAttribute("data-style");
    localStorage.setItem("domino_tile_style", tileStyle);
    if (latestState) renderGame(latestState, mySeatIndex === null);
  });
});

// ---------------- Filtro de cámara (solo del lado del cliente, no se transmite) ----------------
const CAM_FILTER_SELECTOR = "#cam-filter-row .cam-filter-swatch, #meeting-cam-filter-row .cam-filter-swatch";
function applyCamFilter(filter) {
  // Se aplica a mi propio video, esté en el en vivo o en una reunión privada
  const tiles = [document.getElementById("local-video-tile"), document.getElementById("meeting-local-tile")].filter(Boolean);
  tiles.forEach((tile) => {
    tile.className = tile.className.replace(/\bcam-filter-\S+/g, "").trim();
    if (filter && filter !== "natural") tile.classList.add("cam-filter-" + filter);
  });
}
document.querySelectorAll(CAM_FILTER_SELECTOR).forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(CAM_FILTER_SELECTOR).forEach((b) => b.classList.toggle("active", b.getAttribute("data-filter") === btn.getAttribute("data-filter")));
    const filter = btn.getAttribute("data-filter");
    applyCamFilter(filter);
    localStorage.setItem("domino_cam_filter", filter);
  });
});
const savedCamFilter = localStorage.getItem("domino_cam_filter");
if (savedCamFilter && savedCamFilter !== "natural") {
  applyCamFilter(savedCamFilter);
  document.querySelectorAll(CAM_FILTER_SELECTOR).forEach((b) => b.classList.toggle("active", b.getAttribute("data-filter") === savedCamFilter));
}

document.getElementById("meeting-filters-btn").addEventListener("click", () => {
  document.getElementById("meeting-filters-panel").classList.toggle("hidden");
});

document.getElementById("rematch-btn").addEventListener("click", () => socket.emit("rematch"));

function spawnFloatingEmoji(emoji) {
  const layer = document.getElementById("reaction-layer");
  const el = document.createElement("div");
  el.className = "floating-emoji";
  el.textContent = emoji;
  el.style.right = 20 + Math.random() * 40 + "px";
  el.style.setProperty("--drift", (Math.random() * 60 - 30) + "px");
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

const RAIL_EMOJIS = ["😂", "😢", "😮", "👏", "😱", "🔥", "😍", "🤣", "😡", "🎉", "🙌", "💯"];
function openEmojiPicker(anchorEl) {
  closeEmojiPicker();
  const picker = document.createElement("div");
  picker.id = "emoji-picker";
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = rect.top + "px";
  picker.style.right = (window.innerWidth - rect.left + 8) + "px";
  RAIL_EMOJIS.forEach((emoji) => {
    const b = document.createElement("button");
    b.textContent = emoji;
    b.addEventListener("click", () => {
      socket.emit("sendReaction", { emoji });
      spawnFloatingEmoji(emoji);
      closeEmojiPicker();
    });
    picker.appendChild(b);
  });
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener("click", closeEmojiPickerOnce), 0);
}
function closeEmojiPickerOnce(e) { if (!e.target.closest("#emoji-picker") && e.target.id !== "rail-emoji-btn") closeEmojiPicker(); }
function closeEmojiPicker() {
  const existing = document.getElementById("emoji-picker");
  if (existing) existing.remove();
  document.removeEventListener("click", closeEmojiPickerOnce);
}
document.getElementById("rail-emoji-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  openEmojiPicker(e.currentTarget);
});

document.getElementById("toggle-guests-open-btn").addEventListener("click", () => {
  const isOpen = document.getElementById("toggle-guests-open-btn").classList.contains("guests-open-active");
  const limit = document.getElementById("guests-limit-select").value;
  socket.emit("toggleGuestsOpen", { open: !isOpen, limit });
  showToast(!isOpen ? "✅ Ventanillas abiertas — hasta " + limit + " personas van a poder pedir subir a cámara." : "🔒 Ventanillas cerradas.");
});
document.getElementById("toggle-comments-closed-btn").addEventListener("click", () => {
  const isClosed = document.getElementById("toggle-comments-closed-btn").classList.contains("comments-closed-active");
  socket.emit("toggleCommentsClosed", { closed: !isClosed });
  showToast(!isClosed ? "💬 Comentarios cerrados — nadie va a poder escribir." : "💬 Comentarios abiertos de nuevo.");
});
document.getElementById("request-camera-btn-on").addEventListener("click", () => {
  socket.emit("requestJoinCamera", { withCamera: true });
  showToast("Le pediste al anfitrión subir con cámara. Esperá que te aprueben.");
});
document.getElementById("request-camera-btn-off").addEventListener("click", () => {
  socket.emit("requestJoinCamera", { withCamera: false });
  showToast("Le pediste al anfitrión subir sin cámara (solo audio/presencia). Esperá que te aprueben.");
});

document.getElementById("make-admin-btn").addEventListener("click", () => {
  const name = prompt("¿A quién querés poner como administrador del live? Escribí su nombre exacto:");
  if (name && name.trim()) socket.emit("setLiveAdmin", { name: name.trim() });
});

function renderCameraPanel(data) {
  const guests = data.guests || [];
  document.getElementById("camera-guests-count").textContent = guests.length + "/8 en cámara";
  const panel = document.getElementById("camera-requests-panel");
  const requests = data.requests || [];
  if (!requests.length) { panel.classList.add("hidden"); panel.innerHTML = ""; return; }
  panel.classList.remove("hidden");
  panel.innerHTML = requests.map((r) => {
    const name = typeof r === "string" ? r : r.name;
    const withCamera = typeof r === "string" ? true : r.withCamera !== false;
    const modeLabel = withCamera ? "con cámara 🎥" : "sin cámara 🎙️";
    const safeName = escapeHtml(name).replace(/'/g, "");
    return `
    <div class="camera-request-row">
      <span class="camera-request-name">${escapeHtml(name)} pidió TableUp ${modeLabel}</span>
      <div class="camera-request-actions">
        <button class="camera-approve-btn" onclick="window.__approveCam('${safeName}', true)">✅ Aprobar</button>
        <button class="camera-reject-btn" onclick="window.__approveCam('${safeName}', false)">❌ Rechazar</button>
      </div>
    </div>`;
  }).join("");
}
window.__approveCam = (name, approve) => socket.emit("decideCameraRequest", { name, approve });

// ---------------- Mensajes privados ----------------

let privateChatWith = null;

function openPrivateChat(name) {
  privateChatWith = name;
  document.getElementById("private-chat-title").textContent = "Hablando en privado con " + name;
  document.getElementById("private-chat-messages").innerHTML = "";
  document.getElementById("private-chat-modal").classList.remove("hidden");
}

document.getElementById("close-private-chat").addEventListener("click", () => {
  document.getElementById("private-chat-modal").classList.add("hidden");
  privateChatWith = null;
});

document.getElementById("private-chat-send").addEventListener("click", sendPrivateMsg);
document.getElementById("private-chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendPrivateMsg(); });
function sendPrivateMsg() {
  const input = document.getElementById("private-chat-input");
  const text = input.value.trim();
  if (!text || !privateChatWith) return;
  socket.emit("sendPrivateMessage", { toName: privateChatWith, text });
  input.value = "";
}

function renderPrivateMessage(p) {
  if (p.from !== privateChatWith && p.to !== privateChatWith) return; // no es de esta conversacion abierta
  const wrap = document.getElementById("private-chat-messages");
  const line = document.createElement("div");
  line.style.fontSize = "13px";
  line.style.marginBottom = "4px";
  line.innerHTML = "<b>" + escapeHtml(p.from === myName ? "Vos" : p.from) + ":</b> " + escapeHtml(p.text);
  wrap.appendChild(line);
  wrap.scrollTop = wrap.scrollHeight;
}

// ---------------- Tarjeta de ayuda para principiantes ----------------

document.getElementById("rail-help-btn").addEventListener("click", () => {
  document.getElementById("help-card-modal").classList.remove("hidden");
});
document.getElementById("close-help-card").addEventListener("click", () => {
  document.getElementById("help-card-modal").classList.add("hidden");
});

function makeSimpleToggle(btnId, panelId, label, activeLabel) {
  let open = false;
  document.getElementById(btnId).addEventListener("click", () => {
    open = !open;
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (open) { panel.classList.remove("hidden"); btn.classList.add("active"); btn.textContent = activeLabel; }
    else { panel.classList.add("hidden"); btn.classList.remove("active"); btn.textContent = label; }
  });
}
makeSimpleToggle("search-from-game-btn", "live-search-panel", "🔍", "🔍");
makeSimpleToggle("toggle-battle-panel-btn", "battle-panel", "⚔️", "⚔️");
makeSimpleToggle("toggle-camera-panel-btn", "camera-panel", "🎥", "🎥");
makeSimpleToggle("toggle-settings-panel-btn", "settings-panel", "⚙️", "⚙️");

let walletActionsOpen = false;
document.getElementById("wallet-pill").addEventListener("click", (e) => {
  e.stopPropagation();
  walletActionsOpen = !walletActionsOpen;
  document.getElementById("wallet-actions").classList.toggle("hidden", !walletActionsOpen);
});
document.addEventListener("click", (e) => {
  if (walletActionsOpen && !e.target.closest("#wallet-bar")) {
    walletActionsOpen = false;
    document.getElementById("wallet-actions").classList.add("hidden");
  }
});

// Los cuatro dropdowns (buscar/batalla/cámara/ajustes) flotan en el mismo lugar arriba a la
// derecha, así que si abrís uno se cierran los otros para que no queden pisados entre sí.
function closeOverlayDropdown(btnId, panelId) {
  document.getElementById(panelId).classList.add("hidden");
  document.getElementById(btnId).classList.remove("active");
}
document.getElementById("search-from-game-btn").addEventListener("click", () => {
  if (!document.getElementById("live-search-panel").classList.contains("hidden")) {
    closeOverlayDropdown("toggle-battle-panel-btn", "battle-panel");
    closeOverlayDropdown("toggle-camera-panel-btn", "camera-panel");
    closeOverlayDropdown("toggle-settings-panel-btn", "settings-panel");
  }
});
document.getElementById("toggle-battle-panel-btn").addEventListener("click", () => {
  if (!document.getElementById("battle-panel").classList.contains("hidden")) {
    closeOverlayDropdown("search-from-game-btn", "live-search-panel");
    closeOverlayDropdown("toggle-camera-panel-btn", "camera-panel");
    closeOverlayDropdown("toggle-settings-panel-btn", "settings-panel");
    loadBattleTargets();
  }
});
document.getElementById("toggle-camera-panel-btn").addEventListener("click", () => {
  if (!document.getElementById("camera-panel").classList.contains("hidden")) {
    closeOverlayDropdown("search-from-game-btn", "live-search-panel");
    closeOverlayDropdown("toggle-battle-panel-btn", "battle-panel");
    closeOverlayDropdown("toggle-settings-panel-btn", "settings-panel");
  }
});
document.getElementById("toggle-settings-panel-btn").addEventListener("click", () => {
  if (!document.getElementById("settings-panel").classList.contains("hidden")) {
    closeOverlayDropdown("search-from-game-btn", "live-search-panel");
    closeOverlayDropdown("toggle-battle-panel-btn", "battle-panel");
    closeOverlayDropdown("toggle-camera-panel-btn", "camera-panel");
  }
});

// ---------------- Batalla LIVE: invitar, aceptar/rechazar, puntaje ----------------
let selectedBattleDuration = 60;
let selectedBattleRematchMinutes = 0;
document.querySelectorAll("#battle-duration-row .cam-filter-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#battle-duration-row .cam-filter-swatch").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedBattleDuration = parseInt(btn.dataset.seconds, 10);
  });
});
document.querySelectorAll("#battle-rematch-row .cam-filter-swatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#battle-rematch-row .cam-filter-swatch").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedBattleRematchMinutes = parseInt(btn.dataset.rematchMin, 10);
  });
});

async function loadBattleTargets() {
  const wrap = document.getElementById("battle-target-list");
  wrap.innerHTML = '<p class="empty-msg-small">Buscando transmisiones...</p>';
  try {
    const res = await fetch("/api/live-rooms");
    const data = await res.json();
    const others = data.rooms.filter((r) => r.code !== (latestState && latestState.code));
    if (!others.length) { wrap.innerHTML = '<p class="empty-msg-small">No hay otras transmisiones en vivo ahora mismo.</p>'; return; }
    wrap.innerHTML = others.map((r) => `
      <div class="battle-target-row">
        <span>${escapeHtml(r.players.join(", ") || "Sala " + r.code)}</span>
        <button data-invite="${r.code}">⚔️ Desafiar</button>
      </div>
    `).join("");
    wrap.querySelectorAll("[data-invite]").forEach((btn) => {
      btn.addEventListener("click", () => {
        socket.emit("inviteBattle", { targetCode: btn.dataset.invite, durationSeconds: selectedBattleDuration, autoRematchMinutes: selectedBattleRematchMinutes || null });
        showToast(selectedBattleRematchMinutes ? "Desafío enviado — si se acepta, se va a relanzar sola cada " + selectedBattleRematchMinutes + " min." : "Desafío enviado.");
      });
    });
  } catch (e) {
    wrap.innerHTML = '<p class="empty-msg-small">Error buscando transmisiones.</p>';
  }
}

document.getElementById("battle-invite-accept-btn").addEventListener("click", () => {
  socket.emit("respondBattleInvite", { accept: true });
  document.getElementById("battle-invite-modal").classList.add("hidden");
});
document.getElementById("battle-invite-decline-btn").addEventListener("click", () => {
  socket.emit("respondBattleInvite", { accept: false });
  document.getElementById("battle-invite-modal").classList.add("hidden");
});

function wireBattleSocketEvents(sock) {
  sock.on("battleInviteSent", () => {
    closeOverlayDropdown("toggle-battle-panel-btn", "battle-panel");
    showToast("Desafío enviado. Esperando respuesta...");
  });
  sock.on("battleInvited", (data) => {
    const mins = Math.round(data.durationSeconds / 60);
    const rematchText = data.autoRematchMinutes ? " Si aceptás, se va a volver a armar sola cada " + data.autoRematchMinutes + " min mientras las dos sigan en vivo." : "";
    document.getElementById("battle-invite-text").textContent =
      data.fromName + " te desafió a una batalla LIVE de " + mins + " minuto" + (mins === 1 ? "" : "s") + ". ¿Aceptás?" + rematchText;
    document.getElementById("battle-invite-modal").classList.remove("hidden");
  });
  sock.on("battleDeclined", (data) => {
    showToast(data.byName + " rechazó tu desafío de batalla.");
  });
}

function wireModerationSocketEvents(sock) {
  sock.on("liveAdminsEvent", (data) => {
    liveAdminNames = data.liveAdmins || [];
    updateModeratorStatus();
  });
  sock.on("moderationEvent", (data) => {
    mutedNamesSet = new Set(data.mutedNames || []);
  });
  sock.on("commentDeleted", (data) => {
    const line = document.querySelector('.chat-line[data-ts="' + data.ts + '"]');
    if (line) line.remove();
  });
  sock.on("kickedEvent", () => {
    alert("Un moderador te expulsó de esta transmisión.");
    location.href = "/";
  });
  sock.on("cameraApprovedEvent", (data) => {
    showToast(data.withCamera ? "¡Te aceptaron! Prendiendo tu cámara..." : "¡Te aceptaron! Conectando tu micrófono...");
    setupVideoIfNeeded(currentVideoRoomCode, true, data.withCamera);
  });
  sock.on("removedFromCameraEvent", () => {
    showToast("El anfitrión te bajó de cámara. Tu mic y tu cámara se apagaron.");
    if (localStream) {
      myMicOn = false;
      myCamOn = false;
      localStream.getAudioTracks().forEach((t) => (t.enabled = false));
      localStream.getVideoTracks().forEach((t) => (t.enabled = false));
      const tile = document.getElementById("local-video-tile");
      if (tile) tile.classList.add("cam-off");
      updateJitsiMicCamButtons();
    }
  });
  sock.on("hostMutedYouInLiveEvent", () => {
    showToast("El anfitrión te silenció el micrófono.");
    if (localStream) {
      myMicOn = false;
      localStream.getAudioTracks().forEach((t) => (t.enabled = false));
      updateJitsiMicCamButtons();
    }
  });
}

let lastBattleId = null;
let currentBattleInfo = null;
let battleTimerInterval = null;

function tickBattleTimer() {
  if (!currentBattleInfo) return;
  const remaining = Math.max(0, currentBattleInfo.durationSeconds - Math.floor((Date.now() - currentBattleInfo.startedAt) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  document.getElementById("battle-timer").textContent = mm + ":" + ss;
}

function renderBattle(state) {
  const bar = document.getElementById("battle-bar");
  const battle = state.battle;

  if (!battle) {
    if (lastBattleId) { unmountOpponentVideo(); lastBattleId = null; }
    currentBattleInfo = null;
    clearInterval(battleTimerInterval);
    bar.classList.add("hidden");
    document.getElementById("battle-result-overlay").classList.add("hidden");
    return;
  }

  if (battle.ended) {
    currentBattleInfo = null;
    clearInterval(battleTimerInterval);
    bar.classList.add("hidden");
    const myScore = battle.myScore, oppScore = battle.opponentScore;
    const resultText = myScore === oppScore
      ? "🤝 ¡Empate! " + myScore + " 💎 a " + oppScore + " 💎"
      : (myScore > oppScore ? "🏆 ¡Ganaste la batalla!" : "😔 Perdiste la batalla") + " (" + myScore + " ⭐ puntos vs " + oppScore + " ⭐ puntos)";
    const rematchNote = battle.autoRematchMinutes ? "\n🔁 Se va a relanzar sola en " + battle.autoRematchMinutes + " min." : "";
    document.getElementById("battle-result-text").textContent = resultText + rematchNote;
    document.getElementById("battle-result-overlay").classList.remove("hidden");
    return;
  }

  document.getElementById("battle-result-overlay").classList.add("hidden");
  bar.classList.remove("hidden");
  if (lastBattleId !== battle.id) {
    lastBattleId = battle.id;
    mountOpponentVideo(battle.opponentCode);
  }
  currentBattleInfo = { startedAt: battle.startedAt, durationSeconds: battle.durationSeconds };
  clearInterval(battleTimerInterval);
  tickBattleTimer();
  battleTimerInterval = setInterval(tickBattleTimer, 1000);

  document.getElementById("battle-my-name").textContent = myName;
  document.getElementById("battle-opponent-name").textContent = battle.opponentName;
  document.getElementById("battle-my-score").textContent = battle.myScore;
  document.getElementById("battle-opponent-score").textContent = battle.opponentScore;

  // La espada ⚔️ aparece sola al lado de las gemas, para quien más regaló de cada lado
  const myTopGifterEl = document.getElementById("battle-my-top-gifter");
  if (battle.myTopGifter) { myTopGifterEl.textContent = "⚔️ " + battle.myTopGifter; myTopGifterEl.classList.remove("hidden"); }
  else myTopGifterEl.classList.add("hidden");
  const oppTopGifterEl = document.getElementById("battle-opponent-top-gifter");
  if (battle.opponentTopGifter) { oppTopGifterEl.textContent = "⚔️ " + battle.opponentTopGifter; oppTopGifterEl.classList.remove("hidden"); }
  else oppTopGifterEl.classList.add("hidden");

  const iAmLeading = battle.myScore > battle.opponentScore;
  const opponentLeading = battle.opponentScore > battle.myScore;
  document.getElementById("battle-my-block").classList.toggle("leading", iAmLeading);
  document.getElementById("battle-opponent-block").classList.toggle("leading", opponentLeading);
  document.getElementById("battle-my-leading-tag").classList.toggle("hidden", !iAmLeading);
  document.getElementById("battle-opponent-leading-tag").classList.toggle("hidden", !opponentLeading);
  const total = battle.myScore + battle.opponentScore;
  const myPct = total > 0 ? (battle.myScore / total) * 100 : 50;
  document.getElementById("battle-bar-fill-me").style.width = myPct + "%";
  document.getElementById("battle-bar-fill-opponent").style.width = (100 - myPct) + "%";
}


document.getElementById("live-search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  searchTimeout = setTimeout(() => runSearch(q, "live-search-results", "live-search-input"), 350);
});

let dominoPanelOpen = false;

document.getElementById("toggle-domino-btn").addEventListener("click", () => {
  dominoPanelOpen = !dominoPanelOpen;
  const panel = document.getElementById("domino-game-panel");
  const btn = document.getElementById("toggle-domino-btn");
  if (dominoPanelOpen) {
    panel.classList.remove("hidden");
    btn.textContent = "📺 Volver al live";
    btn.classList.add("active");
    if (latestState) renderGame(latestState, mySeatIndex === null);
  } else {
    panel.classList.add("hidden");
    btn.textContent = "🎲 Jugar dominó";
    btn.classList.remove("active");
  }
});

document.getElementById("request-seat-btn").addEventListener("click", () => {
  if (!authToken) { alert("Necesitás iniciar sesión para jugar."); return; }
  if (socket) socket.emit("requestSeat");
});

document.getElementById("rail-share-btn").addEventListener("click", () => document.getElementById("share-btn").click());
document.getElementById("rail-chat-btn").addEventListener("click", () => {
  document.getElementById("chat-input").focus();
  document.getElementById("chat-messages").scrollIntoView({ behavior: "smooth", block: "center" });
});
document.getElementById("rail-gift-btn").addEventListener("click", () => {
  const firstGiftBtn = document.querySelector("#opponents .gift-btn");
  if (firstGiftBtn) firstGiftBtn.click();
  else showToast("Todavía no hay jugadores a quién regalarle.");
});
document.getElementById("rail-like-btn").addEventListener("click", () => {
  const firstSeat = latestState && latestState.seats.find((s) => s.seatIndex !== mySeatIndex && s.name);
  if (!firstSeat) { showToast("Todavía no hay a quién darle like."); return; }
  socket.emit("sendLike", { toSeatIndex: firstSeat.seatIndex });
  const btn = document.getElementById("rail-like-btn");
  btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop");
});

document.getElementById("logout-game-btn").addEventListener("click", () => {
  const confirmed = confirm("¿Seguro que querés cerrar sesión? Vas a salir de la partida.");
  if (!confirmed) return;
  localStorage.removeItem("domino_token");
  localStorage.removeItem("domino_display_name");
  if (socket) socket.disconnect();
  location.href = "/";
});

document.getElementById("share-btn").addEventListener("click", (e) => openSharePicker(e.currentTarget));

function openSharePicker(anchorEl) {
  closeSharePicker();
  if (!latestState) return;
  const picker = document.createElement("div");
  picker.id = "share-picker";
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = rect.bottom + 8 + "px";
  picker.style.right = (window.innerWidth - rect.right) + "px";

  const shareBtn = document.createElement("button");
  shareBtn.textContent = "📤 Compartir";
  shareBtn.addEventListener("click", async () => {
    const link = location.origin + "/?watch=" + latestState.code;
    const shareData = { title: "TableLive", text: "¡Mirá esta partida de TableLive en vivo!", url: link };
    closeSharePicker();
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (e) { /* la persona canceló */ }
    } else {
      showToast("Tu navegador no tiene menú de compartir nativo. Usá 'Copiar enlace'.");
    }
  });

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "📋 Copiar enlace";
  copyBtn.addEventListener("click", async () => {
    const link = location.origin + "/?watch=" + latestState.code;
    closeSharePicker();
    try { await navigator.clipboard.writeText(link); showToast("Link copiado, ¡compartilo donde quieras!"); }
    catch (e) { showToast(link); }
  });

  picker.appendChild(shareBtn);
  picker.appendChild(copyBtn);
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener("click", closeSharePickerOnce), 0);
}
function closeSharePickerOnce(e) { if (!e.target.closest("#share-picker") && e.target.id !== "share-btn") closeSharePicker(); }
function closeSharePicker() {
  const existing = document.getElementById("share-picker");
  if (existing) existing.remove();
  document.removeEventListener("click", closeSharePickerOnce);
}

const AVATAR_COLORS = ["#e0a63e", "#4a8a71", "#5b8ac9", "#c9605b", "#9b6bc9", "#5bc9b0"];
function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
function appendChatLine(c) {
  const wrap = document.getElementById("chat-messages");
  const line = document.createElement("div");
  line.className = "chat-line chat-line-in";
  line.dataset.ts = c.ts;
  const initial = (c.name || "?").trim().charAt(0).toUpperCase();
  const avatar = document.createElement("span");
  avatar.className = "chat-line-avatar";
  avatar.style.background = colorForName(c.name || "?");
  avatar.textContent = initial;
  if (c.email) { avatar.style.cursor = "pointer"; avatar.addEventListener("click", () => openUserProfile(c.email)); }
  line.appendChild(avatar);
  const textSpan = document.createElement("span");
  const badgeHtml = c.badge ? `<span class="name-badge">${c.badge}</span>` : "";
  const nameStyle = c.nameColor ? ` style="color:${c.nameColor}"` : "";
  const isMuted = mutedNamesSet.has(c.name);
  textSpan.innerHTML = badgeHtml + "<b" + nameStyle + (c.email ? ' class="chat-line-name-clickable"' : "") + ">" + escapeHtml(c.name) + "</b> " + escapeHtml(c.text) + (isMuted ? ' <span class="mod-tag">🔇</span>' : "");
  if (c.email) textSpan.querySelector("b").addEventListener("click", () => openUserProfile(c.email));
  line.appendChild(textSpan);

  if (amIModerator && c.name !== myName) {
    const modControls = document.createElement("span");
    modControls.className = "mod-controls";
    modControls.innerHTML =
      '<button class="mod-btn" data-mod-delete="' + c.ts + '" title="Borrar">🗑️</button>' +
      '<button class="mod-btn" data-mod-mute="' + escapeHtml(c.name) + '" title="' + (isMuted ? "Reactivar" : "Silenciar") + '">' + (isMuted ? "🔊" : "🔇") + '</button>' +
      '<button class="mod-btn" data-mod-kick="' + escapeHtml(c.name) + '" title="Expulsar">🚫</button>';
    line.appendChild(modControls);
    modControls.querySelector("[data-mod-delete]").addEventListener("click", () => socket.emit("deleteComment", { ts: c.ts }));
    modControls.querySelector("[data-mod-mute]").addEventListener("click", () => socket.emit("muteUser", { name: c.name, muted: !isMuted }));
    modControls.querySelector("[data-mod-kick]").addEventListener("click", () => {
      if (confirm("¿Expulsar a " + c.name + " de esta transmisión?")) socket.emit("kickUser", { name: c.name });
    });
  }

  wrap.appendChild(line);
  wrap.scrollTop = wrap.scrollHeight;
  while (wrap.children.length > 40) wrap.removeChild(wrap.firstChild);
}

let lastRenderedCommentCount = 0;
function syncChatHistory(comments) {
  if (!comments || comments.length === lastRenderedCommentCount) return;
  const wrap = document.getElementById("chat-messages");
  wrap.innerHTML = "";
  comments.forEach(appendChatLine);
  lastRenderedCommentCount = comments.length;
}

document.getElementById("chat-send-btn").addEventListener("click", sendChatMessage);
document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});
function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !socket) return;
  socket.emit("sendComment", { text });
  input.value = "";
}

// ---------------- Perfil, datos de cobro y monetización ----------------

let myMonetizationStatus = "no_solicitado";
let myFollowerCount = 0;

async function loadProfile() {
  loadMySupportThreads();
  try {
    const res = await fetch("/api/me", { headers: { Authorization: "Bearer " + authToken } });
    const data = await res.json();
    myFollowerCount = data.followerCount;
    myEmail = data.email;
    myName = data.name || myName;
    myMonetizationStatus = data.monetization ? data.monetization.status : "no_solicitado";
    if (!storeItemsCache) await loadStoreItems(); // necesario para poder aplicar el marco del avatar más abajo

    document.getElementById("profile-followers").textContent =
      data.followerCount + " seguidores · se necesitan " + data.monetizationThreshold + " para poder monetizar";
    document.getElementById("profile-name-input").value = data.name || "";
    document.getElementById("lobby-name-label").textContent = "Jugando como " + myName;

    const avatarEl = document.getElementById("profile-avatar");
    const fallbackEl = document.getElementById("profile-avatar-fallback");
    avatarEl.className = avatarEl.className.replace(/\bframe-\S+/g, "").trim();
    fallbackEl.className = fallbackEl.className.replace(/\bframe-\S+/g, "").trim();
    const frameId = data.equipped && data.equipped.frame;
    if (frameId) {
      const frameItem = (storeItemsCache && storeItemsCache[frameId]) || null;
      const cssClass = frameItem ? frameItem.cssClass : null;
      if (cssClass) { avatarEl.classList.add(cssClass); fallbackEl.classList.add(cssClass); }
    }
    if (data.avatarUrl) {
      avatarEl.src = data.avatarUrl;
      avatarEl.style.display = "block";
      fallbackEl.style.display = "none";
    } else {
      avatarEl.style.display = "none";
      fallbackEl.style.display = "flex";
      fallbackEl.textContent = (data.name || "?").trim().charAt(0).toUpperCase();
    }
    document.getElementById("profile-paypal").value = data.paypalEmail || "";
    document.getElementById("profile-bank-name").value = data.bankName || "";
    document.getElementById("profile-bank-number").value = data.bankAccountNumber || "";
    document.getElementById("profile-bank-holder").value = data.bankAccountHolder || "";

    renderMonetizationSection(data);
    const adminCard = document.getElementById("admin-access-card");
    if (data.canAccessAdminPanel) {
      adminCard.classList.remove("hidden");
      document.getElementById("admin-access-msg").textContent = data.staffRoleName
        ? "Tenés el puesto de " + data.staffRoleName + " — entrá con este mismo email y tu contraseña."
        : "Esta cuenta tiene acceso total al panel — entrá con este mismo email y tu contraseña.";
    } else {
      adminCard.classList.add("hidden");
    }
    loadMyVideos();
    loadMySubscriptions();
    loadMySubscribers();
    loadStoreItems();
    loadMyEarnings();
    loadMyWithdrawals();
    loadMeetingPlans();
    loadMyRecordings();
    loadMyScheduledMeetings();
  } catch (e) {}
}

// ---------------- Editar nombre y foto de perfil ----------------
let pendingAvatarFile = null;
document.getElementById("change-avatar-btn").addEventListener("click", () => {
  document.getElementById("avatar-file-input").click();
});
document.getElementById("avatar-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAvatarFile = file;
  const avatarEl = document.getElementById("profile-avatar");
  avatarEl.src = URL.createObjectURL(file);
  avatarEl.style.display = "block";
  document.getElementById("profile-avatar-fallback").style.display = "none";
});
document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const msgEl = document.getElementById("profile-save-msg");
  const newName = document.getElementById("profile-name-input").value.trim();
  if (!newName) { msgEl.textContent = "El nombre no puede quedar vacío."; msgEl.style.color = "#ff8a80"; return; }

  const fd = new FormData();
  fd.append("name", newName);
  if (pendingAvatarFile) fd.append("avatar", pendingAvatarFile);

  const btn = document.getElementById("save-profile-btn");
  btn.disabled = true;
  msgEl.textContent = "Guardando...";
  msgEl.style.color = "#cfe3da";
  try {
    const res = await fetch("/api/update-profile-info", { method: "POST", headers: { Authorization: "Bearer " + authToken }, body: fd });
    const data = await res.json();
    if (!res.ok) { msgEl.textContent = data.error || "No se pudo guardar."; msgEl.style.color = "#ff8a80"; return; }
    myName = data.name;
    localStorage.setItem("domino_display_name", myName);
    pendingAvatarFile = null;
    document.getElementById("lobby-name-label").textContent = "Jugando como " + myName;
    msgEl.textContent = "¡Listo, guardado!";
    msgEl.style.color = "#8fd4a8";
  } catch (e) {
    msgEl.textContent = "Error de conexión.";
    msgEl.style.color = "#ff8a80";
  } finally {
    btn.disabled = false;
  }
});

function renderMonetizationSection(data) {
  const statusEl = document.getElementById("monetization-status");
  const formEl = document.getElementById("monetization-form");
  const status = data.monetization ? data.monetization.status : "no_solicitado";

  if (status === "aprobado") {
    statusEl.textContent = "✅ Tu cuenta ya está verificada y monetizada. Podés recibir regalos y retirarlos.";
    formEl.classList.add("hidden");
  } else if (status === "pendiente") {
    statusEl.textContent = "⏳ Tu solicitud de monetización está en revisión.";
    formEl.classList.add("hidden");
  } else if (status === "rechazado") {
    statusEl.textContent = "❌ Tu solicitud anterior fue rechazada. Podés volver a enviarla.";
    if (data.followerCount >= data.monetizationThreshold) formEl.classList.remove("hidden");
    else formEl.classList.add("hidden");
  } else {
    if (data.followerCount >= data.monetizationThreshold) {
      statusEl.textContent = "🎉 ¡Llegaste a " + data.monetizationThreshold + " seguidores! Ya podés solicitar la monetización.";
      formEl.classList.remove("hidden");
    } else {
      statusEl.textContent = "Te faltan " + (data.monetizationThreshold - data.followerCount) + " seguidores para poder monetizar tu cuenta.";
      formEl.classList.add("hidden");
    }
  }
}

document.getElementById("save-payout-btn").addEventListener("click", async () => {
  const msg = document.getElementById("payout-msg");
  msg.textContent = "Guardando...";
  try {
    const res = await fetch("/api/update-payout-info", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({
        paypalEmail: document.getElementById("profile-paypal").value.trim(),
        bankName: document.getElementById("profile-bank-name").value.trim(),
        bankAccountNumber: document.getElementById("profile-bank-number").value.trim(),
        bankAccountHolder: document.getElementById("profile-bank-holder").value.trim(),
      }),
    });
    if (!res.ok) { msg.textContent = "No se pudo guardar."; return; }
    msg.textContent = "¡Guardado!";
  } catch (e) {
    msg.textContent = "Error de conexión.";
  }
});

document.getElementById("submit-monetization-btn").addEventListener("click", async () => {
  const fileInput = document.getElementById("kyc-file");
  const msg = document.getElementById("monetization-msg");
  if (!fileInput.files[0]) { msg.textContent = "Elegí primero un archivo con tu documento."; return; }
  msg.textContent = "Enviando...";
  try {
    const formData = new FormData();
    formData.append("idDocument", fileInput.files[0]);
    const res = await fetch("/api/monetization/apply", {
      method: "POST",
      headers: { Authorization: "Bearer " + authToken },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error; return; }
    msg.textContent = "¡Solicitud enviada! Te avisamos cuando se revise.";
    loadProfile();
  } catch (e) {
    msg.textContent = "Error de conexión.";
  }
});

// ---------------- Comprar monedas (PayPal) ----------------

document.getElementById("buy-gems-btn").addEventListener("click", async () => {
  document.getElementById("buy-modal").classList.remove("hidden");
  if (!paypalConfig) await setupPaypal();
});
document.getElementById("close-buy-modal").addEventListener("click", () => document.getElementById("buy-modal").classList.add("hidden"));
document.getElementById("withdraw-btn").addEventListener("click", () => document.getElementById("withdraw-modal").classList.remove("hidden"));
document.getElementById("close-withdraw-modal").addEventListener("click", () => document.getElementById("withdraw-modal").classList.add("hidden"));

document.getElementById("submit-withdraw").addEventListener("click", async () => {
  const amount = parseInt(document.getElementById("withdraw-amount").value, 10);
  const msg = document.getElementById("withdraw-msg");
  msg.textContent = "Procesando...";
  try {
    const res = await fetch("/api/withdraw-request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
      body: JSON.stringify({ amount }),
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error; return; }
    msg.textContent = "¡Listo! Vas a recibir USD $" + data.payoutAmount + " en tu PayPal (se descontó $" + data.platformCut + " de comisión). Te lo procesan en las próximas 48 horas.";
    myDiamondBalance = data.newBalance;
    updateWalletDisplay();
    loadMyWithdrawals();
    loadMyEarnings();
  } catch (e) {
    msg.textContent = "Hubo un error de conexión.";
  }
});

async function setupPaypal() {
  const res = await fetch("/api/paypal/config");
  paypalConfig = await res.json();

  const grid = document.getElementById("pack-grid");
  grid.innerHTML = "";
  Object.entries(paypalConfig.packs).forEach(([packId, pack]) => {
    const card = document.createElement("div");
    card.className = "pack-card";
    card.innerHTML = `
      <div class="pack-symbol">${pack.symbol}</div>
      <div class="pack-label">${pack.label} · ${pack.gems.toLocaleString()} 🪙 monedas</div>
      <div class="pack-price">USD $${pack.usd}</div>
      <button class="select-pack-btn" data-pack="${packId}">Comprar</button>
      <div id="confirm-${packId}" class="hidden" style="margin-top:8px;">
        <p style="font-size:12px;color:#e0a63e;margin:0 0 6px;">¿Confirmás comprar ${pack.gems.toLocaleString()} monedas (${pack.symbol} ${pack.label}) por USD $${pack.usd}?</p>

        <p class="settings-label" style="margin-top:2px;">💳 Pagar con tarjeta</p>
        <div class="card-fields-wrap">
          <label class="card-field-label">Nombre en la tarjeta</label>
          <div id="card-name-${packId}" class="card-field-box"></div>
          <label class="card-field-label">Número de tarjeta</label>
          <div id="card-number-${packId}" class="card-field-box"></div>
          <div style="display:flex;gap:6px;">
            <div style="flex:1;">
              <label class="card-field-label">Vencimiento (MM/AA)</label>
              <div id="card-expiry-${packId}" class="card-field-box"></div>
            </div>
            <div style="flex:1;">
              <label class="card-field-label">Código CVV</label>
              <div id="card-cvv-${packId}" class="card-field-box"></div>
            </div>
          </div>
          <button id="card-submit-${packId}">💳 Pagar ${pack.usd} con tarjeta</button>
          <p id="card-msg-${packId}" style="font-size:12px;"></p>
        </div>

        <p class="settings-label" style="margin-top:14px;">O con tu cuenta de PayPal</p>
        <div id="paypal-${packId}"></div>
        <button class="cancel-pack-btn" data-pack="${packId}" style="background:#0f2b23;color:#cfe3da;border:1px solid #2f6b58;margin-top:10px;">Cancelar</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".select-pack-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const packId = btn.dataset.pack;
      btn.classList.add("hidden");
      document.getElementById("confirm-" + packId).classList.remove("hidden");
    });
  });
  grid.querySelectorAll(".cancel-pack-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const packId = btn.dataset.pack;
      document.getElementById("confirm-" + packId).classList.add("hidden");
      grid.querySelector('.select-pack-btn[data-pack="' + packId + '"]').classList.remove("hidden");
    });
  });

  if (!paypalConfig.configured || !paypalConfig.clientId) {
    document.getElementById("paypal-warning").classList.remove("hidden");
    return;
  }
  const script = document.createElement("script");
  script.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(paypalConfig.clientId) + "&currency=USD&components=buttons,card-fields&enable-funding=card";
  script.onload = () => Object.keys(paypalConfig.packs).forEach((packId) => {
    renderPaypalButton(packId);
    renderCardFields(packId);
  });
  document.body.appendChild(script);
}

// Formulario de tarjeta de verdad (número, vencimiento, CVV), alojado y protegido por
// PayPal — el número de tarjeta nunca pasa por nuestro servidor, va directo y cifrado
// a PayPal, así que es seguro. Necesita que en tu cuenta de PayPal Developer esté
// habilitado "Advanced Credit and Debit Card Payments" (pestaña Features de tu app).
function renderCardFields(packId) {
  if (!window.paypal || !window.paypal.CardFields) return;
  const fieldStyle = {
    input: { "font-size": "15px", color: "#ffffff" },
    "::placeholder": { color: "#7a9c8f" },
  };
  const cardFields = window.paypal.CardFields({
    style: { input: fieldStyle.input, "::placeholder": fieldStyle["::placeholder"] },
    createOrder: async () => {
      const res = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (!res.ok || !data.orderID) throw new Error(data.error || "No se pudo iniciar el pago.");
      return data.orderID;
    },
    onApprove: async (data) => {
      const res = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
        body: JSON.stringify({ orderID: data.orderID }),
      });
      const result = await res.json();
      const msgEl = document.getElementById("card-msg-" + packId);
      if (res.ok && result.newBalance !== undefined) {
        myCoinBalance = result.newBalance;
        updateWalletDisplay();
        msgEl.style.color = "#8fd4a8";
        msgEl.textContent = "¡Listo! Se acreditaron tus monedas.";
      } else {
        msgEl.style.color = "#ff8a80";
        msgEl.textContent = result.error || "No se pudo confirmar el pago.";
      }
    },
    onError: (err) => {
      const msgEl = document.getElementById("card-msg-" + packId);
      msgEl.style.color = "#ff8a80";
      // Mostramos el detalle real del error (si PayPal lo manda) para poder entender
      // qué está pasando, en vez de un mensaje genérico que no dice nada.
      const detail = (err && (err.message || (err.details && err.details[0] && err.details[0].description))) || null;
      msgEl.textContent = detail ? "No se pudo procesar: " + detail : "La tarjeta fue rechazada o hubo un error. Revisá los datos e intentá de nuevo.";
      console.error("Error de PayPal CardFields:", err);
    },
  });

  // isEligible() se llama sobre la instancia (cardFields), no sobre la clase — antes
  // estaba mal y por eso tiraba error y los campos nunca se llegaban a mostrar.
  if (!cardFields.isEligible()) {
    document.querySelector("#confirm-" + packId + " .card-fields-wrap").innerHTML =
      '<p class="empty-msg-small">El pago con tarjeta directa no está habilitado todavía en esta cuenta de PayPal (falta activar "Advanced Credit and Debit Card Payments" en tu app de PayPal Developer). Usá la opción de PayPal de abajo — ahí también se puede pagar con tarjeta, sin necesitar cuenta.</p>';
    return;
  }

  cardFields.NameField({ placeholder: "Como figura en la tarjeta" }).render("#card-name-" + packId);
  cardFields.NumberField({ placeholder: "1234 5678 9012 3456" }).render("#card-number-" + packId);
  cardFields.ExpiryField({ placeholder: "MM/AA" }).render("#card-expiry-" + packId);
  cardFields.CVVField({ placeholder: "123" }).render("#card-cvv-" + packId);

  document.getElementById("card-submit-" + packId).addEventListener("click", async () => {
    const msgEl = document.getElementById("card-msg-" + packId);
    msgEl.style.color = "#cfe3da";
    msgEl.textContent = "Procesando el pago...";
    try {
      await cardFields.submit();
    } catch (e) {
      msgEl.style.color = "#ff8a80";
      const detail = e && e.message ? e.message : null;
      msgEl.textContent = detail
        ? "No se pudo procesar: " + detail
        : "Revisá que completaste los 4 campos (nombre, número, vencimiento y CVV) y volvé a intentar.";
      console.error("Error al enviar la tarjeta:", e);
    }
  });
}

function renderPaypalButton(packId) {
  if (!window.paypal) return;
  window.paypal.Buttons({
    style: { layout: "horizontal", height: 35, tagline: false },
    createOrder: async () => {
      const res = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      return data.orderID;
    },
    onApprove: async (data) => {
      const res = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
        body: JSON.stringify({ orderID: data.orderID }),
      });
      const result = await res.json();
      if (result.newBalance !== undefined) {
        myCoinBalance = result.newBalance;
        updateWalletDisplay();
      }
    },
  }).render("#paypal-" + packId);
}

// ---------------- Regalos ----------------

function showToast(text) {
  const wrap = document.getElementById("gift-toast");
  const el = document.createElement("div");
  el.className = "toast-item";
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Catálogo propio de regalos de TableLive — en vez de solo 3 montos sueltos, una
// cuadrícula compacta y prolija con ícono + nombre + precio, como hace TikTok pero
// con nuestra propia identidad (dados, mesas, diamantes, trofeos).
// Catálogo de respaldo, por si todavía no cargó el real del servidor (ver loadGiftCatalog)
const FALLBACK_GIFT_CATALOG = [
  { symbol: "🐣", name: "Pollito", amount: 100 },
  { symbol: "🐰", name: "Conejo", amount: 300 },
  { symbol: "🐶", name: "Perro", amount: 700 },
  { symbol: "🐺", name: "Lobo", amount: 1000 },
];

function openGiftPicker(anchorEl, seatIndex) {
  closeGiftPicker();
  const picker = document.createElement("div");
  picker.id = "gift-picker";
  const rect = anchorEl.getBoundingClientRect();
  const pickerWidth = 220;
  const left = Math.min(rect.left + window.scrollX, window.innerWidth - pickerWidth - 10);
  picker.style.top = rect.bottom + window.scrollY + 4 + "px";
  picker.style.left = Math.max(10, left) + "px";
  picker.innerHTML = '<div id="gift-picker-header">🎁 Mandar un regalo</div><div id="gift-picker-grid"></div><button id="gift-picker-buy-coins">🪙 Comprar más monedas</button>';
  const grid = picker.querySelector("#gift-picker-grid");
  const catalog = giftCatalogCache && giftCatalogCache.length ? giftCatalogCache : FALLBACK_GIFT_CATALOG;
  catalog.forEach((gift) => {
    const b = document.createElement("button");
    b.className = "gift-catalog-item";
    const iAfford = myCoinBalance >= gift.amount;
    if (!iAfford) b.classList.add("gift-catalog-item-locked");
    b.innerHTML = `<span class="gift-catalog-icon">${gift.symbol}</span><span class="gift-catalog-name">${gift.name}</span><span class="gift-catalog-price">🪙 ${gift.amount}</span>`;
    b.addEventListener("click", () => {
      if (!iAfford) { showToast("No te alcanzan las monedas para este regalo."); return; }
      socket.emit("sendGift", { toSeatIndex: seatIndex, amount: gift.amount });
      closeGiftPicker();
    });
    grid.appendChild(b);
  });
  picker.querySelector("#gift-picker-buy-coins").addEventListener("click", () => {
    closeGiftPicker();
    document.getElementById("buy-gems-btn").click();
  });
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener("click", closeGiftPickerOnce), 0);
}
function closeGiftPickerOnce(e) { if (!e.target.closest("#gift-picker")) closeGiftPicker(); }
function closeGiftPicker() {
  const existing = document.getElementById("gift-picker");
  if (existing) existing.remove();
  document.removeEventListener("click", closeGiftPickerOnce);
}
