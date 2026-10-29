const STORAGE_KEY = "retention-dashboard-v1";
const alarmCount = 8;

const state = loadState();
const todayTotal = document.querySelector("#todayTotal");
const fiberCount = document.querySelector("#fiberCount");
const phoneCount = document.querySelector("#phoneCount");
const historyBody = document.querySelector("#historyBody");
const emptyHistory = document.querySelector("#emptyHistory");
const alarmList = document.querySelector("#alarmList");
const notificationStack = document.querySelector("#notificationStack");
const permissionBanner = document.querySelector("#permissionBanner");
const permissionText = document.querySelector("#permissionText");
const permissionButton = document.querySelector("#permissionButton");
const alarmWorker = new Worker("alarm-worker.js");
const monthSelector = document.querySelector("#monthSelector");
const monthlyChart = document.querySelector("#monthlyChart");
const notesList = document.querySelector("#notesList");
const emptyNotes = document.querySelector("#emptyNotes");
const noteForm = document.querySelector("#noteForm");
const notesCount = document.querySelector("#notesCount");
const noteStatus = document.querySelector("#noteStatus");
const reportStatus = document.querySelector("#reportStatus");
const scriptsList = document.querySelector("#scriptsList");
const attendanceForm = document.querySelector("#attendanceForm");
const attendanceStatus = document.querySelector("#attendanceStatus");
const copyAttendanceNotesButton = document.querySelector("#copyAttendanceNotes");
const attendanceRecordsBody = document.querySelector("#attendanceRecordsBody");
const emptyAttendanceRecords = document.querySelector("#emptyAttendanceRecords");
const attendanceRecordsCount = document.querySelector("#attendanceRecordsCount");
const exportAttendancesButton = document.querySelector("#exportAttendances");
let selectedAttendanceStatus = "pending";
let selectedAttendanceType = "fiber";
const workSaturday = document.querySelector("#workSaturday");
const workSaturdayEnabled = document.querySelector("#workSaturdayEnabled");
const reminderStatus = document.querySelector("#reminderStatus");
const saturdayReminderText = document.querySelector("#saturdayReminderText");
let audioContext;

const serviceScripts = [
  {
    title: "Cliente no es titular",
    text: "Cliente entrou em contato porém não é titular do serviço. Orientado que apenas o titular poderá realizar o contato.",
  },
  {
    title: "Cancelamiento por no utilización",
    text: `Motivo: Não Utiliza
Cod: 78
Oferta Conc: N/a
Oferta Ret: Troca de Titularidade/ ME
Obs: Cliente entrou em contato para solicitar o cancelamento do serviço. Informo que não faz utilização do serviço. Não aceita ofertas de retenção.
*Ciente devolução/ Proporcional/ Geradocs / Multa`,
  },
  {
    title: "Cancelamiento por óbito",
    text: `Motivo: Obito
Cod: 57
Oferta Conc: N/a
Oferta Ret: Troca de Titularidade/ ME
Obs: Cliente entrou em contato para solicitar o cancelamento do serviço, informo que por motivo de óbito do titular. Não aceita ofertas de retenção. Irá encaminhar documentos no sac.cancela@sercomtel.net.br.
*Ciente devolução/ Proporcional/ Geradocs / Multa`,
  },
];
let customScripts = loadCustomScripts();

async function loadScriptsFromDatabase() {
  try {
    const response = await fetch("/api/scripts");
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.scripts)) {
      throw new Error(result.error || "MongoDB no devolvió scripts válidos.");
    }
    customScripts = result.scripts;
    localStorage.setItem(`${STORAGE_KEY}-scripts`, JSON.stringify(customScripts));
    renderScripts();
  } catch (error) {
    console.error("No se pudieron cargar los scripts desde MongoDB.", error);
  }
}

async function saveScriptToDatabase(script) {
  const response = await fetch("/api/scripts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(script),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo guardar el script.");
}

async function deleteScriptFromDatabase(id) {
  const response = await fetch(`/api/scripts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo eliminar el script.");
}

function loadCustomScripts() {
  try {
    const saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-scripts`));
    return Array.isArray(saved) ? saved.filter((script) => script && script.title && script.text) : [];
  } catch (error) {
    console.error("No se pudieron cargar los scripts personalizados.", error);
    return [];
  }
}

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateKeyFromDate(date) {
  return localDateKey(date);
}

