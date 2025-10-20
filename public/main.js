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
function formatMinutesToHours(minutes) {
  if (!Number.isFinite(minutes)) return "0.00";
  return (minutes / 60).toFixed(2);
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
  loadOptions();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/logout-user", {
          method: "POST",
          //headers: { "Content-Type": "application/json" },
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
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const startTimeRaw = document.getElementById("oraInizio").value.trim();
    const endTimeRaw = document.getElementById("oraFine").value.trim();
    const breakSelect = document.getElementById("pausa");
    const breakMinutes = Number(breakSelect?.value ?? "0");

    const startMinutes = parseTimeToMinutes(startTimeRaw);
    const endMinutes = parseTimeToMinutes(endTimeRaw);

    if (startMinutes === null || endMinutes === null) {
      msg.innerHTML =
        '<div class="alert alert-danger">Inserisci orari validi (HH:MM).</div>';
      return;
    }
    if (endMinutes <= startMinutes) {
      msg.innerHTML =
        "<div class=\"alert alert-danger\">L'ora di fine deve essere successiva all'inizio.</div>";
      return;
    }
    const validBreak = [0, 30, 60, 90];
    const breakValue = Number.isFinite(breakMinutes) ? breakMinutes : 0;
    if (!validBreak.includes(breakValue)) {
      msg.innerHTML =
        '<div class="alert alert-danger">Seleziona un valore di pausa valido.</div>';
      return;
    }

    const workedMinutes = endMinutes - startMinutes - breakValue;
    if (workedMinutes <= 0) {
      msg.innerHTML =
        '<div class="alert alert-danger">La durata del lavoro deve essere positiva.</div>';
      return;
    }

    const payload = {
      operator: document.getElementById("operator").value.trim(),
      cantiere: document.getElementById("cantiere").value.trim(),
      macchina: document.getElementById("macchina").value.trim(),
      linea: document.getElementById("linea").value.trim(),
      startTime: startTimeRaw,
      endTime: endTimeRaw,
      breakMinutes: breakValue,
      descrizione: document.getElementById("descrizione").value.trim(),
      location:
        (geoInput?.value || cachedLocation || "").toString().trim() || null,
    };
    const res = await fetch("/api/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (res.ok) {
      const oreWorked =
        typeof out?.entry?.ore === "number"
          ? out.entry.ore.toFixed(2)
          : formatMinutesToHours(workedMinutes);
      msg.innerHTML = `<div class="alert alert-success">Registrazione salvata. Ore lavorate: ${oreWorked}</div>`;
      form.reset();
      setLocation(cachedLocation);
      if (breakSelect) {
        breakSelect.value = String(breakValue);
      }
    } else {
      msg.innerHTML = `<div class="alert alert-danger">${
        out.error || "Errore"
      }</div>`;
    }
  });
});
