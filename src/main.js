const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
} = require("electron");
const path = require("path");
const store = require("./store");
const { pickBreak } = require("./breaks");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setName("Iris");
if (process.platform === "win32") {
  app.setAppUserModelId("com.iris.eyecare");
}

let settings = store.load();
let tray = null;
let settingsWin = null;
let overlayWindows = [];
let keepOnTopTimer = null;
let tickTimer = null;
let isQuitting = false;
let currentBreak = null;

const scheduler = {
  state: "idle",
  remainingMs: 0,
  endsAt: 0,
};

function assets(...parts) {
  return path.join(__dirname, "..", "assets", ...parts);
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function remainingNow() {
  if (scheduler.state === "paused") return scheduler.remainingMs;
  if (scheduler.state === "idle") return 0;
  return Math.max(0, scheduler.endsAt - Date.now());
}

function getStatus() {
  return {
    state: scheduler.state,
    remainingMs: remainingNow(),
    remainingLabel: formatRemaining(remainingNow()),
    enabled: settings.enabled,
  };
}

function broadcastStatus() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send("status:update", getStatus());
  }
}

function applyLoginItem() {
  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.openAtLogin),
    openAsHidden: true,
  });
}

function trayIcon() {
  const file = nativeImage.createFromPath(assets("tray.png"));
  const icon = file.isEmpty()
    ? nativeImage.createFromPath(assets("icon.png")).resize({ width: 16, height: 16 })
    : file.resize({ width: process.platform === "darwin" ? 18 : 16, height: process.platform === "darwin" ? 18 : 16 });
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }
  return icon;
}

function overlayPayload() {
  const picked = pickBreak();
  return {
    title: picked.title,
    body: picked.body,
    image: `../assets/${picked.image}`,
    durationMs: settings.breakSeconds * 1000,
    allowSkip: settings.allowSkip,
    sound: settings.sound,
  };
}

function destroyOverlays() {
  if (keepOnTopTimer) {
    clearInterval(keepOnTopTimer);
    keepOnTopTimer = null;
  }
  const windows = [...overlayWindows];
  overlayWindows = [];
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.removeAllListeners("close");
      win.destroy();
    }
  }
}

function createOverlayWindow(display, payload, { focus = false } = {}) {
  const { bounds } = display;
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: false,
    focusable: true,
    show: false,
    backgroundColor: "#101412",
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false);
  win.setMenuBarVisibility(false);

  win.on("close", (event) => {
    if (scheduler.state === "break" && !isQuitting) {
      event.preventDefault();
    }
  });

  win.loadFile(path.join(__dirname, "overlay.html"));
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("overlay:start", payload);
    win.show();
    win.setBounds(bounds);
    win.setAlwaysOnTop(true, "screen-saver");
    if (focus) win.focus();
  });

  return win;
}

function startBreak({ resume = false } = {}) {
  if (scheduler.state === "break" && !resume) return;

  const payload = resume && currentBreak
    ? { ...currentBreak, durationMs: Math.max(1000, remainingNow()), sound: false }
    : overlayPayload();
  currentBreak = { ...payload };

  destroyOverlays();

  const displays = screen.getAllDisplays();
  overlayWindows = displays.map((display, index) =>
    createOverlayWindow(display, { ...payload, sound: index === 0 && payload.sound }, { focus: index === 0 })
  );

  if (!resume) {
    scheduler.state = "break";
    scheduler.remainingMs = payload.durationMs;
    scheduler.endsAt = Date.now() + payload.durationMs;
  }

  keepOnTopTimer = setInterval(() => {
    for (const win of overlayWindows) {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(true, "screen-saver");
        win.moveTop();
      }
    }
  }, 800);

  scheduleTick();
  updateTray();
  broadcastStatus();
}

function endBreak() {
  currentBreak = null;
  destroyOverlays();
  if (!settings.enabled) {
    scheduler.state = "idle";
    scheduler.remainingMs = 0;
    scheduler.endsAt = 0;
  } else {
    startWork();
    return;
  }
  scheduleTick();
  updateTray();
  broadcastStatus();
}

function startWork() {
  if (!settings.enabled) {
    scheduler.state = "idle";
    scheduler.remainingMs = 0;
    scheduler.endsAt = 0;
    scheduleTick();
    updateTray();
    broadcastStatus();
    return;
  }

  scheduler.state = "running";
  scheduler.remainingMs = settings.intervalMinutes * 60 * 1000;
  scheduler.endsAt = Date.now() + scheduler.remainingMs;
  scheduleTick();
  updateTray();
  broadcastStatus();
}

function pauseTimer() {
  if (scheduler.state !== "running") return;
  scheduler.remainingMs = remainingNow();
  scheduler.state = "paused";
  scheduleTick();
  updateTray();
  broadcastStatus();
}

function resumeTimer() {
  if (scheduler.state !== "paused") return;
  scheduler.state = "running";
  scheduler.endsAt = Date.now() + scheduler.remainingMs;
  scheduleTick();
  updateTray();
  broadcastStatus();
}

