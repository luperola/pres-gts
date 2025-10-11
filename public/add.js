const CATEGORY_CONFIG = {
  operators: {
    label: "operatori",
    addPrep: "agli",
    removePrep: "dagli",
    emptyText: "Nessun operatore inserito.",
  },
  cantieri: {
    label: "cantieri",
    addPrep: "ai",
    removePrep: "dai",
    emptyText: "Nessun cantiere disponibile.",
  },
  macchine: {
    label: "macchine",
    addPrep: "alle",
    removePrep: "dalle",
    emptyText: "Nessuna macchina disponibile.",
  },
  linee: {
    label: "linee",
    addPrep: "alle",
    removePrep: "dalle",
    emptyText: "Nessuna linea disponibile.",
  },
};

let TOKEN = null;
let CURRENT_OPTIONS = {
  operators: [],
  cantieri: [],
  macchine: [],
  linee: [],
};

function setAlert(message, variant = "success") {
  const box = document.getElementById("alert");
  if (!box) return;
  box.innerHTML = "";
  if (!message) {
    return;
  }
  const div = document.createElement("div");
  div.className = `alert alert-${variant}`;
  div.setAttribute("role", "alert");
  div.textContent = message;
  box.appendChild(div);
}

function handleUnauthorized() {
  sessionStorage.removeItem("token");
  window.location.href = "/admin.html";
}

function renderOptions(options) {
  CURRENT_OPTIONS = options;
  for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
    const list = document.querySelector(
      `.option-list[data-category="${category}"]`
    );
    if (!list) continue;
    list.innerHTML = "";
    const values = Array.isArray(options?.[category]) ? options[category] : [];
    if (!values.length) {
      const li = document.createElement("li");
      li.className = "list-group-item text-muted";
      li.textContent = config.emptyText;
      list.appendChild(li);
      continue;
    }
    for (const value of values) {
      const li = document.createElement("li");
      li.className =
        "list-group-item d-flex justify-content-between align-items-center";
      const span = document.createElement("span");
      span.textContent = value;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm btn-outline-danger";
      btn.textContent = "Rimuovi";
      btn.dataset.category = category;
      btn.dataset.value = value;
      li.append(span, btn);
      list.appendChild(li);
    }
  }
}

async function fetchOptions() {
  const res = await fetch("/api/options");
  if (!res.ok) throw new Error("Impossibile caricare le liste");
  const options = await res.json();
  renderOptions(options);
}

async function addOption(category, value, inputEl) {
  const res = await fetch("/api/options", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify({ category, value }),
  });
  if (res.status === 401) {
    handleUnauthorized();
    return;
  }
  const out = await res.json().catch(() => ({ error: "Errore" }));
  if (!res.ok) {
    setAlert(out.error || "Impossibile aggiungere", "danger");
    return;
  }
  renderOptions(out.options || CURRENT_OPTIONS);
  const cfg = CATEGORY_CONFIG[category] || {};
  const label = cfg.label || category;
  const addPrep = cfg.addPrep || "in";
  setAlert(
    out.created
      ? `Voce aggiunta ${addPrep} ${label}.`
      : `La voce è già presente ${addPrep} ${label}.`,
    out.created ? "success" : "info"
  );
  if (inputEl) {
    inputEl.value = "";
    inputEl.focus();
  }
}

async function removeOption(category, value) {
  const res = await fetch("/api/options", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify({ category, value }),
  });
  if (res.status === 401) {
    handleUnauthorized();
    return;
  }
  const out = await res.json().catch(() => ({ error: "Errore" }));
  if (!res.ok) {
    setAlert(out.error || "Impossibile eliminare", "danger");
    return;
  }
  renderOptions(out.options || CURRENT_OPTIONS);
  const cfg = CATEGORY_CONFIG[category] || {};
  const label = cfg.label || category;
  const removePrep = cfg.removePrep || "da";
  setAlert(`Voce rimossa ${removePrep} ${label}.`, "success");
}

document.addEventListener("DOMContentLoaded", () => {
  TOKEN = sessionStorage.getItem("token");
  if (!TOKEN) {
    handleUnauthorized();
    return;
  }

  document.querySelectorAll(".option-form").forEach((form) => {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const category = form.dataset.category;
      const input = form.querySelector("input");
      const value = input?.value?.trim();
      if (!category || !value) return;
      addOption(category, value, input).catch((err) => {
        console.error(err);
        setAlert("Errore durante l'aggiunta", "danger");
      });
    });
  });

  document.querySelectorAll(".option-list").forEach((list) => {
    list.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button");
      if (!btn) return;
      const category = btn.dataset.category;
      const value = btn.dataset.value;
      if (!category || !value) return;
      const cfg = CATEGORY_CONFIG[category] || {};
      const label = cfg.label || category;
      const removePrep = cfg.removePrep || "da";
      if (
        !window.confirm(
          `Confermi la rimozione di "${value}" ${removePrep} ${label}?`
        )
      ) {
        return;
      }
      removeOption(category, value).catch((err) => {
        console.error(err);
        setAlert("Errore durante la rimozione", "danger");
      });
    });
  });

  fetchOptions().catch((err) => {
    console.error(err);
    setAlert("Impossibile caricare le liste", "danger");
  });
});
