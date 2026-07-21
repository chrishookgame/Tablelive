const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Los documentos de identidad NO van en /public: no queremos que queden
// accesibles públicamente por su URL. Se guardan aparte y solo el admin
// autenticado puede pedirlos.
const KYC_DIR = path.join(__dirname, "uploads_privados", "kyc");
fs.mkdirSync(KYC_DIR, { recursive: true });
const kycUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, KYC_DIR),
    filename: (req, file, cb) => {
      const safeName = Date.now() + "_" + req.user.email.replace(/[^a-z0-9]/gi, "_") + path.extname(file.originalname);
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB máximo
});

// Las fotos de perfil SÍ son públicas (van dentro de /public), a diferencia
// de los documentos de identidad de arriba.
const AVATAR_DIR = path.join(__dirname, "public", "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const safeName = Date.now() + "_" + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname || ".jpg");
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB máximo
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Solo se aceptan imágenes"));
    cb(null, true);
  },
});

function isValidEmail(email) {
  // Formato estándar: algo@algo.dominio, sin espacios, con un solo @
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || "").trim());
}

const nodemailer = require("nodemailer");

// ---- Config de envío de correo (tu propia cuenta, va en variables de entorno) ----
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";
let mailTransporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

function makeVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // codigo de 6 digitos
}

async function sendVerificationEmail(toEmail, name, code) {
  if (!mailTransporter) {
    console.log("[email no configurado] Código de verificación para " + toEmail + ": " + code);
    return;
  }
  await mailTransporter.sendMail({
    from: '"TableLive" <' + EMAIL_USER + ">",
    to: toEmail,
    subject: "Tu código de confirmación de TableLive",
    html: `<p>Hola ${name || ""},</p>
      <p>Tu código para confirmar tu cuenta en TableLive es:</p>
      <h2 style="letter-spacing:4px;">${code}</h2>
      <p>Este código vence en 15 minutos. Si no creaste esta cuenta, ignorá este mensaje.</p>`,
  });
}

// ---- Config ----
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
// IMPORTANTE: en producción, configurá tu propio JWT_SECRET como variable de entorno,
// larga y aleatoria. Si no lo hacés, se genera una al azar cada vez que arranca el
// servidor, lo que desconecta a todos los usuarios cada reinicio.
const JWT_SECRET = process.env.JWT_SECRET || require("crypto").randomBytes(32).toString("hex");
const PLATFORM_FEE = 0.25; // 25% para la plataforma, 75% para quien retira
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiame123";

const GEM_PACKS = {
  p1: { gems: 100, usd: "1.00", symbol: "🐣", label: "Pollito" },
  p2: { gems: 300, usd: "3.00", symbol: "🐰", label: "Conejo" },
  p3: { gems: 500, usd: "5.00", symbol: "🐱", label: "Gato" },
  p4: { gems: 700, usd: "7.00", symbol: "🐶", label: "Perro" },
  p5: { gems: 800, usd: "8.00", symbol: "🦊", label: "Zorro" },
  p6: { gems: 1000, usd: "10.00", symbol: "🐺", label: "Lobo" },
  p7: { gems: 1500, usd: "15.00", symbol: "🦁", label: "León" },
  p8: { gems: 2000, usd: "20.00", symbol: "🐴", label: "Caballo" },
  p9: { gems: 3000, usd: "30.00", symbol: "🐮", label: "Vaca" },
  p10: { gems: 4000, usd: "40.00", symbol: "🐘", label: "Elefante" },
  p11: { gems: 5000, usd: "50.00", symbol: "🦈", label: "Tiburón" },
  p12: { gems: 7500, usd: "75.00", symbol: "🌙", label: "Luna" },
  p13: { gems: 10000, usd: "100.00", symbol: "☀️", label: "Sol" },
  p14: { gems: 15000, usd: "150.00", symbol: "🪐", label: "Saturno" },
  p15: { gems: 25000, usd: "250.00", symbol: "🌍", label: "Tierra" },
  p16: { gems: 40000, usd: "400.00", symbol: "✨", label: "Estrella" },
  p17: { gems: 65000, usd: "650.00", symbol: "🌌", label: "Galaxia" },
  p18: { gems: 100000, usd: "1000.00", symbol: "💎", label: "Diamante" },
};

const USERS_FILE = path.join(__dirname, "users.json");
const WITHDRAWALS_FILE = path.join(__dirname, "withdrawals.json");

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch (e) { return {}; }
}
function saveUsers(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}
function emailKey(email) { return (email || "").trim().toLowerCase(); }

let users = loadUsers();

function makeToken(email) {
  return jwt.sign({ email: emailKey(email) }, JWT_SECRET, { expiresIn: "30d" });
}
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users[payload.email];
    if (!user) return null;
    return user;
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: "Tenés que iniciar sesión." });
  req.user = user;
  next();
}

// ---------------- Registro e inicio de sesión ----------------

