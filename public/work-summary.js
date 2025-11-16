const STORAGE_KEY = "workSummaryData";
const SUMMARY_MAX_AGE = 15 * 60 * 1000; // 15 minuti

(function () {
  const dom = {};
  let summaryData = null;

  document.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    summaryData = readSummaryData();
    renderSummary(summaryData);
    if (!summaryData) {
      if (dom.validateBtn) {
        dom.validateBtn.disabled = true;
      }
      return;
    }
    if (dom.validateBtn) {
      dom.validateBtn.addEventListener("click", handleValidateClick);
    }
  });

  function cacheDom() {
    dom.text = document.getElementById("workSummaryText");
    dom.error = document.getElementById("workSummaryError");
    dom.comment = document.getElementById("workSummaryComment");
    dom.validateBtn = document.getElementById("validateSummaryBtn");
    dom.status = document.getElementById("validationStatus");
  }

  function readSummaryData() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const timestamp = Number(parsed.timestamp);
      if (
        Number.isFinite(timestamp) &&
        Date.now() - timestamp > SUMMARY_MAX_AGE
      ) {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn("Impossibile leggere il riepilogo finale", err);
      return null;
    }
  }

  function renderSummary(data) {
    if (!dom.text || !dom.error) return;
    if (!data) {
      dom.text.textContent = "";
      dom.error.textContent =
        "Non sono disponibili dati da validare. Torna alla schermata principale.";
      dom.error.classList.remove("d-none");
      return;
    }
    const hoursLabel = data.hoursLabel || "0 minuti";
    const cantiere = data.cantiere || "N/D";
    const macchina = data.macchina || "N/D";
    const parts = [
      `Ore di lavoro effettuate: ${hoursLabel}`,
      `presso cantiere di ${cantiere}`,
      `equipment ${macchina}`,
    ];
    if (data.workDate) {
      parts.push(`in data ${data.workDate}`);
    }
    dom.text.textContent = parts.join(", ") + ".";
    dom.error.classList.add("d-none");
  }

  async function handleValidateClick(event) {
    event.preventDefault();
    if (!dom.validateBtn) return;
    dom.validateBtn.disabled = true;
    updateStatus("Validazione in corso...");
    const comment = dom.comment?.value.trim();
    if (comment) {
      console.info("Commento utente registrato localmente", comment);
    }
    try {
      await fetch("/api/logout-user", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (err) {
      console.warn("Logout non riuscito durante la validazione finale", err);
    } finally {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    updateStatus("Grazie! Il sito verrà chiuso.");
    closeSite();
  }

  function updateStatus(message) {
    if (!dom.status) return;
    dom.status.textContent = message || "";
  }

  function closeSite() {
    const blankWindow = window.open("", "_self");
    if (blankWindow) {
      blankWindow.close();
    }
    setTimeout(() => {
      window.location.replace("/register.html");
    }, 300);
  }
})();
