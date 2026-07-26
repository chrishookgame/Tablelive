require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { spawn } = require("child_process");
const os = require("os");

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

// Grabaciones de en vivos y reuniones: privadas (no van en /public), y se borran
// solas a los 5 días (ver cleanupOldRecordings más abajo).
const RECORDINGS_DIR = path.join(__dirname, "uploads_privados", "recordings");
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RECORDINGS_DIR),
    filename: (req, file, cb) => {
      const safeName = Date.now() + "_" + req.user.email.replace(/[^a-z0-9]/gi, "_") + ".webm";
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB máximo por grabación
});

function isValidEmail(email) {
  // Formato estándar: algo@algo.dominio, sin espacios, con un solo @
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || "").trim());
}

// Videos y fotos que la gente publica (como TikTok): son públicas, van en /public.
const POSTS_DIR = path.join(__dirname, "public", "uploads", "posts");
fs.mkdirSync(POSTS_DIR, { recursive: true });
const postUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, POSTS_DIR),
    filename: (req, file, cb) => {
      const safeName = Date.now() + "_" + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname || "");
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB máximo (video)
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/") && !file.mimetype.startsWith("image/")) {
      return cb(new Error("Solo se aceptan videos o imágenes."));
    }
    cb(null, true);
  },
});

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

// Invitación bien organizada para cada persona que el anfitrión invite a una reunión
// programada — con el nombre del evento, la fecha/hora, y el código para entrar.
async function sendMeetingInviteEmail(toEmail, hostName, label, scheduledForISO, code) {
  const when = new Date(scheduledForISO);
  const fecha = when.toLocaleDateString("es", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const hora = when.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (!mailTransporter) {
    console.log("[email no configurado] Invitación para " + toEmail + " al evento '" + label + "', código: " + code);
    return;
  }
  await mailTransporter.sendMail({
    from: '"TableLive" <' + EMAIL_USER + ">",
    to: toEmail,
    subject: "📅 Invitación: " + label,
    html: `<div style="font-family:sans-serif;">
      <h2 style="color:#1B4332;">📅 Invitación a "${label}"</h2>
      <p><b>${hostName}</b> te invitó a una reunión en TableLive.</p>
      <p><b>Fecha:</b> ${fecha}<br><b>Horario:</b> ${hora} hs</p>
      <p>Tu código para entrar es:</p>
      <h1 style="letter-spacing:4px;color:#e0a63e;">${code}</h1>
      <p>Cuando sea la hora, entrá a TableLive → "Unirme a una reunión" y poné ese código.</p>
    </div>`,
  });
}

// ---- Config ----
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
// Si "ffmpeg" no está en el PATH del sistema (típico en Windows), poné la ruta completa
// en el .env, por ejemplo: FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";
// IMPORTANTE: en producción, configurá tu propio JWT_SECRET como variable de entorno,
// larga y aleatoria. Si no lo hacés, se genera una al azar cada vez que arranca el
// servidor, lo que desconecta a todos los usuarios cada reinicio.
// Si no pusiste JWT_SECRET en el .env, la generamos UNA sola vez y la guardamos en un
// archivo — así, aunque reinicies el servidor, las sesiones de la gente no se invalidan
// solas (antes se generaba una nueva al azar en cada arranque, y eso desconectaba a todos).
function getOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(__dirname, ".jwt_secret");
  try {
    return fs.readFileSync(secretFile, "utf8").trim();
  } catch (e) {
    const fresh = require("crypto").randomBytes(32).toString("hex");
    try { fs.writeFileSync(secretFile, fresh); } catch (e2) { /* si no se puede guardar, seguimos igual con esta */ }
    return fresh;
  }
}
const JWT_SECRET = getOrCreateJwtSecret();
const PLATFORM_FEE = 0.25; // 25% para la plataforma, 75% para quien retira
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiame123";
// Si este email inicia sesión con SU PROPIA cuenta normal de TableLive (la contraseña
// que usa para jugar, no una contraseña maestra aparte), entra directo como admin
// con acceso total — sin tener que acordarse de una contraseña distinta.
const PLATFORM_ADMIN_EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase();

// Límite de duración de video al subir contenido, según cantidad de seguidores
// (como en TikTok, las cuentas nuevas/chicas tienen un límite más corto).
const VIDEO_DURATION_FOLLOWER_THRESHOLD = 500;
const VIDEO_DURATION_LIMIT_NEW = 3 * 60; // 3 minutos, para cuentas con menos de 500 seguidores
const VIDEO_DURATION_LIMIT_ESTABLISHED = 10 * 60; // 10 minutos, para 500 seguidores o más

const GEM_PACKS = {
  p1: { gems: 100, usd: "1.00", symbol: "🐣", label: "Pollito" },
  p1b: { gems: 200, usd: "2.00", symbol: "🐁", label: "Ratón" },
  p2: { gems: 300, usd: "3.00", symbol: "🐰", label: "Conejo" },
  p2b: { gems: 400, usd: "4.00", symbol: "🐹", label: "Hámster" },
  p3: { gems: 500, usd: "5.00", symbol: "🐱", label: "Gato" },
  p3b: { gems: 600, usd: "6.00", symbol: "🐢", label: "Tortuga" },
  p4: { gems: 700, usd: "7.00", symbol: "🐶", label: "Perro" },
  p5: { gems: 800, usd: "8.00", symbol: "🦊", label: "Zorro" },
  p5b: { gems: 900, usd: "9.00", symbol: "🐨", label: "Koala" },
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
const POSTS_FILE = path.join(__dirname, "posts.json");
const DM_FILE = path.join(__dirname, "dm_messages.json");
const SUBSCRIPTIONS_FILE = path.join(__dirname, "subscriptions.json");
const GIFTS_FILE = path.join(__dirname, "gifts.json");
const REPORTS_FILE = path.join(__dirname, "reports.json");
const RECORDINGS_META_FILE = path.join(__dirname, "recordings.json");
const SCHEDULED_MEETINGS_FILE = path.join(__dirname, "scheduled_meetings.json");

function loadUsers() {
  let data;
  try { data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch (e) { data = {}; }
  // Migración: la app usaba una sola moneda ("balance"). Ahora son dos: Monedas (lo que
  // comprás y gastás) y Diamantes (lo que ganás y podés retirar). A cualquier cuenta vieja
  // le pasamos su balance anterior a Monedas, y arranca con 0 Diamantes.
  Object.values(data).forEach((u) => {
    if (u.coinBalance === undefined) u.coinBalance = u.balance || 0;
    if (u.diamondBalance === undefined) u.diamondBalance = 0;
  });
  return data;
}
function saveUsers(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}
function loadPosts() {
  try { return JSON.parse(fs.readFileSync(POSTS_FILE, "utf8")); } catch (e) { return []; }
}
function savePosts(p) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(p, null, 2));
}
function loadDMs() {
  try { return JSON.parse(fs.readFileSync(DM_FILE, "utf8")); } catch (e) { return []; }
}
function saveDMs(d) {
  fs.writeFileSync(DM_FILE, JSON.stringify(d, null, 2));
}
function loadSubscriptions() {
  try { return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, "utf8")); } catch (e) { return []; }
}
function saveSubscriptions(s) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(s, null, 2));
}
function loadGifts() {
  try { return JSON.parse(fs.readFileSync(GIFTS_FILE, "utf8")); } catch (e) { return []; }
}
function saveGifts(g) {
  fs.writeFileSync(GIFTS_FILE, JSON.stringify(g, null, 2));
}
function loadReports() {
  try { return JSON.parse(fs.readFileSync(REPORTS_FILE, "utf8")); } catch (e) { return []; }
}
function saveReports(r) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(r, null, 2));
}
function loadRecordings() {
  try { return JSON.parse(fs.readFileSync(RECORDINGS_META_FILE, "utf8")); } catch (e) { return []; }
}
function saveRecordings(r) {
  fs.writeFileSync(RECORDINGS_META_FILE, JSON.stringify(r, null, 2));
}
function loadScheduledMeetings() {
  try { return JSON.parse(fs.readFileSync(SCHEDULED_MEETINGS_FILE, "utf8")); } catch (e) { return []; }
}
function saveScheduledMeetings(m) {
  fs.writeFileSync(SCHEDULED_MEETINGS_FILE, JSON.stringify(m, null, 2));
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
  if (user.banned) return res.status(403).json({ error: "Esta cuenta fue suspendida por un administrador." });
  req.user = user;
  next();
}

// ---------------- Registro e inicio de sesión ----------------

