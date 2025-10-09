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
    tr.innerHTML = `
      <td>${e.operator ?? ""}</td>
      <td>${e.cantiere ?? ""}</td>
      <td>${e.macchina ?? ""}</td>
      <td>${e.linea ?? ""}</td>
      <td>${Number(e.ore ?? 0).toFixed(2)}</td>
      <td>${e.data ?? ""}</td>
      <td>${e.descrizione ?? ""}</td>
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

// Export CSV/XLSX basati su risultati correnti
async function exportCsv() {
  const entries = window.__lastEntries || [];
  const res = await fetch("/api/export/csv", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + TOKEN,
    },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) {
    const out = await safeJson(res);
    $("loginMsg").textContent = out?.error || "Errore export CSV";
    return;
  }
  const blob = await res.blob();
  downloadBlob(blob, "report.csv");
}

async function exportXlsx() {
  const entries = window.__lastEntries || [];
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
}

// JSON safe
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return { error: "Invalid JSON" };
  }
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
  const panel = $("panel");
  if (panel) panel.classList.remove("d-none");
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
    const panel = $("panel");
    if (panel) panel.classList.remove("d-none");
    search().catch(console.error);
  }

  // Login
  const loginForm = $("loginForm");
  if (loginForm) loginForm.addEventListener("submit", doLogin);

  // Filtri
  const filterForm = $("filterForm");
  if (filterForm) filterForm.addEventListener("submit", search);

  const btnReset = $("btnReset");
  if (btnReset)
    btnReset.addEventListener("click", async () => {
      clearFilters();
      await search();
    });

  // Export
  const btnCsv = $("btnCsv");
  if (btnCsv) btnCsv.addEventListener("click", exportCsv);

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
