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

function checkAlarms() {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);
  const todayKey = localDateKey(now);
  state.alarms.forEach((alarm, index) => {
    if (alarm.enabled && alarm.time === currentTime && alarm.lastTriggered !== todayKey) {
      alarm.lastTriggered = todayKey;
      saveState();
      showNotification(alarm.label || `Pausa ${index + 1}`);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Momento de tu pausa", {
          body: alarm.label || `Pausa ${index + 1}`,
          tag: `retention-break-${index}`,
        });
      }
    }
  });
}

document.querySelectorAll(".add-button").forEach((button) => {
  button.addEventListener("click", () => addCount(button.dataset.type));
});

alarmList.addEventListener("input", (event) => {
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
    });
    return;
  }
  state.alarms[index][field] = target.type === "checkbox" ? target.checked : target.value;
  saveState();
  if (field === "enabled" || field === "time") renderAlarms();
});

permissionButton.addEventListener("click", requestNotificationPermission);

document.querySelector("#clearHistory").addEventListener("click", () => {
  if (!Object.keys(state.days).length) return;
  if (window.confirm("¿Quieres borrar todo el historial diario?")) {
    state.days = {};
    saveState();
    renderDashboard();
  }
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
setInterval(checkAlarms, 1000);