app.post("/api/register", avatarUpload.single("avatar"), async (req, res) => {
  const { name, legalName, phone, country, language, email, password, paypalEmail } = req.body;
  if (!name || !legalName || !phone || !country || !email || !password || !paypalEmail) {
    return res.status(400).json({ error: "Completá todos los campos." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Ese email no tiene un formato válido. Usá un email real." });
  }
  if (!/^[+\d][\d\s\-()]{6,20}$/.test(phone.trim())) {
    return res.status(400).json({ error: "Ese teléfono no parece válido. Escribilo con el código de país, ej: +56 9 1234 5678." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña tiene que tener al menos 6 caracteres." });
  }
  const key = emailKey(email);
  if (users[key]) {
    return res.status(400).json({ error: "Ya existe una cuenta con ese email." });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const verificationCode = makeVerificationCode();
  users[key] = {
    email: key,
    name: name.slice(0, 18),
    legalName: legalName.slice(0, 80),
    phone: phone.slice(0, 30),
    country: country.slice(0, 60),
    language: ["es", "en", "pt", "fr"].includes(language) ? language : "es",
    avatarUrl: req.file ? "/avatars/" + req.file.filename : "",
    passwordHash,
    paypalEmail,
    bankName: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    balance: 0,
    following: [],
    monetization: { status: "no_solicitado" }, // no_solicitado | pendiente | aprobado | rechazado
    emailVerified: false,
    verificationCode,
    verificationExpires: Date.now() + 15 * 60 * 1000,
    createdAt: new Date().toISOString(),
  };
  saveUsers(users);
  try {
    await sendVerificationEmail(key, users[key].name, verificationCode);
  } catch (e) {
    console.log("Error mandando email de verificación:", e.message);
    console.log("[respaldo] Código de verificación para " + key + ": " + verificationCode);
  }
  res.json({ token: makeToken(key), name: users[key].name, balance: 0, avatarUrl: users[key].avatarUrl, emailVerified: false });
});

app.post("/api/verify-email", authMiddleware, async (req, res) => {
  const u = req.user;
  if (u.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  const { code } = req.body;
  if (!u.verificationCode || Date.now() > (u.verificationExpires || 0)) {
    return res.status(400).json({ error: "El código venció. Pedí uno nuevo." });
  }
  if (String(code).trim() !== u.verificationCode) {
    return res.status(400).json({ error: "Ese código no es correcto." });
  }
  u.emailVerified = true;
  u.verificationCode = null;
  saveUsers(users);
  res.json({ ok: true });
});

app.post("/api/resend-verification", authMiddleware, async (req, res) => {
  const u = req.user;
  if (u.emailVerified) return res.json({ ok: true, alreadyVerified: true });
  u.verificationCode = makeVerificationCode();
  u.verificationExpires = Date.now() + 15 * 60 * 1000;
  saveUsers(users);
  try {
    await sendVerificationEmail(u.email, u.name, u.verificationCode);
  } catch (e) {
    console.log("Error mandando email de verificación:", e.message);
    console.log("[respaldo] Código de verificación para " + u.email + ": " + u.verificationCode);
  }
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const key = emailKey(email);
  const user = users[key];
  if (!user) return res.status(400).json({ error: "No existe una cuenta con ese email." });
  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Contraseña incorrecta." });
  res.json({ token: makeToken(key), name: user.name, balance: user.balance, avatarUrl: user.avatarUrl || "", emailVerified: !!user.emailVerified, language: user.language || "es" });
});

function getFollowerCount(email) {
  return Object.values(users).filter((u) => (u.following || []).includes(email)).length;
}
const MONETIZATION_THRESHOLD = 1000;

app.get("/api/me", authMiddleware, (req, res) => {
  const u = req.user;
  res.json({
    name: u.name,
    legalName: u.legalName,
    phone: u.phone,
    country: u.country,
    avatarUrl: u.avatarUrl || "",
    balance: u.balance,
    email: u.email,
    paypalEmail: u.paypalEmail,
    bankName: u.bankName,
    bankAccountNumber: u.bankAccountNumber,
    bankAccountHolder: u.bankAccountHolder,
    followerCount: getFollowerCount(u.email),
    monetizationThreshold: MONETIZATION_THRESHOLD,
    monetization: u.monetization,
    emailVerified: !!u.emailVerified,
  });
});

app.post("/api/update-payout-info", authMiddleware, (req, res) => {
  const { paypalEmail, bankName, bankAccountNumber, bankAccountHolder } = req.body;
  const u = req.user;
  if (paypalEmail) u.paypalEmail = paypalEmail;
  if (bankName !== undefined) u.bankName = bankName;
  if (bankAccountNumber !== undefined) u.bankAccountNumber = bankAccountNumber;
  if (bankAccountHolder !== undefined) u.bankAccountHolder = bankAccountHolder;
  saveUsers(users);
  res.json({ ok: true });
});

const MONETIZATION_FILE = path.join(__dirname, "monetization_requests.json");
function loadMonetizationRequests() {
  try { return JSON.parse(fs.readFileSync(MONETIZATION_FILE, "utf8")); } catch (e) { return []; }
}
function saveMonetizationRequests(list) {
  fs.writeFileSync(MONETIZATION_FILE, JSON.stringify(list, null, 2));
}

app.post("/api/monetization/apply", authMiddleware, kycUpload.single("idDocument"), (req, res) => {
  const u = req.user;
  if (!u.emailVerified) return res.status(400).json({ error: "Primero tenés que confirmar tu email." });
  const followerCount = getFollowerCount(u.email);
  if (followerCount < MONETIZATION_THRESHOLD) {
    return res.status(400).json({ error: "Necesitás al menos " + MONETIZATION_THRESHOLD + " seguidores para solicitar la monetización. Tenés " + followerCount + "." });
  }
  if (!req.file) return res.status(400).json({ error: "Falta el documento de identidad." });

  u.monetization = { status: "pendiente", submittedAt: new Date().toISOString() };
  saveUsers(users);

  const list = loadMonetizationRequests();
  list.push({
    email: u.email,
    name: u.name,
    legalName: u.legalName,
    followerCountAtApply: followerCount,
    documentFile: req.file.filename,
    status: "pendiente",
    submittedAt: new Date().toISOString(),
  });
  saveMonetizationRequests(list);
  res.json({ ok: true });
});

// ---------------- Seguir jugadores (como TikTok) ----------------

const liveUsers = {}; // email -> codigo de sala donde esta jugando activamente ahora

app.get("/api/search-players", authMiddleware, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ results: [] });
  const me = req.user;
  const results = Object.values(users)
    .filter((u) => u.email !== me.email && u.name.toLowerCase().includes(q))
    .slice(0, 20)
    .map((u) => ({
      name: u.name,
      email: u.email,
      isFollowing: (me.following || []).includes(u.email),
      isLive: !!liveUsers[u.email],
      roomCode: liveUsers[u.email] || null,
    }));
  res.json({ results });
});

app.get("/api/following", authMiddleware, (req, res) => {
  const following = req.user.following || [];
  const results = following
    .map((email) => users[email])
    .filter(Boolean)
    .map((u) => ({ name: u.name, email: u.email, isLive: !!liveUsers[u.email], roomCode: liveUsers[u.email] || null }));
  res.json({ results });
});

app.post("/api/follow", authMiddleware, (req, res) => {
  const target = users[emailKey(req.body.email)];
  if (!target) return res.status(400).json({ error: "Ese jugador no existe." });
  const me = req.user;
  if (!me.following) me.following = [];
  if (!me.following.includes(target.email)) me.following.push(target.email);
  saveUsers(users);
  res.json({ ok: true });
});

app.post("/api/unfollow", authMiddleware, (req, res) => {
  const me = req.user;
  me.following = (me.following || []).filter((e) => e !== emailKey(req.body.email));
  saveUsers(users);
  res.json({ ok: true });
});

// ---------------- PayPal: comprar gemas ----------------

const pendingOrders = {}; // orderID -> email

async function paypalAccessToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET).toString("base64");
  const res = await fetch(PAYPAL_API_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  return data.access_token;
}

app.get("/api/paypal/config", (req, res) => {
  res.json({ clientId: PAYPAL_CLIENT_ID, packs: GEM_PACKS, configured: !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET), platformFee: PLATFORM_FEE });
});

app.post("/api/paypal/create-order", authMiddleware, async (req, res) => {
  try {
    const { packId } = req.body;
    const pack = GEM_PACKS[packId];
    if (!pack) return res.status(400).json({ error: "Paquete inválido" });
    const token = await paypalAccessToken();
    const orderRes = await fetch(PAYPAL_API_BASE + "/v2/checkout/orders", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: pack.usd } }] }),
    });
    const order = await orderRes.json();
    pendingOrders[order.id] = { email: req.user.email, packId };
    res.json({ orderID: order.id });
  } catch (e) {
    res.status(500).json({ error: "No se pudo crear la orden de pago" });
  }
});

