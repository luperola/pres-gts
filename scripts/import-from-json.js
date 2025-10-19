import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { query } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function dmyToIso(dmy) {
  const match = dmy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function importEntries() {
  const filePath = path.join(projectRoot, "data", "entries.json");
  const entries = await readJson(filePath, []);
  if (!Array.isArray(entries) || !entries.length) {
    console.log("Nessuna entry da importare");
    return;
  }
  let imported = 0;
  for (const entry of entries) {
    const dataDmy = entry.data ?? entry.data_dmy;
    const iso = dmyToIso(dataDmy);
    if (!iso) continue;
    const id = Number(entry.id);
    if (!Number.isFinite(id)) continue;
    const ore = Number(entry.ore ?? entry.hours);
    if (!Number.isFinite(ore)) continue;
    const descrizione =
      typeof entry.descrizione === "string" ? entry.descrizione : "";
    const location =
      typeof entry.location === "string" && entry.location.trim()
        ? entry.location.trim()
        : null;
    await query(
      `INSERT INTO entries (
         id, operator, cantiere, macchina, linea,
         ore, data_dmy, work_date, descrizione, location
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        entry.operator,
        entry.cantiere,
        entry.macchina,
        entry.linea,
        ore,
        dataDmy,
        iso,
        descrizione,
        location,
      ]
    );
    imported += 1;
  }
  await query(
    `SELECT setval('entries_id_seq', COALESCE((SELECT MAX(id) FROM entries), 0))`
  );
  console.log(`Importate ${imported} entries`);
}

async function importOptions() {
  const filePath = path.join(projectRoot, "data", "operators.json");
  const data = await readJson(filePath, {});
  const categories = ["operators", "cantieri", "macchine", "linee"];
  let imported = 0;
  for (const category of categories) {
    const values = Array.isArray(data[category]) ? data[category] : [];
    for (const raw of values) {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) continue;
      await query(
        `INSERT INTO option_categories (category, value)
         VALUES ($1, $2)
         ON CONFLICT (category, value) DO NOTHING`,
        [category, value]
      );
      imported += 1;
    }
  }
  console.log(`Importate ${imported} opzioni`);
}

async function importUsers() {
  const filePath = path.join(projectRoot, "data", "users.json");
  const users = await readJson(filePath, []);
  if (!Array.isArray(users) || !users.length) {
    console.log("Nessun utente da importare");
    return;
  }
  let imported = 0;
  for (const user of users) {
    const email =
      typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    const passwordHash = user.password || user.password_hash;
    if (!email || !passwordHash) continue;
    const id = user.id || crypto.randomUUID();
    const createdAt = user.createdAt ? new Date(user.createdAt) : new Date();
    await query(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [id, email, passwordHash, createdAt]
    );
    imported += 1;
  }
  console.log(`Importati ${imported} utenti`);
}

async function run() {
  await importEntries();
  await importOptions();
  await importUsers();
  console.log("Import completato");
  process.exit(0);
}

run().catch((err) => {
  console.error("Errore durante l'import", err);
  process.exit(1);
});
