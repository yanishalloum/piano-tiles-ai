"use strict";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SONG_URL = "songs/letitbe.json";
const AUDIO_URL = "songs/letitbe.mp3";

const LOWEST_KEY = 21;   // A0
const HIGHEST_KEY = 108; // C8
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]); // C#, D#, F#, G#, A#

const KEYBOARD_HEIGHT = 120; // px
const FELT_HEIGHT = 6;       // px
const SECONDS_VISIBLE = 3;   // seconds of music shown above the keyboard

const COLORS = {
  stageTop: "#1c2642",
  stageBottom: "#0f1526",
  octaveGuide: "rgba(237, 227, 205, 0.06)",
  felt: "#7a2331",
  ivory: "#ede3cd",
  ivoryShade: "#cdbf9f",
  keyGap: "rgba(20, 18, 24, 0.45)",
  ebony: "#18171c",
  ebonyHighlight: "#3b3943",
  left: "#5b86c5",
  right: "#c9a04e",
  unknown: "#9aa0ae",
};

// ---------------------------------------------------------------------------
// Keyboard geometry
// ---------------------------------------------------------------------------

function isBlackKey(pitch) {
  return BLACK_KEY_CLASSES.has(pitch % 12);
}

/**
 * Compute the horizontal position and width of every key.
 * Returns a Map from MIDI pitch to {x, width, black}.
 */
function buildKeyLayout(totalWidth) {
  let whiteCount = 0;
  for (let pitch = LOWEST_KEY; pitch <= HIGHEST_KEY; pitch++) {
    if (!isBlackKey(pitch)) whiteCount++;
  }
  const whiteWidth = totalWidth / whiteCount;
  const blackWidth = whiteWidth * 0.6;

  const layout = new Map();
  let whiteIndex = 0;
  for (let pitch = LOWEST_KEY; pitch <= HIGHEST_KEY; pitch++) {
    if (isBlackKey(pitch)) {
      layout.set(pitch, { x: whiteIndex * whiteWidth - blackWidth / 2, width: blackWidth, black: true });
    } else {
      layout.set(pitch, { x: whiteIndex * whiteWidth, width: whiteWidth, black: false });
      whiteIndex++;
    }
  }
  return layout;
}

function handColor(hand) {
  if (hand === "left") return COLORS.left;
  if (hand === "right") return COLORS.right;
  return COLORS.unknown;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const audio = document.getElementById("player");

const state = {
  song: null,
  width: 0,
  height: 0,
  layout: new Map(),
};

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  state.width = canvas.clientWidth;
  state.height = canvas.clientHeight;
  canvas.width = Math.round(state.width * ratio);
  canvas.height = Math.round(state.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  state.layout = buildKeyLayout(state.width);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawStage(hitLine) {
  const gradient = ctx.createLinearGradient(0, 0, 0, hitLine);
  gradient.addColorStop(0, COLORS.stageTop);
  gradient.addColorStop(1, COLORS.stageBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, hitLine);

  // A faint line above every C helps reading the octaves.
  ctx.strokeStyle = COLORS.octaveGuide;
  ctx.lineWidth = 1;
  for (const [pitch, key] of state.layout) {
    if (pitch % 12 !== 0) continue;
    ctx.beginPath();
    ctx.moveTo(Math.round(key.x) + 0.5, 0);
    ctx.lineTo(Math.round(key.x) + 0.5, hitLine);
    ctx.stroke();
  }
}

function drawTile(note, time, hitLine, pixelsPerSecond) {
  const key = state.layout.get(note.pitch);
  if (!key) return;

  const bottom = hitLine - (note.start - time) * pixelsPerSecond;
  const top = hitLine - (note.end - time) * pixelsPerSecond;
  const y = Math.max(top, 0);
  const height = Math.min(bottom, hitLine) - y;
  if (height <= 0) return;

  const inset = key.black ? 1 : 2;
  ctx.globalAlpha = 0.55 + 0.45 * (note.velocity / 127);
  ctx.fillStyle = handColor(note.hand);
  ctx.beginPath();
  ctx.roundRect(key.x + inset, y, key.width - 2 * inset, height, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawKeyboard(top, height, activeKeys) {
  const ivory = ctx.createLinearGradient(0, top, 0, top + height);
  ivory.addColorStop(0, COLORS.ivory);
  ivory.addColorStop(1, COLORS.ivoryShade);

  for (const [pitch, key] of state.layout) {
    if (key.black) continue;
    const hand = activeKeys.get(pitch);
    ctx.fillStyle = hand === undefined ? ivory : handColor(hand);
    ctx.fillRect(key.x, top, key.width, height);
    ctx.fillStyle = COLORS.keyGap;
    ctx.fillRect(key.x, top, 1, height);
  }

  const blackHeight = height * 0.62;
  const ebony = ctx.createLinearGradient(0, top, 0, top + blackHeight);
  ebony.addColorStop(0, COLORS.ebonyHighlight);
  ebony.addColorStop(1, COLORS.ebony);

  for (const [pitch, key] of state.layout) {
    if (!key.black) continue;
    const hand = activeKeys.get(pitch);
    ctx.fillStyle = hand === undefined ? ebony : handColor(hand);
    ctx.beginPath();
    ctx.roundRect(key.x, top, key.width, blackHeight, [0, 0, 3, 3]);
    ctx.fill();
  }
}

function drawFrame() {
  const time = audio.currentTime;
  const keyboardTop = state.height - KEYBOARD_HEIGHT;
  const hitLine = keyboardTop - FELT_HEIGHT;
  const pixelsPerSecond = hitLine / SECONDS_VISIBLE;

  drawStage(hitLine);

  const activeKeys = new Map();
  if (state.song) {
    for (const note of state.song.notes) {
      if (note.start > time + SECONDS_VISIBLE) break; // notes are sorted by start time
      if (note.end < time) continue;
      if (note.start <= time) activeKeys.set(note.pitch, note.hand);
      drawTile(note, time, hitLine, pixelsPerSecond);
    }
  }

  ctx.fillStyle = COLORS.felt;
  ctx.fillRect(0, hitLine, state.width, FELT_HEIGHT);
  drawKeyboard(keyboardTop, KEYBOARD_HEIGHT, activeKeys);

  requestAnimationFrame(drawFrame);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function togglePlayback() {
  if (audio.paused) {
    audio.play().catch((error) => console.error(error));
  } else {
    audio.pause();
  }
}

function updateStatus() {
  document.getElementById("status").textContent = audio.paused
    ? "Espace ou clic pour lancer la lecture"
    : "Espace ou clic pour mettre en pause";
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes} min ${rest}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function loadSong(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossible de charger ${url} (erreur HTTP ${response.status})`);
  }
  return response.json();
}

async function main() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  requestAnimationFrame(drawFrame);

  canvas.addEventListener("click", togglePlayback);
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    }
  });
  audio.addEventListener("play", updateStatus);
  audio.addEventListener("pause", updateStatus);

  try {
    state.song = await loadSong(SONG_URL);
    audio.src = AUDIO_URL;
    document.getElementById("title").textContent = state.song.title;
    document.getElementById("details").textContent =
      `${state.song.notes.length} notes, ${formatDuration(state.song.duration)}`;
  } catch (error) {
    document.getElementById("details").textContent = error.message;
    console.error(error);
  }
}

main();