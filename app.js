// app.js — ESM completo (fix Windows __dirname + GET /)

import path from "path";
import crypto from "crypto";
import express from "express";
import dotenv from "dotenv";
import ExcelJS from "exceljs";
import bodyParser from "body-parser";
import { fileURLToPath as f2p } from "url";
import fs from "fs/promises";
import xlsx from "xlsx";
import { query } from "./db.js";

dotenv.config();

function tryParseLooseJson(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let candidate = trimmed;
  if (trimmed.length > 1 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    candidate = trimmed.slice(1, -1);
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function coerceBodyToObject(body, rawBody) {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body;
  }

  const candidateString =
    typeof body === "string" && body.trim()
      ? body.trim()
      : typeof rawBody === "string" && rawBody.trim()
      ? rawBody.trim()
      : "";

  if (!candidateString) {
    return {};
  }
  const recoveredJson = tryParseLooseJson(candidateString);
  if (
    recoveredJson &&
    typeof recoveredJson === "object" &&
    !Array.isArray(recoveredJson)
  ) {
    return recoveredJson;
  }

  if (candidateString.includes("=")) {
    const params = new URLSearchParams(candidateString.replace(/^\?/, ""));
    const formObject = {};
    for (const [key, value] of params.entries()) {
      formObject[key] = value;
    }
    if (Object.keys(formObject).length > 0) {
      return formObject;
    }
  }

  return {};
}
function extractCredentials(req) {
  const normalizedBody = coerceBodyToObject(req.body, req.rawBody);
  const user =
    typeof normalizedBody.user === "string"
      ? normalizedBody.user
      : typeof normalizedBody.username === "string"
      ? normalizedBody.username
      : "";
  const pass =
    typeof normalizedBody.pass === "string"
      ? normalizedBody.pass
      : typeof normalizedBody.password === "string"
      ? normalizedBody.password
      : "";
  return { user, pass };
}

const app = express();
app.use(
  bodyParser.json({
    limit: "5mb",
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf.toString(encoding || "utf8");
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    "body" in err &&
    typeof req.rawBody === "string"
  ) {
    const recovered = tryParseLooseJson(req.rawBody);
    if (recovered) {
      req.body = recovered;
      return next();
    }
    return res.status(400).json({ error: "JSON non valido" });
  }
  return next(err);
});
// __dirname in ESM (compatibile Windows)
//const __filename = fileURLToPath(import.meta.url);
const __filename = f2p(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "GTSTrack";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || "pres-gts/1.0 (admin@pres-gts.local)";
let lastNominatimRequestAt = 0;

// --- Static ---
const PUBLIC_DIR = path.join(__dirname, "public");
const INIT_SQL_PATH = path.join(__dirname, "sql", "init.sql");
const OPTION_CATEGORIES = ["operators", "cantieri", "macchine", "linee"];
const OPERATORS_XLSX = path.join(__dirname, "data", "operators.xlsx");
const ALLOWED_BREAK_MINUTES = new Set([0, 30, 60, 90]);

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCoordsFromLocationString(raw) {
  if (typeof raw !== "string") return null;
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function formatNominatimResult(data) {
  if (!data || typeof data !== "object") return null;
  const address =
    typeof data.address === "object" && data.address ? data.address : {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.city_district ||
    null;
  const suburb =
    address.suburb ||
    address.neighbourhood ||
    address.quarter ||
    address.residential ||
    address.city_block ||
    null;
  const road =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.cycleway ||
    address.path ||
    address.service ||
    null;
  const houseNumber = address.house_number || null;
  const province = address.state || address.region || address.county || null;
  const country = address.country || null;

  const parts = [];
  if (road) {
    parts.push(houseNumber ? `${road} ${houseNumber}` : road);
  } else if (suburb) {
    parts.push(suburb);
  }
  if (suburb && !parts.includes(suburb)) {
    parts.push(suburb);
  }
  if (city) {
    parts.push(city);
  }
  if (province && province !== city) {
    parts.push(province);
  }
  if (country) {
    parts.push(country);
  }

  const formatted = parts
    .map((segment) => (typeof segment === "string" ? segment.trim() : ""))
    .filter((segment) => segment.length > 0)
    .join(", ");

  if (formatted) {
    return formatted;
  }

  if (typeof data.display_name === "string" && data.display_name.trim()) {
    const segments = data.display_name
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (segments.length) {
      return segments.slice(0, 4).join(", ");
    }
  }

  if (city && country) {
    return `${city}, ${country}`;
  }
  if (city) {
    return city;
  }
  if (country) {
    return country;
  }
  return null;
}

async function reverseGeocodeCoordinates(lat, lon) {
  const now = Date.now();
  const elapsed = now - lastNominatimRequestAt;
  if (elapsed < 1100) {
    await wait(1100 - elapsed);
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "16");
  url.searchParams.set("addressdetails", "1");

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": NOMINATIM_USER_AGENT,
        "Accept-Language": "it,en",
      },
    });
    lastNominatimRequestAt = Date.now();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return formatNominatimResult(data);
  } catch (err) {
    console.warn("Reverse geocode fallito", err?.message || err);
    return null;
  }
}

