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

- `/api/entry/start` e `/api/entry/finish`: apertura e chiusura turno con registrazione geolocalizzata (fallback automatico da IP pubblico se necessario).
- `/api/entry`: creazione diretta di una presenza completa (per compatibilità con l'interfaccia precedente).
- `/api/entries/search`: filtri lato server con PostgreSQL.
- `/api/options`: lettura/scrittura categorie su tabella `option_categories`.
- `/api/register`, `/api/login-user`: utenti persistiti nella tabella `users`.

### 7. Appendix: comandi PowerShell passo-passo (Windows)

Quando lavori in PowerShell è consigliabile usare `curl.exe` (per evitare l'alias `curl` → `Invoke-WebRequest`). Sequenza completa:

1. **Verifica la connessione al database** (facoltativo):

   ```powershell
   npm test
   ```

   Lo script esegue `node test-db.js` e mostra `✅ Connessione al database riuscita!` se `DATABASE_URL` è valido.

2. **Avvia il server** nella prima finestra PowerShell:

   ```powershell
   npm start
   ```

   L'app ascolta sulla porta indicata da `PORT` (default `3000`).

3. **Ottieni un token admin** da una seconda finestra PowerShell:

   ```powershell
    $response = curl.exe -s -X POST http://localhost:3000/api/login `
     -H "Content-Type: application/json" `
     -d '{"user":"admin","pass":"GTSTrack"}'
   $json = $response | ConvertFrom-Json
   $token = $json.token
   $json
   ```

   L'opzione `-s` disattiva la progress bar di `curl.exe` (che altrimenti invaliderebbe il JSON ricevuto) e consente a `ConvertFrom-Json` di funzionare correttamente. In PowerShell il carattere di continuazione è il backtick `` ` `` (non `^`, valido solo in `cmd.exe`). Assicurati che il backtick sia l'ultimissimo carattere sulla riga (nessuno spazio dopo `` ` ``); in caso contrario la riga successiva verrebbe interpretata come un nuovo comando e produrrebbe errori come `-H : Termine '-H' non riconosciuto...`.

   Se preferisci evitare le continuazioni di riga, puoi eseguire lo stesso comando tutto su una riga:

   ```powershell
   $response = curl.exe -s -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"user":"admin","pass":"GTSTrack"}'
   $json = $response | ConvertFrom-Json
   $token = $json.token
   $json
   ```

   L'endpoint risponde con un oggetto del tipo `{"token":"<32 caratteri esadecimali>"}`. Se non vedi alcun output, esegui
   manualmente `Write-Output $json` o semplicemente `$json` per stampare la risposta JSON e verificare che il token sia stato
   creato correttamente.

Se l'API risponde `{"error":"JSON non valido"}`, significa che il server non riesce a leggere il corpo come JSON. Controlla che:

- Il server sia effettivamente in esecuzione su `http://localhost:3000` (in caso contrario potresti ricevere una pagina HTML o un 404).
- La chiamata usi `curl.exe` con le virgolette dritte `"` e senza caratteri speciali aggiunti da PowerShell; per sicurezza puoi usare la forma a riga singola copiata sopra.
- Le credenziali siano quelle di amministratore (`user: admin`, `pass: GTSTrack` a meno che non le abbia cambiate via variabili d'ambiente `ADMIN_USER`/`ADMIN_PASS`).

4. **Interroga `/api/entries/search` usando il token ottenuto**:

   ```powershell
   curl.exe -X POST http://localhost:3000/api/entries/search `
     -H "Content-Type: application/json" `
     -H "Authorization: Bearer $token" `
     -d '{}'
   ```

   Sostituisci sempre il segnaposto con il token reale; in caso contrario l'API risponde `{"error":"Unauthorized"}`.

5. **Interrompi il server** tornando alla finestra con `npm start` e premendo `Ctrl+C`. Se, rilanciando il comando, ottieni l'errore `EADDRINUSE`, significa che un'altra istanza è ancora attiva: individua il processo con `Get-NetTCPConnection -LocalPort 3000 | Select-Object -ExpandProperty OwningProcess` e termina l'ID corrispondente con `Stop-Process -Id <PID>`.

## Nuovi file utili

- `db.js`: connessione centralizzata a PostgreSQL (`pg.Pool`).
- `sql/init.sql`: definizione tabelle (`entries`, `option_categories`, `users`).
- `scripts/import-from-json.js`: import dei vecchi file JSON nel database.
