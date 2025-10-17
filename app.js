// app.js — ESM completo (fix Windows __dirname + GET /)

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import express from "express";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import bodyParser from "body-parser";
import { fileURLToPath as f2p } from "url";
import xlsx from "xlsx";

dotenv.config();

const app = express();
app.use(bodyParser.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// __dirname in ESM (compatibile Windows)
//const __filename = fileURLToPath(import.meta.url);
const __filename = f2p(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "GTSTrack";

// --- Static ---
const PUBLIC_DIR = path.join(__dirname, "public");

// --- Storage helpers (entries.json) ---
const ENTRIES_PATH = path.join(__dirname, "data", "entries.json");
const OPTIONS_PATH = path.join(__dirname, "data", "operators.json");
const USERS_PATH = path.join(__dirname, "data", "users.json");

const OPTION_CATEGORIES = ["operators", "cantieri", "macchine", "linee"];

async function ensureDataFile() {
  const dir = path.dirname(ENTRIES_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(ENTRIES_PATH);
  } catch {
    await fs.writeFile(ENTRIES_PATH, "[]", "utf8");
  }
}

async function loadEntries() {
  await ensureDataFile();
  const raw = await fs.readFile(ENTRIES_PATH, "utf8").catch(() => "[]");
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveEntries(arr) {
  await ensureDataFile();
  await fs.writeFile(ENTRIES_PATH, JSON.stringify(arr, null, 2), "utf8");
}

async function ensureOptionsFile() {
  const dir = path.dirname(OPTIONS_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(OPTIONS_PATH);
  } catch {
    const initial = {
      operators: [],
      cantieri: [],
      macchine: [],
      linee: [],
    };
    try {
      const seededOperators = readOperatorsFromXlsx();
      if (seededOperators.length) {
        initial.operators = seededOperators;
      }
    } catch {
      // ignore se il file xlsx non è disponibile
    }
    await fs.writeFile(OPTIONS_PATH, JSON.stringify(initial, null, 2), "utf8");
  }
}

function normalizeOptions(obj) {
  const norm = {
    operators: [],
    cantieri: [],
    macchine: [],
    linee: [],
  };
  for (const key of OPTION_CATEGORIES) {
    const arr = Array.isArray(obj?.[key]) ? obj[key] : [];
    norm[key] = arr
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)
      .filter((v, idx, self) => {
        return (
          self.findIndex((x) => x.toLowerCase() === String(v).toLowerCase()) ===
          idx
        );
      })
      .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
  }
  return norm;
}

async function loadOptions() {
  await ensureOptionsFile();
  const raw = await fs.readFile(OPTIONS_PATH, "utf8").catch(() => "{}");
  try {
    const parsed = JSON.parse(raw);
    return normalizeOptions(parsed);
  } catch {
    return normalizeOptions({});
  }
}

async function saveOptions(data) {
  await ensureOptionsFile();
  const normalized = normalizeOptions(data);
  await fs.writeFile(OPTIONS_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

async function ensureUsersFile() {
  const dir = path.dirname(USERS_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(USERS_PATH);
  } catch {
    await fs.writeFile(USERS_PATH, "[]", "utf8");
  }
}

async function loadUsers() {
  await ensureUsersFile();
  const raw = await fs.readFile(USERS_PATH, "utf8").catch(() => "[]");
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveUsers(users) {
  await ensureUsersFile();
  await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2), "utf8");
}

function readOperatorsFromXlsx() {
  const wb = xlsx.readFile(OPERATORS_XLSX);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  return rows
    .map((r) => String(r.OPERATORI || "").trim())
    .filter(Boolean)
    .filter((v, idx, arr) => {
      return (
        arr.findIndex((x) => x.toLowerCase() === String(v).toLowerCase()) ===
        idx
      );
    })
    .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}

// --- Utility date DD/MM/YYYY ---
function dmyToKey(dmy) {
  if (!dmy || typeof dmy !== "string") return null;
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return Number(`${yyyy}${mm}${dd}`);
}

// --- Auth semplice a token ---
const validTokens = new Set();
const userTokens = new Map();

function parseCookies(header = "") {
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    const value = rest.join("=");
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function getUserTokenFromReq(req) {
  const auth = req.headers.authorization || "";
  const [, bearerToken] = auth.split(" ");
  if (bearerToken && userTokens.has(bearerToken)) {
    return bearerToken;
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies?.userToken;
  if (cookieToken && userTokens.has(cookieToken)) {
    return cookieToken;
  }
  return null;
}

function issueUserToken(res, userId) {
  const token = crypto.randomBytes(16).toString("hex");
  userTokens.set(token, { userId, issuedAt: Date.now() });
  res.setHeader(
    "Set-Cookie",
    `userToken=${token}; HttpOnly; Path=/; Max-Age=${
      7 * 24 * 60 * 60
    }; SameSite=Lax`
  );
  return token;
}

function clearUserToken(res, token) {
  if (token) {
    userTokens.delete(token);
  }
  res.setHeader(
    "Set-Cookie",
    "userToken=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
  );
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const [, token] = h.split(" ");
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function userAuthMiddleware(req, res, next) {
  const token = getUserTokenFromReq(req);
  if (token) {
    req.userToken = token;
    req.userInfo = userTokens.get(token);
    return next();
  }
  if (req.accepts("html")) {
    return res.redirect("/register.html");
  }
  return res.status(401).json({ error: "Utente non autenticato" });
}

// --- LOGIN ---
app.post("/api/login", async (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const token = crypto.randomBytes(16).toString("hex");
    validTokens.add(token);
    return res.json({ token });
  }
  return res.status(401).json({ error: "Credenziali non valide" });
});
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  if (hash.length !== candidate.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(candidate, "hex")
  );
}

app.post("/api/register", async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalizedEmail || !password || password.length < 6) {
    return res.status(400).json({ error: "Dati non validi" });
  }
  const users = await loadUsers();
  const exists = users.some((u) => u.email === normalizedEmail);
  if (exists) {
    return res.status(409).json({ error: "Utente già registrato" });
  }
  const newUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  await saveUsers(users);
  issueUserToken(res, newUser.id);
  return res.json({ ok: true });
});

app.post("/api/login-user", async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Dati non validi" });
  }
  const users = await loadUsers();
  const user = users.find((u) => u.email === normalizedEmail);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }
  issueUserToken(res, user.id);
  return res.json({ ok: true });
});

