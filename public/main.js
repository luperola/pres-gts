(function () {
  const dom = {};
  const state = {
    activeEntry: null,
    pendingStart: null,
    pendingFinish: null,
    statusTimeoutId: null,
    cachedLocation: "",
    pendingLocationPromise: null,
    optionsLoaded: Promise.resolve(),
    currentProfile: null,
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    attachEventListeners();
    setupGeolocation();
    state.optionsLoaded = loadInitialData();
    updateStartButtonState();
    updateEndButtonState();
    updateUiForEntry(null);
  }

  function cacheDom() {
    dom.form = document.getElementById("entryForm");
    dom.msg = document.getElementById("msg");
    dom.logoutBtn = document.getElementById("logoutBtn");
    dom.geoInput = document.getElementById("geoLocation");
    dom.geoBanner = document.getElementById("geoConsentBanner");
    dom.geoBannerMessage = document.getElementById("geoConsentMessage");
    dom.geoBannerStatus = document.getElementById("geoConsentStatus");
    dom.geoBannerButton = document.getElementById("requestLocationBtn");
    dom.operatorSelect = document.getElementById("operator");
    dom.cantiereSelect = document.getElementById("cantiere");
    dom.macchinaSelect = document.getElementById("macchina");
    dom.lineaSelect = document.getElementById("linea");
    dom.breakSelect = document.getElementById("pausa");
    dom.transferSelect = document.getElementById("trasferimento");
    dom.breakWrapper = document.getElementById("breakWrapper");
    dom.pauseReminder = document.getElementById("pauseReminder");
    dom.startBtn = document.getElementById("startWorkBtn");
    dom.startConfirmBtn = document.getElementById("startConfirmBtn");
    dom.endBtn = document.getElementById("endWorkBtn");
    dom.finishConfirmBtn = document.getElementById("finishConfirmBtn");
    dom.startTimeDisplay = document.getElementById("startTimeDisplay");
    dom.finishSummary = document.getElementById("finishSummary");
    dom.workStatus = document.getElementById("workStatus");
    dom.descrizioneInput = document.getElementById("descrizione");
    dom.activeEntryInput = document.getElementById("activeEntryId");
  }

  function attachEventListeners() {
    if (dom.logoutBtn) {
      dom.logoutBtn.addEventListener("click", handleLogoutClick);
    }

    if (dom.operatorSelect) {
      dom.operatorSelect.addEventListener("change", () => {
        clearSelectValidity(dom.operatorSelect);
        updateStartButtonState();
        fetchStatusForOperatorValue(dom.operatorSelect.value);
      });
    }

    [dom.cantiereSelect, dom.macchinaSelect, dom.lineaSelect].forEach(
      (select) => {
        if (!select) return;
        select.addEventListener("change", () => {
          clearSelectValidity(select);
          updateStartButtonState();
        });
      }
    );

    if (dom.breakSelect) {
      dom.breakSelect.addEventListener("change", () => {
        clearSelectValidity(dom.breakSelect);
        if (state.pendingFinish) {
          clearPendingFinish();
        }
        updateEndButtonState();
      });
    }

    if (dom.transferSelect) {
      dom.transferSelect.addEventListener("change", () => {
        clearSelectValidity(dom.transferSelect);
        if (state.pendingFinish) {
          clearPendingFinish();
        }
        updateEndButtonState();
      });
    }

    if (dom.startBtn) {
      dom.startBtn.addEventListener("click", () => {
        handleStartClick().catch((err) => {
          console.error("Errore inatteso start", err);
        });
      });
    }

    if (dom.startConfirmBtn) {
      dom.startConfirmBtn.addEventListener("click", () => {
        handleStartConfirmClick().catch((err) => {
          console.error("Errore inatteso conferma start", err);
        });
      });
    }

    if (dom.endBtn) {
      dom.endBtn.addEventListener("click", () => {
        handleFinishClick().catch((err) => {
          console.error("Errore inatteso fine", err);
        });
      });
    }

    if (dom.finishConfirmBtn) {
      dom.finishConfirmBtn.addEventListener("click", () => {
        handleFinishConfirmClick().catch((err) => {
          console.error("Errore inatteso conferma fine", err);
        });
      });
    }
  }

  function setupGeolocation() {
    if (!dom.geoInput) return;

    if (dom.geoBannerButton) {
      dom.geoBannerButton.addEventListener("click", () => {
        obtainBrowserLocation({ forcePrompt: true }).then((location) => {
          if (!location) {
            fetchServerLocation();
          }
        });
      });
    }

    initGeolocation();
    fetchServerLocation();
  }

  function handleLogoutClick() {
    fetch("/api/logout-user", {
      method: "POST",
      credentials: "same-origin",
    })
      .catch((err) => {
        console.error("Errore durante il logout", err);
      })
      .finally(() => {
        window.location.href = "/register.html";
      });
  }

  function selectPlaceholderOption(select) {
    if (!select) return;
    const placeholder = Array.from(select.options || []).find(
      (opt) => opt?.dataset?.placeholder === "true"
    );
    if (placeholder) {
      const disabled = placeholder.disabled;
      placeholder.disabled = false;
      placeholder.selected = true;
      select.value = placeholder.value;
      placeholder.disabled = disabled;
    } else if (select.options.length) {
      select.selectedIndex = 0;
    }
  }

  function toTitleCase(value) {
    if (typeof value !== "string") return "";
    return value
      .toLocaleLowerCase("it-IT")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toLocaleUpperCase("it-IT") + part.slice(1))
      .join(" ");
  }

  function formatOperatorLabel(value) {
    return toTitleCase(value);
  }

  function populateSelect(
    select,
    values,
    { includePlaceholder = true, preselectValue = "", formatLabel = null } = {}
  ) {
    if (!select) return;
    select.innerHTML = "";
    if (includePlaceholder) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Seleziona";
      option.disabled = true;
      option.selected = true;
      option.dataset.placeholder = "true";
      select.appendChild(option);
    }

    const normalizedPreselect =
      typeof preselectValue === "string" ? preselectValue.trim() : "";
    let hasSelection = false;

    for (const value of values || []) {
      if (typeof value !== "string" || !value.trim()) continue;
      const opt = document.createElement("option");
      opt.value = value.trim();
      opt.textContent = formatLabel ? formatLabel(value) : value.trim();
      if (
        normalizedPreselect &&
        opt.value.trim().toLocaleLowerCase("it-IT") ===
          normalizedPreselect.toLocaleLowerCase("it-IT")
      ) {
        opt.selected = true;
        hasSelection = true;
      }
      select.appendChild(opt);
    }

    if (!hasSelection) {
      if (includePlaceholder) {
        selectPlaceholderOption(select);
      } else if (select.options.length) {
        select.options[0].selected = true;
      }
    }
  }

  async function loadOptions(assignedOperatorName = "") {
    try {
      const res = await fetch("/api/options");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const normalizedAssigned = assignedOperatorName.trim();
      let operators = Array.isArray(data.operators) ? data.operators : [];
      if (normalizedAssigned) {
        const target = normalizedAssigned.toLocaleLowerCase("it-IT");
        operators = operators.filter((name) => {
          if (typeof name !== "string") return false;
          return name.trim().toLocaleLowerCase("it-IT") === target;
        });
        if (!operators.length) {
          operators = [normalizedAssigned];
        }
      }
      populateSelect(dom.operatorSelect, operators, {
        includePlaceholder: !(normalizedAssigned && operators.length === 1),
        preselectValue: normalizedAssigned || null,
        formatLabel: formatOperatorLabel,
      });
      populateSelect(dom.cantiereSelect, data.cantieri || []);
      populateSelect(dom.macchinaSelect, data.macchine || []);
      populateSelect(dom.lineaSelect, data.linee || []);
    } catch (err) {
      console.error("Impossibile caricare le opzioni", err);
      const fallbackOperators = assignedOperatorName
        ? [assignedOperatorName]
        : [];
      populateSelect(dom.operatorSelect, fallbackOperators, {
        includePlaceholder: !(
          assignedOperatorName && fallbackOperators.length === 1
        ),
        preselectValue: assignedOperatorName || null,
        formatLabel: formatOperatorLabel,
      });
      populateSelect(dom.cantiereSelect, []);
      populateSelect(dom.macchinaSelect, []);
      populateSelect(dom.lineaSelect, []);
    }
  }

  async function fetchUserProfile() {
    try {
      const res = await fetch("/api/user/profile", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && typeof data === "object" && data.user) {
        return data.user;
      }
    } catch (err) {
      console.warn("Impossibile recuperare il profilo utente", err);
    }
    return null;
  }

  async function loadInitialData() {
    const profile = await fetchUserProfile();
    state.currentProfile = profile;
    const assigned =
      profile && typeof profile.operatorName === "string"
        ? profile.operatorName.trim()
        : "";
    await loadOptions(assigned);
    if (assigned && dom.operatorSelect) {
      dom.operatorSelect.value = assigned;
      dom.operatorSelect.dataset.assignedOperator = assigned;
      fetchStatusForOperatorValue(assigned);
    }
  }

  function clearAlert() {
    if (dom.msg) {
      dom.msg.innerHTML = "";
    }
  }

  function showAlert(type, text) {
    if (!dom.msg) return;
    dom.msg.innerHTML = `<div class="alert alert-${type}">${text}</div>`;
  }

  function setStatusText(text, { timeout = 0 } = {}) {
    if (state.statusTimeoutId) {
      clearTimeout(state.statusTimeoutId);
      state.statusTimeoutId = null;
    }
    if (dom.workStatus) {
      dom.workStatus.textContent = text || "";
      if (text && timeout > 0) {
        state.statusTimeoutId = setTimeout(() => {
          if (dom.workStatus.textContent === text) {
            dom.workStatus.textContent = "";
          }
        }, timeout);
      }
    }
  }

  function resetFormFields() {
    selectPlaceholderOption(dom.operatorSelect);
    selectPlaceholderOption(dom.cantiereSelect);
    selectPlaceholderOption(dom.macchinaSelect);
    selectPlaceholderOption(dom.lineaSelect);
    selectPlaceholderOption(dom.breakSelect);
    selectPlaceholderOption(dom.transferSelect);
    if (dom.descrizioneInput) {
      dom.descrizioneInput.value = "";
    }
  }

  function clearPendingStart() {
    state.pendingStart = null;
    if (dom.startConfirmBtn) {
      dom.startConfirmBtn.classList.add("d-none");
      dom.startConfirmBtn.disabled = false;
    }
    if (dom.startTimeDisplay) {
      dom.startTimeDisplay.textContent = "";
      dom.startTimeDisplay.classList.add("d-none");
    }
  }

  function clearPendingFinish() {
    state.pendingFinish = null;
    if (dom.finishConfirmBtn) {
      dom.finishConfirmBtn.classList.add("d-none");
      dom.finishConfirmBtn.disabled = false;
    }
    if (dom.finishSummary) {
      dom.finishSummary.textContent = "";
      dom.finishSummary.classList.add("d-none");
    }
  }

  function updateStartButtonState() {
    if (!dom.startBtn) return;
    dom.startBtn.disabled = Boolean(state.activeEntry);
  }

  function updateEndButtonState() {
    if (!dom.endBtn) return;
    const hasEntry = Boolean(state.activeEntry);
    const pauseSelected = isSelectCompleted(dom.breakSelect);
    const transferSelected = isSelectCompleted(dom.transferSelect);
    dom.endBtn.disabled = !hasEntry || !pauseSelected || !transferSelected;
  }

  function updateUiForEntry(entry) {
    state.activeEntry = entry && entry.id ? entry : null;
    if (dom.activeEntryInput) {
      dom.activeEntryInput.value = state.activeEntry
        ? String(state.activeEntry.id)
        : "";
    }

    const hasEntry = Boolean(state.activeEntry);

    if (!hasEntry) {
      clearPendingStart();
      clearPendingFinish();
    } else {
      clearPendingStart();
    }

    if (dom.startBtn) {
      dom.startBtn.classList.toggle("d-none", hasEntry);
      dom.startBtn.disabled = hasEntry;
    }

    if (dom.endBtn) {
      dom.endBtn.classList.toggle("d-none", !hasEntry);
      dom.endBtn.disabled = !hasEntry;
    }

    if (dom.breakWrapper) {
      dom.breakWrapper.classList.toggle("d-none", !hasEntry);
    }

    if (dom.pauseReminder) {
      dom.pauseReminder.classList.toggle("d-none", !hasEntry);
    }

    [
      dom.operatorSelect,
      dom.cantiereSelect,
      dom.macchinaSelect,
      dom.lineaSelect,
    ].forEach((select) => {
      if (!select) return;
      select.disabled = hasEntry;
      if (!hasEntry && !select.value) {
        selectPlaceholderOption(select);
      }
    });

    if (!hasEntry && dom.breakSelect) {
      selectPlaceholderOption(dom.breakSelect);
    }
    if (!hasEntry && dom.transferSelect) {
      selectPlaceholderOption(dom.transferSelect);
    }

    if (hasEntry && state.activeEntry.start_time) {
      const dateLabel = state.activeEntry.data
        ? ` del ${state.activeEntry.data}`
        : "";
      setStatusText(
        `Turno avviato alle ${state.activeEntry.start_time}${dateLabel}.`,
        {
          timeout: 0,
        }
      );
    } else if (!hasEntry) {
      setStatusText('Premi "Inizio lavoro" per registrare l\'orario.', {
        timeout: 0,
      });
    }

    updateStartButtonState();
    updateEndButtonState();
  }

  function ensureOptionValue(select, value, { formatLabel = null } = {}) {
    if (!select) return;
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      selectPlaceholderOption(select);
      return;
    }
    const existing = Array.from(select.options || []).find(
      (opt) => opt.value === normalized
    );
    if (!existing) {
      const option = new Option(
        formatLabel ? formatLabel(normalized) : normalized,
        normalized,
        true,
        true
      );
      select.appendChild(option);
    }
    select.value = normalized;
  }

  function populateFormFromEntry(entry) {
    ensureOptionValue(dom.operatorSelect, entry?.operator ?? "", {
      formatLabel: formatOperatorLabel,
    });
    ensureOptionValue(dom.cantiereSelect, entry?.cantiere ?? "");
    ensureOptionValue(dom.macchinaSelect, entry?.macchina ?? "");
    ensureOptionValue(dom.lineaSelect, entry?.linea ?? "");
    if (dom.descrizioneInput) {
      dom.descrizioneInput.value = entry?.descrizione ?? "";
    }
    if (dom.breakSelect) {
      if (entry?.break_minutes !== undefined && entry.break_minutes !== null) {
        dom.breakSelect.value = String(entry.break_minutes);
      } else {
        selectPlaceholderOption(dom.breakSelect);
      }
    }
    if (dom.transferSelect) {
      if (
        entry?.transfer_minutes !== undefined &&
        entry.transfer_minutes !== null
      ) {
        dom.transferSelect.value = String(entry.transfer_minutes);
      } else {
        selectPlaceholderOption(dom.transferSelect);
      }
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entry = data?.entry ?? null;
      if (entry) {
        await state.optionsLoaded;
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

  function getCurrentTimeString() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
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

  function buildWorkSummaryPayload(
    entry,
    { previousEntry = null, pendingFinish = null } = {}
  ) {
    const sanitize = (value) => (typeof value === "string" ? value.trim() : "");
    const entryId = Number.isFinite(Number(entry?.id))
      ? Number(entry.id)
      : Number.isFinite(Number(previousEntry?.id))
      ? Number(previousEntry.id)
      : null;
    const oreValue = Number(entry?.ore);
    let hoursLabel = "";
    if (Number.isFinite(oreValue)) {
      hoursLabel = formatMinutesToReadableTime(Math.round(oreValue * 60));
    } else if (pendingFinish) {
      const pendingMinutes = Number(pendingFinish.workedMinutes);
      if (Number.isFinite(pendingMinutes) && pendingMinutes > 0) {
        hoursLabel = formatMinutesToReadableTime(pendingMinutes);
      }
    }
    const fallback = previousEntry || {};
    return {
      hoursLabel,
      cantiere: sanitize(entry?.cantiere) || sanitize(fallback.cantiere),
      macchina: sanitize(entry?.macchina) || sanitize(fallback.macchina),
      operator: sanitize(entry?.operator) || sanitize(fallback.operator),
      workDate: sanitize(entry?.data) || sanitize(fallback.data),
      entryId,
    };
  }

  async function handleStartClick() {
    if (!dom.form || state.activeEntry) return;
    clearAlert();
    if (!validateRequiredSelects()) {
      /*  showAlert(
        "danger"
        "Seleziona Cantiere, Macchina e Linea prima di iniziare il lavoro."
      ); */
      return;
    }
    const startTime = getCurrentTimeString();
    state.pendingStart = { startTime };
    if (dom.startTimeDisplay) {
      dom.startTimeDisplay.textContent = `Ora di inizio: ${startTime}`;
      dom.startTimeDisplay.classList.remove("d-none");
    }
    if (dom.startConfirmBtn) {
      dom.startConfirmBtn.classList.remove("d-none");
      dom.startConfirmBtn.disabled = false;
    }
    setStatusText('Premi "Conferma" per registrare l\'inizio del lavoro.', {
      timeout: 0,
    });
  }

  function validateRequiredSelects() {
    const selects = [
      dom.operatorSelect,
      dom.cantiereSelect,
      dom.macchinaSelect,
      dom.lineaSelect,
    ];
    let firstInvalid = null;
    selects.forEach((select) => {
      if (!select) return;
      if (!isSelectCompleted(select)) {
        select.setCustomValidity("Compila questo campo");
        if (!firstInvalid) {
          firstInvalid = select;
        }
      } else {
        select.setCustomValidity("");
      }
    });
    if (firstInvalid) {
      firstInvalid.reportValidity();
      if (typeof firstInvalid.focus === "function") {
        firstInvalid.focus();
      }
      return false;
    }
    return true;
  }

  function isSelectCompleted(select) {
    const value = typeof select?.value === "string" ? select.value.trim() : "";
    const selectedOption = select?.options?.[select.selectedIndex];
    const isPlaceholder = selectedOption?.dataset?.placeholder === "true";
    return Boolean(value) && !isPlaceholder;
  }

  function clearSelectValidity(select) {
    if (!select) return;
    select.setCustomValidity("");
  }

  async function handleStartConfirmClick() {
    if (!dom.form || !state.pendingStart) return;
    const operatorValue = dom.operatorSelect?.value.trim();
    const cantiereValue = dom.cantiereSelect?.value.trim();
    const macchinaValue = dom.macchinaSelect?.value.trim();
    const lineaValue = dom.lineaSelect?.value.trim();
    if (!operatorValue || !cantiereValue || !macchinaValue || !lineaValue) {
      showAlert(
        "danger",
        "Compila tutti i campi prima di confermare l'inizio."
      );
      return;
    }
    const descrizioneValue = dom.descrizioneInput?.value.trim() ?? "";
    const payload = {
      operator: operatorValue,
      cantiere: cantiereValue,
      macchina: macchinaValue,
      linea: lineaValue,
      startTime: state.pendingStart.startTime,
      descrizione: descrizioneValue,
    };
    let locationValue = await resolveLocationForAction({
      forcePrompt: false,
    });
    payload.location = locationValue;

    if (dom.startConfirmBtn) {
      dom.startConfirmBtn.disabled = true;
    }

    try {
      const res = await fetch("/api/entry/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        if (res.status === 409 && data?.entry) {
          await state.optionsLoaded;
          populateFormFromEntry(data.entry);
          updateUiForEntry(data.entry);
        }
        showAlert("danger", data?.error || "Impossibile avviare il turno.");
        return;
      }
      const entry = data?.entry || null;
      if (entry) {
        await state.optionsLoaded;
        populateFormFromEntry(entry);
      }
      clearPendingStart();
      state.pendingStart = null;
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
      if (dom.startConfirmBtn) {
        dom.startConfirmBtn.disabled = false;
      }
      updateStartButtonState();
    }
  }

  async function handleFinishClick() {
    if (!dom.form || !state.activeEntry) {
      showAlert("warning", "Non ci sono turni aperti da chiudere.");
      return;
    }
    clearAlert();
    const breakValueRaw = dom.breakSelect?.value ?? "";
    if (typeof breakValueRaw !== "string" || !breakValueRaw.trim()) {
      showAlert(
        "danger",
        "Seleziona la durata della pausa prima di proseguire."
      );
      return;
    }
    const transferValueRaw = dom.transferSelect?.value ?? "";
    if (typeof transferValueRaw !== "string" || !transferValueRaw.trim()) {
      showAlert(
        "danger",
        "Seleziona la durata del trasferimento prima di proseguire."
      );
      return;
    }
    const breakMinutes = Number(breakValueRaw);
    if (!Number.isFinite(breakMinutes)) {
      showAlert("danger", "Seleziona un valore di pausa valido.");
      return;
    }
    const transferMinutes = Number(transferValueRaw);
    if (!Number.isFinite(transferMinutes)) {
      showAlert("danger", "Seleziona un valore di trasferimento valido.");
      return;
    }

    const descrizioneValue = dom.descrizioneInput?.value.trim() ?? "";
    const endTime = getCurrentTimeString();
    const startMinutes = parseTimeToMinutes(state.activeEntry.start_time);
    const endMinutes = parseTimeToMinutes(endTime);
    let oreLavorateLabel = "";
    let workedMinutes = null;
    if (startMinutes !== null && endMinutes !== null) {
      workedMinutes = endMinutes - startMinutes;
      if (workedMinutes < 0) {
        workedMinutes += 24 * 60;
      }
      workedMinutes = Math.max(
        0,
        workedMinutes - breakMinutes - transferMinutes
      );
      oreLavorateLabel = formatMinutesToReadableTime(workedMinutes);
    }
    const pausaLabel = formatMinutesToReadableTime(breakMinutes);
    const transferLabel = formatMinutesToReadableTime(transferMinutes);
    if (dom.finishSummary) {
      const parts = [];
      if (oreLavorateLabel) {
        parts.push(`Ore lavorate: ${oreLavorateLabel}`);
      }
      parts.push(`Pausa: ${pausaLabel}`);
      parts.push(`Trasferimento: ${transferLabel}`);
      dom.finishSummary.textContent = parts.join(" • ");
      dom.finishSummary.classList.remove("d-none");
    }
    state.pendingFinish = {
      endTime,
      breakMinutes,
      transferMinutes,
      descrizione: descrizioneValue,
      workedMinutes,
    };
    if (dom.finishConfirmBtn) {
      dom.finishConfirmBtn.classList.remove("d-none");
      dom.finishConfirmBtn.disabled = false;
    }
    setStatusText(
      'Verifica i dati e premi "Conferma" per registrare la fine del lavoro.',
      { timeout: 0 }
    );
  }

  async function handleFinishConfirmClick() {
    if (!dom.form || !state.activeEntry || !state.pendingFinish) {
      return;
    }
    const payload = {
      entryId: state.activeEntry.id,
      endTime: state.pendingFinish.endTime,
      breakMinutes: state.pendingFinish.breakMinutes,
      transferMinutes: state.pendingFinish.transferMinutes,
      descrizione:
        dom.descrizioneInput?.value.trim() ??
        state.pendingFinish.descrizione ??
        "",
    };
    let locationValue = await resolveLocationForAction({
      forcePrompt: false,
    });
    payload.location = locationValue;

    if (dom.finishConfirmBtn) {
      dom.finishConfirmBtn.disabled = true;
    }

    try {
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
      const durationWarning = Boolean(data?.durationWarning);
      const previousEntry = state.activeEntry;
      const pendingFinishSnapshot = state.pendingFinish;
      const summaryPayload = buildWorkSummaryPayload(entry, {
        previousEntry,
        pendingFinish: pendingFinishSnapshot,
      });
      summaryPayload.durationWarning = durationWarning;
      if (durationWarning) {
        summaryPayload.durationWarningReason =
          "Durata del turno superiore o uguale a 24 ore. Ore registrate a 0.";
      }
      const oreWorked = summaryPayload.hoursLabel;
      if (durationWarning) {
        showAlert(
          "warning",
          "Attenzione: durata turno pari o superiore a 24 ore. Ore registrate a 0. Aggiungi un messaggio nel riepilogo finale se necessario."
        );
      } else {
        showAlert(
          "success",
          oreWorked
            ? `Fine lavoro registrata. Ore lavorate: ${oreWorked}`
            : "Fine lavoro registrata."
        );
      }
      resetFormFields();
      setLocation(state.cachedLocation);
      clearPendingFinish();
      state.pendingFinish = null;
      updateUiForEntry(null);
      setStatusText(
        entry?.end_time
          ? `Turno concluso alle ${entry.end_time}.`
          : "Turno concluso.",
        { timeout: 10000 }
      );
      try {
        sessionStorage.setItem(
          "workSummaryData",
          JSON.stringify({
            ...summaryPayload,
            timestamp: Date.now(),
          })
        );
      } catch (storageErr) {
        console.warn(
          "Impossibile salvare i dati di riepilogo per la validazione",
          storageErr
        );
      }
      window.location.href = "/work-summary.html";
      return;
    } catch (err) {
      console.error("Errore durante la chiusura turno", err);
      showAlert(
        "danger",
        "Impossibile registrare la fine del lavoro. Controlla la connessione e riprova."
      );
    } finally {
      if (dom.finishConfirmBtn) {
        dom.finishConfirmBtn.disabled = false;
      }
      updateStartButtonState();
      updateEndButtonState();
    }
  }

  function setLocation(value) {
    state.cachedLocation = typeof value === "string" ? value.trim() : "";
    if (dom.geoInput) {
      dom.geoInput.value = state.cachedLocation;
    }
  }

  function updateGeoStatus(text = "") {
    if (!dom.geoBannerStatus) return;
    if (text) {
      dom.geoBannerStatus.textContent = text;
      dom.geoBannerStatus.classList.remove("d-none");
    } else {
      dom.geoBannerStatus.textContent = "";
      dom.geoBannerStatus.classList.add("d-none");
    }
  }

  function showGeoBanner(message, { status = "", showButton = true } = {}) {
    if (!dom.geoBanner) return;
    dom.geoBanner.classList.remove("d-none");
    if (dom.geoBannerMessage && message) {
      dom.geoBannerMessage.textContent = message;
    }
    updateGeoStatus(status);
    if (dom.geoBannerButton) {
      if (showButton) {
        dom.geoBannerButton.classList.remove("d-none");
        dom.geoBannerButton.disabled = false;
      } else {
        dom.geoBannerButton.classList.add("d-none");
      }
    }
  }

  function hideGeoBanner() {
    if (!dom.geoBanner) return;
    dom.geoBanner.classList.add("d-none");
    updateGeoStatus("");
  }

  async function fetchServerLocation() {
    try {
      const res = await fetch("/api/geolocation", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!state.cachedLocation && typeof data?.location === "string") {
        setLocation(data.location);
      }
    } catch (err) {
      console.warn("Impossibile ottenere la geolocalizzazione dal server", err);
    }
  }

  function requestBrowserLocation() {
    if (!navigator?.geolocation) {
      return Promise.reject(new Error("Geolocalizzazione non supportata"));
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords || {};
          const coords = [latitude, longitude]
            .map((value) =>
              typeof value === "number" && Number.isFinite(value)
                ? value.toFixed(6)
                : null
            )
            .filter((value) => value !== null);
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

  function obtainBrowserLocation({ forcePrompt = false } = {}) {
    if (!navigator?.geolocation) {
      showGeoBanner("Questo dispositivo non supporta la geolocalizzazione.", {
        status:
          "I dati verranno salvati senza coordinate. Se possibile usa un dispositivo compatibile.",
        showButton: false,
      });
      return Promise.resolve(null);
    }
    if (state.cachedLocation && !forcePrompt) {
      return Promise.resolve(state.cachedLocation);
    }
    if (state.pendingLocationPromise) {
      return state.pendingLocationPromise;
    }
    if (dom.geoBannerButton) {
      dom.geoBannerButton.disabled = true;
    }
    showGeoBanner(
      "Stiamo tentando di rilevare automaticamente la tua posizione...",
      { status: "Attendi qualche secondo.", showButton: false }
    );
    state.pendingLocationPromise = requestBrowserLocation()
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
        if (dom.geoBannerButton) {
          dom.geoBannerButton.disabled = false;
        }
        state.pendingLocationPromise = null;
      });
    return state.pendingLocationPromise;
  }

  async function initGeolocation() {
    const tryFetchLocation = () => {
      obtainBrowserLocation().catch(() => {
        // error already handled
      });
    };

    if (navigator?.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: "geolocation",
        });
        const handleState = (stateValue) => {
          if (stateValue === "granted") {
            hideGeoBanner();
            obtainBrowserLocation();
          } else if (stateValue === "prompt") {
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

  async function resolveLocationForAction({ forcePrompt = false } = {}) {
    try {
      const location = await obtainBrowserLocation({ forcePrompt });
      if (location) {
        setLocation(location);
        return location;
      }
    } catch (err) {
      // handled downstream
    }
    const fallback =
      (dom.geoInput?.value || state.cachedLocation || "").toString().trim() ||
      null;
    return fallback;
  }

  async function safeJson(res) {
    try {
      return await res.json();
    } catch (err) {
      return null;
    }
  }
})();
