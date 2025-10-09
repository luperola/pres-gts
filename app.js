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
app.use(express.static(PUBLIC_DIR));

// Rotta esplicita per la home: serve public/index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// --- Storage helpers (entries.json) ---
const ENTRIES_PATH = path.join(__dirname, "data", "entries.json");

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

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const [, token] = h.split(" ");
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
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

// Legge data/operators.xlsx (colonna OPERATORI) e restituisce la lista
const OPERATORS_XLSX = path.join(__dirname, "data", "operators.xlsx");

app.get("/api/operators", (req, res) => {
  try {
    const wb = xlsx.readFile(OPERATORS_XLSX);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    const operators = rows
      .map((r) => String(r.OPERATORI || "").trim())
      .filter(Boolean);
    res.json({ operators });
  } catch (err) {
    res.json({ operators: [] });
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
