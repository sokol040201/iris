const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const defaults = {
  intervalMinutes: 20,
  breakSeconds: 30,
  enabled: true,
  openAtLogin: false,
  allowSkip: true,
  sound: true,
  hasLaunched: false,
};

function filePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalize(raw = {}) {
  return {
    intervalMinutes: clamp(raw.intervalMinutes ?? defaults.intervalMinutes, 1, 180),
    breakSeconds: clamp(raw.breakSeconds ?? defaults.breakSeconds, 10, 300),
    enabled: raw.enabled !== false,
    openAtLogin: Boolean(raw.openAtLogin),
    allowSkip: raw.allowSkip !== false,
    sound: raw.sound !== false,
    hasLaunched: Boolean(raw.hasLaunched),
  };
}

function load() {
  try {
    const text = fs.readFileSync(filePath(), "utf8");
    return normalize(JSON.parse(text));
  } catch {
    return { ...defaults };
  }
}

function save(next) {
  const settings = normalize(next);
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tmp, target);
  return settings;
}

module.exports = { defaults, load, save, normalize };