function getThursdayBefore(saturdayDate) {
  const date = new Date(`${saturdayDate}T12:00:00`);
  date.setDate(date.getDate() - 2);
  return dateKeyFromDate(date);
}

function renderSaturdayReminder() {
  workSaturday.value = state.saturdayReminder.saturdayDate;
  workSaturdayEnabled.checked = state.saturdayReminder.enabled;
  saturdayReminderText.textContent = state.saturdayReminder.saturdayDate
    ? `Aviso el jueves anterior a las ${state.saturdayReminder.time}.`
    : "Selecciona el sábado en el que trabajarás.";
}

function updateSaturdayReminder() {
  const selectedDate = workSaturday.value;
  if (!selectedDate) {
    state.saturdayReminder.saturdayDate = "";
    state.saturdayReminder.thursdayDate = "";
    state.saturdayReminder.enabled = false;
    reminderStatus.textContent = "Selecciona una fecha para activar el recordatorio.";
    reminderStatus.className = "reminder-status";
  } else {
    const selected = new Date(`${selectedDate}T12:00:00`);
    if (selected.getDay() !== 6) {
      state.saturdayReminder.enabled = false;
      state.saturdayReminder.lastTriggered = "";
      workSaturdayEnabled.checked = false;
      reminderStatus.textContent = "Elige un sábado para configurar este recordatorio.";
      reminderStatus.className = "reminder-status error";
    } else {
      state.saturdayReminder.saturdayDate = selectedDate;
      state.saturdayReminder.thursdayDate = getThursdayBefore(selectedDate);
      state.saturdayReminder.enabled = workSaturdayEnabled.checked;
      state.saturdayReminder.lastTriggered = "";
      reminderStatus.textContent = `Recordatorio programado para el jueves ${formatDate(state.saturdayReminder.thursdayDate)} a las 16:12.`;
      reminderStatus.className = "reminder-status success";
    }
  }
  saveState();
  renderSaturdayReminder();
  syncAlarmsWithWorker();
}

