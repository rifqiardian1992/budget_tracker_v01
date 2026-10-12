(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API_URL = "https://script.google.com/macros/s/AKfycbxG86upLfMmmalCrwe9J6mhvwaGjimx08tLOKkood-szmzxET13YWTR4mrbFy9qKHPx/exec"; // Tempel URL Web App Google Apps Script setelah deploy.
  const STORAGE_KEY = "budget-tracker-v01";
  let rows = [];
  let nextId = 1;

  const rupiah = (n) => new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0
  }).format(Number(n) || 0);
  const number = (v) => Math.max(0, Number(v) || 0);
  const currentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
  };
  const sampleRows = () => [
    {id: nextId++, name:"Kebutuhan pokok", mode:"percent", amount:0, percent:40},
    {id: nextId++, name:"Tagihan rumah", mode:"percent", amount:0, percent:15},
    {id: nextId++, name:"Transportasi", mode:"amount", amount:800000, percent:0},
    {id: nextId++, name:"Tabungan anak", mode:"percent", amount:0, percent:10},
    {id: nextId++, name:"Dana darurat", mode:"percent", amount:0, percent:10}
  ];

  function budget() { return number($("mainBudget").value); }
  function normalizeRow(row) {
    const main = budget();
    if (row.mode === "percent") row.amount = main * number(row.percent) / 100;
    else row.percent = main ? number(row.amount) / main * 100 : 0;
  }
  function recalcAll() { rows.forEach(normalizeRow); }
  function renderRows() {
    const tbody = $("budgetRows");
    tbody.innerHTML = "";
    $("emptyState").hidden = rows.length !== 0;
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input aria-label="Nama pos" data-field="name" data-id="${row.id}" value="${escapeHtml(row.name)}" placeholder="Nama pos"></td>
        <td><select aria-label="Mode input" data-field="mode" data-id="${row.id}">
          <option value="amount" ${row.mode==="amount"?"selected":""}>Nominal</option>
          <option value="percent" ${row.mode==="percent"?"selected":""}>Persentase</option>
        </select></td>
        <td><input aria-label="Nominal rupiah" data-field="amount" data-id="${row.id}" type="number" min="0" step="1000" value="${round(row.amount)}"></td>
        <td><input aria-label="Persentase" data-field="percent" data-id="${row.id}" type="number" min="0" step="0.1" value="${round(row.percent)}"></td>
        <td><button class="delete-btn" type="button" data-delete="${row.id}" aria-label="Hapus pos">Hapus</button></td>`;
      tbody.appendChild(tr);
    });
    updateSummary();
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function round(n) { return Math.round((Number(n)||0)*100)/100; }
  function updateSummary() {
    const main = budget();
    const total = rows.reduce((sum, r) => sum + number(r.amount), 0);
    const remaining = main - total;
    const pct = main ? total / main * 100 : 0;
    $("mainBudgetDisplay").textContent = rupiah(main);
    $("remainingDisplay").textContent = rupiah(remaining);
    $("remainingDisplay").style.color = remaining < 0 ? "var(--red)" : "var(--text)";
    $("allocationTotal").textContent = `Total alokasi: ${rupiah(total)}`;
    $("allocationPercent").textContent = `${round(pct)}% teralokasi`;
    $("allocationProgress").style.width = `${Math.min(100, Math.max(0, pct))}%`;
    $("allocationProgress").style.background = pct > 100 ? "var(--red)" : "var(--primary)";
  }
  function setMessage(text, kind="") {
    $("message").textContent = text;
    $("message").className = `message ${kind}`;
  }
  function payload() {
    return {
      period: $("budgetDate").value,
      mainBudget: budget(),
      items: rows.map(r => ({
        name: r.name.trim(),
        mode: r.mode,
        amount: round(r.amount),
        percent: round(r.percent)
      }))
    };
  }
  function localSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload()));
  }
  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) {
        $("budgetDate").value = saved.period || currentMonth();
        $("mainBudget").value = saved.mainBudget || "";
        rows = (saved.items || []).map(r => ({...r, id: nextId++}));
        recalcAll();
        renderRows();
        setMessage("Data demo dimuat dari penyimpanan browser.");
        return;
      }
    } catch (e) { console.warn("Tidak dapat membaca data lokal", e); }
    $("budgetDate").value = currentMonth();
    $("mainBudget").value = "8000000";
    rows = sampleRows();
    recalcAll();
    renderRows();
  }

  $("budgetRows").addEventListener("input", (event) => {
    const el = event.target;
    const id = Number(el.dataset.id);
    const field = el.dataset.field;
    if (!field) return;
    const row = rows.find(r => r.id === id);
    if (!row) return;
    if (field === "name") row.name = el.value;
    if (field === "amount") {
      row.amount = number(el.value);
      row.mode = "amount";
      row.percent = budget() ? row.amount / budget() * 100 : 0;
      const percentEl = $("budgetRows").querySelector(`[data-id="${id}"][data-field="percent"]`);
      if (percentEl) percentEl.value = round(row.percent);
      const modeEl = $("budgetRows").querySelector(`[data-id="${id}"][data-field="mode"]`);
      if (modeEl) modeEl.value = "amount";
    }
    if (field === "percent") {
      row.percent = number(el.value);
      row.mode = "percent";
      row.amount = budget() * row.percent / 100;
      const amountEl = $("budgetRows").querySelector(`[data-id="${id}"][data-field="amount"]`);
      if (amountEl) amountEl.value = round(row.amount);
      const modeEl = $("budgetRows").querySelector(`[data-id="${id}"][data-field="mode"]`);
      if (modeEl) modeEl.value = "percent";
    }
    updateSummary();
  });
  $("budgetRows").addEventListener("change", (event) => {
    const el = event.target;
    const id = Number(el.dataset.id);
    if (el.dataset.field === "mode") {
      const row = rows.find(r => r.id === id);
      if (!row) return;
      row.mode = el.value;
      normalizeRow(row);
      renderRows();
    }
  });
  $("budgetRows").addEventListener("click", (event) => {
    const id = Number(event.target.dataset.delete);
    if (!id) return;
    rows = rows.filter(r => r.id !== id);
    renderRows();
  });
  $("mainBudget").addEventListener("input", () => {
    recalcAll();
    renderRows();
  });
  $("addRowBtn").addEventListener("click", () => {
    rows.push({id: nextId++, name:"", mode:"amount", amount:0, percent:0});
    renderRows();
    const inputs = $("budgetRows").querySelectorAll('[data-field="name"]');
    if (inputs.length) inputs[inputs.length-1].focus();
  });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Kembalikan data contoh? Data demo yang tersimpan di browser akan diganti.")) return;
    nextId = 1;
    $("budgetDate").value = currentMonth();
    $("mainBudget").value = "8000000";
    rows = sampleRows();
    recalcAll();
    renderRows();
    setMessage("Data contoh dipulihkan. Klik Simpan anggaran untuk menyimpannya.");
  });
  $("saveBtn").addEventListener("click", async () => {
    const data = payload();
    if (!data.period) return setMessage("Pilih tanggal/periode anggaran terlebih dahulu.", "error");
    if (!data.mainBudget) return setMessage("Main Budget harus lebih besar dari Rp0.", "error");
    if (data.items.some(x => !x.name)) return setMessage("Setiap pos harus memiliki nama.", "error");
    if (API_URL) {
      try {
        $("saveBtn").disabled = true;
        $("saveBtn").textContent = "Menyimpan…";
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {"Content-Type":"text/plain;charset=utf-8"},
          body: JSON.stringify({action:"saveBudget", ...data})
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Gagal menyimpan ke Google Sheets.");
        setMessage("Anggaran berhasil disimpan ke Google Sheets.", "success");
      } catch (err) {
        localSave();
        setMessage(`Gagal menghubungi backend; data disimpan lokal di browser. ${err.message}`, "error");
      } finally {
        $("saveBtn").disabled = false;
        $("saveBtn").textContent = "Simpan anggaran";
      }
    } else {
      localSave();
      setMessage("Tersimpan di browser ini. Untuk menyimpan ke Google Sheets, isi API_URL di app.js.", "success");
    }
  });
  loadLocal();
})();