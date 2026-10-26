const demo = {
  settings: {
    intervalMinutes: 20,
    breakSeconds: 30,
    enabled: true,
    openAtLogin: false,
    allowSkip: true,
    sound: true,
  },
  status: {
    state: "running",
    remainingMs: 20 * 60 * 1000,
    remainingLabel: "20:00",
    enabled: true,
  },
};

const api = window.iris || {
  platform: "browser",
  getSettings: async () => demo.settings,
  saveSettings: async (next) => Object.assign(demo.settings, next),
  getStatus: async () => demo.status,
  onStatus: (callback) => {
    const timer = setInterval(() => callback(demo.status), 1000);
    return () => clearInterval(timer);
  },
  takeBreak: () => {},
  pause: () => {
    demo.status.state = "paused";
  },
  resume: () => {
    demo.status.state = "running";
  },
};

const fields = {
  enabled: document.getElementById("enabled"),
  intervalMinutes: document.getElementById("intervalMinutes"),
  breakSeconds: document.getElementById("breakSeconds"),
  openAtLogin: document.getElementById("openAtLogin"),
  allowSkip: document.getElementById("allowSkip"),
  sound: document.getElementById("sound"),
};

const statusLabel = document.getElementById("statusLabel");
const togglePause = document.getElementById("togglePause");
const takeBreak = document.getElementById("takeBreak");

let current = { ...demo.settings };
let status = { ...demo.status };
let saveTimer = 0;

function readForm() {
  return {
    enabled: fields.enabled.checked,
    intervalMinutes: Number(fields.intervalMinutes.value),
    breakSeconds: Number(fields.breakSeconds.value),
    openAtLogin: fields.openAtLogin.checked,
    allowSkip: fields.allowSkip.checked,
    sound: fields.sound.checked,
  };
}

function fillForm(settings) {
  current = settings;
  fields.enabled.checked = settings.enabled;
  fields.intervalMinutes.value = settings.intervalMinutes;
  fields.breakSeconds.value = settings.breakSeconds;
  fields.openAtLogin.checked = settings.openAtLogin;
  fields.allowSkip.checked = settings.allowSkip;
  fields.sound.checked = settings.sound;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    current = await api.saveSettings(readForm());
    fillForm(current);
  }, 120);
}

function renderStatus(next) {
  status = next;
  const labels = {
    idle: "Напоминания выключены",
    paused: `На паузе · осталось ${next.remainingLabel}`,
    break: `Сейчас пауза · ${next.remainingLabel}`,
    running: `Следующая пауза через ${next.remainingLabel}`,
  };
  statusLabel.textContent = labels[next.state] || labels.running;
  togglePause.textContent = next.state === "paused" ? "Продолжить" : "Приостановить";
  togglePause.disabled = next.state === "break" || next.state === "idle";
  takeBreak.disabled = next.state === "break";
}

document.querySelectorAll(".stepper button").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.target;
    const input = fields[key];
    const step = Number(button.dataset.step);
    const min = Number(input.min);
    const max = Number(input.max);
    input.value = Math.min(max, Math.max(min, Number(input.value) + step));
    persist();
  });
});

Object.values(fields).forEach((el) => {
  el.addEventListener("change", persist);
  el.addEventListener("input", () => {
    if (el.type === "number") persist();
  });
});

togglePause.addEventListener("click", () => {
  if (status.state === "paused") api.resume();
  else api.pause();
});

takeBreak.addEventListener("click", () => api.takeBreak());

(async () => {
  document.documentElement.classList.add(api.platform || "browser");
  fillForm(await api.getSettings());
  renderStatus(await api.getStatus());
  api.onStatus(renderStatus);
})();
