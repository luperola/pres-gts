function populateSelect(select, values) {
  if (!select) return;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Seleziona...";
  select.appendChild(placeholder);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
}

function populateDatalist(list, values) {
  if (!list) return;
  list.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    list.appendChild(opt);
  }
}

async function loadOptions() {
  try {
    const res = await fetch("/api/options");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    populateSelect(document.getElementById("operator"), data.operators || []);
    populateDatalist(
      document.getElementById("cantiereList"),
      data.cantieri || []
    );
    populateDatalist(
      document.getElementById("macchinaList"),
      data.macchine || []
    );
    populateDatalist(document.getElementById("lineaList"), data.linee || []);
  } catch (err) {
    console.error("Impossibile caricare le opzioni", err);
    populateSelect(document.getElementById("operator"), []);
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
  loadOptions();
  setTodayMaxDate("data");

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