app.post("/api/logout-user", async (req, res) => {
  const token = getUserTokenFromReq(req);
  clearUserToken(res, token);
  res.json({ ok: true });
});

// Rotta protetta per index
app.get(["/", "/index.html"], userAuthMiddleware, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// static assets (index escluso)
app.use(express.static(PUBLIC_DIR, { index: false }));

// Legge data/operators.xlsx (colonna OPERATORI) e restituisce la lista
const OPERATORS_XLSX = path.join(__dirname, "data", "operators.xlsx");

app.get("/api/options", async (req, res) => {
  try {
    const options = await loadOptions();
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: "Impossibile leggere le opzioni" });
  }
});

app.post("/api/options", authMiddleware, async (req, res) => {
  const category = String(req.body?.category || "").toLowerCase();
  const value =
    typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (!OPTION_CATEGORIES.includes(category) || !value) {
    return res.status(400).json({ error: "Categoria o valore non valido" });
  }
  try {
    const options = await loadOptions();
    const arr = options[category];
    const exists = arr.some((v) => v.toLowerCase() === value.toLowerCase());
    if (!exists) {
      arr.push(value);
    }
    const saved = await saveOptions(options);
    res.json({ ok: true, options: saved, created: !exists });
  } catch (err) {
    res.status(500).json({ error: "Impossibile salvare" });
  }
});

app.delete("/api/options", authMiddleware, async (req, res) => {
  const category = String(req.body?.category || "").toLowerCase();
  const value =
    typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (!OPTION_CATEGORIES.includes(category) || !value) {
    return res.status(400).json({ error: "Categoria o valore non valido" });
  }
  try {
    const options = await loadOptions();
    const arr = options[category];
    const filtered = arr.filter((v) => v.toLowerCase() !== value.toLowerCase());
    if (filtered.length === arr.length) {
      return res
        .status(404)
        .json({ error: "Voce non trovata", options: options });
    }
    options[category] = filtered;
    const saved = await saveOptions(options);
    res.json({ ok: true, options: saved });
  } catch (err) {
    res.status(500).json({ error: "Impossibile salvare" });
  }
});

