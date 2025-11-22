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
const DEFAULT_PORT = 3000;
const envPortRaw = typeof process.env.PORT === "string" ? process.env.PORT : "";
const parsedEnvPort = Number.parseInt(envPortRaw, 10);
const HAS_VALID_ENV_PORT = Number.isFinite(parsedEnvPort) && parsedEnvPort >= 0;
const PREFERRED_PORT = HAS_VALID_ENV_PORT ? parsedEnvPort : DEFAULT_PORT;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "GTSTrack";
const MAX_PORT_RETRIES_BEFORE_RANDOM = 3;
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || "pres-gts/1.0 (admin@pres-gts.local)";
let lastNominatimRequestAt = 0;

// --- Static ---
const PUBLIC_DIR = path.join(__dirname, "public");
const INIT_SQL_PATH = path.join(__dirname, "sql", "init.sql");
const OPTION_CATEGORIES = ["operators", "cantieri", "macchine", "linee"];
const OPERATORS_XLSX = path.join(__dirname, "data", "operators.xlsx");
const OPERATORS_JSON = path.join(__dirname, "data", "operators.json");
const ALLOWED_BREAK_MINUTES = new Set([0, 30, 60, 90]);
const MINUTES_IN_DAY = 24 * 60;
function coalesce(value, fallback) {
  return value !== undefined && value !== null ? value : fallback;
}

function extractClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
    ? forwarded.split(",")[0]
    : req.socket && req.socket.remoteAddress;
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

function normalizeLocationString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 160);
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
    const errorMessage = err && err.message ? err.message : err;
    console.warn("Reverse geocode fallito", errorMessage);
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

function normalizeOperatorKey(value) {
  if (typeof value !== "string") return "";
  return value
    .toLocaleLowerCase("it-IT")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function normalizePersonName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function buildFullName(firstName, lastName) {
  const parts = [
    normalizePersonName(firstName),
    normalizePersonName(lastName),
  ].filter(Boolean);
  return parts.join(" ");
}

function findOperatorMatch(operators, fullName) {
  if (!Array.isArray(operators) || !fullName) return null;
  const normalizedTarget = fullName.toLowerCase();
  return (
    operators.find((name) => {
      if (typeof name !== "string") return false;
      return name.trim().toLowerCase() === normalizedTarget;
    }) || null
  );
}

let cachedCanonicalOperators = null;

async function loadCanonicalOperators() {
  if (cachedCanonicalOperators) return cachedCanonicalOperators;
  let list = [];
  try {
    const raw = await fs.readFile(OPERATORS_JSON, "utf8");
    const data = JSON.parse(raw);
    list = Array.isArray(data?.operators)
      ? data.operators
          .map((name) => (typeof name === "string" ? name.trim() : ""))
          .filter(Boolean)
      : [];
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn("Impossibile leggere operators.json", err);
    }
  }
  const map = new Map(list.map((name) => [normalizeOperatorKey(name), name]));
  cachedCanonicalOperators = { list, map };
  return cachedCanonicalOperators;
}

function buildLoginKey(firstName, lastName) {
  const fullName = buildFullName(firstName, lastName);
  return fullName ? fullName.toLowerCase() : "";
}
function sortOptionValues(values) {
  return values.sort((a, b) =>
    a.localeCompare(b, "it", { sensitivity: "base", ignorePunctuation: true })
  );
}

