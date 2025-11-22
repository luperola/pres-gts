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

async function resetPassword(payload) {
  const res = await fetch("/api/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function initUppercaseInputs(ids) {
  ids.forEach((id) => enforceUppercaseInput(document.getElementById(id)));
}

initUppercaseInputs(["resetFirstName", "resetLastName"]);

document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideFeedback();

  const firstName = document.getElementById("resetFirstName").value.trim();
  const lastName = document.getElementById("resetLastName").value.trim();
  const password = document.getElementById("resetPassword").value;
  const passwordConfirm = document.getElementById("resetPasswordConfirm").value;

  if (!firstName || !lastName || !password || !passwordConfirm) {
    showFeedback(
      "Compila tutti i campi per procedere con il recupero della password.",
      "warning"
    );
    return;
  }

  if (password.length < 6) {
    showFeedback("La password deve avere almeno 6 caratteri.", "warning");
    return;
  }

  if (password !== passwordConfirm) {
    showFeedback("Le password non coincidono.", "warning");
    return;
  }

  try {
    await resetPassword({ firstName, lastName, password });
    showFeedback(
      "Password aggiornata con successo! Reindirizzamento in corso...",
      "success"
    );
    setTimeout(redirectToIndex, 800);
  } catch (err) {
    showFeedback(err.message, "danger");
  }
});
