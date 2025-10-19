import dotenv from "dotenv";
import pkg from "pg";
const { Client } = pkg;

dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
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
    console.error("❌ Errore di connessione:", err.message);
  } finally {
    await client.end();
  }
}

testConnection();
