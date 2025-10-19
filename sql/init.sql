CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY,
  operator TEXT NOT NULL,
  cantiere TEXT NOT NULL,
  macchina TEXT NOT NULL,
  linea TEXT NOT NULL,
  ore NUMERIC(10,2) NOT NULL,
  data_dmy TEXT NOT NULL,
  work_date DATE NOT NULL,
  descrizione TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS option_categories (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE (category, value)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