function scheduleTick() {
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }

  const step = () => {
    const left = remainingNow();
    updateTrayTooltip();
    broadcastStatus();

    if (scheduler.state === "running" && left <= 0) {
      startBreak();
      return;
    }
    if (scheduler.state === "break" && left <= 0) {
      endBreak();
      return;
    }

    const delay = scheduler.state === "paused" || scheduler.state === "idle" ? 1000 : Math.min(250, Math.max(50, left));
    tickTimer = setTimeout(step, delay);
  };

  tickTimer = setTimeout(step, 200);
}

function statusLabel() {
  if (!settings.enabled) return "Напоминания выключены";
  if (scheduler.state === "paused") return `На паузе · осталось ${formatRemaining(scheduler.remainingMs)}`;
  if (scheduler.state === "break") return `Пауза · ${formatRemaining(remainingNow())}`;
  if (scheduler.state === "running") return `Следующая пауза через ${formatRemaining(remainingNow())}`;
  return "Iris";
}

function updateTrayTooltip() {
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(statusLabel());
  }
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  updateTrayTooltip();
  const paused = scheduler.state === "paused";
  const breaking = scheduler.state === "break";

  const template = [
    { label: statusLabel(), enabled: false },
    { type: "separator" },
    {
      label: "Пауза сейчас",
      enabled: !breaking,
      click: () => startBreak(),
    },
    paused
      ? { label: "Продолжить таймер", click: () => resumeTimer() }
      : { label: "Приостановить таймер", enabled: scheduler.state === "running", click: () => pauseTimer() },
    { type: "separator" },
    { label: "Настройки", click: () => openSettings() },
    { type: "separator" },
    {
      label: "Выйти",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function syncDock() {
  if (process.platform !== "darwin") return;
  const visible = settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible();
  if (visible) app.dock.show();
  else app.dock.hide();
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    syncDock();
    return;
  }

  const isMac = process.platform === "darwin";
  settingsWin = new BrowserWindow({
    width: 420,
    height: isMac ? 756 : 720,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Iris",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    vibrancy: isMac ? "under-window" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    transparent: isMac,
    backgroundColor: isMac ? "#00000000" : "#f3f0e8",
    autoHideMenuBar: true,
    show: false,
    icon: assets("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload-settings.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.once("ready-to-show", () => {
    settingsWin.show();
    syncDock();
  });
  settingsWin.on("closed", () => {
    settingsWin = null;
    syncDock();
  });
}

function applySettings(next) {
  const previous = settings;
  settings = store.save({ ...previous, ...next, hasLaunched: true });
  applyLoginItem();

  const intervalChanged = settings.intervalMinutes !== previous.intervalMinutes;
  const enabledChanged = settings.enabled !== previous.enabled;

  if (!settings.enabled) {
    if (scheduler.state !== "break") {
      scheduler.state = "idle";
      scheduler.remainingMs = 0;
      scheduler.endsAt = 0;
    }
    scheduleTick();
    updateTray();
    broadcastStatus();
    return settings;
  }

  if (scheduler.state !== "break" && (enabledChanged || intervalChanged || scheduler.state === "idle")) {
    if (scheduler.state === "paused" && intervalChanged) {
      scheduler.remainingMs = settings.intervalMinutes * 60 * 1000;
    } else if (scheduler.state !== "paused") {
      startWork();
      return settings;
    }
  }

  updateTray();
  broadcastStatus();
  return settings;
}

ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:save", (_event, next) => applySettings(next));
ipcMain.handle("status:get", () => getStatus());
ipcMain.on("break:now", () => startBreak());
ipcMain.on("timer:pause", () => pauseTimer());
ipcMain.on("timer:resume", () => resumeTimer());
ipcMain.on("overlay:skip", () => {
  if (settings.allowSkip && scheduler.state === "break") {
    endBreak();
  }
});

app.on("window-all-closed", () => {
  // Stay in the tray.
});

app.on("before-quit", () => {
  isQuitting = true;
  destroyOverlays();
  if (tickTimer) clearTimeout(tickTimer);
});

app.on("second-instance", () => {
  openSettings();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  settings = store.load();
  applyLoginItem();

  if (process.platform === "darwin") {
    app.dock.hide();
  }

  tray = new Tray(trayIcon());
  tray.on("click", () => {
    if (process.platform === "win32") openSettings();
  });
  tray.on("double-click", () => openSettings());
  updateTray();

  if (settings.enabled) startWork();
  else {
    scheduler.state = "idle";
    updateTray();
  }

  if (!settings.hasLaunched) {
    settings = store.save({ ...settings, hasLaunched: true });
    openSettings();
  }

  screen.on("display-added", () => {
    if (scheduler.state === "break") startBreak({ resume: true });
  });
  screen.on("display-removed", () => {
    if (scheduler.state === "break") startBreak({ resume: true });
  });
});

app.on("activate", () => {
  openSettings();
});
