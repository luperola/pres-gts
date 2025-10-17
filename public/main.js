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

function ymdToDmy(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}
function setTodayMaxDate(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const t = new Date();
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  el.max = `${yyyy}-${mm}-${dd}`;
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
  setTodayMaxDate("data");

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/logout-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    const payload = {
      operator: document.getElementById("operator").value.trim(),
      cantiere: document.getElementById("cantiere").value.trim(),
      macchina: document.getElementById("macchina").value.trim(),
      linea: document.getElementById("linea").value.trim(),
      ore: document.getElementById("ore").value.trim(),
      data: ymdToDmy(document.getElementById("data").value.trim()),
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
      msg.innerHTML =
        '<div class="alert alert-success">Registrazione salvata.</div>';
      form.reset();
      setTodayMaxDate("data");
    } else {
      msg.innerHTML = `<div class="alert alert-danger">${
        out.error || "Errore"
      }</div>`;
    }
  });
});