app.post("/api/paypal/capture-order", authMiddleware, async (req, res) => {
  try {
    const { orderID } = req.body;
    const pending = pendingOrders[orderID];
    if (!pending || pending.email !== req.user.email) return res.status(400).json({ error: "Orden desconocida" });
    const token = await paypalAccessToken();
    const capRes = await fetch(PAYPAL_API_BASE + "/v2/checkout/orders/" + orderID + "/capture", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    });
    const capData = await capRes.json();
    if (capData.status !== "COMPLETED") return res.status(400).json({ error: "El pago no se completó" });

    const pack = GEM_PACKS[pending.packId];
    users[req.user.email].balance += pack.gems;
    saveUsers(users);
    delete pendingOrders[orderID];
    res.json({ gems: pack.gems, newBalance: users[req.user.email].balance });
  } catch (e) {
    res.status(500).json({ error: "No se pudo confirmar el pago" });
  }
});

// ---------------- Retiros (con la comisión de plataforma) ----------------

app.post("/api/withdraw-request", authMiddleware, (req, res) => {
  const { amount } = req.body;
  const user = req.user;
  if (!user.emailVerified) return res.status(400).json({ error: "Primero tenés que confirmar tu email antes de retirar." });
  if (!amount || amount <= 0 || amount > user.balance) {
    return res.status(400).json({ error: "Cantidad inválida o saldo insuficiente." });
  }
  user.balance -= amount;
  saveUsers(users);

  const gemsToUsd = amount * 0.01;
  const platformCut = +(gemsToUsd * PLATFORM_FEE).toFixed(2);
  const payoutAmount = +(gemsToUsd - platformCut).toFixed(2);

  let list = [];
  try { list = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}
  list.push({
    name: user.name,
    email: user.email,
    paypalEmail: user.paypalEmail,
    gemsWithdrawn: amount,
    grossUsd: gemsToUsd.toFixed(2),
    platformCut,
    payoutAmount,
    requestedAt: new Date().toISOString(),
    status: "pendiente",
  });
  fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true, newBalance: user.balance, payoutAmount, platformCut });
});

