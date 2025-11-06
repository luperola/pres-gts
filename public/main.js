function populateSelect(select, values) {
  if (!select) return;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleziona";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
}
async function loadOptions() {
  try {
    const res = await fetch("/api/options");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    populateSelect(document.getElementById("operator"), data.operators || []);
    populateSelect(document.getElementById("cantiere"), data.cantieri || []);
    populateSelect(document.getElementById("macchina"), data.macchine || []);
    populateSelect(document.getElementById("linea"), data.linee || []);
  } catch (err) {
    console.error("Impossibile caricare le opzioni", err);
    populateSelect(document.getElementById("operator"), []);
    populateSelect(document.getElementById("cantiere"), []);
    populateSelect(document.getElementById("macchina"), []);
    populateSelect(document.getElementById("linea"), []);
  }
}

function parseTimeToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}
function formatMinutesToReadableTime(minutes) {
  const totalMinutes = Math.max(0, Math.round(Number(minutes)));
  if (!Number.isFinite(totalMinutes)) {
    return "0 minuti";
  }
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "ora" : "ore"}`);
  }
  if (remainingMinutes > 0) {
    parts.push(
      `${remainingMinutes} ${remainingMinutes === 1 ? "minuto" : "minuti"}`
    );
  }
  if (!parts.length) {
    return "0 minuti";
  }
  return parts.join(" e ");
}

document.addEventListener("DOMContentLoaded", () => {
  const geoInput = document.getElementById("geoLocation");
  const geoBanner = document.getElementById("geoConsentBanner");
  const geoBannerMessage = document.getElementById("geoConsentMessage");
  const geoBannerStatus = document.getElementById("geoConsentStatus");
  const geoBannerButton = document.getElementById("requestLocationBtn");
  let cachedLocation = "";
  let pendingLocationPromise = null;

  function setLocation(value) {
    cachedLocation = typeof value === "string" ? value.trim() : "";
    if (geoInput) {
      geoInput.value = cachedLocation;
    }
  }
  function updateGeoStatus(text = "") {
    if (!geoBannerStatus) return;
    if (text) {
      geoBannerStatus.textContent = text;
      geoBannerStatus.classList.remove("d-none");
    } else {
      geoBannerStatus.textContent = "";
      geoBannerStatus.classList.add("d-none");
    }
  }

  function showGeoBanner(message, { status = "", showButton = true } = {}) {
    if (!geoBanner) return;
    geoBanner.classList.remove("d-none");
    if (geoBannerMessage && message) {
      geoBannerMessage.textContent = message;
    }
    updateGeoStatus(status);
    if (geoBannerButton) {
      if (showButton) {
        geoBannerButton.classList.remove("d-none");
        geoBannerButton.disabled = false;
      } else {
        geoBannerButton.classList.add("d-none");
      }
    }
  }

  function hideGeoBanner() {
    if (!geoBanner) return;
    geoBanner.classList.add("d-none");
    updateGeoStatus("");
  }

  async function fetchLocation() {
    try {
      const res = await fetch("/api/geolocation", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return;
      const data = await res.json();

      if (!cachedLocation && typeof data?.location === "string") {
        setLocation(data.location);
      }
    } catch (err) {
      console.warn("Impossibile ottenere la geolocalizzazione dal server", err);
    }
  }

  async function requestBrowserLocation() {
    if (!navigator?.geolocation) {
      throw new Error("Geolocalizzazione non supportata");
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords || {};
          const coords = [latitude, longitude]
            .map((v) =>
              typeof v === "number" && Number.isFinite(v) ? v.toFixed(6) : null
            )
            .filter((v) => v !== null);
          if (!coords.length) {
            reject(new Error("Coordinate non disponibili"));
            return;
          }
          let label = coords.join(", ");
          if (
            typeof accuracy === "number" &&
            Number.isFinite(accuracy) &&
            accuracy > 0
          ) {
            label += ` (±${Math.round(accuracy)}m)`;
          }
          resolve(label);
        },
        (err) => {
          reject(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }

  function describeGeoError(err) {
    const defaultMessage = {
      message:
        "Non è stato possibile ottenere automaticamente la posizione dal browser.",
      status:
        "Verifica le impostazioni del dispositivo e prova di nuovo a concedere l'autorizzazione.",
      showButton: true,
    };
    if (!err || typeof err !== "object") {
      return defaultMessage;
    }
    if (err.code === 1 || err.PERMISSION_DENIED === err.code) {
      return {
        message: "La richiesta di geolocalizzazione è stata bloccata.",
        status:
          'Consenti l\'accesso alla posizione dalle impostazioni del browser e poi clicca su "Attiva geolocalizzazione".',
        showButton: true,
      };
    }
    if (err.code === 2 || err.POSITION_UNAVAILABLE === err.code) {
      return {
        message: "Il dispositivo non riesce a rilevare la posizione.",
        status:
          "Controlla che GPS o servizi di posizione siano attivi e riprova.",
        showButton: true,
      };
    }
    if (err.code === 3 || err.TIMEOUT === err.code) {
      return {
        message: "Il tentativo di ottenere la posizione è scaduto.",
        status: "Assicurati di avere segnale sufficiente e riprova.",
        showButton: true,
      };
    }
    if (typeof err.message === "string" && /secure/i.test(err.message)) {
      return {
        message:
          "Il browser richiede una connessione sicura (HTTPS) per la geolocalizzazione.",
        status:
          "Apri la pagina tramite HTTPS o da localhost, poi riprova a consentire l'accesso alla posizione.",
        showButton: true,
      };
    }
    return defaultMessage;
  }

  async function obtainBrowserLocation({ forcePrompt = false } = {}) {
    if (!navigator?.geolocation) {
      showGeoBanner("Questo dispositivo non supporta la geolocalizzazione.", {
        status:
          "I dati verranno salvati senza coordinate. Se possibile usa un dispositivo compatibile.",
        showButton: false,
      });
      return null;
    }
    if (cachedLocation && !forcePrompt) {
      return cachedLocation;
    }
    if (pendingLocationPromise) {
      return pendingLocationPromise;
    }
    if (geoBannerButton) {
      geoBannerButton.disabled = true;
    }
    showGeoBanner(
      "Stiamo tentando di rilevare automaticamente la tua posizione...",
      { status: "Attendi qualche secondo.", showButton: false }
    );
    pendingLocationPromise = requestBrowserLocation()
      .then((location) => {
        setLocation(location);
        hideGeoBanner();
        return location;
      })
      .catch((err) => {
        const info = describeGeoError(err);
        showGeoBanner(info.message, {
          status: info.status,
          showButton: info.showButton,
        });
        return null;
      })
      .finally(() => {
        if (geoBannerButton) {
          geoBannerButton.disabled = false;
        }
        pendingLocationPromise = null;
      });
    return pendingLocationPromise;
  }

  async function initGeolocation() {
    const tryFetchLocation = () => {
      obtainBrowserLocation().catch(() => {
        // errore già gestito in obtainBrowserLocation
      });
    };

    if (navigator?.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: "geolocation",
        });
        const handleState = (state) => {
          if (state === "granted") {
            hideGeoBanner();
            obtainBrowserLocation();
          } else if (state === "prompt") {
            showGeoBanner(
              "Consenti alla pagina di accedere alla tua posizione per registrare le presenze.",
              {
                status:
                  'Quando compare la finestra del browser scegli "Consenti".',
                showButton: true,
              }
            );
            tryFetchLocation();
          } else {
            showGeoBanner(
              "La geolocalizzazione è disabilitata per questo sito.",
              {
                status:
                  'Sblocca l\'autorizzazione dalle impostazioni del browser e poi premi "Attiva geolocalizzazione".',
                showButton: true,
              }
            );
          }
        };
        handleState(status.state);
        status.onchange = () => handleState(status.state);
        return;
      } catch (err) {
        console.warn("Impossibile verificare lo stato dei permessi", err);
      }
    }

    showGeoBanner(
      "Consenti alla pagina di accedere alla tua posizione per registrare le presenze.",
      {
        status: 'Quando compare la finestra del browser scegli "Consenti".',
        showButton: true,
      }
    );
    tryFetchLocation();
  }

  if (geoBannerButton) {
    geoBannerButton.addEventListener("click", () => {
      obtainBrowserLocation({ forcePrompt: true }).then((location) => {
        if (!location) {
          fetchLocation();
        }
      });
    });
  }

  initGeolocation();
  fetchLocation();
  const optionsLoadedPromise = loadOptions();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/logout-user", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch (err) {
        console.error("Errore durante il logout", err);
      } finally {
        window.location.href = "/register.html";
      }
    });
  }

  const form = document.getElementById("entryForm");
  const msg = document.getElementById("msg");
  const startBtn = document.getElementById("startWorkBtn");
  const endBtn = document.getElementById("endWorkBtn");
  const breakWrapper = document.getElementById("breakWrapper");
  const breakSelect = document.getElementById("pausa");
  const workStatusEl = document.getElementById("workStatus");
  const activeEntryInput = document.getElementById("activeEntryId");
  const resetBtn = document.getElementById("resetBtn");
  const operatorSelect = document.getElementById("operator");
  const cantiereSelect = document.getElementById("cantiere");
  const macchinaSelect = document.getElementById("macchina");
  const lineaSelect = document.getElementById("linea");
  const descrizioneInput = document.getElementById("descrizione");

  let activeEntry = null;
  let statusTimeoutId = null;

  function showAlert(type, text) {
    if (!msg) return;
    msg.innerHTML = `<div class="alert alert-${type}">${text}</div>`;
  }

  function clearAlert() {
    if (msg) {
      msg.innerHTML = "";
    }
  }

  function setStatusText(text, { timeout = 0 } = {}) {
    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
      statusTimeoutId = null;
    }
    if (workStatusEl) {
      workStatusEl.textContent = text || "";
      if (text && timeout > 0) {
        statusTimeoutId = setTimeout(() => {
          if (workStatusEl.textContent === text) {
            workStatusEl.textContent = "";
          }
        }, timeout);
      }
    }
  }

  function ensureSelectValue(select, value) {
    if (!select) return;
    const normalized = typeof value === "string" ? value : "";
    if (!normalized) {
      select.value = "";
      return;
    }
    const existing = Array.from(select.options).find(
      (opt) => opt.value === normalized
    );
    if (!existing) {
      const opt = new Option(normalized, normalized, true, true);
      select.appendChild(opt);
    }
    select.value = normalized;
  }

  function updateStartButtonState() {
    if (!startBtn) return;
    const values = [
      operatorSelect?.value,
      cantiereSelect?.value,
      macchinaSelect?.value,
      lineaSelect?.value,
    ];
    const canStart = values.every((v) => typeof v === "string" && v.trim());
    startBtn.disabled = !canStart || Boolean(activeEntry);
  }

  function updateUiForEntry(entry) {
    activeEntry = entry && entry.id ? entry : null;
    if (activeEntryInput) {
      activeEntryInput.value = activeEntry ? String(activeEntry.id) : "";
    }
    const hasEntry = Boolean(activeEntry);

    if (startBtn) {
      startBtn.classList.toggle("d-none", hasEntry);
      startBtn.disabled = hasEntry;
    }
    if (endBtn) {
      endBtn.classList.toggle("d-none", !hasEntry);
      endBtn.disabled = !hasEntry;
    }
    if (breakWrapper) {
      breakWrapper.classList.toggle("d-none", !hasEntry);
    }
    if (resetBtn) {
      resetBtn.disabled = hasEntry;
    }

    const selects = [
      operatorSelect,
      cantiereSelect,
      macchinaSelect,
      lineaSelect,
    ];
    selects.forEach((select) => {
      if (!select) return;
      select.disabled = hasEntry;
      if (!hasEntry && !select.value) {
        select.value = "";
      }
    });

    if (!hasEntry && breakSelect) {
      breakSelect.value = "0";
    }

    if (hasEntry && activeEntry.start_time) {
      const dateLabel = activeEntry.data ? ` del ${activeEntry.data}` : "";
      setStatusText(
        `Turno avviato alle ${activeEntry.start_time}${dateLabel}.`,
        { timeout: 0 }
      );
    } else if (!hasEntry) {
      setStatusText('Premi "Inizio lavoro" per registrare l\'orario.', {
        timeout: 0,
      });
    }

    updateStartButtonState();
  }

  function populateFormFromEntry(entry) {
    ensureSelectValue(operatorSelect, entry?.operator ?? "");
    ensureSelectValue(cantiereSelect, entry?.cantiere ?? "");
    ensureSelectValue(macchinaSelect, entry?.macchina ?? "");
    ensureSelectValue(lineaSelect, entry?.linea ?? "");
    if (descrizioneInput) {
      descrizioneInput.value = entry?.descrizione ?? "";
    }
    if (breakSelect) {
      if (entry?.break_minutes !== undefined && entry.break_minutes !== null) {
        breakSelect.value = String(entry.break_minutes);
      } else {
        breakSelect.value = "0";
      }
    }
  }

  function getCurrentTimeString() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  async function safeJson(res) {
    try {
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async function fetchStatusForOperatorValue(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      updateUiForEntry(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/entry/status?operator=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const entry = data?.entry ?? null;
      if (entry) {
        await optionsLoadedPromise;
        populateFormFromEntry(entry);
      }
      updateUiForEntry(entry);
      clearAlert();
    } catch (err) {
      console.error("Impossibile recuperare lo stato turno", err);
      showAlert(
        "warning",
        "Impossibile verificare se esiste un turno aperto. Riprova."
      );
      updateUiForEntry(null);
    }
  }

  async function resolveLocationForAction({ forcePrompt = false } = {}) {
    try {
      const loc = await obtainBrowserLocation({ forcePrompt });
      if (loc) {
        setLocation(loc);
        return loc;
      }
    } catch (err) {
      // handled downstream
    }
    const fallback =
      (geoInput?.value || cachedLocation || "").toString().trim() || null;
    return fallback;
  }
  async function handleStartClick() {
    if (!form) return;
    clearAlert();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (activeEntry) {
      return;
    }
    const operatorValue = operatorSelect?.value.trim();
    const cantiereValue = cantiereSelect?.value.trim();
    const macchinaValue = macchinaSelect?.value.trim();
    const lineaValue = lineaSelect?.value.trim();
    const descrizioneValue = descrizioneInput?.value.trim() ?? "";

    let locationValue = await resolveLocationForAction({ forcePrompt: false });

    const payload = {
      operator: operatorValue,
      cantiere: cantiereValue,
      macchina: macchinaValue,
      linea: lineaValue,
      startTime: getCurrentTimeString(),
      descrizione: descrizioneValue,
      location: locationValue,
    };
    startBtn.disabled = true;
    try {
      const res = await fetch("/api/entry/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        if (res.status === 409 && data?.entry) {
          await optionsLoadedPromise;
          populateFormFromEntry(data.entry);
          updateUiForEntry(data.entry);
        }
        showAlert("danger", data?.error || "Impossibile avviare il turno.");
        return;
      }
      const entry = data?.entry || null;
      if (entry) {
        await optionsLoadedPromise;
        populateFormFromEntry(entry);
      }
      updateUiForEntry(entry);
      showAlert(
        "success",
        entry?.start_time
          ? `Inizio lavoro registrato alle ${entry.start_time}.`
          : "Inizio lavoro registrato."
      );
    } catch (err) {
      console.error("Errore durante l'avvio turno", err);
      showAlert(
        "danger",
        "Impossibile registrare l'inizio del lavoro. Controlla la connessione e riprova."
      );
    } finally {
      updateStartButtonState();
    }
  }

  async function handleFinishClick() {
    if (!form || !activeEntry) {
      showAlert("warning", "Non ci sono turni aperti da chiudere.");
      return;
    }
    clearAlert();

    const breakValueRaw = Number(breakSelect?.value ?? "0");
    if (![0, 30, 60, 90].includes(breakValueRaw)) {
      showAlert("danger", "Seleziona un valore di pausa valido.");
      return;
    }

    const descrizioneValue = descrizioneInput?.value.trim() ?? "";
    let locationValue = await resolveLocationForAction({ forcePrompt: false });

    endBtn.disabled = true;
    try {
      const payload = {
        entryId: activeEntry.id,
        endTime: getCurrentTimeString(),
        breakMinutes: breakValueRaw,
        descrizione: descrizioneValue,
        location: locationValue,
      };
      const res = await fetch("/api/entry/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        showAlert("danger", data?.error || "Impossibile chiudere il turno.");
        return;
      }
      const entry = data?.entry || null;
      const oreValue = Number(entry?.ore);
      const oreWorked = Number.isFinite(oreValue)
        ? formatMinutesToReadableTime(Math.round(oreValue * 60))
        : "";
      showAlert(
        "success",
        oreWorked
          ? `Fine lavoro registrata. Ore lavorate: ${oreWorked}`
          : "Fine lavoro registrata."
      );
      form.reset();
      setLocation(cachedLocation);
      updateUiForEntry(null);
      setStatusText(
        entry?.end_time
          ? `Turno concluso alle ${entry.end_time}.`
          : "Turno concluso.",
        { timeout: 10000 }
      );
    } catch (err) {
      console.error("Errore durante la chiusura turno", err);
      showAlert(
        "danger",
        "Impossibile registrare la fine del lavoro. Controlla la connessione e riprova."
      );
    } finally {
      if (endBtn) endBtn.disabled = false;
      updateStartButtonState();
    }
  }

  if (operatorSelect) {
    operatorSelect.addEventListener("change", () => {
      const value = operatorSelect.value;
      fetchStatusForOperatorValue(value);
      updateStartButtonState();
    });
  }

  [cantiereSelect, macchinaSelect, lineaSelect].forEach((select) => {
    if (!select) return;
    select.addEventListener("change", () => {
      updateStartButtonState();
    });
  });

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      handleStartClick().catch((err) => {
        console.error("Errore inatteso start", err);
      });
    });
  }

  if (endBtn) {
    endBtn.addEventListener("click", () => {
      handleFinishClick().catch((err) => {
        console.error("Errore inatteso finish", err);
      });
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (activeEntry) {
        showAlert("warning", "Completa il turno prima di annullare i campi.");
        return;
      }
      if (form) {
        form.reset();
        setLocation(cachedLocation);
      }
      clearAlert();
      setStatusText("Campi ripristinati.", { timeout: 5000 });
      updateStartButtonState();
    });
  }

  optionsLoadedPromise
    .then(() => {
      updateStartButtonState();
    })
    .catch((err) => {
      console.warn("Impossibile caricare le opzioni", err);
    });

  updateUiForEntry(null);
});
