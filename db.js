import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL non è configurata. Imposta la variabile d'ambiente o crea un file .env."
  );
}

const shouldUseSSL =
  connectionString.includes("amazonaws.com") ||
  process.env.PGSSLMODE === "require" ||
  process.env.NODE_ENV === "production";
const pool = new pg.Pool({
  connectionString,
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
});

export async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