function formatDate(dateKey) {
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${dateKey}T12:00:00`))
    .replace(".", "");
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      return {
        days: saved.days || {},
        attendances: Array.isArray(saved.attendances) ? saved.attendances : [],
        notes: Array.isArray(saved.notes) ? saved.notes : [],
        reportSent: saved.reportSent || {},
        saturdayReminder: {
          saturdayDate: saved.saturdayReminder?.saturdayDate || "",
          thursdayDate: saved.saturdayReminder?.thursdayDate || "",
          time: saved.saturdayReminder?.time || "16:12",
          enabled: Boolean(saved.saturdayReminder?.enabled),
          lastTriggered: saved.saturdayReminder?.lastTriggered || "",
        },
        alarms: Array.from({ length: alarmCount }, (_, index) => ({
          time: saved.alarms?.[index]?.time || "",
          label: saved.alarms?.[index]?.label || `Pausa ${index + 1}`,
          enabled: Boolean(saved.alarms?.[index]?.enabled),
        })),
      };
    }
  } catch (error) {
    console.error("No se pudieron cargar los datos guardados.", error);
  }
  return {
    days: {},
    attendances: [],
    notes: [],
    reportSent: {},
    saturdayReminder: {
      saturdayDate: "",
      thursdayDate: "",
      time: "16:12",
      enabled: false,
      lastTriggered: "",
    },
    alarms: Array.from({ length: alarmCount }, (_, index) => ({
      time: "",
      label: `Pausa ${index + 1}`,
      enabled: false,
    })),
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function rebuildDaysFromAttendances() {
  state.days = state.attendances.reduce((days, record) => {
    if (!days[record.date]) days[record.date] = { fiber: 0, phone: 0, total: 0 };
    days[record.date].total += 1;
    if (record.type === "fiber" || record.type === "phone") days[record.date][record.type] += 1;
    return days;
  }, {});
}

async function loadAttendancesFromDatabase() {
  try {
    const response = await fetch("/api/attendances");
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.records)) {
      throw new Error(result.error || "MongoDB no devolvió registros válidos.");
    }
    state.attendances = result.records.map((record) => ({ ...record, syncStatus: "sent" }));
    rebuildDaysFromAttendances();
    saveState();
    renderDashboard();
  } catch (error) {
    console.error("No se pudieron cargar los atendimientos desde MongoDB.", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function renderAttendanceRecords() {
  const statusLabels = { retained: "Retenido", cancelled: "Cancelado", pending: "Pendiente" };
  const typeLabels = { fiber: "Fibras", phone: "Líneas" };
  const records = [...state.attendances].reverse();
  attendanceRecordsCount.textContent = `${records.length} ${records.length === 1 ? "registro" : "registros"}`;
  attendanceRecordsBody.innerHTML = records.map((record) => `
    <tr>
      <td>${escapeHtml(record.date)}</td>
      <td>${escapeHtml(typeLabels[record.type] || record.type || "—")}</td>
      <td><span class="attendance-status-badge ${escapeHtml(record.status)}">${escapeHtml(statusLabels[record.status] || record.status)}</span></td>
      <td>${escapeHtml(record.name) || "—"}</td>
      <td>${escapeHtml(record.protocol) || "—"}</td>
      <td>${escapeHtml(record.registration) || "—"}</td>
      <td>${escapeHtml(record.contact) || "—"}</td>
      <td>${escapeHtml(record.document) || "—"}</td>
      <td>${escapeHtml(record.vox) || "—"}</td>
      <td class="attendance-annotation">${escapeHtml(record.annotations) || "—"}</td>
      <td><span class="sync-badge ${record.syncStatus === "sent" ? "sent" : "pending"}">${record.syncStatus === "sent" ? "Enviado" : "Pendiente"}</span></td>
    </tr>
  `).join("");
  emptyAttendanceRecords.hidden = records.length > 0;
}

function exportAttendancesToExcel() {
  if (!state.attendances.length) {
    attendanceStatus.textContent = "No hay atendimientos para descargar.";
    return;
  }

  const statusLabels = { retained: "Retenido", cancelled: "Cancelado", pending: "Pendiente" };
  const typeLabels = { fiber: "Fibras", phone: "Líneas" };
  const headers = ["Fecha", "Tipo", "Estado", "Nome", "Protocolo", "Inscrição", "Contato", "CPF/CNPJ", "VOX", "Anotaciones", "MongoDB"];
  const records = [...state.attendances].reverse();
  const values = records.map((record) => [
    record.date,
    typeLabels[record.type] || record.type,
    statusLabels[record.status] || record.status,
    record.name,
    record.protocol,
    record.registration,
    record.contact,
    record.document,
    record.vox,
    record.annotations,
    record.syncStatus === "sent" ? "Enviado" : "Pendiente",
  ]);
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...values].map((row) => row.map(escapeCell).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `atendimientos-${localDateKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  attendanceStatus.textContent = `${records.length} ${records.length === 1 ? "registro exportado" : "registros exportados"}.`;
}

function getToday() {
  const key = localDateKey();
  return state.days[key] || { fiber: 0, phone: 0, total: 0 };
}

function renderDashboard() {
  const today = getToday();
  fiberCount.textContent = today.fiber;
  phoneCount.textContent = today.phone;
  todayTotal.textContent = today.fiber + today.phone;
  renderRetentionMetrics();

  const days = Object.entries(state.days).sort(([first], [second]) => second.localeCompare(first));
  historyBody.innerHTML = days.map(([date, counts]) => `
    <tr>
      <td>${formatDate(date)}</td>
      <td>${counts.fiber}</td>
      <td>${counts.phone}</td>
      <td>${counts.total ?? counts.fiber + counts.phone}</td>
    </tr>
  `).join("");
  emptyHistory.hidden = days.length > 0;
  renderAttendanceRecords();
  renderMonthlyDashboard();
  renderNotes();
}

function getAttendanceCounts(records) {
  return records.reduce((counts, record) => {
    if (record.status === "retained") counts.retained += 1;
    if (record.status === "cancelled") counts.cancelled += 1;
    if (record.status === "pending") counts.pending += 1;
    return counts;
  }, { retained: 0, cancelled: 0, pending: 0 });
}

function retentionRate(records) {
  if (!records.length) return "0";
  return ((getAttendanceCounts(records).retained / records.length) * 100).toFixed(1);
}

function renderRetentionMetrics() {
  const todayRecords = state.attendances.filter((record) => record.date === localDateKey());
  const monthRecords = state.attendances.filter((record) => record.date.startsWith(currentMonthKey()));
  const todayCounts = getAttendanceCounts(todayRecords);
  const monthCounts = getAttendanceCounts(monthRecords);
  document.querySelector("#retainedCount").textContent = todayCounts.retained;
  document.querySelector("#cancelledCount").textContent = todayCounts.cancelled;
  document.querySelector("#pendingCount").textContent = todayCounts.pending;
  document.querySelector("#dailyRetention").textContent = `${retentionRate(todayRecords)}%`;
  document.querySelector("#monthlyRetention").textContent = `${retentionRate(monthRecords)}%`;
  return { monthCounts };
}

function currentMonthKey() {
  return localDateKey().slice(0, 7);
}

function renderMonthlyDashboard() {
  const month = monthSelector.value || currentMonthKey();
  const monthDays = Object.entries(state.days)
    .filter(([date]) => date.startsWith(month))
    .sort(([first], [second]) => first.localeCompare(second));
  const totals = monthDays.reduce((result, [, counts]) => ({
    fiber: result.fiber + counts.fiber,
    phone: result.phone + counts.phone,
  }), { fiber: 0, phone: 0 });
  const total = totals.fiber + totals.phone;
  const monthRecords = state.attendances.filter((record) => record.date.startsWith(month));

  document.querySelector("#monthlyTotal").textContent = total;
  document.querySelector("#dailyAverage").textContent = monthDays.length ? (total / monthDays.length).toFixed(1) : "0";
  document.querySelector("#registeredDays").textContent = monthDays.length;
  document.querySelector("#monthlySplit").textContent = `${totals.fiber} / ${totals.phone}`;
  document.querySelector("#monthlyRetention").textContent = `${retentionRate(monthRecords)}%`;

  const maxTotal = Math.max(...monthDays.map(([, counts]) => counts.fiber + counts.phone), 1);
  monthlyChart.innerHTML = monthDays.length ? monthDays.map(([date, counts]) => {
    const dayTotal = counts.fiber + counts.phone;
    const height = Math.max((dayTotal / maxTotal) * 100, 3);
    return `<div class="chart-column" title="${formatDate(date)}: ${dayTotal} atendimientos">
      <div class="chart-bar" style="height: ${height}%"></div>
      <span>${Number(date.slice(8))}</span>
    </div>`;
  }).join("") : `<div class="empty-chart">No hay atendimientos registrados en este mes.</div>`;
}

function getMonthDays(month) {
  return Object.entries(state.days)
    .filter(([date]) => date.startsWith(month))
    .sort(([first], [second]) => first.localeCompare(second));
}

function buildReport(month, title) {
  const monthDays = getMonthDays(month);
  const totals = monthDays.reduce((result, [, counts]) => ({
    fiber: result.fiber + counts.fiber,
    phone: result.phone + counts.phone,
  }), { fiber: 0, phone: 0 });
  const total = totals.fiber + totals.phone;
  const lines = monthDays.map(([date, counts]) =>
    `${formatDate(date)}: ${counts.fiber + counts.phone} (${counts.fiber} fibras, ${counts.phone} teléfonos)`);
  return {
    title,
    content: [
      `Total: ${total} atendimientos`,
      `Media diaria: ${monthDays.length ? (total / monthDays.length).toFixed(1) : "0"}`,
      `Días registrados: ${monthDays.length}`,
      `Fibras: ${totals.fiber} | Teléfonos: ${totals.phone}`,
      lines.length ? `\nDetalle:\n${lines.join("\n")}` : "\nSin registros.",
    ].join("\n"),
  };
}

async function sendReport(month, type, markAsSent = false) {
  const title = type === "daily" ? `Informe diario · ${formatDate(month)}` : `Informe mensual · ${month}`;
  const report = { title, period: month, type };
  reportStatus.className = "report-status";
  reportStatus.textContent = "Enviando informe...";
  try {
    const response = await fetch("/api/discord-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Discord rechazó el informe.");
    }
    if (markAsSent) {
      state.reportSent[`${type}-${month}`] = true;
      saveState();
    }
    reportStatus.className = "report-status success";
    reportStatus.textContent = "Informe enviado a Discord.";
  } catch (error) {
    reportStatus.className = "report-status error";
    reportStatus.textContent = `No se pudo enviar: ${error.message}`;
  }
}