// ---------------- Panel de administrador ----------------

function adminAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.t || null);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("no admin");
    next();
  } catch (e) {
    res.status(401).json({ error: "No autorizado." });
  }
}

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Contraseña incorrecta." });
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

app.get("/api/admin/overview", adminAuthMiddleware, (req, res) => {
  let withdrawals = [];
  try { withdrawals = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}

  const userList = Object.values(users).map((u) => ({
    name: u.name, email: u.email, paypalEmail: u.paypalEmail, balance: u.balance, createdAt: u.createdAt,
    followerCount: getFollowerCount(u.email), monetizationStatus: u.monetization ? u.monetization.status : "no_solicitado",
  }));

  const roomList = Object.values(rooms).map((r) => ({
    code: r.code,
    capacity: r.capacity,
    started: r.started,
    finished: r.finished,
    players: r.seats.map((s) => s.name).filter(Boolean),
    spectatorCount: r.spectators ? r.spectators.size : 0,
  }));

  const monetizationRequests = loadMonetizationRequests();

  res.json({ users: userList, withdrawals, rooms: roomList, monetizationRequests });
});

app.get("/api/admin/kyc-document/:filename", adminAuthMiddleware, (req, res) => {
  const list = loadMonetizationRequests();
  const match = list.find((r) => r.documentFile === req.params.filename);
  if (!match) return res.status(404).send("No encontrado");
  res.sendFile(path.join(KYC_DIR, match.documentFile));
});

app.post("/api/admin/monetization/decision", adminAuthMiddleware, (req, res) => {
  const { email, submittedAt, approve } = req.body;
  const list = loadMonetizationRequests();
  const reqItem = list.find((r) => r.email === email && r.submittedAt === submittedAt);
  if (!reqItem) return res.status(400).json({ error: "No encontrado." });
  reqItem.status = approve ? "aprobado" : "rechazado";
  reqItem.decidedAt = new Date().toISOString();
  saveMonetizationRequests(list);

  const user = users[emailKey(email)];
  if (user) {
    user.monetization = { status: reqItem.status, submittedAt, decidedAt: reqItem.decidedAt };
    saveUsers(users);
  }
  res.json({ ok: true });
});

app.post("/api/admin/mark-paid", adminAuthMiddleware, (req, res) => {
  const { index } = req.body;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}
  if (!list[index]) return res.status(400).json({ error: "No encontrado." });
  list[index].status = "pagado";
  list[index].paidAt = new Date().toISOString();
  fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true });
});

app.get("/api/room-status/:code", (req, res) => {
  const room = rooms[(req.params.code || "").toUpperCase()];
  if (!room) return res.json({ exists: false });
  const playersCount = room.seats.filter((s) => s.name).length;
  res.json({
    exists: true,
    capacity: room.capacity,
    playersCount,
    full: playersCount >= room.capacity,
    started: room.started,
  });
});

app.get("/api/live-rooms", (req, res) => {
  const list = Object.values(rooms)
    .filter((r) => r.started && !r.finished)
    .map((r) => ({
      code: r.code,
      players: r.seats.map((s) => s.name).filter(Boolean),
      capacity: r.capacity,
      spectatorCount: r.spectators ? r.spectators.size : 0,
    }));
  res.json({ rooms: list });
});

// ---------------- Dominó: fichas y salas ----------------

function buildDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) deck.push([a, b]);
  return deck;
}
// Para 3 jugadores, 12 fichas por mano no entra en el mazo de 28 (12*3=36), así que
// esa combinación queda afuera automáticamente. Para 4 jugadores, siempre son 6 fijas.
const HAND_SIZE_OPTIONS = { 2: [3, 6, 7, 9, 12], 3: [3, 6, 7, 9], 4: [6] };
function defaultHandSize(capacity) { return capacity === 4 ? 6 : 9; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const rooms = {};

function emptySeats(capacity) {
  return Array.from({ length: capacity }, () => ({ name: null, email: null, socketId: null, connected: false, hand: [] }));
}

function publicState(room) {
  return {
    code: room.code,
    capacity: room.capacity,
    started: room.started,
    finished: room.finished,
    winner: room.winner,
    board: room.board,
    leftEnd: room.leftEnd,
    rightEnd: room.rightEnd,
    seats: room.seats.map((s, i) => ({ seatIndex: i, name: s.name, tileCount: s.hand.length, connected: s.connected })),
    queue: room.queue.map((q) => q.name),
    spectatorCount: room.spectators ? room.spectators.size : 0,
    boneyardCount: room.boneyard ? room.boneyard.length : 0,
    likes: room.likes || {},
    comments: room.comments || [],
    turnSeatIndex: room.started ? room.turnIndex : null,
    lastMoveSeatIndex: room.lastMove ? room.lastMove.seatIndex : null,
    lastMoveExpiresAt: room.lastMove ? room.lastMove.expiresAt : null,
    passCount: room.passCount,
  };
}

function broadcastState(room) { io.to(room.code).emit("state", publicState(room)); }

function sendHandTo(seat) {
  if (!seat.socketId) return;
  const socket = io.sockets.sockets.get(seat.socketId);
  if (socket) socket.emit("hand", seat.hand);
}

function playerHasMove(room, seatIndex) {
  const hand = room.seats[seatIndex].hand;
  if (room.board.length === 0) return true;
  return hand.some((t) => t[0] === room.leftEnd || t[1] === room.leftEnd || t[0] === room.rightEnd || t[1] === room.rightEnd);
}
function pipSum(hand) { return hand.reduce((s, t) => s + t[0] + t[1], 0); }

function startGame(room) {
  const deck = shuffle(buildDeck());
  const size = room.handSize || defaultHandSize(room.capacity);
  room.seats.forEach((seat, i) => { seat.hand = deck.slice(i * size, (i + 1) * size); });
  room.boneyard = deck.slice(room.capacity * size);
  room.board = [];
  room.leftEnd = null;
  room.rightEnd = null;
  room.passCount = 0;
  room.finished = false;
  room.winner = null;
  if (room.lastMoveTimeout) clearTimeout(room.lastMoveTimeout);
  room.lastMove = null;

  let starter = 0, bestDouble = -1;
  room.seats.forEach((seat, i) => {
    seat.hand.forEach((t) => { if (t[0] === t[1] && t[0] > bestDouble) { bestDouble = t[0]; starter = i; } });
  });
  room.turnIndex = starter;
  room.started = true;

  broadcastState(room);
  room.seats.forEach(sendHandTo);
  advanceSkippingDisconnected(room);
}

function buildRanking(room, winnerSeatIndex) {
  const scored = room.seats.map((s, i) => ({
    seatIndex: i,
    name: s.name,
    hand: s.hand.slice(),
    pipSum: pipSum(s.hand),
  }));
  // El ganador siempre va primero; el resto se ordena de menos a más fichas encima
  scored.sort((a, b) => {
    if (a.seatIndex === winnerSeatIndex) return -1;
    if (b.seatIndex === winnerSeatIndex) return 1;
    return a.pipSum - b.pipSum;
  });
  return scored.map((s, i) => ({ place: i + 1, ...s }));
}

function endGame(room, seatIndex, reason) {
  room.finished = true;
  const seat = room.seats[seatIndex];
  room.winner = { seatIndex, name: seat ? seat.name : null, reason, ranking: buildRanking(room, seatIndex) };
  broadcastState(room);
}
function resolveBlockedGame(room) {
  let bestIdx = 0, bestSum = Infinity;
  room.seats.forEach((seat, i) => { const s = pipSum(seat.hand); if (s < bestSum) { bestSum = s; bestIdx = i; } });
  endGame(room, bestIdx, "bloqueado");
}
function advanceSkippingDisconnected(room) {
  if (!room.started || room.finished) return;
  let attempts = 0;
  while (attempts < room.seats.length) {
    const seat = room.seats[room.turnIndex];
    if (seat.connected) return;
    room.passCount++;
    if (room.passCount >= room.seats.length) { resolveBlockedGame(room); return; }
    room.turnIndex = (room.turnIndex + 1) % room.seats.length;
    attempts++;
  }
  broadcastState(room);
}
function nextTurn(room) { room.turnIndex = (room.turnIndex + 1) % room.seats.length; }

function tryPromoteFromQueue(room, seatIndex) {
  if (room.queue.length === 0) return false;
  const next = room.queue.shift();
  const seat = room.seats[seatIndex];
  seat.name = next.name;
  seat.email = next.email;
  seat.socketId = next.socketId;
  seat.connected = true;
  liveUsers[next.email] = room.code;
  const socket = io.sockets.sockets.get(next.socketId);
  if (socket) {
    socket.data.roomCode = room.code;
    socket.data.seatIndex = seatIndex;
    socket.data.inQueue = false;
    socket.emit("joined", { code: room.code, seatIndex, capacity: room.capacity });
    if (room.started) socket.emit("hand", seat.hand);
  }
  return true;
}

// name/email vienen del socket ya autenticado, nunca del cliente sin verificar
function assignSeat(socket, room) {
  const name = socket.data.userName;
  const email = socket.data.userEmail;
  let seatIdx = room.seats.findIndex((s) => s.email === email && !s.connected);
  if (seatIdx === -1) seatIdx = room.seats.findIndex((s) => s.name === null);
  if (seatIdx === -1) seatIdx = room.seats.findIndex((s) => s.name !== null && !s.connected);

  if (seatIdx === -1) {
    room.queue.push({ socketId: socket.id, name, email });
    socket.data.roomCode = room.code;
    socket.data.inQueue = true;
    socket.join(room.code);
    socket.emit("queued", { code: room.code, position: room.queue.length });
    broadcastState(room);
    return;
  }

  const seat = room.seats[seatIdx];
  const isFreshSeat = seat.name === null;
  seat.name = name;
  seat.email = email;
  seat.socketId = socket.id;
  seat.connected = true;
  if (isFreshSeat) seat.hand = [];

  socket.data.roomCode = room.code;
  socket.data.seatIndex = seatIdx;
  socket.data.inQueue = false;
  socket.join(room.code);
  socket.emit("joined", { code: room.code, seatIndex: seatIdx, capacity: room.capacity });
  liveUsers[email] = room.code;
  broadcastState(room);
  if (seat.hand.length) socket.emit("hand", seat.hand);

  if (!room.started && room.seats.every((s) => s.name !== null)) startGame(room);
  else if (room.started && room.turnIndex === seatIdx) advanceSkippingDisconnected(room);
}

// ---------------- Sockets: todo requiere haber iniciado sesión ----------------

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token) {
    const user = verifyToken(token);
    if (user) {
      socket.data.userEmail = user.email;
      socket.data.userName = user.name;
    }
  }
  next(); // dejamos pasar sin token: puede ser un espectador público
});