app.post("/api/register", avatarUpload.single("avatar"), async (req, res) => {
  const { name, legalName, phone, country, language, email, password, paypalEmail } = req.body;
  if (!name || !legalName || !phone || !country || !email || !password || !paypalEmail) {
    return res.status(400).json({ error: "Completá todos los campos." });
  }
  if (name.includes("@") || isValidEmail(name)) {
    return res.status(400).json({ error: "El nombre de perfil no puede ser un email — poné tu nombre o un apodo, así te ven los demás." });
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
    coinBalance: 0,
    diamondBalance: 0,
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
  res.json({ token: makeToken(key), name: users[key].name, coinBalance: 0, diamondBalance: 0, avatarUrl: users[key].avatarUrl, emailVerified: false });
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
  if (user.banned) return res.status(403).json({ error: "Esta cuenta fue suspendida por un administrador." });
  res.json({ token: makeToken(key), name: user.name, coinBalance: user.coinBalance, diamondBalance: user.diamondBalance, avatarUrl: user.avatarUrl || "", emailVerified: !!user.emailVerified, language: user.language || "es" });
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
    coinBalance: u.coinBalance,
    diamondBalance: u.diamondBalance,
    email: u.email,
    paypalEmail: u.paypalEmail,
    bankName: u.bankName,
    bankAccountNumber: u.bankAccountNumber,
    bankAccountHolder: u.bankAccountHolder,
    followerCount: getFollowerCount(u.email),
    monetizationThreshold: MONETIZATION_THRESHOLD,
    monetization: u.monetization,
    emailVerified: !!u.emailVerified,
    equipped: u.equipped || {},
    inventory: u.inventory || [],
    canAccessAdminPanel: emailKey(u.email) === PLATFORM_ADMIN_EMAIL || !!u.staffRole,
    staffRoleName: u.staffRole ? u.staffRole.roleName : null,
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

app.post("/api/update-profile-info", authMiddleware, avatarUpload.single("avatar"), (req, res) => {
  const u = req.user;
  const { name } = req.body;
  if (name !== undefined) {
    const clean = name.trim();
    if (!clean) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: "El nombre no puede quedar vacío." });
    }
    if (clean.includes("@") || isValidEmail(clean)) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: "El nombre de perfil no puede ser un email — poné tu nombre o un apodo." });
    }
    u.name = clean.slice(0, 18);
  }
  if (req.file) {
    // Borramos la foto anterior del disco para no ir acumulando archivos sueltos.
    if (u.avatarUrl) {
      const oldPath = path.join(__dirname, "public", u.avatarUrl.replace(/^\//, ""));
      fs.unlink(oldPath, () => {});
    }
    u.avatarUrl = "/avatars/" + req.file.filename;
  }
  saveUsers(users);
  res.json({ ok: true, name: u.name, avatarUrl: u.avatarUrl || "" });
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

// ---------------- Suscripciones: apoyo mensual a un creador, pagado con Monedas ----------------
// Nota: esto usa el sistema de Monedas/Diamantes que ya existe (probado y funcional). Cobros recurrentes
// con tarjeta/PayPal de verdad son un proyecto de pagos aparte, no incluido acá.

const SUBSCRIPTION_TIERS = {
  bronze: { label: "🥉 Bronce", priceGems: 200 },
  silver: { label: "🥈 Plata", priceGems: 500 },
  gold: { label: "🥇 Oro", priceGems: 1000 },
};
const SUBSCRIPTION_DAYS = 30;

function activeSubscription(subs, subscriberEmail, creatorEmail) {
  return subs.find((s) => s.subscriberEmail === subscriberEmail && s.creatorEmail === creatorEmail && s.active);
}

function shapeSubscription(s) {
  return {
    id: s.id,
    creatorEmail: s.creatorEmail,
    creatorName: s.creatorName,
    subscriberEmail: s.subscriberEmail,
    subscriberName: s.subscriberName,
    tier: s.tier,
    tierLabel: (SUBSCRIPTION_TIERS[s.tier] || {}).label || s.tier,
    priceGems: s.priceGems,
    startedAt: s.startedAt,
    expiresAt: s.expiresAt,
    autoRenew: s.autoRenew,
    active: s.active,
  };
}

app.get("/api/subscriptions/tiers", authMiddleware, (req, res) => {
  res.json({ tiers: SUBSCRIPTION_TIERS });
});

app.post("/api/subscribe", authMiddleware, (req, res) => {
  const me = req.user;
  const creatorEmail = emailKey(req.body.creatorEmail);
  const tier = req.body.tier;
  if (!SUBSCRIPTION_TIERS[tier]) return res.status(400).json({ error: "Elegí un nivel de suscripción válido." });
  if (creatorEmail === me.email) return res.status(400).json({ error: "No te podés suscribir a vos mismo." });
  const creator = users[creatorEmail];
  if (!creator) return res.status(400).json({ error: "Ese usuario no existe." });

  const subs = loadSubscriptions();
  if (activeSubscription(subs, me.email, creatorEmail)) {
    return res.status(400).json({ error: "Ya estás suscripto a esta persona." });
  }
  const price = SUBSCRIPTION_TIERS[tier].priceGems;
  if (me.coinBalance < price) return res.status(400).json({ error: "No te alcanzan las monedas para este nivel." });

  me.coinBalance -= price;
  creator.diamondBalance += price;
  saveUsers(users);

  const sub = {
    id: "sub_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    subscriberEmail: me.email,
    subscriberName: me.name,
    creatorEmail,
    creatorName: creator.name,
    tier,
    priceGems: price,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SUBSCRIPTION_DAYS * 86400000).toISOString(),
    autoRenew: true,
    active: true,
  };
  subs.push(sub);
  saveSubscriptions(subs);

  res.json({ ok: true, subscription: shapeSubscription(sub), balance: me.coinBalance });
});

app.post("/api/subscriptions/:id/cancel", authMiddleware, (req, res) => {
  const subs = loadSubscriptions();
  const sub = subs.find((s) => s.id === req.params.id && s.subscriberEmail === req.user.email);
  if (!sub) return res.status(404).json({ error: "No se encontró esa suscripción." });
  sub.autoRenew = false;
  saveSubscriptions(subs);
  res.json({ ok: true });
});

app.get("/api/subscriptions/mine", authMiddleware, (req, res) => {
  const subs = loadSubscriptions().filter((s) => s.subscriberEmail === req.user.email && s.active);
  res.json({ subscriptions: subs.map(shapeSubscription) });
});

app.get("/api/subscriptions/my-subscribers", authMiddleware, (req, res) => {
  const subs = loadSubscriptions().filter((s) => s.creatorEmail === req.user.email && s.active);
  const totalGems = subs.reduce((sum, s) => sum + s.priceGems, 0);
  res.json({ subscribers: subs.map(shapeSubscription), count: subs.length, totalGems });
});

app.get("/api/subscriptions/status/:email", authMiddleware, (req, res) => {
  const subs = loadSubscriptions();
  const sub = activeSubscription(subs, req.user.email, emailKey(req.params.email));
  res.json({ subscribed: !!sub, subscription: sub ? shapeSubscription(sub) : null });
});

// Cada una hora, procesamos vencimientos: si tenía auto-renovación y le alcanzan las monedas,
// le cobramos otro mes; si no, la suscripción se desactiva.
function processSubscriptionRenewals() {
  const subs = loadSubscriptions();
  let changed = false;
  const now = Date.now();
  subs.forEach((s) => {
    if (!s.active || new Date(s.expiresAt).getTime() > now) return;
    changed = true;
    const subscriber = users[s.subscriberEmail];
    const creator = users[s.creatorEmail];
    if (s.autoRenew && subscriber && creator && subscriber.coinBalance >= s.priceGems) {
      subscriber.coinBalance -= s.priceGems;
      creator.diamondBalance += s.priceGems;
      s.expiresAt = new Date(now + SUBSCRIPTION_DAYS * 86400000).toISOString();
    } else {
      s.active = false;
    }
  });
  if (changed) { saveUsers(users); saveSubscriptions(subs); }
}
setInterval(processSubscriptionRenewals, 60 * 60 * 1000);

// ---------------- Tienda: insignias, colores de nombre y marcos de perfil, con Monedas ----------------

const STORE_ITEMS = {
  badge_crown: { category: "badge", name: "Corona", emoji: "👑", priceGems: 300 },
  badge_fire: { category: "badge", name: "Fuego", emoji: "🔥", priceGems: 150 },
  badge_diamond: { category: "badge", name: "Diamante", emoji: "💎", priceGems: 500 },
  badge_unicorn: { category: "badge", name: "Unicornio", emoji: "🦄", priceGems: 250 },
  badge_rocket: { category: "badge", name: "Cohete", emoji: "🚀", priceGems: 200 },
  badge_star: { category: "badge", name: "Estrella", emoji: "🌟", priceGems: 120 },
  color_red: { category: "color", name: "Rojo fuego", value: "#e0503e", priceGems: 150 },
  color_blue: { category: "color", name: "Azul eléctrico", value: "#5b8ac9", priceGems: 150 },
  color_purple: { category: "color", name: "Violeta", value: "#a855f7", priceGems: 150 },
  color_green: { category: "color", name: "Verde neón", value: "#4ade80", priceGems: 150 },
  color_pink: { category: "color", name: "Rosa", value: "#f472b6", priceGems: 150 },
  frame_gold: { category: "frame", name: "Marco dorado", cssClass: "frame-gold", priceGems: 300 },
  frame_neon: { category: "frame", name: "Marco neón", cssClass: "frame-neon", priceGems: 400 },
  frame_fire: { category: "frame", name: "Marco de fuego", cssClass: "frame-fire", priceGems: 500 },
};

// ---------------- Reuniones privadas (tipo Zoom): gratis 30 min, planes por día/mes ----------------

// ---------------- Reuniones programadas: elegís fecha/hora y te dan un código de reserva ----------------

app.post("/api/meetings/schedule", authMiddleware, async (req, res) => {
  const { label, date, time, participantEmails } = req.body;
  const cleanLabel = (label || "").trim();
  if (!cleanLabel) return res.status(400).json({ error: "Ponele un nombre a la reunión." });
  if (!date || !time) return res.status(400).json({ error: "Elegí una fecha y un horario." });
  const scheduledFor = new Date(date + "T" + time + ":00");
  if (isNaN(scheduledFor.getTime())) return res.status(400).json({ error: "Esa fecha u horario no es válido." });
  if (scheduledFor.getTime() < Date.now() - 5 * 60000) return res.status(400).json({ error: "Elegí una fecha/hora que todavía no haya pasado." });

  const scheduled = loadScheduledMeetings();
  let code = makeMeetingCode();
  while (scheduled.some((m) => m.code === code) || meetings[code]) code = makeMeetingCode();

  // Cada invitado válido (con email de verdad) recibe el mismo código de reserva, pero
  // con su propia invitación por email, prolija, con el nombre del evento y la fecha.
  const invitedEmails = Array.isArray(participantEmails)
    ? [...new Set(participantEmails.map((e) => (e || "").trim().toLowerCase()).filter((e) => isValidEmail(e)))]
    : [];

  const entry = {
    code,
    hostEmail: req.user.email,
    hostName: req.user.name,
    label: cleanLabel.slice(0, 60),
    scheduledFor: scheduledFor.toISOString(),
    createdAt: new Date().toISOString(),
    invitedEmails,
    started: false,
  };
  scheduled.push(entry);
  saveScheduledMeetings(scheduled);

  for (const email of invitedEmails) {
    try { await sendMeetingInviteEmail(email, req.user.name, entry.label, entry.scheduledFor, code); }
    catch (e) { console.log("Error mandando invitación a " + email + ":", e.message); }
  }

  res.json({ ok: true, meeting: entry, invitedCount: invitedEmails.length });
});

app.get("/api/meetings/scheduled/mine", authMiddleware, (req, res) => {
  const scheduled = loadScheduledMeetings().filter((m) => m.hostEmail === req.user.email && !m.started);
  res.json({ meetings: scheduled.sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1)) });
});

app.post("/api/meetings/scheduled/:code/cancel", authMiddleware, (req, res) => {
  const scheduled = loadScheduledMeetings();
  const entry = scheduled.find((m) => m.code === req.params.code);
  if (!entry) return res.status(404).json({ error: "Esa reserva ya no existe." });
  if (entry.hostEmail !== req.user.email) return res.status(403).json({ error: "Esa reserva no es tuya." });
  saveScheduledMeetings(scheduled.filter((m) => m.code !== req.params.code));
  res.json({ ok: true });
});

app.get("/api/meetings/plans", authMiddleware, (req, res) => {
  res.json({
    plans: loadMeetingPlans(),
    freeMinutes: MEETING_FREE_MINUTES,
    myPlan: req.user.meetingPlan || null,
    active: hasActiveMeetingPlan(req.user),
    isPlatformOwner: !!req.user.isPlatformOwner,
  });
});