function checkScheduledReports() {
  const now = new Date();
  if (now.getHours() !== 16 || now.getMinutes() !== 12) return;
  const today = localDateKey(now);
  if (!state.reportSent[`daily-${today}`]) sendReport(today, "daily", true);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (tomorrow.getMonth() !== now.getMonth() && !state.reportSent[`monthly-${today.slice(0, 7)}`]) {
    sendReport(today.slice(0, 7), "monthly", true);
  }
}

function renderNotes() {
  const notes = [...state.notes].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  notesCount.textContent = `${notes.length} ${notes.length === 1 ? "registro" : "registros"}`;
  emptyNotes.hidden = notes.length > 0;
  notesList.innerHTML = "";
  notes.forEach((note) => {
    const card = document.createElement("article");
    card.className = "note-card";
    card.innerHTML = `<button class="delete-note" type="button" data-note-id="${note.id}" aria-label="Eliminar nota">×</button>`;
    const title = document.createElement("strong");
    title.textContent = note.title;
    const content = document.createElement("p");
    content.textContent = note.content;
    const date = document.createElement("time");
    date.textContent = formatDate(note.createdAt.slice(0, 10));
    card.append(title, content, date);
    notesList.append(card);
  });

}

function renderScripts() {
  const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
  const builtInMarkup = serviceScripts.map((script, index) => `
    <details class="script-card">
      <summary><strong>${escapeHtml(script.title)}</strong><span>+</span></summary>
      <div class="script-body">
        <pre></pre>
        <button class="copy-script" type="button" data-script-index="${index}">Copiar script</button>
      </div>
    </details>
  `).join("");
  const customMarkup = customScripts.map((script, index) => `
    <details class="script-card custom-script-card">
      <summary><strong>${escapeHtml(script.title)}</strong><span>+</span></summary>
      <div class="script-body">
        <pre></pre>
        <div class="script-card-actions">
          <button class="copy-script" type="button" data-custom-script-index="${index}">Copiar script</button>
          <button class="delete-script" type="button" data-custom-script-delete="${index}">Eliminar</button>
        </div>
      </div>
    </details>
  `).join("");
  scriptsList.innerHTML = builtInMarkup + customMarkup;
  scriptsList.querySelectorAll(".script-card").forEach((card, index) => {
    const script = index < serviceScripts.length ? serviceScripts[index] : customScripts[index - serviceScripts.length];
    card.querySelector("pre").textContent = script.text;
  });
}

