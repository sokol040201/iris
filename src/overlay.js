const RING = 2 * Math.PI * 52;

const photo = document.getElementById("photo");
const title = document.getElementById("title");
const lead = document.getElementById("lead");
const countdown = document.getElementById("countdown");
const progress = document.getElementById("progress");
const skip = document.getElementById("skip");

progress.style.strokeDasharray = String(RING);
progress.style.strokeDashoffset = "0";

const demoPayload = {
  title: "Посмотри вдаль",
  body: "Найди точку метров за двадцать — дерево, крышу, линию горизонта — и держи взгляд, пока не закончится пауза.",
  image: "../assets/break-horizon.jpg",
  durationMs: 30000,
  allowSkip: true,
  sound: false,
};

let started = false;
let startedAt = 0;
let durationMs = 30000;
let frame = 0;

function format(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function chime(kind) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const now = ctx.currentTime;
  const notes = kind === "end" ? [392, 329.63] : [523.25, 659.25, 783.99];
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.03 + index * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9 + index * 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + index * 0.1);
    osc.stop(now + 1.1 + index * 0.12);
  });
  setTimeout(() => ctx.close(), 1800);
}

function render(now) {
  const elapsed = now - startedAt;
  const left = Math.max(0, durationMs - elapsed);
  const t = Math.min(1, elapsed / durationMs);
  countdown.textContent = format(left);
  progress.style.strokeDashoffset = String(RING * t);
  if (left <= 0) {
    cancelAnimationFrame(frame);
    return;
  }
  frame = requestAnimationFrame(render);
}

function start(payload) {
  if (started) return;
  started = true;
  durationMs = payload.durationMs || 30000;
  title.textContent = payload.title;
  lead.textContent = payload.body;
  photo.src = payload.image;
  skip.classList.toggle("hidden", !payload.allowSkip);
  startedAt = performance.now();
  if (payload.sound) chime("start");
  frame = requestAnimationFrame(render);
}

skip.addEventListener("click", () => {
  if (window.overlay) window.overlay.skip();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && window.overlay) {
    window.overlay.skip();
  }
});

if (window.overlay) {
  window.overlay.onStart(start);
} else {
  start(demoPayload);
}
