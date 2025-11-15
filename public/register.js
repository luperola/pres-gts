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
