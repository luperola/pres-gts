async function loadOperators() {
  const res = await fetch('/api/operators');
  const data = await res.json();
  const sel = document.getElementById('operator');
  sel.innerHTML = '<option value="">Seleziona...</option>' + data.operators.map(o => `<option>${o}</option>`).join('');
}

function ymdToDmy(ymd) {
  if (!ymd) return '';
  const [y,m,d] = ymd.split('-');
  return `${d.padStart(2,'0')}/${m.padStart(2,'0')}/${y}`;
}
function setTodayMaxDate(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const t = new Date();
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth()+1).padStart(2,'0');
  const dd = String(t.getDate()).padStart(2,'0');
  el.max = `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', () => {
  loadOperators();
  setTodayMaxDate('data');

  const form = document.getElementById('entryForm');
  const msg = document.getElementById('msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      operator: document.getElementById('operator').value.trim(),
      macchina: document.getElementById('macchina').value.trim(),
      linea: document.getElementById('linea').value.trim(),
      ore: document.getElementById('ore').value.trim(),
      data: ymdToDmy(document.getElementById('data').value.trim()),
      descrizione: document.getElementById('descrizione').value.trim(),
    };
    const res = await fetch('/api/entry', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (res.ok) {
      msg.innerHTML = '<div class="alert alert-success">Registrazione salvata.</div>';
      form.reset();
      setTodayMaxDate('data');
    } else {
      msg.innerHTML = `<div class="alert alert-danger">${out.error || 'Errore'}</div>`;
    }
  });
});
