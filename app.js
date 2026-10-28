const STORAGE_KEY = "retention-dashboard-v1";
const alarmCount = 8;

const state = loadState();
const currentDate = document.querySelector("#currentDate");
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
let audioContext;

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
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
        notes: Array.isArray(saved.notes) ? saved.notes : [],
        reportSent: saved.reportSent || {},
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
    notes: [],
    reportSent: {},
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

function getToday() {
  const key = localDateKey();
  return state.days[key] || { fiber: 0, phone: 0 };
}

function renderDashboard() {
  const today = getToday();
  fiberCount.textContent = today.fiber;
  phoneCount.textContent = today.phone;
  todayTotal.textContent = today.fiber + today.phone;
  currentDate.textContent = `· ${formatDate(localDateKey())}`;

  const days = Object.entries(state.days).sort(([first], [second]) => second.localeCompare(first));
  historyBody.innerHTML = days.map(([date, counts]) => `
    <tr>
      <td>${formatDate(date)}</td>
      <td>${counts.fiber}</td>
      <td>${counts.phone}</td>
      <td>${counts.fiber + counts.phone}</td>
    </tr>
  `).join("");
  emptyHistory.hidden = days.length > 0;
  renderMonthlyDashboard();
  renderNotes();
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

  document.querySelector("#monthlyTotal").textContent = total;
  document.querySelector("#dailyAverage").textContent = monthDays.length ? (total / monthDays.length).toFixed(1) : "0";
  document.querySelector("#registeredDays").textContent = monthDays.length;
  document.querySelector("#monthlySplit").textContent = `${totals.fiber} / ${totals.phone}`;

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
  const report = buildReport(month, title);
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
  });
}

alarmWorker.addEventListener("message", (event) => {
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

document.querySelector("#resetToday").addEventListener("click", () => {
  const todayKey = localDateKey();
  const today = state.days[todayKey];
  if (!today || today.fiber + today.phone === 0) return;
  if (window.confirm("¿Quieres resetear los atendimientos de hoy? El historial de días anteriores se conservará.")) {
    delete state.days[todayKey];
    saveState();
    renderDashboard();
  }
});

renderDashboard();
renderAlarms();
updatePermissionBanner();
syncAlarmsWithWorker();
setInterval(checkScheduledReports, 30000);