async function copyScript(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.append(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
  }
  button.textContent = "Script copiado";
  setTimeout(() => { button.textContent = "Copiar script"; }, 1600);
}

function renderAlarms() {
  alarmList.innerHTML = state.alarms.map((alarm, index) => `
    <div class="alarm-row">
      <input type="time" aria-label="Hora de la alarma ${index + 1}" data-alarm="${index}" data-field="time" value="${alarm.time}" />
      <input type="text" aria-label="Descripción de la alarma ${index + 1}" data-alarm="${index}" data-field="label" value="${alarm.label}" maxlength="40" />
      <label class="switch" title="${alarm.enabled ? "Desactivar" : "Activar"} alarma">
        <input type="checkbox" data-alarm="${index}" data-field="enabled" ${alarm.enabled ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>
  `).join("");
  const active = state.alarms.filter((alarm) => alarm.enabled && alarm.time).length;
  document.querySelector(".alarm-limit").textContent = `${active} / 8 activas`;
}

function addCount(type) {
  const key = localDateKey();
  if (!state.days[key]) state.days[key] = { fiber: 0, phone: 0 };
  const today = state.days[key];
  today[type] += 1;
  saveState();
  renderDashboard();
}

async function submitAttendance(status) {
  const formData = new FormData(attendanceForm);
  const fields = Object.fromEntries(formData.entries());
  const hasData = Object.values(fields).some((value) => String(value).trim());
  if (!hasData) {
    attendanceStatus.textContent = "Completa al menos un campo antes de registrar.";
    attendanceStatus.className = "attendance-status error";
    return;
  }
  const record = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: localDateKey(),
    createdAt: new Date().toISOString(),
    status,
    type: selectedAttendanceType,
    ...fields,
    syncStatus: "pending",
  };
  state.attendances.push(record);
  selectedAttendanceStatus = status;
  const counterType = selectedAttendanceType;
  if (!state.days[record.date]) state.days[record.date] = { fiber: 0, phone: 0 };
  state.days[record.date][counterType] += 1;
  saveState();
  renderDashboard();
  attendanceForm.reset();
  attendanceStatus.textContent = `Atendimiento ${status === "retained" ? "retenido" : status === "cancelled" ? "cancelado" : "pendiente"} registrado localmente.`;
  attendanceStatus.className = "attendance-status success";

  try {
    const response = await fetch("/api/attendances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo sincronizar el atendimiento.");
    if (result.saved) {
      record.syncStatus = "sent";
      saveState();
      renderAttendanceRecords();
      attendanceStatus.textContent = "Atendimiento guardado en MongoDB.";
      await loadAttendancesFromDatabase();
    }
  } catch (error) {
    console.error("El atendimiento quedó guardado localmente, pero no se sincronizó.", error);
    attendanceStatus.textContent += " Guardado localmente; sincronización pendiente.";
  }
}