async function humanizeLocation(rawLocation, cache = new Map()) {
  const trimmed = typeof rawLocation === "string" ? rawLocation.trim() : "";
  if (!trimmed) return "";
  const coords = extractCoordsFromLocationString(trimmed);
  if (!coords) return trimmed;
  const key = `${coords.lat.toFixed(6)},${coords.lon.toFixed(6)}`;
  if (cache.has(key)) {
    return cache.get(key);
  }
  const label = await reverseGeocodeCoordinates(coords.lat, coords.lon);
  const value = label || trimmed;
  cache.set(key, value);
  return value;
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

async function initializeDatabase() {
  try {
    const sql = await fs.readFile(INIT_SQL_PATH, "utf8");
    if (!sql.trim()) {
      return;
    }
    await query(sql);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn("File init.sql non trovato, nessuna migrazione eseguita.");
      return;
    }
    console.error("Errore durante l'inizializzazione del database", err);
    throw err;
  }
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
function formatDateToDmy(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateToIso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}
function parseTimeStringToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}
function normalizeTimeString(value) {
  const totalMinutes = parseTimeStringToMinutes(value);
  if (totalMinutes === null) return null;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}`;
}

async function createEntryInDb(entry, req) {
  const {
    operator,
    cantiere,
    macchina,
    linea,
    ore,
    dataDmy,
    workDateIso,
    descrizione = "",
    location: locationFromBody,
    startTime = null,
    endTime = null,
    breakMinutes = null,
  } = entry;

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dataDmy)) {
    throw new Error("Formato data non valido (usa DD/MM/YYYY).");
  }
  if (
    typeof workDateIso !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(workDateIso)
  ) {
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

  const normalizedStart = normalizeTimeString(startTime);
  const normalizedEnd = normalizeTimeString(endTime);
  const breakValueRaw =
    breakMinutes === undefined || breakMinutes === null
      ? null
      : Number(breakMinutes);
  const normalizedBreak = Number.isFinite(breakValueRaw)
    ? Number(breakValueRaw)
    : null;

  if (startTime && !normalizedStart) {
    throw new Error("Ora inizio non valida (usa HH:MM).");
  }
  if (endTime && !normalizedEnd) {
    throw new Error("Ora fine non valida (usa HH:MM).");
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
       location,
       start_time,
       end_time,
       break_minutes
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id,
               operator,
               cantiere,
               macchina,
               linea,
               ore::float AS ore,
               to_char(work_date, 'DD/MM/YYYY') AS data,
               descrizione,
                location,
               start_time,
               end_time,
               break_minutes::int AS break_minutes`,
    [
      typeof operator === "string" ? operator.trim() : operator,
      typeof cantiere === "string" ? cantiere.trim() : cantiere,
      typeof macchina === "string" ? macchina.trim() : macchina,
      typeof linea === "string" ? linea.trim() : linea,
      Number(ore),
      dataDmy,
      workDateIso,
      typeof descrizione === "string" ? descrizione.trim() : "",
      normalizedLocation || null,
      normalizedStart,
      normalizedEnd,
      normalizedBreak,
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
             location,
            start_time,
            end_time,
            break_minutes::int AS break_minutes
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
  const { user, pass } = extractCredentials(req);
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
      startTime,
      endTime,
      breakMinutes,
      descrizione,
      location: locationFromBody,
    } = req.body || {};

    if (!operator || !cantiere || !macchina || !linea) {
      return res.status(400).json({
        error: "Tutti i campi sono obbligatori (tranne descrizione).",
      });
    }
    const startMinutes = parseTimeStringToMinutes(startTime);
    if (startMinutes === null) {
      return res
        .status(400)
        .json({ error: "Ora inizio non valida (usa HH:MM)." });
    }
    const endMinutes = parseTimeStringToMinutes(endTime);
    if (endMinutes === null) {
      return res
        .status(400)
        .json({ error: "Ora fine non valida (usa HH:MM)." });
    }
    if (endMinutes <= startMinutes) {
      return res
        .status(400)
        .json({ error: "L'ora di fine deve essere successiva all'inizio." });
    }
    const parsedBreak =
      breakMinutes === undefined || breakMinutes === null
        ? 0
        : Number(breakMinutes);
    if (
      !Number.isFinite(parsedBreak) ||
      !ALLOWED_BREAK_MINUTES.has(parsedBreak)
    ) {
      return res.status(400);
      json({ error: "Seleziona un tempo pausa valido." });
    }
    // ore numerico
    const workedMinutes = endMinutes - startMinutes - parsedBreak;
    if (workedMinutes <= 0) {
      return res
        .status(400)
        .json({ error: "La durata del lavoro deve essere positiva." });
    }

    const ore = Number((workedMinutes / 60).toFixed(2));

    const now = new Date();
    const dataDmy = formatDateToDmy(now);
    const workDateIso = formatDateToIso(now);
    if (!dataDmy || !workDateIso) {
      return res
        .status(500)
        .json({ error: "Impossibile determinare la data corrente." });
    }

    const entry = await createEntryInDb(
      {
        operator,
        cantiere,
        macchina,
        linea,
        ore,
        dataDmy,
        workDateIso,
        descrizione,
        location: locationFromBody,
        startTime,
        endTime,
        breakMinutes: parsedBreak,
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
    "Ora inizio",
    "Ora fine",
    "Pausa (min)",
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
      e.start_time ?? "",
      e.end_time ?? "",
      e.break_minutes ?? "",
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
    { header: "Ora inizio", key: "start_time", width: 12 },
    { header: "Ora fine", key: "end_time", width: 12 },
    { header: "Pausa (min)", key: "break_minutes", width: 12 },
    { header: "Ore", key: "ore", width: 10 },
    { header: "Data", key: "data", width: 14 },
    { header: "Località", key: "location", width: 26 },
    { header: "Descrizione", key: "descrizione", width: 40 },
    { header: "ID", key: "id", width: 10 },
  ];

  const geocodeCache = new Map();
  for (const e of rows) {
    const resolvedLocation = await humanizeLocation(e.location, geocodeCache);
    ws.addRow({
      operator: e.operator ?? "",
      cantiere: e.cantiere ?? "",
      macchina: e.macchina ?? "",
      linea: e.linea ?? "",
      start_time: e.start_time ?? e.startTime ?? "",
      end_time: e.end_time ?? e.endTime ?? "",
      break_minutes: e.break_minutes ?? e.breakMinutes ?? "",
      ore: (e.ore ?? "") !== "" ? Number(e.ore).toFixed(2) : "",
      data: e.data ?? "",
      location: resolvedLocation,
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
initializeDatabase()
  .then(() => ensureOptionSeed())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server attivo su http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Impossibile avviare il server", err);
    process.exit(1);
  });