app.post("/api/meetings/buy-plan", authMiddleware, (req, res) => {
  const type = req.body.type;
  const plans = loadMeetingPlans();
  const plan = plans[type];
  if (!plan) return res.status(400).json({ error: "Elegí un plan válido." });
  const me = req.user;
  if (me.coinBalance < plan.priceCoins) return res.status(400).json({ error: "No te alcanzan las monedas para este plan." });
  me.coinBalance -= plan.priceCoins;
  // Si ya tenías un plan activo, se suma tiempo en vez de perderlo
  const baseTime = hasActiveMeetingPlan(me) && me.meetingPlan ? new Date(me.meetingPlan.expiresAt).getTime() : Date.now();
  me.meetingPlan = { type, label: plan.label, expiresAt: new Date(baseTime + plan.hours * 3600000).toISOString() };
  saveUsers(users);
  res.json({ ok: true, balance: me.coinBalance, meetingPlan: me.meetingPlan });
});

app.get("/api/store/items", authMiddleware, (req, res) => {
  res.json({ items: STORE_ITEMS, inventory: req.user.inventory || [], equipped: req.user.equipped || {} });
});

app.post("/api/store/buy", authMiddleware, (req, res) => {
  const itemId = req.body.itemId;
  const item = STORE_ITEMS[itemId];
  if (!item) return res.status(400).json({ error: "Ese artículo no existe." });
  const me = req.user;
  if (!me.inventory) me.inventory = [];
  if (me.inventory.includes(itemId)) return res.status(400).json({ error: "Ya tenés este artículo." });
  if (me.coinBalance < item.priceGems) return res.status(400).json({ error: "No te alcanzan las monedas." });
  me.coinBalance -= item.priceGems;
  me.inventory.push(itemId);
  saveUsers(users);
  res.json({ ok: true, balance: me.coinBalance, inventory: me.inventory });
});

app.post("/api/store/equip", authMiddleware, (req, res) => {
  const { itemId, category } = req.body;
  if (!["badge", "color", "frame"].includes(category)) return res.status(400).json({ error: "Categoría inválida." });
  const me = req.user;
  if (!me.equipped) me.equipped = {};
  if (itemId === null || itemId === undefined) {
    me.equipped[category] = null;
  } else {
    const item = STORE_ITEMS[itemId];
    if (!item || item.category !== category) return res.status(400).json({ error: "Artículo inválido." });
    if (!(me.inventory || []).includes(itemId)) return res.status(400).json({ error: "Todavía no compraste ese artículo." });
    me.equipped[category] = itemId;
  }
  saveUsers(users);
  res.json({ ok: true, equipped: me.equipped });
});

// ---------------- Publicaciones: video / foto / texto (como TikTok) ----------------

function maxVideoDurationFor(email) {
  return getFollowerCount(email) >= VIDEO_DURATION_FOLLOWER_THRESHOLD
    ? VIDEO_DURATION_LIMIT_ESTABLISHED
    : VIDEO_DURATION_LIMIT_NEW;
}

function shapePost(p, viewerEmail) {
  return {
    id: p.id,
    authorEmail: p.authorEmail,
    authorName: p.authorName,
    authorAvatar: p.authorAvatar || "",
    type: p.type,
    fileUrl: p.fileUrl || "",
    caption: p.caption || "",
    durationSeconds: p.durationSeconds || null,
    likeCount: (p.likes || []).length,
    likedByMe: viewerEmail ? (p.likes || []).includes(viewerEmail) : false,
    comments: p.comments || [],
    viewCount: p.views || 0,
    createdAt: p.createdAt,
  };
}

// ---------------- Algoritmo "Para ti": ordena el feed por qué tan interesante es cada
// publicación (likes, comentarios, vistas, qué tan nueva es, y si seguís a quien la subió),
// en vez de mostrar todo en orden de subida como una simple lista cronológica. ----------------
function scorePostForViewer(p, viewerEmail, followingSet) {
  const likeCount = (p.likes || []).length;
  const commentCount = (p.comments || []).length;
  const viewCount = p.views || 0;
  const ageHours = Math.max(0, (Date.now() - new Date(p.createdAt).getTime()) / 3600000);

  // Interacciones "caras" pesan más que solo mirar de pasada
  const engagement = likeCount * 3 + commentCount * 5 + viewCount * 0.5;
  // El contenido nuevo tiene ventaja, pero no desaparece de golpe (se va apagando de a poco)
  const recencyBoost = 1 / (1 + ageHours / 30);
  // Le damos prioridad extra a la gente que seguís
  const followBoost = followingSet.has(p.authorEmail) ? 1.6 : 1;
  // Un poquito de variación para que el feed no sea siempre exactamente igual
  const jitter = 0.85 + Math.random() * 0.3;

  return (engagement + 1) * (1 + recencyBoost * 2) * followBoost * jitter;
}

function rankPostsForYou(posts, viewerEmail, followingSet) {
  const scored = posts.map((p) => ({ p, score: scorePostForViewer(p, viewerEmail, followingSet) }));
  scored.sort((a, b) => b.score - a.score);

  // Intercalamos por autor para que la misma persona no ocupe el feed entero seguido,
  // igual que hace TikTok para variar quién aparece.
  const byAuthor = new Map();
  scored.forEach(({ p }) => {
    if (!byAuthor.has(p.authorEmail)) byAuthor.set(p.authorEmail, []);
    byAuthor.get(p.authorEmail).push(p);
  });
  const authorQueues = Array.from(byAuthor.values());
  const interleaved = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const queue of authorQueues) {
      if (queue.length) { interleaved.push(queue.shift()); remaining = true; }
    }
  }
  return interleaved;
}

app.get("/api/video-limit", authMiddleware, (req, res) => {
  const followerCount = getFollowerCount(req.user.email);
  res.json({
    followerCount,
    threshold: VIDEO_DURATION_FOLLOWER_THRESHOLD,
    maxDurationSeconds: maxVideoDurationFor(req.user.email),
  });
});

app.post("/api/posts", authMiddleware, postUpload.single("file"), (req, res) => {
  const u = req.user;
  const type = req.body.type;
  const caption = (req.body.caption || "").slice(0, 300);
  if (!["video", "photo", "text"].includes(type)) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(400).json({ error: "Tipo de publicación inválido." });
  }
  if ((type === "video" || type === "photo") && !req.file) {
    return res.status(400).json({ error: "Falta el archivo." });
  }
  if (type === "text" && !caption.trim()) {
    return res.status(400).json({ error: "Escribí algo para publicar." });
  }

  let durationSeconds = null;
  if (type === "video") {
    durationSeconds = parseFloat(req.body.durationSeconds) || 0;
    const limit = maxVideoDurationFor(u.email);
    if (durationSeconds > limit + 2) { // +2s de margen por redondeo del navegador
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({
        error: "Ese video dura más de lo permitido. Con tus seguidores actuales podés subir hasta " + Math.floor(limit / 60) + " minutos.",
      });
    }
  }

  const post = {
    id: "post_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    authorEmail: u.email,
    authorName: u.name,
    authorAvatar: u.avatarUrl || "",
    type,
    fileUrl: req.file ? "/uploads/posts/" + req.file.filename : "",
    caption,
    durationSeconds,
    likes: [],
    comments: [],
    views: 0,
    createdAt: new Date().toISOString(),
  };
  const posts = loadPosts();
  posts.unshift(post);
  savePosts(posts);
  res.json({ ok: true, post: shapePost(post, u.email) });
});

app.get("/api/posts", authMiddleware, (req, res) => {
  const posts = loadPosts();
  const followingSet = new Set(req.user.following || []);
  const ranked = rankPostsForYou(posts, req.user.email, followingSet).slice(0, 60);
  res.json({ posts: ranked.map((p) => shapePost(p, req.user.email)) });
});

app.post("/api/posts/:id/view", authMiddleware, (req, res) => {
  const posts = loadPosts();
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Esa publicación ya no existe." });
  post.views = (post.views || 0) + 1;
  savePosts(posts);
  res.json({ ok: true, viewCount: post.views });
});

app.get("/api/users/:email/profile", authMiddleware, (req, res) => {
  const key = emailKey(req.params.email);
  const user = users[key];
  if (!user) return res.status(404).json({ error: "Ese usuario no existe." });
  const equipped = user.equipped || {};
  const badge = equipped.badge && STORE_ITEMS[equipped.badge] ? STORE_ITEMS[equipped.badge].emoji : null;
  res.json({
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl || "",
    followerCount: getFollowerCount(user.email),
    isFollowing: (req.user.following || []).includes(user.email),
    badge,
    frameCssClass: equipped.frame && STORE_ITEMS[equipped.frame] ? STORE_ITEMS[equipped.frame].cssClass : null,
  });
});

app.get("/api/posts/user/:email", authMiddleware, (req, res) => {
  const key = emailKey(req.params.email);
  const posts = loadPosts().filter((p) => p.authorEmail === key);
  res.json({ posts: posts.map((p) => shapePost(p, req.user.email)) });
});

app.post("/api/posts/:id/like", authMiddleware, (req, res) => {
  const posts = loadPosts();
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Esa publicación ya no existe." });
  if (!post.likes) post.likes = [];
  const idx = post.likes.indexOf(req.user.email);
  if (idx === -1) post.likes.push(req.user.email); else post.likes.splice(idx, 1);
  savePosts(posts);
  res.json({ ok: true, liked: idx === -1, likeCount: post.likes.length });
});

app.post("/api/posts/:id/comment", authMiddleware, (req, res) => {
  const text = (req.body.text || "").trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: "Escribí un comentario." });
  const posts = loadPosts();
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Esa publicación ya no existe." });
  if (!post.comments) post.comments = [];
  const comment = { name: req.user.name, text, createdAt: new Date().toISOString() };
  post.comments.push(comment);
  savePosts(posts);
  res.json({ ok: true, comment, commentCount: post.comments.length });
});

// ---------------- Denuncias: publicaciones o usuarios ----------------

const REPORT_REASONS = ["spam", "contenido_inapropiado", "acoso", "informacion_falsa", "otro"];

// ---------------- Grabaciones de en vivos / reuniones: se borran solas a los 5 días ----------------

const RECORDING_RETENTION_DAYS = 5;

app.post("/api/recordings/upload", authMiddleware, recordingUpload.single("recording"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo." });
  const recordings = loadRecordings();
  const rec = {
    id: "rec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    ownerEmail: req.user.email,
    ownerName: req.user.name,
    filename: req.file.filename,
    label: (req.body.label || "Grabación").slice(0, 80),
    sourceType: req.body.sourceType === "meeting" ? "meeting" : "live", // en vivo o reunión privada
    sizeBytes: req.file.size,
    createdAt: new Date().toISOString(),
  };
  recordings.push(rec);
  saveRecordings(recordings);
  res.json({ ok: true, id: rec.id });
});