async function fetchOptions() {
  const { map: canonicalOperatorMap } = await loadCanonicalOperators();
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
    const values = Array.from(
      new Set(initial[key].map((v) => v.trim()).filter((v) => v.length > 0))
    );
    if (key === "operators" && canonicalOperatorMap.size) {
      initial[key] = sortOptionValues(
        values.map((value) => {
          const normalized = normalizeOperatorKey(value);
          return canonicalOperatorMap.get(normalized) || value;
        })
      );
    } else {
      initial[key] = sortOptionValues(values);
    }
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
    const { list: canonicalOperators } = await loadCanonicalOperators();
    const operators = canonicalOperators.length
      ? canonicalOperators
      : readOperatorsFromXlsx();
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

async function findUserByLoginKey(loginKey) {
  const normalizedKey =
    typeof loginKey === "string" ? loginKey.trim().toLowerCase() : "";
  if (!normalizedKey) return null;
  return query(
    `SELECT id, email, password_hash, first_name, last_name, operator_name
     FROM users
      WHERE LOWER(email) = $1
     LIMIT 1`,
    [normalizedKey]
  ).then((res) => (res.rows.length ? res.rows[0] : null));
}

async function findUserById(id) {
  return query(
    `SELECT id, email, first_name, last_name, operator_name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id]
  ).then((res) => (res.rows.length ? res.rows[0] : null));
}

async function createUser({
  id,
  loginKey,
  passwordHash,
  firstName = null,
  lastName = null,
  operatorName = null,
}) {
  const normalizedLoginKey =
    typeof loginKey === "string" ? loginKey.trim().toLowerCase() : "";
  if (!normalizedLoginKey) {
    throw new Error("Chiave di login non valida");
  }
  await query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, operator_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, normalizedLoginKey, passwordHash, firstName, lastName, operatorName]
  );
}

async function updateUser({
  id,
  passwordHash,
  firstName = null,
  lastName = null,
  operatorName = null,
}) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (typeof passwordHash === "string" && passwordHash) {
    fields.push(`password_hash = $${idx}`);
    values.push(passwordHash);
    idx += 1;
  }
  fields.push(`first_name = $${idx}`);
  values.push(firstName);
  idx += 1;
  fields.push(`last_name = $${idx}`);
  values.push(lastName);
  idx += 1;
  fields.push(`operator_name = $${idx}`);
  values.push(operatorName);
  idx += 1;

  values.push(id);
  await query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${idx}`,
    values
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
  const hasValue = typeof dmy === "string";
  const m = hasValue ? dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
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

function calculateShiftDurationMinutes(startMinutes, endMinutes) {
  if (
    typeof startMinutes !== "number" ||
    Number.isNaN(startMinutes) ||
    typeof endMinutes !== "number" ||
    Number.isNaN(endMinutes)
  ) {
    return null;
  }
  let adjustedEnd = endMinutes;
  if (endMinutes <= startMinutes) {
    adjustedEnd += MINUTES_IN_DAY;
  }
  const diff = adjustedEnd - startMinutes;
  return diff > 0 ? diff : null;
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
    startLocation = null,
    endLocation = null,
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

  const preferredStartLocation = coalesce(
    startLocation,
    coalesce(locationFromBody, "")
  );
  const normalizedPreferredStart = normalizeLocationString(
    preferredStartLocation
  );

  let normalizedLocation = normalizedPreferredStart;
  if (!normalizedLocation) {
    const lookedUp = await resolveLocationFromRequest(req);
    if (lookedUp) {
      normalizedLocation = normalizeLocationString(lookedUp);
    }
  }

  const normalizedStartLocation =
    normalizedPreferredStart || normalizedLocation || "";
  const normalizedEndLocation = normalizeLocationString(
    coalesce(endLocation, "")
  );

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
       break_minutes,
       start_location,
       end_location
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
               break_minutes::int AS break_minutes,
               start_location,
               end_location`,

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
      normalizedStartLocation || null,
      normalizedEndLocation || null,
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
    clauses.push(...buildTokenClauses("macchina", filters.macchina, params));
  }
  if (filters.linea) {
    clauses.push(...buildTokenClauses("linea", filters.linea, params));
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
            break_minutes::int AS break_minutes,
            start_location,
            end_location
     FROM entries
     ${whereClause}
     ORDER BY work_date DESC, id DESC`,
    params
  );
  return rows;
}

async function fetchEntryById(id) {
  const { rows } = await query(
    `SELECT id,
            operator,
            cantiere,
            macchina,
            linea,
            ore::float AS ore,
            to_char(work_date, 'DD/MM/YYYY') AS data,
            work_date,
            descrizione,
            location,
            start_time,
            end_time,
            break_minutes::int AS break_minutes,
            start_location,
            end_location
     FROM entries
     WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function findOpenEntryForOperator(operator) {
  if (!operator) return null;
  const { rows } = await query(
    `SELECT id,
            operator,
            cantiere,
            macchina,
            linea,
            ore::float AS ore,
            to_char(work_date, 'DD/MM/YYYY') AS data,
            work_date,
            descrizione,
            location,
            start_time,
            end_time,
            break_minutes::int AS break_minutes,
            start_location,
            end_location
     FROM entries
     WHERE lower(operator) = lower($1)
       AND end_time IS NULL
     ORDER BY work_date DESC, id DESC
     LIMIT 1`,
    [operator]
  );
  return rows[0] || null;
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
  const cookieToken = cookies && cookies.userToken;
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

app.post("/api/register", registerUserHandler);

async function registerUserHandler(req, res) {
  const { password, firstName, lastName } = req.body || {};
  const normalizedFirstName = normalizePersonName(firstName);
  const normalizedLastName = normalizePersonName(lastName);
  const loginKey = buildLoginKey(normalizedFirstName, normalizedLastName);
  if (!loginKey || !password || password.length < 6) {
    return res.status(400).json({ error: "Dati non validi" });
  }
  await ensureOptionSeed();
  const options = await fetchOptions();
  const fullName = buildFullName(normalizedFirstName, normalizedLastName);
  const matchedOperator = findOperatorMatch(options.operators || [], fullName);
  if (!matchedOperator) {
    return res.status(400).json({
      error:
        "Non è stato possibile associare il tuo nome a un operatore. Verifica di aver inserito nome e cognome corretti o contatta l'amministratore.",
    });
  }

  const existing = await findUserByLoginKey(loginKey);
  const operatorName = matchedOperator.toUpperCase();
  const passwordHash = hashPassword(password);
  if (existing) {
    try {
      await updateUser({
        id: existing.id,
        passwordHash,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        operatorName,
      });
    } catch (err) {
      return res.status(500).json({ error: "Impossibile aggiornare l'utente" });
    }
    issueUserToken(res, existing.id);
    return res.json({ ok: true, updated: true });
  }

  const newUser = {
    id: crypto.randomUUID(),
    loginKey,
    passwordHash,
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    operatorName,
  };
  try {
    await createUser(newUser);
  } catch (err) {
    return res.status(500).json({ error: "Impossibile registrare l'utente" });
  }
  issueUserToken(res, newUser.id);
  return res.json({ ok: true });
}
app.post("/api/login-user", async (req, res) => {
  const { password, firstName, lastName } = req.body || {};
  const normalizedFirstName = normalizePersonName(firstName);
  const normalizedLastName = normalizePersonName(lastName);
  const loginKey = buildLoginKey(normalizedFirstName, normalizedLastName);
  if (!loginKey || !password) {
    return res.status(400).json({ error: "Dati non validi" });
  }
  const user = await findUserByLoginKey(loginKey);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Credenziali non valide" });
  }
  issueUserToken(res, user.id);
  return res.json({ ok: true });
});

app.post("/api/reset-password", async (req, res) => {
  const { password, firstName, lastName } = req.body || {};
  const normalizedFirstName = normalizePersonName(firstName);
  const normalizedLastName = normalizePersonName(lastName);
  const loginKey = buildLoginKey(normalizedFirstName, normalizedLastName);
  if (!loginKey || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Dati non validi" });
  }

  const options = await fetchOptions();
  const fullName = buildFullName(normalizedFirstName, normalizedLastName);
  const matchedOperator = findOperatorMatch(options.operators || [], fullName);
  if (!matchedOperator) {
    return res.status(400).json({
      error:
        "Non è stato possibile associare il tuo nome a un operatore. Verifica di aver inserito nome e cognome corretti o contatta l'amministratore.",
    });
  }

  const user = await findUserByLoginKey(loginKey);
  if (!user) {
    return res
      .status(404)
      .json({ error: "Nessun account trovato per i dati inseriti" });
  }

  const passwordHash = hashPassword(password);
  try {
    await updateUser({
      id: user.id,
      passwordHash,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      operatorName: matchedOperator.toUpperCase(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Impossibile aggiornare la password. Riprova più tardi.",
    });
  }

  issueUserToken(res, user.id);
  return res.json({ ok: true, reset: true });
});

app.post("/api/logout-user", async (req, res) => {
  const token = getUserTokenFromReq(req);
  clearUserToken(res, token);
  res.json({ ok: true });
});

app.get("/api/user/profile", userAuthMiddleware, async (req, res) => {
  const userId = req.userInfo ? req.userInfo.userId : undefined;
  if (!userId) {
    return res.status(401).json({ error: "Utente non autenticato" });
  }
  try {
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ error: "Utente non trovato" });
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        operatorName:
          typeof user.operator_name === "string"
            ? user.operator_name.trim().toUpperCase()
            : "",
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Impossibile recuperare il profilo utente" });
  }
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
  const bodyCategory = req.body && req.body.category;
  const bodyValue = req.body && req.body.value;
  const category = String(bodyCategory || "").toLowerCase();
  const value = typeof bodyValue === "string" ? bodyValue.trim() : "";
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
app.get("/api/entry/status", async (req, res) => {
  const operatorParam = req.query && req.query.operator;
  const operator =
    typeof operatorParam === "string" ? operatorParam.trim() : "";
  if (!operator) {
    return res.status(400).json({ error: "Operatore non valido." });
  }
  try {
    const entry = await findOpenEntryForOperator(operator);
    res.json({ entry: entry || null });
  } catch (err) {
    console.error("Status entry error", err);
    res.status(500).json({ error: "Impossibile recuperare lo stato." });
  }
});

app.post("/api/entry/start", async (req, res) => {
  try {
    const {
      operator: operatorRaw,
      cantiere: cantiereRaw,
      macchina: macchinaRaw,
      linea: lineaRaw,
      descrizione,
      startTime,
      location: locationFromBody,
    } = req.body || {};

    const operator = typeof operatorRaw === "string" ? operatorRaw.trim() : "";
    const cantiere = typeof cantiereRaw === "string" ? cantiereRaw.trim() : "";
    const macchina = typeof macchinaRaw === "string" ? macchinaRaw.trim() : "";
    const linea = typeof lineaRaw === "string" ? lineaRaw.trim() : "";

    if (!operator || !cantiere || !macchina || !linea) {
      return res.status(400).json({
        error: "Compila tutti i campi obbligatori prima di avviare il lavoro.",
      });
    }

    const normalizedStart = normalizeTimeString(startTime);
    if (!normalizedStart) {
      return res
        .status(400)
        .json({ error: "Ora inizio non valida (usa HH:MM)." });
    }

    const existing = await findOpenEntryForOperator(operator);
    if (existing) {
      return res.status(409).json({
        error: "Esiste già un turno aperto per questo operatore.",
        entry: existing,
      });
    }

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
        ore: 0,
        dataDmy,
        workDateIso,
        descrizione,
        location: locationFromBody,
        startTime: normalizedStart,
        endTime: null,
        breakMinutes: null,
        startLocation: locationFromBody,
        endLocation: null,
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

app.post("/api/entry/finish", async (req, res) => {
  try {
    const {
      entryId: entryIdRaw,
      endTime,
      breakMinutes,
      location: endLocationRaw,
      descrizione,
    } = req.body || {};

    const entryId = Number(entryIdRaw);
    if (!Number.isFinite(entryId) || entryId <= 0) {
      return res.status(400).json({ error: "ID turno non valido." });
    }

    const entry = await fetchEntryById(entryId);
    if (!entry) {
      return res.status(404).json({ error: "Turno non trovato." });
    }
    if (entry.end_time) {
      return res
        .status(400)
        .json({ error: "Questo turno è già stato chiuso." });
    }
    if (!entry.start_time) {
      return res.status(400).json({
        error: "Il turno non ha un orario di inizio valido.",
      });
    }

    const normalizedEnd = normalizeTimeString(endTime);
    if (!normalizedEnd) {
      return res
        .status(400)
        .json({ error: "Ora fine non valida (usa HH:MM)." });
    }

    const startMinutes = parseTimeStringToMinutes(entry.start_time);
    const endMinutes = parseTimeStringToMinutes(normalizedEnd);
    if (startMinutes === null || endMinutes === null) {
      return res
        .status(400)
        .json({ error: "Impossibile calcolare la durata del turno." });
    }

    const parsedBreak =
      breakMinutes === undefined || breakMinutes === null
        ? 0
        : Number(breakMinutes);
    if (
      !Number.isFinite(parsedBreak) ||
      !ALLOWED_BREAK_MINUTES.has(parsedBreak)
    ) {
      return res
        .status(400)
        .json({ error: "Seleziona un tempo pausa valido." });
    }

    const elapsedMinutes = calculateShiftDurationMinutes(
      startMinutes,
      endMinutes
    );
    if (elapsedMinutes === null) {
      return res.status(400).json({
        error: "L'ora di fine deve essere successiva all'inizio.",
      });
    }

    const workedMinutes = elapsedMinutes - parsedBreak;
    if (workedMinutes <= 0) {
      return res.status(400).json({
        error: "La durata del lavoro deve essere positiva.",
      });
    }

    const ore = Number((workedMinutes / 60).toFixed(2));

    let normalizedEndLocation = normalizeLocationString(
      coalesce(endLocationRaw, "")
    );
    if (!normalizedEndLocation) {
      const fallback = await resolveLocationFromRequest(req);
      if (fallback) {
        normalizedEndLocation = normalizeLocationString(fallback);
      }
    }

    const sanitizedDescrizione =
      typeof descrizione === "string"
        ? descrizione.trim()
        : typeof entry.descrizione === "string"
        ? entry.descrizione
        : "";

    const { rows } = await query(
      `UPDATE entries
       SET end_time = $2,
           break_minutes = $3,
           ore = $4,
           descrizione = $5,
           end_location = $6,
           location = COALESCE(location, start_location, $6)
       WHERE id = $1
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
                 break_minutes::int AS break_minutes,
                 start_location,
                 end_location`,
      [
        entryId,
        normalizedEnd,
        parsedBreak,
        ore,
        sanitizedDescrizione,
        normalizedEndLocation || null,
      ]
    );

    const updated = rows[0];
    if (!updated) {
      return res
        .status(500)
        .json({ error: "Impossibile aggiornare il turno." });
    }

    res.json({ ok: true, entry: updated });
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : "Errore salvataggio.";
    res.status(500).json({ error: message });
  }
});

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
    const elapsedMinutes = calculateShiftDurationMinutes(
      startMinutes,
      endMinutes
    );
    if (elapsedMinutes === null) {
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
      return res
        .status(400)
        .json({ error: "Seleziona un tempo pausa valido." });
    }
    // ore numerico
    const workedMinutes = elapsedMinutes - parsedBreak;
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
        startLocation: locationFromBody,
        endLocation: locationFromBody,
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
  const idsPayload = req.body && req.body.ids;
  const ids = Array.isArray(idsPayload) ? idsPayload.map(Number) : [];
  if (!ids.length || ids.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: "Elenco ID non valido." });
  }
  const deleted = await deleteEntriesByIds(ids);
  res.json({ ok: true, deleted });
});

// --- EXPORT CSV ---
app.post("/api/export/csv", authMiddleware, async (req, res) => {
  const entriesPayload = req.body && req.body.entries;
  const rows = Array.isArray(entriesPayload) ? entriesPayload : [];
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
    "Geo inizio",
    "Geo fine",
    "Descrizione",
    "ID",
  ];
  const lines = [];
  lines.push(headers.join(";"));

  for (const e of rows) {
    const line = [
      coalesce(e.operator, ""),
      coalesce(e.cantiere, ""),
      coalesce(e.macchina, ""),
      coalesce(e.linea, ""),
      coalesce(e.start_time, ""),
      coalesce(e.end_time, ""),
      coalesce(e.break_minutes, ""),
      coalesce(e.ore, "") !== "" ? Number(e.ore).toFixed(2) : "",
      coalesce(e.data, ""),
      coalesce(coalesce(e.start_location, e.location), ""),
      coalesce(e.end_location, ""),
      coalesce(e.descrizione, "").replace(/\r?\n/g, " "),
      coalesce(e.id, ""),
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
  const entriesPayload = req.body && req.body.entries;
  const rows = Array.isArray(entriesPayload) ? entriesPayload : [];

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
    { header: "Geo inizio", key: "start_location", width: 26 },
    { header: "Geo fine", key: "end_location", width: 26 },
    { header: "Descrizione", key: "descrizione", width: 40 },
    { header: "ID", key: "id", width: 10 },
  ];

  const geocodeCache = new Map();
  for (const e of rows) {
    const resolvedStartLocation = await humanizeLocation(
      e.start_location ?? e.location,
      geocodeCache
    );
    const resolvedEndLocation = await humanizeLocation(
      e.end_location,
      geocodeCache
    );
    ws.addRow({
      operator: coalesce(e.operator, ""),
      cantiere: coalesce(e.cantiere, ""),
      macchina: coalesce(e.macchina, ""),
      linea: coalesce(e.linea, ""),
      start_time: coalesce(coalesce(e.start_time, e.startTime), ""),
      end_time: coalesce(coalesce(e.end_time, e.endTime), ""),
      break_minutes: coalesce(coalesce(e.break_minutes, e.breakMinutes), ""),
      ore: coalesce(e.ore, "") !== "" ? Number(e.ore).toFixed(2) : "",
      data: coalesce(e.data, ""),
      start_location: resolvedStartLocation,
      end_location: resolvedEndLocation,
      descrizione: coalesce(e.descrizione, ""),
      id: coalesce(e.id, ""),
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
function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = app
      .listen(port)
      .once("listening", () => resolve(server))
      .once("error", reject);
  });
}
async function startServerWithRetry() {
  let attempt = 0;
  while (true) {
    //const portToTry = useRandomPort ? 0 : PREFERRED_PORT;
    const useRandomPort =
      !HAS_VALID_ENV_PORT && attempt >= MAX_PORT_RETRIES_BEFORE_RANDOM;
    const targetPort = PREFERRED_PORT;
    const portToTry = useRandomPort ? 0 : targetPort;

    try {
      const server = await listenOnPort(portToTry);
      const addressInfo = server.address();
      const activePort =
        typeof addressInfo === "object" && addressInfo && addressInfo.port
          ? addressInfo.port
          : targetPort;
      const entryUrl = `http://localhost:${activePort}`;
      console.log(`Server attivo su ${entryUrl}`);
      /* console.log(
        `Porta ${activePort} attiva: puoi entrare nel sito con Ctrl+Click in ${entryUrl}`
      ); */
      //console.log(`Server attivo su http://localhost:${activePort}`);
      server.on("error", (err) => {
        console.error("Errore del server", err);
        process.exit(1);
      });
      return server;
    } catch (err) {
      const errorCode = err && err.code;
      if (errorCode !== "EADDRINUSE") {
        throw err;
      }

      console.error(
        `Porta ${targetPort} già in uso. ${
          HAS_VALID_ENV_PORT
            ? "Imposta la variabile di ambiente PORT o chiudi l'altra applicazione che utilizza la porta."
            : "Chiudi l'altra applicazione che la utilizza o attendi che si liberi."
        }`
      );

      if (HAS_VALID_ENV_PORT) {
        throw err;
      }

      attempt += 1;
      const waitTimeMs = Math.min(1000 * attempt, 5000);
      console.log(
        `Riprovo automaticamente la porta ${targetPort} tra ${waitTimeMs}ms...`
      );
      await wait(waitTimeMs);
    }
  }
}
async function bootstrap() {
  await initializeDatabase();
  await ensureOptionSeed();
  await startServerWithRetry();
}

bootstrap().catch((err) => {
  console.error("Impossibile avviare il server", err);
  process.exit(1);
});