function showNotification(message) {
  const notification = document.createElement("div");
  notification.className = "notification";
  notification.innerHTML = `<strong>Momento de tu pausa</strong><span>${message}</span>`;
  notificationStack.append(notification);
  setTimeout(() => notification.remove(), 10000);
}

function unlockAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playAlarmBeep() {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startTime = audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.16, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + 0.2);
}

function updatePermissionBanner() {
  if (!("Notification" in window)) {
    permissionBanner.hidden = false;
    permissionText.textContent = "Este navegador no admite notificaciones del sistema.";
    permissionButton.hidden = true;
    return;
  }
  if (Notification.permission === "granted") {
    permissionBanner.hidden = true;
    return;
  }
  permissionBanner.hidden = false;
  permissionButton.hidden = false;
  if (Notification.permission === "denied") {
    permissionText.textContent = "Las notificaciones están bloqueadas. Actívalas desde la configuración del navegador.";
    permissionButton.hidden = true;
  } else {
    permissionText.textContent = "Activa las notificaciones para recibir avisos aunque estés en otra ventana.";
    permissionButton.textContent = "Permitir notificaciones";
  }
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    updatePermissionBanner();
    return false;
  }
  const permission = await Notification.requestPermission();
  updatePermissionBanner();
  return permission === "granted";
}

function syncAlarmsWithWorker() {
  alarmWorker.postMessage({
    type: "sync",
    alarms: state.alarms.map(({ time, label, enabled }) => ({ time, label, enabled })),
    saturdayReminder: state.saturdayReminder,
  });
}

alarmWorker.addEventListener("message", (event) => {
  if (event.data?.type === "saturday-reminder") {
    if (state.saturdayReminder.lastTriggered === event.data.dateKey) return;
    state.saturdayReminder.lastTriggered = event.data.dateKey;
    saveState();
    showNotification(event.data.label);
    playAlarmBeep();
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Recordatorio de jornada", {
        body: event.data.label,
        tag: "retention-saturday-reminder",
        silent: true,
      });
    }
    return;
  }
  if (event.data?.type !== "alarm") return;
  const { index, label, dateKey } = event.data;
  const alarm = state.alarms[index];
  if (!alarm || alarm.lastTriggered === dateKey) return;

  alarm.lastTriggered = dateKey;
  saveState();
  showNotification(label || `Pausa ${index + 1}`);
  playAlarmBeep();
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Momento de tu pausa", {
      body: label || `Pausa ${index + 1}`,
      tag: `retention-break-${index}`,
      silent: true,
    });
  }
});