app.get("/api/recordings/mine", authMiddleware, (req, res) => {
  const mine = loadRecordings()
    .filter((r) => r.ownerEmail === req.user.email)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((r) => ({ id: r.id, label: r.label, sourceType: r.sourceType, sizeBytes: r.sizeBytes, createdAt: r.createdAt }));
  res.json({ recordings: mine, retentionDays: RECORDING_RETENTION_DAYS });
});

app.get("/api/recordings/:id/download", authMiddleware, (req, res) => {
  const rec = loadRecordings().find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "Esa grabación ya no existe (puede que se haya borrado a los 5 días)." });
  if (rec.ownerEmail !== req.user.email) return res.status(403).json({ error: "Esa grabación no es tuya." });
  const filePath = path.join(RECORDINGS_DIR, rec.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "No se encontró el archivo." });
  res.download(filePath, "tablelive_" + rec.label.replace(/[^a-z0-9]/gi, "_") + ".webm");
});

app.post("/api/recordings/:id/delete", authMiddleware, (req, res) => {
  const recordings = loadRecordings();
  const rec = recordings.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "No encontrada." });
  if (rec.ownerEmail !== req.user.email) return res.status(403).json({ error: "Esa grabación no es tuya." });
  fs.unlink(path.join(RECORDINGS_DIR, rec.filename), () => {});
  saveRecordings(recordings.filter((r) => r.id !== rec.id));
  res.json({ ok: true });
});

function cleanupOldRecordings() {
  const recordings = loadRecordings();
  const cutoff = Date.now() - RECORDING_RETENTION_DAYS * 86400000;
  const expired = recordings.filter((r) => new Date(r.createdAt).getTime() <= cutoff);
  const kept = recordings.filter((r) => new Date(r.createdAt).getTime() > cutoff);
  expired.forEach((r) => fs.unlink(path.join(RECORDINGS_DIR, r.filename), () => {}));
  if (expired.length) saveRecordings(kept);
}
setInterval(cleanupOldRecordings, 60 * 60 * 1000);
cleanupOldRecordings(); // también al arrancar, por si el servidor estuvo apagado varios días

app.post("/api/report", authMiddleware, (req, res) => {
  const { type, targetId, reason, details } = req.body;
  if (!["post", "user"].includes(type)) return res.status(400).json({ error: "Tipo de denuncia inválido." });
  if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ error: "Elegí un motivo válido." });
  if (!targetId) return res.status(400).json({ error: "Falta indicar qué estás denunciando." });

  const reports = loadReports();
  reports.push({
    id: "report_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    type,
    targetId,
    reason,
    details: (details || "").slice(0, 300),
    reporterEmail: req.user.email,
    reporterName: req.user.name,
    status: "pendiente",
    createdAt: new Date().toISOString(),
  });
  saveReports(reports);
  res.json({ ok: true });
});

// ---------------- Descargar una publicación, con marca de agua de TableLive ----------------
// Necesita que el servidor tenga ffmpeg instalado (`ffmpeg -version` para comprobar).

function sanitizeForFfmpegText(text) {
  // Sacamos los caracteres que rompen la sintaxis de filtros de ffmpeg (drawtext)
  return (text || "").replace(/[:'\\%\[\],;]/g, "").slice(0, 40);
}

app.get("/api/posts/:id/download", authMiddleware, (req, res) => {
  const post = loadPosts().find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Esa publicación ya no existe." });
  if (post.type === "text") return res.status(400).json({ error: "Las publicaciones de texto no se pueden descargar como archivo." });
  if (!post.fileUrl) return res.status(400).json({ error: "Esta publicación no tiene un archivo." });

  const sourcePath = path.join(__dirname, "public", post.fileUrl.replace(/^\//, ""));
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: "No se encontró el archivo original." });

  const ext = post.type === "video" ? "mp4" : "jpg";
  const outPath = path.join(os.tmpdir(), "tablelive_dl_" + post.id + "_" + Date.now() + "." + ext);
  const watermarkText = "TableLive - " + sanitizeForFfmpegText(post.authorName);
  // Usamos nuestra propia fuente (incluida en el proyecto) para que la marca de agua
  // se vea siempre, sin depender de qué fuentes tenga instaladas el sistema operativo
  // (en Windows, sin esto, el texto a veces no aparecía).
  const fontPath = path.join(__dirname, "fonts", "watermark-font.ttf").replace(/\\/g, "/").replace(/:/g, "\\:");
  const drawtext = "drawtext=fontfile='" + fontPath + "':text='" + watermarkText + "':fontcolor=white@0.9:fontsize=22:box=1:boxcolor=black@0.45:boxborderw=8:x=16:y=h-th-16";

  const args = post.type === "video"
    ? ["-y", "-i", sourcePath, "-vf", drawtext, "-codec:a", "copy", outPath]
    : ["-y", "-i", sourcePath, "-vf", drawtext, outPath];

  const ffmpegProc = spawn(FFMPEG_PATH, args);
  let stderrLog = "";
  ffmpegProc.stderr.on("data", (d) => { stderrLog += d.toString(); });
  ffmpegProc.on("error", () => {
    res.status(500).json({ error: "El servidor no tiene ffmpeg instalado, no se puede generar la marca de agua." });
  });
  ffmpegProc.on("close", (code) => {
    if (res.headersSent) return;
    if (code !== 0 || !fs.existsSync(outPath)) {
      console.error("ffmpeg falló al generar la descarga:", stderrLog.slice(-800));
      return res.status(500).json({ error: "No se pudo generar la descarga con marca de agua." });
    }
    res.download(outPath, "tablelive_" + post.id + "." + ext, () => {
      fs.unlink(outPath, () => {});
    });
  });
});

// ---------------- Mensajes privados (bandeja tipo TikTok, persistente) ----------------
// Nota: esto es independiente del chat privado dentro de una sala en vivo (sendPrivateMessage
// por socket), que solo funciona mientras las dos personas están juntas en la misma sala.

app.get("/api/messages/conversations", authMiddleware, (req, res) => {
  const me = req.user.email;
  const dms = loadDMs();
  const lastByPartner = {};
  dms.forEach((m) => {
    if (m.from !== me && m.to !== me) return;
    const partner = m.from === me ? m.to : m.from;
    if (!lastByPartner[partner] || m.createdAt > lastByPartner[partner].createdAt) lastByPartner[partner] = m;
  });
  const results = Object.entries(lastByPartner)
    .map(([partnerEmail, last]) => {
      const u = users[partnerEmail];
      return {
        email: partnerEmail,
        name: u ? u.name : "Usuario",
        avatarUrl: u ? (u.avatarUrl || "") : "",
        lastText: last.text,
        lastAt: last.createdAt,
        lastFromMe: last.from === me,
      };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  res.json({ conversations: results });
});

app.get("/api/messages/with/:email", authMiddleware, (req, res) => {
  const me = req.user.email;
  const partner = emailKey(req.params.email);
  const messages = loadDMs().filter(
    (m) => (m.from === me && m.to === partner) || (m.from === partner && m.to === me)
  );
  res.json({ messages, partnerName: users[partner] ? users[partner].name : "Usuario" });
});

app.post("/api/messages/send", authMiddleware, (req, res) => {
  const to = emailKey(req.body.to);
  const text = (req.body.text || "").trim().slice(0, 500);
  const sharedPostId = req.body.sharedPostId || null;
  if (!text && !sharedPostId) return res.status(400).json({ error: "Escribí un mensaje." });
  if (!users[to]) return res.status(400).json({ error: "Ese usuario no existe." });
  if (to === req.user.email) return res.status(400).json({ error: "No te podés mandar mensajes a vos mismo." });

  let sharedPost = null;
  if (sharedPostId) {
    const post = loadPosts().find((p) => p.id === sharedPostId);
    if (post) sharedPost = { id: post.id, type: post.type, authorName: post.authorName, caption: post.caption, fileUrl: post.fileUrl };
  }

  const dms = loadDMs();
  const message = { from: req.user.email, to, text, sharedPost, createdAt: new Date().toISOString() };
  dms.push(message);
  saveDMs(dms);
  res.json({ ok: true, message });
});

// ---------------- PayPal: comprar Monedas ----------------

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

// Manda plata de verdad a la cuenta de PayPal de la persona, usando PayPal Payouts.
// Devuelve { ok: true, batchId } si PayPal aceptó el pago, o { ok: false, error } si no.
async function sendPaypalPayout(receiverEmail, usdAmount, note) {
  try {
    const token = await paypalAccessToken();
    const batchId = "tablelive_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const res = await fetch(PAYPAL_API_BASE + "/v1/payments/payouts", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: batchId,
          email_subject: "¡Te pagaron desde TableLive!",
          email_message: "Gracias por ser parte de TableLive. Acá tenés tu retiro.",
        },
        items: [{
          recipient_type: "EMAIL",
          amount: { value: usdAmount.toFixed(2), currency: "USD" },
          receiver: receiverEmail,
          note: note || "Retiro de diamantes en TableLive",
          sender_item_id: batchId,
        }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: (data.message || "PayPal rechazó el pago.") + (data.details ? " " + JSON.stringify(data.details) : "") };
    }
    return { ok: true, batchId: data.batch_header ? data.batch_header.payout_batch_id : batchId };
  } catch (e) {
    return { ok: false, error: "No se pudo conectar con PayPal: " + e.message };
  }
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
    users[req.user.email].coinBalance += pack.gems;
    saveUsers(users);
    delete pendingOrders[orderID];
    res.json({ gems: pack.gems, newBalance: users[req.user.email].coinBalance });
  } catch (e) {
    res.status(500).json({ error: "No se pudo confirmar el pago" });
  }
});

// ---------------- Retiros (con la comisión de plataforma) ----------------

app.post("/api/withdraw-request", authMiddleware, (req, res) => {
  const { amount } = req.body;
  const user = req.user;
  if (!user.emailVerified) return res.status(400).json({ error: "Primero tenés que confirmar tu email antes de retirar." });
  if (!amount || amount <= 0 || amount > user.diamondBalance) {
    return res.status(400).json({ error: "Cantidad inválida o saldo insuficiente de diamantes." });
  }
  user.diamondBalance -= amount;
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
  res.json({ ok: true, newBalance: user.diamondBalance, payoutAmount, platformCut });
});

app.get("/api/my-withdrawals", authMiddleware, (req, res) => {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}
  const mine = list.filter((w) => w.email === req.user.email).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  res.json({ withdrawals: mine });
});

