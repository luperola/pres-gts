// === admin.js (versione completa) ===
let TOKEN = null;
const $ = (id) => document.getElementById(id);

// YYYY-MM-DD -> DD/MM/YYYY (per i campi <input type="date">)
function ymdToDmy(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
}

// Limita le date future
function setTodayMaxDate(inputId) {
  const el = $(inputId);
  if (!el) return;
  const t = new Date();
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  el.max = `${yyyy}-${mm}-${dd}`;
}

// Download helper
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setExportLoading(isLoading) {
  const btn = $("btnXlsx");
  const spinner = $("spinnerXlsx");
  const label = $("btnXlsxLabel");

  if (btn) {
    btn.disabled = isLoading;
  }

  if (spinner) {
    spinner.classList.toggle("d-none", !isLoading);
  }

  if (label) {
    if (!label.dataset.defaultText) {
      label.dataset.defaultText = label.textContent || "Export Excel";
    }
    label.textContent = isLoading
      ? "Preparazione..."
      : label.dataset.defaultText;
  }
}

function debounce(fn, delay = 300) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Pulisce i filtri ai valori vuoti
function clearFilters() {
  const ids = [
    "f-cantiere",
    "f-macchina",
    "f-linea",
    "f-operator",
    "f-descr",
    "f-from",
    "f-to",
  ];
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (el.tagName === "SELECT") el.selectedIndex = 0;
    else el.value = "";
  });
}

// Rende la tabella e aggiunge la colonna Azioni (Elimina)
function renderTable(entries) {
  const tbody = document.querySelector("#tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  for (const e of entries) {
    const tr = document.createElement("tr");
    const oreValue =
      e.ore !== undefined && e.ore !== null ? Number(e.ore) : null;
    const oreLabel =
      oreValue !== null && !Number.isNaN(oreValue) ? oreValue.toFixed(2) : "";
    const breakLabel =
      e.break_minutes !== undefined && e.break_minutes !== null
        ? e.break_minutes
        : "";
    const transferLabel =
      e.transfer_minutes !== undefined && e.transfer_minutes !== null
        ? e.transfer_minutes
        : "";
    tr.innerHTML = `
     <td class="text-nowrap">${e.operator ?? ""}</td>
      <td class="text-nowrap">${e.cantiere ?? ""}</td>
      <td class="text-nowrap">${e.macchina ?? ""}</td>
      <td class="text-nowrap">${e.linea ?? ""}</td>
      <td class="text-nowrap">${e.start_time ?? ""}</td>
      <td class="text-nowrap">${e.end_time ?? ""}</td>
      <td class="text-nowrap">${breakLabel}</td>
       <td class="text-nowrap">${transferLabel}</td>
      <td class="text-nowrap">${oreLabel}</td>
           <td class="text-nowrap">${e.data ?? ""}</td>
      <td class="text-break">${e.descrizione ?? ""}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger btn-del" data-id="${
          e.id
        }">Elimina</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  // salva ultimo set per export/cancellazione massiva
  window.__lastEntries = entries;
}

// Esegue la ricerca con i filtri correnti
async function search(ev) {
  if (ev) ev.preventDefault();
  if (!TOKEN) return;

  const macchina = $("f-macchina")?.value || "";
  const linea = $("f-linea")?.value || "";
  const operator = $("f-operator")?.value || "";
  const cantiere = $("f-cantiere")?.value || "";
  const descrContains = $("f-descr")?.value || "";
  const dataFrom = $("f-from")?.value ? ymdToDmy($("f-from").value) : "";
  const dataTo = $("f-to")?.value ? ymdToDmy($("f-to").value) : "";

  const body = {
    cantiere: cantiere || null,
    macchina: macchina || null,
    linea: linea || null,
    operator: operator || null,
    descrContains: descrContains || null,
    dataFrom: dataFrom || null,
    dataTo: dataTo || null,
  };

  const res = await fetch("/api/entries/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const out = await safeJson(res);
    $("loginMsg").textContent = out?.error || "Errore ricerca";
    return;
  }

  const out = await res.json();
  renderTable(Array.isArray(out.entries) ? out.entries : []);
}

// Cancella una singola riga (conferma)
async function deleteById(id) {
  if (!window.confirm("Confermi la cancellazione della riga?")) return;

  const res = await fetch(`/api/entries/${id}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + TOKEN },
  });

  const out = await safeJson(res);
  if (!res.ok) {
    $("loginMsg").textContent = out?.error || "Errore cancellazione riga";
    return;
  }
  await search();
}