alarmWorker.addEventListener("error", (event) => {
  console.error("No se pudo iniciar el reloj de alarmas.", event.error || event.message);
});

document.querySelectorAll(".add-button").forEach((button) => {
  button.addEventListener("click", () => {
    unlockAudio();
    addCount(button.dataset.type);
  });
});

document.querySelectorAll(".status-button").forEach((button) => {
  button.addEventListener("click", () => submitAttendance(button.dataset.status));
});

document.querySelectorAll(".type-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedAttendanceType = button.dataset.attendanceType;
    document.querySelectorAll(".type-button").forEach((item) => item.classList.toggle("active", item === button));
  });
});

attendanceForm.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.target.matches("textarea")) return;
  event.preventDefault();
  submitAttendance(selectedAttendanceStatus);
});

exportAttendancesButton.addEventListener("click", exportAttendancesToExcel);

copyAttendanceNotesButton.addEventListener("click", async () => {
  const notes = attendanceForm.elements.annotations.value.trim();
  if (!notes) {
    attendanceStatus.textContent = "No hay anotaciones para copiar.";
    return;
  }
  try {
    await navigator.clipboard.writeText(notes);
    attendanceStatus.textContent = "Anotaciones copiadas.";
  } catch (error) {
    console.error("No se pudieron copiar las anotaciones.", error);
    attendanceStatus.textContent = "No se pudieron copiar las anotaciones.";
  }
});

function showView(view) {
  document.querySelectorAll(".side-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  document.querySelectorAll("[data-view-section]").forEach((section) => {
    const isVisible = section.dataset.viewSection === view;
    section.hidden = !isVisible;
    section.classList.toggle("is-hidden", !isVisible);
  });
}

document.querySelectorAll(".side-nav-item").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
showView("atendimientos");

document.querySelector("#sidebarToggle").addEventListener("click", () => {
  const collapsed = document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
  const toggle = document.querySelector("#sidebarToggle");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "Expandir menú" : "Contraer menú");
  toggle.textContent = collapsed ? "›" : "‹";
});

alarmList.addEventListener("input", (event) => {
  unlockAudio();
  const target = event.target;
  const index = Number(target.dataset.alarm);
  const field = target.dataset.field;
  if (!Number.isInteger(index) || !field) return;
  if (field === "enabled" && target.checked && (!("Notification" in window) || Notification.permission !== "granted")) {
    requestNotificationPermission().then((granted) => {
      if (!granted) {
        target.checked = false;
        state.alarms[index].enabled = false;
        saveState();
        renderAlarms();
        return;
      }
      state.alarms[index].enabled = true;
      saveState();
      renderAlarms();
      syncAlarmsWithWorker();
    });
    return;
  }
  state.alarms[index][field] = target.type === "checkbox" ? target.checked : target.value;
  saveState();
  if (field === "enabled" || field === "time") renderAlarms();
  syncAlarmsWithWorker();
});

workSaturday.addEventListener("change", updateSaturdayReminder);

workSaturdayEnabled.addEventListener("change", () => {
  if (workSaturdayEnabled.checked && (!("Notification" in window) || Notification.permission !== "granted")) {
    requestNotificationPermission().then((granted) => {
      if (!granted) {
        workSaturdayEnabled.checked = false;
        updateSaturdayReminder();
        return;
      }
      updateSaturdayReminder();
    });
    return;
  }
  updateSaturdayReminder();
});

permissionButton.addEventListener("click", () => {
  unlockAudio();
  requestNotificationPermission();
});

document.addEventListener("click", unlockAudio, { once: true });

document.querySelector("#clearHistory").addEventListener("click", () => {
  if (!Object.keys(state.days).length) return;
  if (window.confirm("¿Quieres borrar todo el historial diario?")) {
    state.days = {};
    saveState();
    renderDashboard();
  }
});