app.get("/api/my-earnings", authMiddleware, (req, res) => {
  const me = req.user.email;
  const gifts = loadGifts().filter((g) => g.toEmail === me);
  const giftTotal = gifts.reduce((sum, g) => sum + g.amount, 0);

  const subs = loadSubscriptions().filter((s) => s.creatorEmail === me);
  // Sumamos cada mes ya pagado: el primer pago de cada suscripción, más cada renovación que ya haya ocurrido.
  const subTotal = subs.reduce((sum, s) => {
    const monthsPaid = s.active
      ? Math.max(1, Math.ceil((Date.now() - new Date(s.startedAt).getTime()) / (SUBSCRIPTION_DAYS * 86400000)))
      : 1;
    return sum + s.priceGems * monthsPaid;
  }, 0);

  const recentGifts = gifts.sort((a, b) => b.ts - a.ts).slice(0, 20)
    .map((g) => ({ type: "gift", fromName: g.fromName, amount: g.amount, ts: g.ts }));

  res.json({
    diamondBalance: req.user.diamondBalance,
    giftTotal,
    subscriptionTotal: subTotal,
    subscriberCount: subs.filter((s) => s.active).length,
    recentActivity: recentGifts,
  });
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

// ---------------- Personal con acceso limitado (secretaria/supervisor/etc) ----------------
// El administrador (con la contraseña maestra) puede asignarle a cualquier usuario un
// puesto de trabajo con nivel de acceso "full", "parcial" o "limitado". Esa persona
// entra al panel con su propio email y contraseña normal, no con la contraseña maestra.
const ACCESS_LEVEL_RANK = { limitado: 1, parcial: 2, full: 3 };

function adminOrStaff(minLevel) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.t || null);
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.role === "admin") { req.staffAccessLevel = "full"; return next(); }
      if (payload.role === "staff") {
        const user = users[emailKey(payload.email)];
        if (!user || !user.staffRole) throw new Error("ya no tiene puesto asignado");
        const level = user.staffRole.accessLevel;
        if ((ACCESS_LEVEL_RANK[level] || 0) < (ACCESS_LEVEL_RANK[minLevel] || 0)) throw new Error("acceso insuficiente");
        req.staffAccessLevel = level;
        req.staffUser = user;
        return next();
      }
      throw new Error("rol inválido");
    } catch (e) {
      res.status(401).json({ error: "No autorizado para esta acción." });
    }
  };
}

app.post("/api/staff-login", async (req, res) => {
  const { email, password } = req.body;
  const key = emailKey(email);
  const user = users[key];
  if (!user) return res.status(401).json({ error: "Ese email no está registrado en TableLive." });
  const valid = await bcrypt.compare(password || "", user.password);
  if (!valid) return res.status(401).json({ error: "Contraseña incorrecta." });

  // El email de la plataforma entra directo como admin maestro, con su propia contraseña
  if (key === PLATFORM_ADMIN_EMAIL) {
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
    return res.json({ token, roleName: "Administrador de la plataforma", accessLevel: "full", name: user.name, isMasterAdmin: true });
  }

  if (!user.staffRole) return res.status(401).json({ error: "Ese email no tiene un puesto de trabajo asignado." });
  const token = jwt.sign({ role: "staff", email: key }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, roleName: user.staffRole.roleName, accessLevel: user.staffRole.accessLevel, name: user.name, isMasterAdmin: false });
});

app.post("/api/admin/staff/assign", adminAuthMiddleware, (req, res) => {
  const { email, roleName, accessLevel } = req.body;
  const user = users[emailKey(email)];
  if (!user) return res.status(404).json({ error: "Ese usuario no existe." });
  if (!["full", "parcial", "limitado"].includes(accessLevel)) return res.status(400).json({ error: "Nivel de acceso inválido." });
  user.staffRole = { roleName: (roleName || "Personal").slice(0, 40), accessLevel };
  saveUsers(users);
  res.json({ ok: true, staffRole: user.staffRole });
});

app.post("/api/admin/staff/remove", adminAuthMiddleware, (req, res) => {
  const user = users[emailKey(req.body.email)];
  if (!user) return res.status(404).json({ error: "Ese usuario no existe." });
  delete user.staffRole;
  saveUsers(users);
  res.json({ ok: true });
});

app.get("/api/admin/staff/list", adminAuthMiddleware, (req, res) => {
  const staff = Object.values(users).filter((u) => u.staffRole).map((u) => ({ email: u.email, name: u.name, roleName: u.staffRole.roleName, accessLevel: u.staffRole.accessLevel }));
  res.json({ staff });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Contraseña incorrecta." });
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

app.get("/api/admin/overview", adminOrStaff("limitado"), (req, res) => {
  let withdrawals = [];
  try { withdrawals = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}

  const userList = Object.values(users).map((u) => ({
    name: u.name, email: u.email, paypalEmail: u.paypalEmail, coinBalance: u.coinBalance, diamondBalance: u.diamondBalance, createdAt: u.createdAt,
    followerCount: getFollowerCount(u.email), monetizationStatus: u.monetization ? u.monetization.status : "no_solicitado",
    banned: !!u.banned, isPlatformOwner: !!u.isPlatformOwner,
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

app.get("/api/admin/kyc-document/:filename", adminOrStaff("parcial"), (req, res) => {
  const list = loadMonetizationRequests();
  const match = list.find((r) => r.documentFile === req.params.filename);
  if (!match) return res.status(404).send("No encontrado");
  res.sendFile(path.join(KYC_DIR, match.documentFile));
});

app.post("/api/admin/monetization/decision", adminOrStaff("parcial"), (req, res) => {
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

app.post("/api/admin/mark-paid", adminOrStaff("parcial"), (req, res) => {
  const { index } = req.body;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}
  if (!list[index]) return res.status(400).json({ error: "No encontrado." });
  list[index].status = "pagado";
  list[index].paidAt = new Date().toISOString();
  fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true });
});

app.post("/api/admin/reject-withdrawal", adminOrStaff("parcial"), (req, res) => {
  const { index } = req.body;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}
  const w = list[index];
  if (!w) return res.status(400).json({ error: "No encontrado." });
  if (w.status !== "pendiente") return res.status(400).json({ error: "Ese retiro ya no está pendiente." });
  w.status = "rechazado";
  w.rejectedAt = new Date().toISOString();
  // Le devolvemos los diamantes a la cuenta, ya que el retiro no se va a pagar
  const user = users[w.email];
  if (user) { user.diamondBalance += w.gemsWithdrawn; saveUsers(users); }
  fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true });
});

app.post("/api/admin/pay-withdrawal-automatic", adminAuthMiddleware, async (req, res) => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return res.status(400).json({ error: "Todavía no configuraste PAYPAL_CLIENT_ID/SECRET en el .env." });
  }
  const { index } = req.body;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}
  const w = list[index];
  if (!w) return res.status(400).json({ error: "No encontrado." });
  if (w.status !== "pendiente") return res.status(400).json({ error: "Ese retiro ya no está pendiente." });
  if (!w.paypalEmail) return res.status(400).json({ error: "Esa persona no tiene un email de PayPal cargado." });

  const result = await sendPaypalPayout(w.paypalEmail, parseFloat(w.payoutAmount), "Retiro de diamantes en TableLive");
  if (!result.ok) {
    return res.status(400).json({ error: "PayPal no pudo procesar el pago: " + result.error });
  }
  w.status = "pagado";
  w.paidAt = new Date().toISOString();
  w.paypalBatchId = result.batchId;
  w.paidAutomatically = true;
  fs.writeFileSync(WITHDRAWALS_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true, batchId: result.batchId });
});

// ---------------- Admin: gestión total de usuarios ----------------

app.post("/api/admin/user/adjust-balance", adminAuthMiddleware, (req, res) => {
  const { email, coinBalance, diamondBalance } = req.body;
  const user = users[emailKey(email)];
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  if (coinBalance !== undefined && !isNaN(coinBalance)) user.coinBalance = Math.max(0, parseInt(coinBalance, 10));
  if (diamondBalance !== undefined && !isNaN(diamondBalance)) user.diamondBalance = Math.max(0, parseInt(diamondBalance, 10));
  saveUsers(users);
  res.json({ ok: true, coinBalance: user.coinBalance, diamondBalance: user.diamondBalance });
});

app.post("/api/admin/user/ban", adminOrStaff("parcial"), (req, res) => {
  const { email, banned } = req.body;
  const user = users[emailKey(email)];
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  user.banned = !!banned;
  saveUsers(users);
  res.json({ ok: true, banned: user.banned });
});

app.post("/api/admin/user/set-owner", adminAuthMiddleware, (req, res) => {
  const { email, isPlatformOwner } = req.body;
  const user = users[emailKey(email)];
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  user.isPlatformOwner = !!isPlatformOwner;
  saveUsers(users);
  res.json({ ok: true, isPlatformOwner: user.isPlatformOwner });
});

app.post("/api/admin/user/verify-email", adminOrStaff("parcial"), (req, res) => {
  const user = users[emailKey(req.body.email)];
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  user.emailVerified = true;
  saveUsers(users);
  res.json({ ok: true });
});

app.post("/api/admin/user/delete", adminAuthMiddleware, (req, res) => {
  const key = emailKey(req.body.email);
  if (!users[key]) return res.status(404).json({ error: "Usuario no encontrado." });
  delete users[key];
  saveUsers(users);
  res.json({ ok: true });
});

// ---------------- Admin: moderar cualquier publicación ----------------

app.get("/api/admin/posts", adminOrStaff("limitado"), (req, res) => {
  const posts = loadPosts().map((p) => ({
    id: p.id, authorName: p.authorName, authorEmail: p.authorEmail, type: p.type,
    caption: p.caption, fileUrl: p.fileUrl, likeCount: (p.likes || []).length,
    commentCount: (p.comments || []).length, createdAt: p.createdAt,
  }));
  res.json({ posts });
});

app.post("/api/admin/posts/delete", adminOrStaff("parcial"), (req, res) => {
  const posts = loadPosts();
  const idx = posts.findIndex((p) => p.id === req.body.id);
  if (idx === -1) return res.status(404).json({ error: "No encontrada." });
  const [removed] = posts.splice(idx, 1);
  if (removed.fileUrl) {
    const filePath = path.join(__dirname, "public", removed.fileUrl.replace(/^\//, ""));
    fs.unlink(filePath, () => {});
  }
  savePosts(posts);
  res.json({ ok: true });
});

// ---------------- Admin: cerrar cualquier sala en vivo ----------------

app.post("/api/admin/rooms/end", adminOrStaff("parcial"), (req, res) => {
  const room = rooms[(req.body.code || "").toUpperCase()];
  if (!room) return res.status(404).json({ error: "Esa sala no existe." });
  if (room.activeBattleId) endBattle(room.activeBattleId);
  io.to(room.code).emit("errorMsg", "Un administrador cerró esta transmisión.");
  io.in(room.code).fetchSockets().then((sockets) => {
    sockets.forEach((s) => { s.emit("kickedEvent", { roomCode: room.code }); s.leave(room.code); });
  });
  delete rooms[room.code];
  res.json({ ok: true });
});

// ---------------- Admin: ver y cancelar cualquier suscripción ----------------

app.get("/api/admin/subscriptions", adminOrStaff("limitado"), (req, res) => {
  const subs = loadSubscriptions().filter((s) => s.active);
  res.json({ subscriptions: subs });
});

app.post("/api/admin/subscriptions/cancel", adminOrStaff("parcial"), (req, res) => {
  const subs = loadSubscriptions();
  const sub = subs.find((s) => s.id === req.body.id);
  if (!sub) return res.status(404).json({ error: "No encontrada." });
  sub.active = false;
  sub.autoRenew = false;
  saveSubscriptions(subs);
  res.json({ ok: true });
});

// ---------------- Admin: estadísticas generales de la plataforma ----------------

app.get("/api/admin/reports", adminOrStaff("limitado"), (req, res) => {
  const reports = loadReports().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ reports });
});

