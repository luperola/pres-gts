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
  let cachedLocation = "";

  function setLocation(value) {
    cachedLocation = typeof value === "string" ? value.trim() : "";
    if (geoInput) {
      geoInput.value = cachedLocation;
    }
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
      if (typeof data?.location === "string") {
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

  requestBrowserLocation()
    .then((location) => {
      setLocation(location);
    })
    .catch((err) => {
      console.warn("Geolocalizzazione browser non disponibile", err);
      fetchLocation();
    });
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