monthSelector.value = currentMonthKey();
monthSelector.addEventListener("change", renderMonthlyDashboard);
document.querySelector("#sendDailyReport").addEventListener("click", () => {
  sendReport(localDateKey(), "daily");
});
document.querySelector("#sendMonthlyReport").addEventListener("click", () => {
  sendReport(monthSelector.value || currentMonthKey(), "monthly");
});
noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = document.querySelector("#noteTitle").value.trim();
  const content = document.querySelector("#noteContent").value.trim();
  if (!title || !content) return;
  const submitButton = noteForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  noteStatus.className = "note-status";
  noteStatus.textContent = "Enviando nota a Discord...";
  const note = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    content,
    createdAt: new Date().toISOString(),
  };

  try {
    const response = await fetch("/api/discord-note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, content: note.content, createdAt: note.createdAt }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Discord no pudo recibir la nota.");
    }
    state.notes.push(note);
    noteStatus.className = "note-status success";
    noteStatus.textContent = "Nota guardada y enviada a Discord.";
  } catch (error) {
    state.notes.push(note);
    noteStatus.className = "note-status error";
    noteStatus.textContent = `Nota guardada localmente, pero no se pudo enviar: ${error.message}`;
  } finally {
    saveState();
    noteForm.reset();
    submitButton.disabled = false;
  }
  renderNotes();
});

notesList.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-note");
  if (!button) return;
  state.notes = state.notes.filter((note) => note.id !== button.dataset.noteId);
  saveState();
  renderNotes();
});

scriptsList.addEventListener("click", (event) => {
  const customCopyButton = event.target.closest("[data-custom-script-index]");
  if (customCopyButton) {
    copyScript(customScripts[Number(customCopyButton.dataset.customScriptIndex)].text, customCopyButton);
    return;
  }
  const deleteButton = event.target.closest("[data-custom-script-delete]");
  if (deleteButton) {
    const scriptIndex = Number(deleteButton.dataset.customScriptDelete);
    const [script] = customScripts.splice(scriptIndex, 1);
    localStorage.setItem(`${STORAGE_KEY}-scripts`, JSON.stringify(customScripts));
    renderScripts();
    deleteScriptFromDatabase(script.id).catch((error) => {
      console.error("No se pudo eliminar el script de MongoDB.", error);
    });
    return;
  }
  const button = event.target.closest(".copy-script");
  if (!button) return;
  copyScript(serviceScripts[Number(button.dataset.scriptIndex)].text, button);
});

document.querySelector("#toggleScriptForm").addEventListener("click", () => {
  const form = document.querySelector("#customScriptForm");
  form.hidden = !form.hidden;
  if (!form.hidden) document.querySelector("#scriptTitle").focus();
});

document.querySelector("#cancelScript").addEventListener("click", () => {
  document.querySelector("#customScriptForm").reset();
  document.querySelector("#customScriptForm").hidden = true;
});

document.querySelector("#customScriptForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = document.querySelector("#scriptTitle").value.trim();
  const text = document.querySelector("#scriptContent").value.trim();
  if (!title || !text) return;
  const script = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, text, createdAt: new Date().toISOString() };
  customScripts.push(script);
  localStorage.setItem(`${STORAGE_KEY}-scripts`, JSON.stringify(customScripts));
  event.currentTarget.reset();
  event.currentTarget.hidden = true;
  renderScripts();
  try {
    await saveScriptToDatabase(script);
  } catch (error) {
    console.error("No se pudo guardar el script en MongoDB.", error);
  }
});

document.querySelector("#resetToday").addEventListener("click", () => {
  const todayKey = localDateKey();
  const today = state.days[todayKey];
  if (!today || today.fiber + today.phone === 0) return;
  if (window.confirm("¿Quieres resetear los atendimientos de hoy? El historial de días anteriores se conservará.")) {
    delete state.days[todayKey];
    state.attendances = state.attendances.filter((record) => record.date !== todayKey);
    saveState();
    renderDashboard();
  }
});

renderDashboard();
loadAttendancesFromDatabase();
renderAlarms();
renderScripts();
loadScriptsFromDatabase();
renderSaturdayReminder();
updatePermissionBanner();
syncAlarmsWithWorker();
setInterval(checkScheduledReports, 30000);
