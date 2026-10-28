let alarms = [];
let lastMinute = "";

self.addEventListener("message", (event) => {
  if (event.data?.type === "sync") {
    alarms = event.data.alarms || [];
  }
});

function checkAlarms() {
  const now = new Date();
  const time = now.toTimeString().slice(0, 5);
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const minuteKey = `${dateKey}T${time}`;
  if (minuteKey === lastMinute) return;
  lastMinute = minuteKey;

  alarms.forEach((alarm, index) => {
    if (alarm.enabled && alarm.time === time) {
      self.postMessage({ type: "alarm", index, label: alarm.label, dateKey });
    }
  });
}

checkAlarms();
setInterval(checkAlarms, 1000);
