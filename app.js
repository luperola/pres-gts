// app.js — ESM completo (fix Windows __dirname + GET /)

import path from "path";
import crypto from "crypto";
import express from "express";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import bodyParser from "body-parser";
import { fileURLToPath as f2p } from "url";
import xlsx from "xlsx";
import { query } from "./db.js";

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

const OPTION_CATEGORIES = ["operators", "cantieri", "macchine", "linee"];
const OPERATORS_XLSX = path.join(__dirname, "data", "operators.xlsx");

function extractClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
    ? forwarded.split(",")[0]
    : req.socket?.remoteAddress;
  if (!rawIp) return null;
  const ip = rawIp.replace(/^::ffff:/, "").trim();
  if (!ip) return null;
  if (ip === "127.0.0.1" || ip === "::1") return null;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (
      lower.startsWith("fe80") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    ) {
      return null;
    }
  }
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return null;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (second >= 16 && second <= 31) return null;
  }
  return ip;
}

async function fetchWithTimeout(url, ms = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLocationFromRequest(req) {
  const ip = extractClientIp(req);
  if (!ip) return null;
  const endpoints = [`https://ipapi.co/${ip}/json/`, `https://ipwho.is/${ip}`];
  for (const url of endpoints) {
    try {
      const data = await fetchWithTimeout(url, 2500);
      if (!data) continue;
      const city =
        typeof data.city === "string" && data.city.trim()
          ? data.city.trim()
          : typeof data.town === "string" && data.town.trim()
          ? data.town.trim()
          : null;
      const region =
        typeof data.region === "string" && data.region.trim()
          ? data.region.trim()
          : typeof data.state_prov === "string" && data.state_prov.trim()
          ? data.state_prov.trim()
          : null;
      const country =
        typeof data.country_name === "string" && data.country_name.trim()
          ? data.country_name.trim()
          : null;
      const pieces = [city, region].filter(Boolean);
      if (!pieces.length && country) {
        pieces.push(country);
      } else if (country && city && !region) {
        pieces.push(country);
      }
      if (pieces.length) {
        return pieces.join(", ");
      }
    } catch (err) {
      // ignore endpoint errors and try next
    }
  }
  return null;
}
function normalizeOptionValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sortOptionValues(values) {
  return values.sort((a, b) =>
    a.localeCompare(b, "it", { sensitivity: "base", ignorePunctuation: true })
  );
}

async function fetchOptions() {
  const initial = {
    operators: [],
    cantieri: [],
    macchine: [],
    linee: [],
  };
  const { rows } = await query(
    `SELECT category, value
     FROM option_categories
     ORDER BY category, value`
  );

  for (const row of rows) {
    const category = OPTION_CATEGORIES.includes(row.category)
      ? row.category
      : null;
    const value = normalizeOptionValue(row.value);
    if (!category || !value) continue;
    initial[category].push(value);
  }

  for (const key of OPTION_CATEGORIES) {
    initial[key] = sortOptionValues(
      Array.from(
        new Set(initial[key].map((v) => v.trim()).filter((v) => v.length > 0))
      )
    );
  }
  return initial;
}

async function ensureOptionSeed() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM option_categories WHERE category = 'operators'`
  );
  if (!rows.length || rows[0].count > 0) {
    return;
  }
  try {
    const operators = readOperatorsFromXlsx();
    if (!operators.length) return;
    for (const name of operators) {
      await query(
        `INSERT INTO option_categories (category, value)
         VALUES ('operators', $1)
         ON CONFLICT (category, value) DO NOTHING`,
        [name]
      );
    }
  } catch {
    // ignore se non riusciamo a leggere il file
  }
}

async function addOption(category, value) {
  const normalizedCategoryKey =
    typeof category === "string" ? category.toLowerCase() : "";
  const normalizedCategory = OPTION_CATEGORIES.includes(normalizedCategoryKey)
    ? normalizedCategoryKey
    : null;
  const normalizedValue = normalizeOptionValue(value);
  if (!normalizedCategory || !normalizedValue) {
    throw new Error("Categoria o valore non valido");
  }

  const existing = await query(
    `SELECT id FROM option_categories
     WHERE category = $1 AND LOWER(value) = LOWER($2)
     LIMIT 1`,
    [normalizedCategory, normalizedValue]
  );
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO option_categories (category, value)
       VALUES ($1, $2)
       ON CONFLICT (category, value) DO NOTHING`,
      [normalizedCategory, normalizedValue]
    );
  }
  return fetchOptions();
}

