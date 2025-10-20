# Presenze App (DD/MM/YYYY)

- Operatori inseriscono: Macchina / Linea / Ore / Data (DD/MM/YYYY) / Descrizione
- Data con **calendar picker**, **no date future**
- Admin con login: filtri (Macchina, Linea, Data da/a, Operatore, Descrizione) + export CSV/Excel

## Migrazione a PostgreSQL

Questa versione sostituisce i file JSON locali con un database PostgreSQL (es. Heroku Postgres).

### 1. Provisionare Heroku Postgres

```bash
heroku login
heroku git:remote -a app-gts-f90c2cb77e39
heroku addons:create heroku-postgresql:mini --app app-gts-f90c2cb77e39
heroku config:get DATABASE_URL
```

Annota il valore di `DATABASE_URL`: servirà sia in locale (file `.env`) sia su Heroku (già configurato automaticamente).

### 2. Configurare l'ambiente locale

1. Crea un file `.env` con:
   ```env
   DATABASE_URL=postgres://user:password@host:port/dbname
   ADMIN_USER=admin # facoltativo
   ADMIN_PASS=GTSTrack # facoltativo
   ```
2. Installa le dipendenze aggiornate:
   ```bash
   npm install
   ```
   (se l'installazione viene bloccata da policy di rete, ripeti il comando in un ambiente con accesso a `registry.npmjs.org`).

### 3. Creare le tabelle

Lo schema è definito in `sql/init.sql`. Per applicarlo:

```bash
psql "$DATABASE_URL" -f sql/init.sql
# oppure, su Heroku
heroku pg:psql < sql/init.sql
```

### 4. Importare i dati storici

Se sono presenti i vecchi file JSON in `data/` esegui:

```bash
npm run import:json
```

Lo script `scripts/import-from-json.js` importa entries, opzioni e utenti preservando gli ID esistenti.

### 5. Avviare l'applicazione

```bash
npm start
```

Su Heroku basta effettuare il deploy (`git push heroku main`) dopo aver aggiornato le variabili d'ambiente.

### 6. Verifiche suggerite

- `/api/entry`: creazione di una nuova presenza (località opzionale, risoluzione automatica su IP pubblico).
- `/api/entries/search`: filtri lato server con PostgreSQL.
- `/api/options`: lettura/scrittura categorie su tabella `option_categories`.
- `/api/register`, `/api/login-user`: utenti persistiti nella tabella `users`.

C:\Users\luigi\OneDrive\Documenti\1 Tests\Codici che funzionano\Test web Pubblicato> curl

Cmdlet Invoke-WebRequest nella posizione 1 della pipeline dei comandi
Specificare i valori per i seguenti parametri:
Uri: http://localhost:3000/api/entry
curl : Impossibile effettuare la connessione al server remoto.
In riga:1 car:1

- curl
- ```
    + CategoryInfo          : InvalidOperation: (System.Net.HttpWebRequest:HttpWebRequest) [Invoke-WebRequest], WebException
    + FullyQualifiedErrorId : WebCmdletWebResponseException,Microsoft.PowerShell.Commands.InvokeWebRequestCommand
  ```

## Nuovi file utili

- `db.js`: connessione centralizzata a PostgreSQL (`pg.Pool`).
- `sql/init.sql`: definizione tabelle (`entries`, `option_categories`, `users`).
- `scripts/import-from-json.js`: import dei vecchi file JSON nel database.
