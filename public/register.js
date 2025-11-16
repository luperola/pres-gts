function showFeedback(message, type = "success") {
  const feedback = document.getElementById("feedback");
  feedback.textContent = message;
  feedback.classList.remove(
    "d-none",
    "alert-success",
    "alert-danger",
    "alert-warning"
  );
  feedback.classList.add(`alert-${type}`);
}

function hideFeedback() {
  const feedback = document.getElementById("feedback");
  feedback.classList.add("d-none");
}

async function handleAuthSubmit(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "Errore sconosciuto" }));
    throw new Error(data.error || "Errore sconosciuto");
  }
  return res.json();
}

function redirectToIndex() {
  window.location.href = "/index.html";
}

function enforceUppercaseInput(input) {
  if (!input) return;
  input.style.textTransform = "uppercase";
  input.addEventListener("input", () => {
    const { selectionStart, selectionEnd } = input;
    const upperValue = input.value.toLocaleUpperCase("it-IT");
    if (input.value !== upperValue) {
      input.value = upperValue;
      if (
        typeof selectionStart === "number" &&
        typeof selectionEnd === "number"
      ) {
        input.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  });
}

const credentialSyncState = {};

function setCredentialSyncState(prefix, state) {
  if (!prefix) return;
  if (!state) {
    delete credentialSyncState[prefix];
    return;
  }
  credentialSyncState[prefix] = state;
}

function getCredentialSyncState(prefix) {
  return credentialSyncState[prefix];
}

function normalizeHelperValue(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().toLocaleUpperCase("it-IT");
}

function splitFullName(value) {
  const normalized = normalizeHelperValue(value);
  if (!normalized) {
    return { firstName: "", lastName: "" };
  }
  const parts = normalized.split(" ");
  if (parts.length === 1) {
    return { lastName: parts[0], firstName: "" };
  }
  return { lastName: parts[0], firstName: parts.slice(1).join(" ") };
}

function updateCredentialHelperValue(prefix) {
  if (getCredentialSyncState(prefix) === "helper") {
    return;
  }
  const firstInput = document.getElementById(`${prefix}FirstName`);
  const lastInput = document.getElementById(`${prefix}LastName`);
  const helperInput = document.getElementById(`${prefix}Username`);
  if (!helperInput) return;
  setCredentialSyncState(prefix, "names");
  const parts = [];
  if (lastInput?.value) parts.push(lastInput.value.trim());
  if (firstInput?.value) parts.push(firstInput.value.trim());
  helperInput.value = normalizeHelperValue(parts.join(" "));
  setCredentialSyncState(prefix, "");
}

function setInputValue(input, value) {
  if (!input) return;
  const nextValue = typeof value === "string" ? value : "";
  if (input.value === nextValue) return;
  input.value = nextValue;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncNamesFromCredentialHelper(prefix) {
  const helperInput = document.getElementById(`${prefix}Username`);
  if (!helperInput) return;
  setCredentialSyncState(prefix, "helper");
  const { firstName, lastName } = splitFullName(helperInput.value || "");
  setInputValue(document.getElementById(`${prefix}LastName`), lastName);
  setInputValue(document.getElementById(`${prefix}FirstName`), firstName);
  setCredentialSyncState(prefix, "");
  updateCredentialHelperValue(prefix);
}

function initCredentialHelpers(prefix) {
  ["FirstName", "LastName"].forEach((field) => {
    const input = document.getElementById(`${prefix}${field}`);
    if (!input) return;
    input.addEventListener("input", () => updateCredentialHelperValue(prefix));
    updateCredentialHelperValue(prefix);
  });
  const helperInput = document.getElementById(`${prefix}Username`);
  if (helperInput) {
    ["input", "change"].forEach((eventName) => {
      helperInput.addEventListener(eventName, () =>
        syncNamesFromCredentialHelper(prefix)
      );
    });
    syncNamesFromCredentialHelper(prefix);
  }
}

function showFarewellMessageIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const farewell = params.get("goodbye");
  if (!farewell) return;
  showFeedback(farewell, "success");
  if (typeof window.history?.replaceState === "function") {
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl || "/");
  }
}

[
  "registerFirstName",
  "registerLastName",
  "registerUsername",
  "loginFirstName",
  "loginLastName",
  "loginUsername",
].forEach((id) => {
  const input = document.getElementById(id);
  enforceUppercaseInput(input);
});

initCredentialHelpers("register");
initCredentialHelpers("login");

showFarewellMessageIfPresent();

document
  .getElementById("registerForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFeedback();
    const firstName = document.getElementById("registerFirstName").value.trim();
    const lastName = document.getElementById("registerLastName").value.trim();
    const password = document.getElementById("registerPassword").value;

    if (!firstName || !lastName || !password) {
      showFeedback(
        "Compila nome, cognome e password per completare la registrazione.",
        "warning"
      );
      return;
    }
    try {
      await handleAuthSubmit("/api/register", {
        firstName,
        lastName,
        password,
      });
      showFeedback(
        "Registrazione completata! Reindirizzamento in corso...",
        "success"
      );
      setTimeout(redirectToIndex, 800);
    } catch (err) {
      showFeedback(err.message, "danger");
    }
  });

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideFeedback();
  const firstName = document.getElementById("loginFirstName").value.trim();
  const lastName = document.getElementById("loginLastName").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!firstName || !lastName || !password) return;
  try {
    await handleAuthSubmit("/api/login-user", {
      firstName,
      lastName,
      password,
    });
    showFeedback("Accesso eseguito! Reindirizzamento in corso...", "success");
    setTimeout(redirectToIndex, 800);
  } catch (err) {
    showFeedback(err.message, "danger");
  }
});