async function deleteOption(category, value) {
  const normalizedCategoryKey =
    typeof category === "string" ? category.toLowerCase() : "";
  const normalizedCategory = OPTION_CATEGORIES.includes(normalizedCategoryKey)
    ? normalizedCategoryKey
    : null;
  const normalizedValue = normalizeOptionValue(value);
  if (!normalizedCategory || !normalizedValue) {
    throw new Error("Categoria o valore non valido");
  }
  const result = await query(
    `DELETE FROM option_categories
     WHERE category = $1 AND LOWER(value) = LOWER($2)
     RETURNING id`,
    [normalizedCategory, normalizedValue]
  );
  if (result.rowCount === 0) {
    const options = await fetchOptions();
    const err = new Error("Voce non trovata");
    err.options = options;
    throw err;
  }
  return fetchOptions();
}

async function findUserByEmail(email) {
  return query(
    `SELECT id, email, password_hash
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email]
  ).then((res) => (res.rows.length ? res.rows[0] : null));
}

async function createUser({ id, email, passwordHash }) {
  await query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3)`,
    [id, email, passwordHash]
  );
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

function dmyToIso(dmy) {
  const m = dmy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

async function createEntryInDb(entry, req) {
  const {
    operator,
    cantiere,
    macchina,
    linea,
    ore,
    data,
    descrizione = "",
    location: locationFromBody,
  } = entry;

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) {
    throw new Error("Formato data non valido (usa DD/MM/YYYY).");
  }
  const workDateIso = dmyToIso(data);
  if (!workDateIso) {
    throw new Error("Formato data non valido (usa DD/MM/YYYY).");
  }

  let normalizedLocation = "";
  if (typeof locationFromBody === "string" && locationFromBody.trim()) {
    normalizedLocation = locationFromBody.trim().slice(0, 120);
  } else {
    const lookedUp = await resolveLocationFromRequest(req);
    if (lookedUp) {
      normalizedLocation = lookedUp.slice(0, 120);
    }
  }

  const { rows } = await query(
    `INSERT INTO entries (
       operator,
       cantiere,
       macchina,
       linea,
       ore,
       data_dmy,
       work_date,
       descrizione,
       location
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id,
               operator,
               cantiere,
               macchina,
               linea,
               ore::float AS ore,
               to_char(work_date, 'DD/MM/YYYY') AS data,
               descrizione,
               location`,
    [
      typeof operator === "string" ? operator.trim() : operator,
      typeof cantiere === "string" ? cantiere.trim() : cantiere,
      typeof macchina === "string" ? macchina.trim() : macchina,
      typeof linea === "string" ? linea.trim() : linea,
      Number(ore),
      data,
      workDateIso,
      typeof descrizione === "string" ? descrizione.trim() : "",
      normalizedLocation || null,
    ]
  );
  return rows[0];
}

function buildTokenClauses(column, value, params) {
  const tokens = String(value)
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const clauses = [];
  for (const token of tokens) {
    params.push(`%${token}%`);
    clauses.push(`${column} ILIKE $${params.length}`);
  }
  return clauses;
}

async function searchEntriesInDb(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.cantiere) {
    clauses.push(...buildTokenClauses("cantiere", filters.cantiere, params));
  }
  if (filters.macchina) {
    params.push(String(filters.macchina));
    clauses.push(`LOWER(macchina) = LOWER($${params.length})`);
  }
  if (filters.linea) {
    params.push(String(filters.linea));
    clauses.push(`LOWER(linea) = LOWER($${params.length})`);
  }
  if (filters.operator) {
    clauses.push(...buildTokenClauses("operator", filters.operator, params));
  }
  if (filters.descrContains) {
    params.push(`%${String(filters.descrContains)}%`);
    clauses.push(`descrizione ILIKE $${params.length}`);
  }
  if (filters.dataFrom) {
    const iso = dmyToIso(filters.dataFrom);
    if (iso) {
      params.push(iso);
      clauses.push(`work_date >= $${params.length}`);
    }
  }
  if (filters.dataTo) {
    const iso = dmyToIso(filters.dataTo);
    if (iso) {
      params.push(iso);
      clauses.push(`work_date <= $${params.length}`);
    }
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT id,
            operator,
            cantiere,
            macchina,
            linea,
            ore::float AS ore,
            to_char(work_date, 'DD/MM/YYYY') AS data,
            descrizione,
            location
     FROM entries
     ${whereClause}
     ORDER BY work_date DESC, id DESC`,
    params
  );
  return rows;
}

async function deleteEntryById(id) {
  const result = await query(`DELETE FROM entries WHERE id = $1 RETURNING id`, [
    id,
  ]);
  return result.rowCount;
}

async function deleteEntriesByIds(ids) {
  const result = await query(
    `DELETE FROM entries WHERE id = ANY($1::bigint[]) RETURNING id`,
    [ids]
  );
  return result.rowCount;
}

ensureOptionSeed().catch((err) => {
  console.error("Impossibile inizializzare le opzioni", err);
});

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

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "Utente già registrato" });
  }
  const newUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash: hashPassword(password),
  };
  try {
    await createUser(newUser);
  } catch (err) {
    return res.status(500).json({ error: "Impossibile registrare l'utente" });
  }
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
  const user = await findUserByEmail(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
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
app.get("/api/geolocation", userAuthMiddleware, async (req, res) => {
  try {
    const location = await resolveLocationFromRequest(req);
    res.json({ location: location || null });
  } catch (err) {
    res.json({ location: null });
  }
});

// static assets (index escluso)
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/api/options", async (req, res) => {
  try {
    await ensureOptionSeed();
    const options = await fetchOptions();
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: "Impossibile leggere le opzioni" });
  }
});

app.post("/api/options", authMiddleware, async (req, res) => {
  const payload = req.body || {};
  if (typeof payload !== "object" || payload === null) {
    return res.status(400).json({ error: "Dati non validi" });
  }
  try {
    await ensureOptionSeed();
    if (payload.category && payload.value !== undefined) {
      await addOption(payload.category, payload.value);
    }
    for (const key of OPTION_CATEGORIES) {
      const values = Array.isArray(payload[key])
        ? payload[key]
        : payload[key]
        ? [payload[key]]
        : [];
      for (const rawValue of values) {
        await addOption(key, rawValue);
      }
    }
    const options = await fetchOptions();
    res.json({ ok: true, options });
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
    await ensureOptionSeed();
    const options = await deleteOption(category, value);
    res.json({ ok: true, options });
  } catch (err) {
    if (err.message === "Voce non trovata") {
      return res
        .status(404)
        .json({ error: "Voce non trovata", options: err.options });
    }
    res.status(500).json({ error: "Impossibile salvare" });
  }
});

app.get("/api/operators", async (req, res) => {
  try {
    await ensureOptionSeed();
    const options = await fetchOptions();
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
    const {
      operator,
      cantiere,
      macchina,
      linea,
      ore,
      data,
      descrizione,
      location: locationFromBody,
    } = req.body || {};
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

    const entry = await createEntryInDb(
      {
        operator,
        cantiere,
        macchina,
        linea,
        ore: numOre,
        data,
        descrizione,
        location: locationFromBody,
      },
      req
    );
    res.json({ ok: true, entry });
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : "Errore salvataggio.";
    res.status(500).json({ error: message });
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

  const entries = await searchEntriesInDb({
    cantiere,
    macchina,
    linea,
    operator,
    descrContains,
    dataFrom,
    dataTo,
  });

  res.json({ entries });
});

// --- DELETE singola riga ---
app.delete("/api/entries/:id", authMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "ID non valido." });

  const deleted = await deleteEntryById(id);
  if (!deleted) {
    return res.status(404).json({ error: "Riga non trovata." });
  }
  res.json({ ok: true, deleted: 1 });
});

// --- DELETE massiva (righe filtrate) ---
app.post("/api/entries/delete-bulk", authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length || ids.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: "Elenco ID non valido." });
  }
  const deleted = await deleteEntriesByIds(ids);
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
    { header: "Località", key: "location", width: 26 },
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
      location: e.location ?? "",
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