app.post("/api/admin/reports/resolve", adminOrStaff("limitado"), (req, res) => {
  const reports = loadReports();
  const r = reports.find((x) => x.id === req.body.id);
  if (!r) return res.status(404).json({ error: "No encontrada." });
  r.status = req.body.status === "descartada" ? "descartada" : "resuelta";
  r.resolvedAt = new Date().toISOString();
  saveReports(reports);
  res.json({ ok: true });
});

app.get("/api/admin/meeting-plans", adminOrStaff("limitado"), (req, res) => {
  res.json({ plans: loadMeetingPlans() });
});

app.post("/api/admin/meeting-plans/update", adminAuthMiddleware, (req, res) => {
  const { type, label, priceCoins, hours } = req.body;
  if (!type) return res.status(400).json({ error: "Falta el tipo de plan." });
  const plans = loadMeetingPlans();
  plans[type] = {
    label: (label || type).slice(0, 40),
    priceCoins: Math.max(0, parseInt(priceCoins, 10) || 0),
    hours: Math.max(1, parseFloat(hours) || 1),
  };
  saveMeetingPlans(plans);
  res.json({ ok: true, plans });
});

app.post("/api/admin/meeting-plans/delete", adminAuthMiddleware, (req, res) => {
  const plans = loadMeetingPlans();
  delete plans[req.body.type];
  saveMeetingPlans(plans);
  res.json({ ok: true, plans });
});

app.get("/api/admin/stats", adminOrStaff("limitado"), (req, res) => {
  const userList = Object.values(users);
  const gifts = loadGifts();
  const subs = loadSubscriptions();
  let withdrawals = [];
  try { withdrawals = JSON.parse(fs.readFileSync(WITHDRAWALS_FILE, "utf8")); } catch (e) {}

  res.json({
    totalUsers: userList.length,
    bannedUsers: userList.filter((u) => u.banned).length,
    totalCoinsInCirculation: userList.reduce((sum, u) => sum + (u.coinBalance || 0), 0),
    totalDiamondsInCirculation: userList.reduce((sum, u) => sum + (u.diamondBalance || 0), 0),
    totalGiftsSent: gifts.length,
    totalGiftValue: gifts.reduce((sum, g) => sum + g.amount, 0),
    activeSubscriptions: subs.filter((s) => s.active).length,
    totalPosts: loadPosts().length,
    activeRooms: Object.keys(rooms).length,
    pendingWithdrawals: withdrawals.filter((w) => w.status === "pendiente").length,
    paidOutUsd: withdrawals.filter((w) => w.status === "pagado").reduce((sum, w) => sum + parseFloat(w.payoutAmount || 0), 0),
    pendingReports: loadReports().filter((r) => r.status === "pendiente").length,
  });
});

// ---------------- Admin: mandar un anuncio a toda la plataforma ----------------

app.post("/api/admin/announce", adminAuthMiddleware, (req, res) => {
  const text = (req.body.text || "").trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: "Escribí un mensaje." });
  io.emit("platformAnnouncement", { text });
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
const meetings = {}; // código de reunión -> { code, hostEmail, hostName, participants: Map<socketId,{name,email}>, startedAt, freeLimitTimeout }
const MEETING_FREE_MINUTES = 30;
const MEETING_PLANS_FILE = path.join(__dirname, "meeting_plans.json");

// Precios pensados para quedar más baratos que Zoom/Meet de pago (Zoom Pro ronda
// los USD $14-16 por mes) — esto lo puede cambiar el administrador cuando quiera
// desde el panel de admin, esto es solo el valor de arranque la primera vez.
const DEFAULT_MEETING_PLANS = {
  hourly: { label: "Por hora", priceCoins: 50, hours: 1 },
  daily: { label: "Plan diario", priceCoins: 150, hours: 24 },
  weekly: { label: "Plan semanal", priceCoins: 500, hours: 24 * 7 },
  monthly: { label: "Plan mensual", priceCoins: 1200, hours: 24 * 30 },
  yearly: { label: "Plan anual", priceCoins: 10000, hours: 24 * 365 },
};

function loadMeetingPlans() {
  try { return JSON.parse(fs.readFileSync(MEETING_PLANS_FILE, "utf8")); } catch (e) { return { ...DEFAULT_MEETING_PLANS }; }
}
function saveMeetingPlans(plans) {
  fs.writeFileSync(MEETING_PLANS_FILE, JSON.stringify(plans, null, 2));
}

function makeMeetingCode() {
  return "M-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function hasActiveMeetingPlan(user) {
  if (user && user.isPlatformOwner) return true; // el dueño de la plataforma nunca tiene límite de tiempo
  return !!(user && user.meetingPlan && user.meetingPlan.expiresAt && new Date(user.meetingPlan.expiresAt).getTime() > Date.now());
}
const battles = {}; // battleId -> { id, roomA, roomB, scoreA, scoreB, startedAt, durationSeconds, ended, timeout }
const pendingBattleInvites = {}; // código de sala destino -> { fromCode, fromName, durationSeconds, expiresAt }

function emptySeats(capacity) {
  return Array.from({ length: capacity }, () => ({ name: null, email: null, socketId: null, connected: false, hand: [] }));
}

function publicBattleFor(room) {
  if (!room.activeBattleId) return null;
  const b = battles[room.activeBattleId];
  if (!b) return null;
  const isA = b.roomA === room.code;
  const opponentCode = isA ? b.roomB : b.roomA;
  const opponentRoom = rooms[opponentCode];
  const opponentSeat = opponentRoom ? opponentRoom.seats.find((s) => s.name) : null;
  return {
    id: b.id,
    opponentCode,
    opponentName: opponentSeat ? opponentSeat.name : "Rival",
    myScore: isA ? b.scoreA : b.scoreB,
    opponentScore: isA ? b.scoreB : b.scoreA,
    myTopGifter: topGifterName(isA ? b.giftersA : b.giftersB, room),
    opponentTopGifter: opponentRoom ? topGifterName(isA ? b.giftersB : b.giftersA, opponentRoom) : null,
    startedAt: b.startedAt,
    durationSeconds: b.durationSeconds,
    ended: !!b.ended,
  };
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
    seats: room.seats.map((s, i) => ({
      seatIndex: i, name: s.name, tileCount: s.hand.length, connected: s.connected,
      email: s.email || null,
      avatarUrl: s.email && users[s.email] ? (users[s.email].avatarUrl || "") : "",
    })),
    queue: room.queue.map((q) => q.name),
    spectatorCount: room.spectators ? room.spectators.size : 0,
    boneyardCount: room.boneyard ? room.boneyard.length : 0,
    likes: room.likes || {},
    comments: room.comments || [],
    turnSeatIndex: room.started ? room.turnIndex : null,
    lastMoveSeatIndex: room.lastMove ? room.lastMove.seatIndex : null,
    lastMoveExpiresAt: room.lastMove ? room.lastMove.expiresAt : null,
    passCount: room.passCount,
    liveStartedAt: room.liveStartedAt || null,
    battle: publicBattleFor(room),
    cameraGuests: (room.cameraGuests || []).map((g) => ({
      name: g.name, email: g.email,
      avatarUrl: g.email && users[g.email] ? (users[g.email].avatarUrl || "") : "",
    })),
    featuredEmail: room.featuredEmail || null,
    guestsOpen: !!room.guestsOpen,
  };
}

function startBattle(roomA, roomB, durationSeconds) {
  const id = "battle_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const battle = {
    id, roomA: roomA.code, roomB: roomB.code, scoreA: 0, scoreB: 0,
    giftersA: {}, giftersB: {}, // email -> total regalado de ese lado (para la espada del que más regala)
    startedAt: Date.now(), durationSeconds, ended: false, timeout: null,
  };
  battles[id] = battle;
  roomA.activeBattleId = id;
  roomB.activeBattleId = id;
  battle.timeout = setTimeout(() => endBattle(id), durationSeconds * 1000);
  broadcastState(roomA);
  broadcastState(roomB);
}

function topGifterName(gifters, room) {
  const entries = Object.entries(gifters || {});
  if (!entries.length) return null;
  const [topEmail] = entries.sort((a, b) => b[1] - a[1])[0];
  const seat = room.seats.find((s) => s.email === topEmail);
  if (seat) return seat.name;
  const user = users[topEmail];
  return user ? user.name : null;
}

