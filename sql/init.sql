CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY,
  operator TEXT NOT NULL,
  cantiere TEXT NOT NULL,
  macchina TEXT NOT NULL,
  linea TEXT NOT NULL,
  ore NUMERIC(10,2) NOT NULL,
  data_dmy TEXT NOT NULL,
  work_date DATE NOT NULL,
  setLocation(cachedLocation);
      if (breakSelect) {
        breakSelect.value = String(breakValue);
      }
  descrizione TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS start_time TEXT;

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS end_time TEXT;

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER;

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