app.get("/api/operators", async (req, res) => {
  try {
    const options = await loadOptions();
    res.json({ operators: options.operators });
  } catch (err) {
    try {
      const fallback = readOperatorsFromXlsx();
      res.json({ operators: fallback });
    } catch {
      res.json({ operators: [] });
    }
  }
});

app.post("/api/options", authMiddleware, async (req, res) => {
  const category = String(req.body?.category || "").toLowerCase();
  const value =
    typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (!OPTION_CATEGORIES.includes(category) || !value) {
    return res.status(400).json({ error: "Categoria o valore non valido" });
  }
  try {
    const options = await loadOptions();
    const arr = options[category];
    const exists = arr.some((v) => v.toLowerCase() === value.toLowerCase());
    if (!exists) {
      arr.push(value);
    }
    const saved = await saveOptions(options);
    res.json({ ok: true, options: saved, created: !exists });
  } catch (err) {
    res.status(500).json({ error: "Impossibile salvare" });
  }
});

app.delete("/api/options", authMiddleware, async (req, res) => {
  const category = String(req.body?.category || "").toLowerCase();
  const value =
    typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (!OPTION_CATEGORIES.includes(category) || !value) {
    return res.status(400).json({ error: "Categoria o valore non valido" });
  }
  try {
    const options = await loadOptions();
    const arr = options[category];
    const filtered = arr.filter((v) => v.toLowerCase() !== value.toLowerCase());
    if (filtered.length === arr.length) {
      return res
        .status(404)
        .json({ error: "Voce non trovata", options: options });
    }
    options[category] = filtered;
    const saved = await saveOptions(options);
    res.json({ ok: true, options: saved });
  } catch (err) {
    res.status(500).json({ error: "Impossibile salvare" });
  }
});

app.get("/api/operators", async (req, res) => {
  try {
    const options = await loadOptions();
    res.json({ operators: options.operators });
  } catch (err) {
    try {
      const fallback = readOperatorsFromXlsx();
      res.json({ operators: fallback });
    } catch {
      res.json({ operators: [] });
    }
  }
});

// --- CREA VOCE (chiamato da index.html) ---
// --- CREA VOCE (chiamato da index.html) ---
app.post("/api/entry", async (req, res) => {
  try {
    const { operator, cantiere, macchina, linea, ore, data, descrizione } =
      req.body || {};
    // campi obbligatori (descrizione diventa facoltativa)
    if (
      !operator ||
      !cantiere ||
      !macchina ||
      !linea ||
      ore === undefined ||
      !data
    ) {
      return res.status(400).json({
        error: "Tutti i campi sono obbligatori (tranne descrizione).",
      });
    }
    // data in formato DD/MM/YYYY
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) {
      return res
        .status(400)
        .json({ error: "Formato data non valido (usa DD/MM/YYYY)." });
    }
    // ore numerico
    const numOre = Number(ore);
    if (!Number.isFinite(numOre)) {
      return res.status(400).json({ error: "Ore deve essere un numero." });
    }

    const entries = await loadEntries();
    const nextId = entries.length
      ? Math.max(...entries.map((e) => Number(e.id) || 0)) + 1
      : Date.now();

    const entry = {
      id: nextId,
      operator: typeof operator === "string" ? operator.trim() : operator,
      cantiere: typeof cantiere === "string" ? cantiere.trim() : cantiere,
      macchina: typeof macchina === "string" ? macchina.trim() : macchina,
      linea: typeof linea === "string" ? linea.trim() : linea,
      ore: numOre,
      data, // DD/MM/YYYY
      descrizione: typeof descrizione === "string" ? descrizione.trim() : "", // <-- facoltativa
    };

    entries.push(entry);
    await saveEntries(entries);
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: "Errore salvataggio." });
  }
});