function endBattle(id) {
  const b = battles[id];
  if (!b || b.ended) return;
  b.ended = true;
  if (b.timeout) clearTimeout(b.timeout);
  const roomA = rooms[b.roomA];
  const roomB = rooms[b.roomB];
  if (roomA) broadcastState(roomA);
  if (roomB) broadcastState(roomB);
  // Dejamos el resultado final a la vista unos segundos antes de volver todo a la normalidad
  setTimeout(() => {
    delete battles[id];
    if (rooms[b.roomA]) { rooms[b.roomA].activeBattleId = null; broadcastState(rooms[b.roomA]); }
    if (rooms[b.roomB]) { rooms[b.roomB].activeBattleId = null; broadcastState(rooms[b.roomB]); }
  }, 8000);
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
  if ((room.bannedNames || []).includes(name)) {
    socket.emit("errorMsg", "Te expulsaron de esa transmisión, no podés volver a entrar.");
    return;
  }
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
    if (user && !user.banned) {
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
    const u0 = users[socket.data.userEmail];
    socket.emit("balance", u0 ? { coins: u0.coinBalance, diamonds: u0.diamondBalance } : { coins: 0, diamonds: 0 });
  }

  // ---------------- Video propio (WebRTC), sin Jitsi ni ningún servidor externo ----------------
  // El servidor acá es solo un "cartero": conecta a la gente entre sí pasándose mensajes
  // (ofertas, respuestas, direcciones de red), pero el video/audio viaja directo entre los
  // celulares/computadoras de cada persona, nunca pasa por nuestro servidor.
  socket.data.rtcRooms = new Set();

  socket.on("rtc-join", ({ roomCode }) => {
    if (!roomCode) return;
    const rtcRoom = "rtc:" + roomCode;
    const existingPeers = [];
    const room = io.sockets.adapter.rooms.get(rtcRoom);
    if (room) {
      room.forEach((sid) => {
        const s = io.sockets.sockets.get(sid);
        if (s) existingPeers.push({ socketId: sid, name: displayNameFor(s), email: s.data.userEmail || null });
      });
    }
    socket.join(rtcRoom);
    socket.data.rtcRooms.add(rtcRoom);
    socket.emit("rtc-existing-peers", { roomCode, peers: existingPeers });
    socket.to(rtcRoom).emit("rtc-peer-joined", { roomCode, socketId: socket.id, name: displayNameFor(socket), email: socket.data.userEmail || null });
  });

  socket.on("rtc-leave", ({ roomCode }) => {
    const rtcRoom = "rtc:" + roomCode;
    socket.leave(rtcRoom);
    socket.data.rtcRooms.delete(rtcRoom);
    socket.to(rtcRoom).emit("rtc-peer-left", { roomCode, socketId: socket.id });
  });

  socket.on("rtc-signal", ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit("rtc-signal", { from: socket.id, data });
  });

  // ---------------- Reuniones privadas (tipo Zoom) ----------------
  function meetingSummary(m) {
    return {
      code: m.code,
      hostName: m.hostName,
      hostEmail: m.hostEmail,
      label: m.label || null,
      startedAt: m.startedAt,
      participantCount: m.participants.size,
      participants: Array.from(m.participants.values()),
      freeLimited: !m.unlimited,
    };
  }

  function endMeeting(code, reason) {
    const m = meetings[code];
    if (!m) return;
    if (m.freeLimitTimeout) clearTimeout(m.freeLimitTimeout);
    io.to("meeting:" + code).emit("meetingEnded", { code, reason: reason || "El anfitrión cerró la reunión." });
    delete meetings[code];
  }

  function startMeetingForCode(code, hostSocket, label) {
    const user = users[hostSocket.data.userEmail];
    const unlimited = hasActiveMeetingPlan(user);
    meetings[code] = {
      code, hostEmail: hostSocket.data.userEmail, hostName: displayNameFor(hostSocket), label: label || null,
      participants: new Map(), startedAt: Date.now(), unlimited, freeLimitTimeout: null,
    };
    if (!unlimited) {
      meetings[code].freeLimitTimeout = setTimeout(() => {
        endMeeting(code, "Se acabaron los 30 minutos gratis. Comprá un plan para reuniones sin límite de tiempo.");
      }, MEETING_FREE_MINUTES * 60 * 1000);
    }
    hostSocket.join("meeting:" + code);
    meetings[code].participants.set(hostSocket.id, { socketId: hostSocket.id, name: displayNameFor(hostSocket), email: hostSocket.data.userEmail });
    hostSocket.data.meetingCode = code;
    hostSocket.emit("meetingJoined", meetingSummary(meetings[code]));
  }

  socket.on("createMeeting", () => {
    if (!requireAuth(socket)) return;
    let code = makeMeetingCode();
    while (meetings[code]) code = makeMeetingCode();
    startMeetingForCode(code, socket);
  });

  // Convierte una reserva programada en una reunión en vivo de verdad, usando el
  // mismo código que ya le habían dado a la persona — así entra directo con ese código.
  socket.on("startScheduledMeeting", ({ code }) => {
    if (!requireAuth(socket)) return;
    const scheduled = loadScheduledMeetings();
    const entry = scheduled.find((m) => m.code === (code || "").toUpperCase());
    if (!entry) { socket.emit("errorMsg", "Esa reserva no existe o ya se usó."); return; }
    if (entry.hostEmail !== socket.data.userEmail) { socket.emit("errorMsg", "Esa reserva no es tuya."); return; }
    saveScheduledMeetings(scheduled.filter((m) => m.code !== entry.code));
    startMeetingForCode(entry.code, socket, entry.label);
  });

  socket.on("joinMeeting", ({ code }) => {
    const upperCode = (code || "").toUpperCase();
    const m = meetings[upperCode];
    if (!m) {
      // Si no está en vivo todavía, capaz es una reserva que no arrancó — avisamos bien
      const scheduled = loadScheduledMeetings().find((s) => s.code === upperCode);
      if (scheduled) {
        const when = new Date(scheduled.scheduledFor);
        socket.emit("errorMsg", "Esta reunión está programada para el " + when.toLocaleDateString("es") + " a las " + when.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) + " — todavía no arrancó.");
      } else {
        socket.emit("errorMsg", "Esa reunión no existe o ya terminó.");
      }
      return;
    }
    const name = socket.data.userEmail ? displayNameFor(socket) : "Invitado";
    socket.join("meeting:" + m.code);
    m.participants.set(socket.id, { socketId: socket.id, name, email: socket.data.userEmail || null });
    socket.data.meetingCode = m.code;
    socket.emit("meetingJoined", meetingSummary(m));
    socket.to("meeting:" + m.code).emit("meetingRoster", meetingSummary(m));
  });

  socket.on("leaveMeeting", () => {
    const code = socket.data.meetingCode;
    if (!code || !meetings[code]) return;
    const m = meetings[code];
    m.participants.delete(socket.id);
    socket.leave("meeting:" + code);
    socket.data.meetingCode = null;
    if (socket.data.userEmail === m.hostEmail || m.participants.size === 0) {
      endMeeting(code, "La reunión terminó.");
    } else {
      io.to("meeting:" + code).emit("meetingRoster", meetingSummary(m));
    }
  });

  // El anfitrión de la reunión puede expulsar o silenciar a cualquier persona en
  // cualquier momento — ninguna de las dos cosas existía antes para reuniones.
  socket.on("kickMeetingParticipant", ({ socketId }) => {
    const code = socket.data.meetingCode;
    const m = meetings[code];
    if (!m || socket.data.userEmail !== m.hostEmail) return;
    const targetSocket = io.sockets.sockets.get(socketId);
    m.participants.delete(socketId);
    if (targetSocket) {
      targetSocket.emit("youWereKickedFromMeeting");
      targetSocket.leave("meeting:" + code);
      targetSocket.data.meetingCode = null;
    }
    io.to("meeting:" + code).emit("meetingRoster", meetingSummary(m));
  });

  socket.on("muteMeetingParticipant", ({ socketId }) => {
    const code = socket.data.meetingCode;
    const m = meetings[code];
    if (!m || socket.data.userEmail !== m.hostEmail) return;
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) targetSocket.emit("hostMutedYouInMeetingEvent");
  });

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
      likes: {}, comments: [], liveStartedAt: Date.now(),
      mutedNames: [], bannedNames: [],
    };
    assignSeat(socket, rooms[code]);
  });

  socket.on("joinRoom", ({ code }) => {
    if (!requireAuth(socket)) return;
    const room = rooms[(code || "").toUpperCase()];
    if (!room) { socket.emit("errorMsg", "Esa sala no existe. Revisá el código."); return; }
    assignSeat(socket, room);
  });

  // Un espectador que está mirando el live decide que quiere jugar al dominó: se suma
  // sin tener que salir e ingresar de nuevo. Es opcional, nadie lo obliga a jugar.
  socket.on("requestSeat", () => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room) { socket.emit("errorMsg", "No estás mirando ninguna sala."); return; }
    if (!socket.data.isSpectator) return; // ya tiene asiento o ya está en la fila
    room.spectators.delete(socket.id);
    socket.data.isSpectator = false;
    assignSeat(socket, room);
  });

  // ---------------- Batallas LIVE: dos transmisiones compiten por regalos ----------------
  socket.on("inviteBattle", ({ targetCode, durationSeconds }) => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room) { socket.emit("errorMsg", "Tenés que estar en una sala para invitar a batalla."); return; }
    const target = rooms[(targetCode || "").toUpperCase()];
    if (!target) { socket.emit("errorMsg", "Esa transmisión ya no está disponible."); return; }
    if (target.code === room.code) { socket.emit("errorMsg", "No te podés desafiar a vos mismo."); return; }
    if (room.activeBattleId) { socket.emit("errorMsg", "Tu transmisión ya está en una batalla."); return; }
    if (target.activeBattleId) { socket.emit("errorMsg", "Esa transmisión ya está en otra batalla."); return; }
    const dur = [60, 120, 180, 300].includes(durationSeconds) ? durationSeconds : 180;
    const fromName = displayNameFor(socket);
    pendingBattleInvites[target.code] = { fromCode: room.code, fromName, durationSeconds: dur, expiresAt: Date.now() + 30000 };
    io.to(target.code).emit("battleInvited", { fromCode: room.code, fromName, durationSeconds: dur });
    socket.emit("battleInviteSent", { targetCode: target.code });
  });

  socket.on("respondBattleInvite", ({ accept }) => {
    if (!requireAuth(socket)) return;
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const invite = pendingBattleInvites[room.code];
    if (!invite || invite.expiresAt < Date.now()) { delete pendingBattleInvites[room.code]; return; }
    delete pendingBattleInvites[room.code];
    const challenger = rooms[invite.fromCode];
    if (!challenger) { socket.emit("errorMsg", "Esa transmisión ya no está disponible."); return; }
    if (!accept) {
      io.to(challenger.code).emit("battleDeclined", { byName: displayNameFor(socket) });
      return;
    }
    if (room.activeBattleId || challenger.activeBattleId) {
      socket.emit("errorMsg", "Una de las dos transmisiones ya está en otra batalla.");
      return;
    }
    startBattle(challenger, room, invite.durationSeconds);
  });

  // Cualquiera puede mirar en vivo, sin necesitar cuenta
  socket.on("spectateRoom", ({ code, name }) => {
    const room = rooms[(code || "").toUpperCase()];
    if (!room) { socket.emit("errorMsg", "Esa sala no existe."); return; }
    const spectatorDisplayName = socket.data.userName || (name || "Espectador").slice(0, 18);
    if ((room.bannedNames || []).includes(spectatorDisplayName)) {
      socket.emit("errorMsg", "Te expulsaron de esa transmisión, no podés volver a entrar.");
      return;
    }
    // Si ya estabas mirando otra sala (deslizaste a esta sin recargar la página), la dejamos
    // limpia antes de pasar a la nueva — si no, quedan restos: contador de espectadores mal,
    // seguís "adentro" de la sala vieja para recibir cosas que ya no te interesan.
    if (socket.data.roomCode && socket.data.roomCode !== room.code && socket.data.isSpectator) {
      const prevRoom = rooms[socket.data.roomCode];
      if (prevRoom) {
        prevRoom.spectators.delete(socket.id);
        socket.leave(prevRoom.code);
        broadcastState(prevRoom);
      }
    }
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

  socket.on("requestJoinCamera", ({ withCamera } = {}) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (!room.cameraGuests) room.cameraGuests = [];
    if (!room.cameraRequests) room.cameraRequests = [];
    const name = displayNameFor(socket);
    const already = room.cameraGuests.some((g) => g.name === name) || room.cameraRequests.some((r) => r.name === name);
    if (already) return;
    room.cameraRequests.push({ name, email: socket.data.userEmail || null, withCamera: withCamera !== false, socketId: socket.id });
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

    const request = (room.cameraRequests || []).find((r) => r.name === name);
    room.cameraRequests = (room.cameraRequests || []).filter((r) => r.name !== name);
    if (approve) {
      if (!room.cameraGuests) room.cameraGuests = [];
      if (room.cameraGuests.length >= 10) return;
      room.cameraGuests.push({ name, email: request ? request.email : null });
      // Le avisamos directo a esa persona que la aceptaron, para que se conecte sola
      // (con o sin cámara, según lo que ella haya pedido) sin tener que hacer nada más.
      if (request && request.socketId) {
        const targetSocket = io.sockets.sockets.get(request.socketId);
        if (targetSocket) targetSocket.emit("cameraApprovedEvent", { withCamera: request.withCamera });
      }
    }
    io.to(room.code).emit("cameraRequestEvent", { requests: room.cameraRequests, guests: room.cameraGuests || [] });
    broadcastState(room); // así la tira de "en cámara" se actualiza para todos los que están mirando, no solo para quien pidió subir
  });

  // El anfitrión (o admin del live) puede bajar a alguien de cámara en cualquier
  // momento que quiera, no solo cuando aprueba o rechaza un pedido nuevo.
  socket.on("removeCameraGuest", ({ email }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const myDisplayName = displayNameFor(socket);
    const isPlayer = room.seats.some((s) => s.name === myDisplayName);
    const isLiveAdmin = (room.liveAdmins || []).includes(myDisplayName);
    if (!isPlayer && !isLiveAdmin) return;
    if (!room.cameraGuests) return;
    room.cameraGuests = room.cameraGuests.filter((g) => g.email !== email);
    broadcastState(room);
    // Le avisamos directo a esa persona para que su cámara se apague sola, sin que
    // tenga que darse cuenta mirando la pantalla.
    const roomSockets = io.sockets.adapter.rooms.get(room.code);
    if (roomSockets) {
      roomSockets.forEach((sid) => {
        const s = io.sockets.sockets.get(sid);
        if (s && s.data.userEmail === email) s.emit("removedFromCameraEvent");
      });
    }
  });

  // Silenciar a alguien en cámara sin bajarlo del todo — distinto a removeCameraGuest.
  socket.on("muteCameraGuest", ({ email }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const myDisplayName = displayNameFor(socket);
    const isPlayer = room.seats.some((s) => s.name === myDisplayName);
    const isLiveAdmin = (room.liveAdmins || []).includes(myDisplayName);
    if (!isPlayer && !isLiveAdmin) return;
    const roomSockets = io.sockets.adapter.rooms.get(room.code);
    if (roomSockets) {
      roomSockets.forEach((sid) => {
        const s = io.sockets.sockets.get(sid);
        if (s && s.data.userEmail === email) s.emit("hostMutedYouInLiveEvent");
      });
    }
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

  // El anfitrión (o quien nombró como admin del live) elige a quién se ve en pantalla
  // grande — mandar email null saca al destacado y vuelve todo parejo.
  socket.on("setFeaturedParticipant", ({ email }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const myDisplayName = displayNameFor(socket);
    const isPlayer = room.seats.some((s) => s.name === myDisplayName);
    const isLiveAdmin = (room.liveAdmins || []).includes(myDisplayName);
    if (!isPlayer && !isLiveAdmin) return;
    room.featuredEmail = email || null;
    broadcastState(room);
  });

  // El anfitrión decide cuándo abrir su transmisión para que la gente pueda pedir TableUp.
  // Mientras esté cerrado, nadie ve las ventanillas — no es algo que quede siempre puesto.
  socket.on("toggleGuestsOpen", ({ open }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const myDisplayName = displayNameFor(socket);
    const isPlayer = room.seats.some((s) => s.name === myDisplayName);
    const isLiveAdmin = (room.liveAdmins || []).includes(myDisplayName);
    if (!isPlayer && !isLiveAdmin) return;
    room.guestsOpen = !!open;
    broadcastState(room);
  });

  // ---------------- Moderación del live: borrar comentarios, silenciar, expulsar ----------------
  function isModerator(socket, room) {
    const myDisplayName = displayNameFor(socket);
    return room.seats.some((s) => s.name === myDisplayName) || (room.liveAdmins || []).includes(myDisplayName);
  }

  socket.on("deleteComment", ({ ts }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !isModerator(socket, room)) return;
    room.comments = (room.comments || []).filter((c) => c.ts !== ts);
    io.to(room.code).emit("commentDeleted", { ts });
  });

  socket.on("muteUser", ({ name, muted }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !isModerator(socket, room)) return;
    if (name === displayNameFor(socket)) return; // no te podés silenciar a vos mismo
    if (!room.mutedNames) room.mutedNames = [];
    if (muted) {
      if (!room.mutedNames.includes(name)) room.mutedNames.push(name);
    } else {
      room.mutedNames = room.mutedNames.filter((n) => n !== name);
    }
    io.to(room.code).emit("moderationEvent", { mutedNames: room.mutedNames, bannedNames: room.bannedNames || [] });
  });

  socket.on("kickUser", ({ name }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || !isModerator(socket, room)) return;
    if (name === displayNameFor(socket)) return; // no te podés expulsar a vos mismo
    if (!room.bannedNames) room.bannedNames = [];
    if (!room.bannedNames.includes(name)) room.bannedNames.push(name);

    // Si estaba jugando, le liberamos el asiento (igual que si se hubiera desconectado)
    const seatIndex = room.seats.findIndex((s) => s.name === name);
    if (seatIndex !== -1) {
      const seat = room.seats[seatIndex];
      if (seat.socketId) {
        const targetSocket = io.sockets.sockets.get(seat.socketId);
        if (targetSocket) { targetSocket.emit("kickedEvent", { roomCode: room.code }); targetSocket.leave(room.code); }
      }
      if (seat.email) delete liveUsers[seat.email];
      const promoted = tryPromoteFromQueue(room, seatIndex);
      if (!promoted) { seat.name = null; seat.email = null; seat.socketId = null; seat.connected = false; seat.hand = []; }
    }

    // Si estaba mirando como espectador, lo sacamos también
    io.in(room.code).fetchSockets().then((sockets) => {
      sockets.forEach((s) => {
        const sName = s.data.userName || s.data.spectatorName;
        if (s.data.isSpectator && sName === name) {
          s.emit("kickedEvent", { roomCode: room.code });
          s.leave(room.code);
          room.spectators.delete(s.id);
        }
      });
      broadcastState(room);
    });

    io.to(room.code).emit("moderationEvent", { mutedNames: room.mutedNames || [], bannedNames: room.bannedNames });
    broadcastState(room);
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
    const senderName = displayNameFor(socket);
    if ((room.mutedNames || []).includes(senderName)) {
      socket.emit("errorMsg", "Un moderador te silenció en esta transmisión.");
      return;
    }
    const u = socket.data.userEmail ? users[socket.data.userEmail] : null;
    const equipped = (u && u.equipped) || {};
    const badge = equipped.badge && STORE_ITEMS[equipped.badge] ? STORE_ITEMS[equipped.badge].emoji : null;
    const nameColor = equipped.color && STORE_ITEMS[equipped.color] ? STORE_ITEMS[equipped.color].value : null;
    const comment = { name: senderName, text: clean, ts: Date.now(), badge, nameColor };
    room.comments.push(comment);
    if (room.comments.length > 50) room.comments.shift();
    io.to(room.code).emit("commentEvent", comment);
  });

  socket.on("getBalance", () => {
    if (!socket.data.userEmail) return;
    const u = users[socket.data.userEmail];
    socket.emit("balance", u ? { coins: u.coinBalance, diamonds: u.diamondBalance } : { coins: 0, diamonds: 0 });
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
    if (sender.coinBalance < amt) { socket.emit("giftError", "No te alcanzan las monedas."); return; }
    sender.coinBalance -= amt;
    receiver.diamondBalance += amt;
    saveUsers(users);
    const gifts = loadGifts();
    gifts.push({ fromEmail: sender.email, fromName: sender.name, toEmail: receiver.email, toName: receiver.name, amount: amt, ts: Date.now() });
    saveGifts(gifts);
    socket.emit("balance", { coins: sender.coinBalance, diamonds: sender.diamondBalance });
    if (toSeat.socketId) {
      const recSocket = io.sockets.sockets.get(toSeat.socketId);
      if (recSocket) recSocket.emit("balance", { coins: receiver.coinBalance, diamonds: receiver.diamondBalance });
    }
    io.to(room.code).emit("giftEvent", { from: sender.name, to: receiver.name, amount: amt });

    // Si la sala está en una batalla LIVE, este regalo suma puntos para este lado
    if (room.activeBattleId) {
      const b = battles[room.activeBattleId];
      if (b && !b.ended) {
        const gifters = b.roomA === room.code ? b.giftersA : b.giftersB;
        gifters[sender.email] = (gifters[sender.email] || 0) + amt;
        if (b.roomA === room.code) b.scoreA += amt;
        else if (b.roomB === room.code) b.scoreB += amt;
        broadcastState(room);
        const otherCode = b.roomA === room.code ? b.roomB : b.roomA;
        if (rooms[otherCode]) broadcastState(rooms[otherCode]);
      }
    }
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
    if (socket.data.rtcRooms) {
      socket.data.rtcRooms.forEach((rtcRoom) => {
        socket.to(rtcRoom).emit("rtc-peer-left", { roomCode: rtcRoom.replace(/^rtc:/, ""), socketId: socket.id });
      });
    }
    const meetingCode = socket.data.meetingCode;
    if (meetingCode && meetings[meetingCode]) {
      const m = meetings[meetingCode];
      m.participants.delete(socket.id);
      if (socket.data.userEmail === m.hostEmail || m.participants.size === 0) {
        endMeeting(meetingCode, "La reunión terminó.");
      } else {
        io.to("meeting:" + meetingCode).emit("meetingRoster", meetingSummary(m));
      }
    }
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
      if (room.activeBattleId) endBattle(room.activeBattleId);
      setTimeout(() => {
        if (rooms[room.code] && room.seats.every((s) => !s.connected) && room.queue.length === 0) delete rooms[room.code];
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("TableLive escuchando en puerto " + PORT));
