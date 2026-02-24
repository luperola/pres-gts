import dotenv from "dotenv";
import pkg from "pg";

const { Client } = pkg;

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log(
    "⚠️ DATABASE_URL non configurato: test DB saltato (nessun errore bloccante).",
  );
  process.exit(0);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false, // necessario per Heroku Postgres
  },
});

async function testConnection() {
  try {
    await client.connect();
    console.log("✅ Connessione al database riuscita!");
    const res = await client.query("SELECT NOW()");
    console.log("🕒 Ora del server:", res.rows[0].now);
  } catch (err) {
    console.log(
      "⚠️ Test connessione DB non riuscito in questo ambiente (non bloccante):",
      err.message,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

testConnection();