function displayNameFor(socket) {
  return socket.data.userName || socket.data.spectatorName || "Anónimo";
}

function requireAuth(socket) {
  if (!socket.data.userEmail) {
    socket.emit("errorMsg", "Tenés que iniciar sesión para jugar.");
    return false;
  }
  return true;
}

io.on("connection", (socket) => {
  if (socket.data.userEmail) {
    socket.emit("balance", users[socket.data.userEmail] ? users[socket.data.userEmail].balance : 0);
  }

  socket.on("createRoom", ({ capacity, handSize }) => {
    if (!requireAuth(socket)) return;
    const cap = [2, 3, 4].includes(capacity) ? capacity : 4;
    const allowedSizes = HAND_SIZE_OPTIONS[cap];
    const size = allowedSizes.includes(handSize) ? handSize : defaultHandSize(cap);
    let code = makeRoomCode();
    while (rooms[code]) code = makeRoomCode();
    rooms[code] = {
      code, capacity: cap, handSize: size, seats: emptySeats(cap), queue: [], spectators: new Set(),
      started: false, finished: false, winner: null, board: [], boneyard: [],
      leftEnd: null, rightEnd: null, turnIndex: 0, passCount: 0,
      likes: {}, comments: [],
    };
    assignSeat(socket, rooms[code]);
  });

  socket.on("joinRoom", ({ code }) => {
    if (!requireAuth(socket)) return;
    const room = rooms[(code || "").toUpperCase()];
    if (!room) { socket.emit("errorMsg", "Esa sala no existe. Revisá el código."); return; }
    assignSeat(socket, room);
  });

  // Cualquiera puede mirar en vivo, sin necesitar cuenta
  socket.on("spectateRoom", ({ code, name }) => {
    const room = rooms[(code || "").toUpperCase()];
    if (!room) { socket.emit("errorMsg", "Esa sala no existe."); return; }
    socket.data.roomCode = room.code;
    socket.data.isSpectator = true;
    socket.data.spectatorName = (name || "Espectador").slice(0, 18);
    room.spectators.add(socket.id);
    socket.join(room.code);
    socket.emit("spectating", { code: room.code });
    broadcastState(room);
  });

  socket.on("sendPrivateMessage", ({ toName, text }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const clean = (text || "").trim().slice(0, 300);
    if (!clean) return;
    const fromName = displayNameFor(socket);

    // Buscamos el socket de la persona destino, sea jugador o espectador, en la misma sala
    let targetSocketId = null;
    const targetSeat = room.seats.find((s) => s.name === toName);
    if (targetSeat) targetSocketId = targetSeat.socketId;
    if (!targetSocketId) {
      const sockets = io.sockets.adapter.rooms.get(room.code);
      if (sockets) {
        for (const sid of sockets) {
          const s = io.sockets.sockets.get(sid);
          if (s && displayNameFor(s) === toName) { targetSocketId = sid; break; }
        }
      }
    }
    if (!targetSocketId) { socket.emit("errorMsg", "Esa persona ya no está en la sala."); return; }

    const payload = { from: fromName, to: toName, text: clean, ts: Date.now() };
    socket.emit("privateMessageEvent", payload);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) targetSocket.emit("privateMessageEvent", payload);
  });

  socket.on("requestJoinCamera", () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (!room.cameraGuests) room.cameraGuests = [];
    if (!room.cameraRequests) room.cameraRequests = [];
    const name = displayNameFor(socket);
    if (room.cameraGuests.includes(name) || room.cameraRequests.includes(name)) return;
    room.cameraRequests.push(name);
    io.to(room.code).emit("cameraRequestEvent", { name, requests: room.cameraRequests, guests: room.cameraGuests });
  });

  socket.on("decideCameraRequest", ({ name, approve }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    // Solo un jugador de la mesa (o alguien puesto como admin del live) puede aprobar
    const myDisplayName = displayNameFor(socket);
    const isPlayer = room.seats.some((s) => s.name === myDisplayName);
    const isLiveAdmin = (room.liveAdmins || []).includes(myDisplayName);
    if (!isPlayer && !isLiveAdmin) return;

    room.cameraRequests = (room.cameraRequests || []).filter((n) => n !== name);
    if (approve) {
      if (!room.cameraGuests) room.cameraGuests = [];
      if (room.cameraGuests.length >= 8) return;
      room.cameraGuests.push(name);
    }
    io.to(room.code).emit("cameraRequestEvent", { requests: room.cameraRequests, guests: room.cameraGuests || [] });
  });

  socket.on("setLiveAdmin", ({ name }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const myDisplayName = displayNameFor(socket);
    const isPlayer = room.seats.some((s) => s.name === myDisplayName);
    if (!isPlayer) return; // solo un jugador de la mesa puede nombrar administradores
    if (!room.liveAdmins) room.liveAdmins = [];
    if (!room.liveAdmins.includes(name)) room.liveAdmins.push(name);
    io.to(room.code).emit("liveAdminsEvent", { liveAdmins: room.liveAdmins });
  });

  socket.on("sendReaction", ({ emoji }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const allowed = ["😂", "😢", "❤️", "😮", "👏"];
    if (!allowed.includes(emoji)) return;
    io.to(room.code).emit("reactionEvent", { emoji, from: displayNameFor(socket) });
  });

  socket.on("sendLike", ({ toSeatIndex }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const seat = room.seats[toSeatIndex];
    if (!seat || !seat.name) return;
    room.likes[toSeatIndex] = (room.likes[toSeatIndex] || 0) + 1;
    io.to(room.code).emit("likeEvent", { toSeatIndex, from: displayNameFor(socket), total: room.likes[toSeatIndex] });
    broadcastState(room);
  });

  socket.on("sendComment", ({ text }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const clean = (text || "").trim().slice(0, 200);
    if (!clean) return;
    const comment = { name: displayNameFor(socket), text: clean, ts: Date.now() };
    room.comments.push(comment);
    if (room.comments.length > 50) room.comments.shift();
    io.to(room.code).emit("commentEvent", comment);
  });

  socket.on("getBalance", () => {
    if (!socket.data.userEmail) return;
    const u = users[socket.data.userEmail];
    socket.emit("balance", u ? u.balance : 0);
  });

  socket.on("sendGift", ({ toSeatIndex, amount }) => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) return;
    const toSeat = room.seats[toSeatIndex];
    if (!toSeat || !toSeat.email) return;
    const sender = users[socket.data.userEmail];
    const receiver = users[toSeat.email];
    if (!sender || !receiver) return;
    if (sender.balance < amt) { socket.emit("giftError", "No te alcanzan las gemas."); return; }
    sender.balance -= amt;
    receiver.balance += amt;
    saveUsers(users);
    socket.emit("balance", sender.balance);
    if (toSeat.socketId) {
      const recSocket = io.sockets.sockets.get(toSeat.socketId);
      if (recSocket) recSocket.emit("balance", receiver.balance);
    }
    io.to(room.code).emit("giftEvent", { from: sender.name, to: receiver.name, amount: amt });
  });

  socket.on("playTile", ({ tile, end }) => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room || !room.started || room.finished) return;
    if (socket.data.seatIndex === undefined) return;
    if (room.turnIndex !== socket.data.seatIndex) return;
    const seat = room.seats[socket.data.seatIndex];
    const hand = seat.hand;
    const idx = hand.findIndex((t) => t[0] === tile[0] && t[1] === tile[1]);
    if (idx === -1) return;

    if (room.lastMove && room.lastMove.seatIndex !== socket.data.seatIndex) {
      if (room.lastMoveTimeout) clearTimeout(room.lastMoveTimeout);
      room.lastMove = null;
    }

    const wasFirstMove = room.board.length === 0;
    const prevLeftEnd = room.leftEnd;
    const prevRightEnd = room.rightEnd;
    const prevPassCount = room.passCount;

    if (room.board.length === 0) {
      room.board.push({ tile, seatIndex: socket.data.seatIndex, side: "start" });
      room.leftEnd = tile[0];
      room.rightEnd = tile[1];
    } else {
      let placed = null;
      if (end === "left") {
        if (tile[0] === room.leftEnd) placed = [tile[1], tile[0]];
        else if (tile[1] === room.leftEnd) placed = [tile[0], tile[1]];
        else return;
        room.leftEnd = placed[0];
        room.board.unshift({ tile: placed, seatIndex: socket.data.seatIndex, side: "left" });
      } else {
        if (tile[0] === room.rightEnd) placed = [tile[0], tile[1]];
        else if (tile[1] === room.rightEnd) placed = [tile[1], tile[0]];
        else return;
        room.rightEnd = placed[1];
        room.board.push({ tile: [placed[0], placed[1]], seatIndex: socket.data.seatIndex, side: "right" });
      }
    }

    hand.splice(idx, 1);
    room.passCount = 0;

    if (room.lastMoveTimeout) clearTimeout(room.lastMoveTimeout);
    room.lastMove = {
      seatIndex: socket.data.seatIndex,
      tile,
      end,
      wasFirstMove,
      prevLeftEnd,
      prevRightEnd,
      prevPassCount,
      expiresAt: Date.now() + 15000,
    };
    room.lastMoveTimeout = setTimeout(() => {
      if (room.lastMove && room.lastMove.tile[0] === tile[0] && room.lastMove.tile[1] === tile[1]) {
        room.lastMove = null;
        broadcastState(room);
      }
    }, 15000);

    if (hand.length === 0) {
      broadcastState(room);
      sendHandTo(seat);
      endGame(room, socket.data.seatIndex, "sin_fichas");
      return;
    }

    nextTurn(room);
    broadcastState(room);
    sendHandTo(seat);
    advanceSkippingDisconnected(room);
  });

  socket.on("drawTile", ({ pileIndex } = {}) => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room || !room.started || room.finished) return;
    if (socket.data.seatIndex === undefined) return;
    if (room.turnIndex !== socket.data.seatIndex) return;
    if (playerHasMove(room, socket.data.seatIndex)) return; // si ya podés jugar, no hace falta robar
    if (!room.boneyard || room.boneyard.length === 0) return;

    const seat = room.seats[socket.data.seatIndex];
    const idx = (typeof pileIndex === "number" && pileIndex >= 0 && pileIndex < room.boneyard.length)
      ? pileIndex
      : room.boneyard.length - 1;
    const drawn = room.boneyard.splice(idx, 1)[0];
    seat.hand.push(drawn);

    if (room.lastMove) { if (room.lastMoveTimeout) clearTimeout(room.lastMoveTimeout); room.lastMove = null; }

    sendHandTo(seat);
    broadcastState(room);
  });

  socket.on("passTurn", () => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room || !room.started || room.finished) return;
    if (socket.data.seatIndex === undefined) return;
    if (room.turnIndex !== socket.data.seatIndex) return;
    if (playerHasMove(room, socket.data.seatIndex)) return;
    if (room.boneyard && room.boneyard.length > 0) return; // primero tiene que robar hasta que se acabe el monton

    if (room.lastMove) {
      if (room.lastMoveTimeout) clearTimeout(room.lastMoveTimeout);
      room.lastMove = null;
    }

    room.passCount++;
    if (room.passCount >= room.seats.length) { resolveBlockedGame(room); return; }
    nextTurn(room);
    broadcastState(room);
    advanceSkippingDisconnected(room);
  });

  socket.on("undoLastMove", () => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room || !room.lastMove) return;
    const lm = room.lastMove;
    if (socket.data.seatIndex !== lm.seatIndex) return;
    if (Date.now() > lm.expiresAt) return;
    // Solo se puede deshacer si nadie jugo despues (el turno tiene que seguir en el siguiente jugador, intacto)
    const expectedTurn = (lm.seatIndex + 1) % room.seats.length;
    if (room.turnIndex !== expectedTurn && room.seats.length > 1) return;

    const seat = room.seats[lm.seatIndex];

    if (lm.wasFirstMove) {
      room.board = [];
      room.leftEnd = null;
      room.rightEnd = null;
    } else if (lm.end === "left") {
      room.board.shift();
      room.leftEnd = lm.prevLeftEnd;
    } else {
      room.board.pop();
      room.rightEnd = lm.prevRightEnd;
    }

    seat.hand.push(lm.tile);
    room.turnIndex = lm.seatIndex;
    room.passCount = lm.prevPassCount;
    room.finished = false;
    room.winner = null;
    if (room.lastMoveTimeout) clearTimeout(room.lastMoveTimeout);
    room.lastMove = null;

    broadcastState(room);
    sendHandTo(seat);
  });

  socket.on("rematch", () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (room.seats.every((s) => s.name !== null)) startGame(room);
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;

    if (socket.data.isSpectator) {
      room.spectators.delete(socket.id);
      broadcastState(room);
      return;
    }

    if (socket.data.inQueue) {
      room.queue = room.queue.filter((q) => q.socketId !== socket.id);
      broadcastState(room);
      return;
    }

    const seatIndex = socket.data.seatIndex;
    if (seatIndex === undefined) return;
    const seat = room.seats[seatIndex];
    if (!seat || seat.socketId !== socket.id) return;

    seat.connected = false;
    seat.socketId = null;
    if (seat.email) delete liveUsers[seat.email];

    const promoted = tryPromoteFromQueue(room, seatIndex);
    if (!promoted && !room.started) { seat.name = null; seat.email = null; seat.hand = []; }

    broadcastState(room);
    if (room.started && room.turnIndex === seatIndex) advanceSkippingDisconnected(room);

    const roomIsEmpty = room.seats.every((s) => !s.connected) && room.queue.length === 0;
    if (roomIsEmpty) {
      setTimeout(() => {
        if (rooms[room.code] && room.seats.every((s) => !s.connected) && room.queue.length === 0) delete rooms[room.code];
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("TableLive escuchando en puerto " + PORT));