// Cancella tutte le righe attualmente filtrate (conferma)
async function deleteFiltered() {
  const entries = window.__lastEntries || [];
  if (!entries.length) {
    alert("Non ci sono righe filtrate da cancellare.");
    return;
  }
  if (
    !window.confirm(
      `Confermi la cancellazione di ${entries.length} righe filtrate?`
    )
  )
    return;

  const ids = entries
    .map((e) => e.id)
    .filter((v) => v !== undefined && v !== null);
  const res = await fetch("/api/entries/delete-bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify({ ids }),
  });

  const out = await safeJson(res);
  if (!res.ok) {
    $("loginMsg").textContent = out?.error || "Errore cancellazione massiva";
    return;
  }
  await search();
}

async function exportXlsx() {
  const entries = window.__lastEntries || [];
  setExportLoading(true);
  try {
    const res = await fetch("/api/export/xlsx", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + TOKEN,
      },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) {
      const out = await safeJson(res);
      $("loginMsg").textContent = out?.error || "Errore export Excel";
      return;
    }
    const blob = await res.blob();
    downloadBlob(blob, "report.xlsx");
  } catch (error) {
    console.error("Errore export Excel", error);
    $("loginMsg").textContent = "Errore export Excel";
  } finally {
    setExportLoading(false);
  }
}

// JSON safe
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return { error: "Invalid JSON" };
  }
}

function showAdminArea() {
  const panel = $("panel");
  if (panel) panel.classList.remove("d-none");
  const adminLinks = $("adminLinks");
  if (adminLinks) adminLinks.classList.remove("d-none");
}

// Login admin -> salva token e mostra pannello
async function doLogin(ev) {
  ev.preventDefault();
  const user = $("user")?.value || "";
  const pass = $("pass")?.value || "";
  $("loginMsg").textContent = "";

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, pass }),
  });

  const out = await safeJson(res);
  if (!res.ok || !out?.token) {
    $("loginMsg").textContent = out?.error || "Credenziali non valide";
    return;
  }

  TOKEN = out.token;
  // persisto per la sessione corrente
  sessionStorage.setItem("token", TOKEN);

  // mostra pannello e carica dati
  showAdminArea();
  $("loginMsg").textContent = "Login ok";
  await search();
}

document.addEventListener("DOMContentLoaded", () => {
  // Blocca date future
  setTodayMaxDate("f-from");
  setTodayMaxDate("f-to");

  // Prova a riprendere token dalla sessione (se già loggato)
  TOKEN = sessionStorage.getItem("token") || null;
  if (TOKEN) {
    showAdminArea();
    search().catch(console.error);
  }

  // Login
  const loginForm = $("loginForm");
  if (loginForm) loginForm.addEventListener("submit", doLogin);

  // Filtri
  const filterForm = $("filterForm");
  if (filterForm) filterForm.addEventListener("submit", search);

  const autoFilterIds = ["f-operator", "f-macchina", "f-linea", "f-cantiere"];
  const debouncedSearch = debounce(() => {
    search().catch(console.error);
  }, 300);
  autoFilterIds.forEach((id) => {
    const input = $(id);
    if (input) input.addEventListener("input", debouncedSearch);
  });

  const btnReset = $("btnReset");
  if (btnReset)
    btnReset.addEventListener("click", async () => {
      clearFilters();
      await search();
    });

  // Export
  const btnXlsx = $("btnXlsx");
  if (btnXlsx) btnXlsx.addEventListener("click", exportXlsx);

  // Elimina filtrati
  const btnDeleteFiltered = $("btnDeleteFiltered");
  if (btnDeleteFiltered)
    btnDeleteFiltered.addEventListener("click", deleteFiltered);

  // Delego l'eliminazione singola sulla tabella
  const tbody = document.querySelector("#tbl tbody");
  if (tbody) {
    tbody.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-del");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      if (id) deleteById(id);
    });
  }
});