// --- SEARCH (filtri) ---
app.post("/api/entries/search", authMiddleware, async (req, res) => {
  const {
    cantiere = null,
    macchina = null,
    linea = null,
    operator = null,
    descrContains = null,
    dataFrom = null,
    dataTo = null,
  } = req.body || {};

  const fromKey = dataFrom ? dmyToKey(dataFrom) : null;
  const toKey = dataTo ? dmyToKey(dataTo) : null;

  const entries = await loadEntries();
  const out = entries.filter((e) => {
    if (cantiere) {
      const hay = String(e.cantiere || "").toLowerCase();
      const tokens = String(cantiere)
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const t of tokens) {
        if (!hay.includes(t)) return false;
      }
    }
    if (
      macchina &&
      String(e.macchina || "").toLowerCase() !== String(macchina).toLowerCase()
    )
      return false;
    if (
      linea &&
      String(e.linea || "").toLowerCase() !== String(linea).toLowerCase()
    )
      return false;
    if (operator) {
      const hay = String(e.operator || "").toLowerCase();
      const tokens = String(operator)
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const t of tokens) {
        if (!hay.includes(t)) return false; // richiede che ogni parola cercata sia contenuta
      }
    }
    if (descrContains) {
      const hay = String(e.descrizione || "").toLowerCase();
      const needle = String(descrContains).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (fromKey || toKey) {
      const k = dmyToKey(e.data);
      if (fromKey && (k === null || k < fromKey)) return false;
      if (toKey && (k === null || k > toKey)) return false;
    }
    return true;
  });

  res.json({ entries: out });
});

// --- DELETE singola riga ---
app.delete("/api/entries/:id", authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "ID non valido." });

  const entries = await loadEntries();
  const kept = entries.filter((e) => e.id !== id);
  if (kept.length === entries.length) {
    return res.status(404).json({ error: "Riga non trovata." });
  }
  await saveEntries(kept);
  res.json({ ok: true, deleted: 1 });
});

// --- DELETE massiva (righe filtrate) ---
app.post("/api/entries/delete-bulk", authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length || ids.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: "Elenco ID non valido." });
  }
  const set = new Set(ids);
  const entries = await loadEntries();
  const kept = entries.filter((e) => !set.has(e.id));
  const deleted = entries.length - kept.length;
  await saveEntries(kept);
  res.json({ ok: true, deleted });
});

// --- EXPORT CSV ---
app.post("/api/export/csv", authMiddleware, async (req, res) => {
  const rows = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const headers = [
    "Operatore",
    "Cantiere",
    "Macchina",
    "Linea",
    "Ore",
    "Data",
    "Descrizione",
    "ID",
  ];
  const lines = [];
  lines.push(headers.join(";"));

  for (const e of rows) {
    const line = [
      e.operator ?? "",
      e.cantiere ?? "",
      e.macchina ?? "",
      e.linea ?? "",
      (e.ore ?? "") !== "" ? Number(e.ore).toFixed(2) : "",
      e.data ?? "",
      (e.descrizione ?? "").replace(/\r?\n/g, " "),
      e.id ?? "",
    ]
      .map((v) => String(v).replace(/;/g, ","))
      .join(";");
    lines.push(line);
  }

  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="report.csv"`);
  res.send(csv);
});

// --- EXPORT XLSX ---
app.post("/api/export/xlsx", authMiddleware, async (req, res) => {
  const rows = Array.isArray(req.body?.entries) ? req.body.entries : [];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");

  ws.columns = [
    { header: "Operatore", key: "operator", width: 24 },
    { header: "Cantiere", key: "cantiere", width: 24 },
    { header: "Macchina", key: "macchina", width: 18 },
    { header: "Linea", key: "linea", width: 14 },
    { header: "Ore", key: "ore", width: 10 },
    { header: "Data", key: "data", width: 14 },
    { header: "Descrizione", key: "descrizione", width: 40 },
    { header: "ID", key: "id", width: 10 },
  ];

  for (const e of rows) {
    ws.addRow({
      operator: e.operator ?? "",
      cantiere: e.cantiere ?? "",
      macchina: e.macchina ?? "",
      linea: e.linea ?? "",
      ore: (e.ore ?? "") !== "" ? Number(e.ore).toFixed(2) : "",
      data: e.data ?? "",
      descrizione: e.descrizione ?? "",
      id: e.id ?? "",
    });
  }
  ws.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader("Content-Disposition", 'attachment; filename="report.xlsx"');
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.send(Buffer.from(buf));
});

// --- Avvio ---
app.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});
