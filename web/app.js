"use strict";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const API_SONGS = "/api/songs";
const POLL_INTERVAL = 2000; // ms between two status checks while a song is processing

const LOWEST_KEY = 21;   // A0
const HIGHEST_KEY = 108; // C8
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]); // C#, D#, F#, G#, A#

const SECONDS_VISIBLE = 3;   // seconds of music shown above the keyboard
const SKIP_SECONDS = 5;      // jump size for the arrow buttons and keys
const FALLBOARD_HEIGHT = 22; // px, lacquered band where the tiles end
const FELT_HEIGHT = 5;       // px, red felt strip above the keys
const KEY_FRONT = 9;         // px, visible front edge of the white keys
const PRESS_DEPTH = 3;       // px, how far a played key sinks

const COLORS = {
  stageTop: "#1b2643",
  stageBottom: "#0e1424",
  spotlight: "rgba(255, 222, 160, 0.09)",
  octaveGuide: "rgba(237, 227, 205, 0.055)",
  lacquerTop: "#24232b",
  lacquerBottom: "#0d0d11",
  lacquerShine: "rgba(255, 255, 255, 0.16)",
  felt: "#7a2331",
  feltShadow: "rgba(0, 0, 0, 0.35)",
  ivory: "#efe6d2",
  ivoryShade: "#d9cbab",
  ivoryFront: "#b8a785",
  keyGap: "rgba(30, 26, 22, 0.5)",
  ebonyTop: "#3a3842",
  ebony: "#17161b",
  ebonySlope: "#2c2b33",
  whiteKeyLabel: "#8a7c5c",
  blackKeyLabel: "rgba(237, 227, 205, 0.55)",
  tileLabel: "rgba(14, 20, 36, 0.85)",
  hands: {
    left: { light: "#9cbcf0", base: "#5f8fd6", dark: "#2c4c84" },
    right: { light: "#f0cf86", base: "#d0a24f", dark: "#7d5a1c" },
    unknown: { light: "#c5c9d3", base: "#9aa0ae", dark: "#555b68" },
  },
};

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function handPalette(hand) {
  return COLORS.hands[hand] ?? COLORS.hands.unknown;
}

// ---------------------------------------------------------------------------
// Note names
// ---------------------------------------------------------------------------

const NOTE_NAMES = {
  english: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"],
  solfege: ["Do", "Do♯", "Ré", "Ré♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"],
};

function noteName(pitch, convention) {
  return NOTE_NAMES[convention][pitch % 12];
}

/** Octave number: middle C (60) is C4 in English and Do3 in French solfège. */
function octaveNumber(pitch, convention) {
  return Math.floor(pitch / 12) - (convention === "solfege" ? 2 : 1);
}

function loadConvention() {
  try {
    return localStorage.getItem("noteNames") ?? "solfege";
  } catch {
    return "solfege";
  }
}

function saveConvention(convention) {
  try {
    localStorage.setItem("noteNames", convention);
  } catch {
    // Storage may be unavailable (private browsing): the choice is simply not remembered.
  }
}

/**
 * Set the largest font (from maxSize down to minSize) at which `text` fits in
 * `maxWidth`. Returns false if it never fits.
 */
function fitFont(text, family, maxSize, minSize, maxWidth) {
  for (let size = maxSize; size >= minSize; size--) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const players = {
  mix: document.getElementById("audio-mix"),
  piano: document.getElementById("audio-piano"),
};

const controls = {
  play: document.getElementById("play"),
  back: document.getElementById("back"),
  forward: document.getElementById("forward"),
  seek: document.getElementById("seek"),
  clockNow: document.getElementById("clock-now"),
  clockTotal: document.getElementById("clock-total"),
  speed: document.getElementById("speed"),
  speedValue: document.getElementById("speed-value"),
  names: document.getElementById("names"),
  sourceButtons: document.querySelectorAll(".source button"),
};

const libraryUi = {
  panel: document.getElementById("library"),
  toggle: document.getElementById("library-toggle"),
  close: document.getElementById("library-close"),
  addButton: document.getElementById("add-song"),
  fileInput: document.getElementById("file-input"),
  message: document.getElementById("library-message"),
  list: document.getElementById("song-list"),
  overlay: document.getElementById("drop-overlay"),
};

const state = {
  song: null,
  audio: players.mix, // the active player, which is also the clock
  seeking: false,
  convention: loadConvention(),
  width: 0,
  height: 0,
  keyboardHeight: 0,
  layout: new Map(),
  lastTime: 0,        // audio time of the previous frame, to detect new notes
  lastFrame: 0,       // real time of the previous frame, to animate the sparks
  sparks: [],
  songs: [],          // the library, as returned by the server
  currentId: null,    // id of the song being played
  pollTimer: null,
  pendingDelete: null,
  dragDepth: 0,
};

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  state.width = canvas.clientWidth;
  state.height = canvas.clientHeight;
  canvas.width = Math.round(state.width * ratio);
  canvas.height = Math.round(state.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  state.layout = buildKeyLayout(state.width);
  state.keyboardHeight = Math.min(150, Math.max(96, state.height * 0.24));
}

// ---------------------------------------------------------------------------
// Sparks
// ---------------------------------------------------------------------------

function spawnSparks(x, y, color) {
  if (REDUCED_MOTION) return;
  for (let i = 0; i < 9; i++) {
    state.sparks.push({
      x: x + (Math.random() - 0.5) * 6,
      y,
      vx: (Math.random() - 0.5) * 110,
      vy: -(50 + Math.random() * 140),
      age: 0,
      life: 0.35 + Math.random() * 0.35,
      size: 0.8 + Math.random() * 1.6,
      color,
    });
  }
  if (state.sparks.length > 600) state.sparks.splice(0, state.sparks.length - 600);
}

function updateAndDrawSparks(dt) {
  const gravity = 320;
  for (const spark of state.sparks) {
    spark.age += dt;
    spark.vy += gravity * dt;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
  }
  state.sparks = state.sparks.filter((spark) => spark.age < spark.life);

  for (const spark of state.sparks) {
    ctx.globalAlpha = 1 - spark.age / spark.life;
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Drawing: stage and tiles
// ---------------------------------------------------------------------------

function drawStage(hitLine) {
  const base = ctx.createLinearGradient(0, 0, 0, hitLine);
  base.addColorStop(0, COLORS.stageTop);
  base.addColorStop(1, COLORS.stageBottom);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, state.width, hitLine);

  // A soft spotlight from above, as on a club stage.
  const cx = state.width / 2;
  const spot = ctx.createRadialGradient(cx, -hitLine * 0.2, 0, cx, -hitLine * 0.2, hitLine * 1.2);
  spot.addColorStop(0, COLORS.spotlight);
  spot.addColorStop(1, "rgba(255, 222, 160, 0)");
  ctx.fillStyle = spot;
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

/** Screen rectangle of a tile, clipped between the top of the stage and the hit line. */
function tileRect(note, key, time, hitLine, pixelsPerSecond) {
  const inset = key.black ? 1 : 2;
  const bottom = hitLine - (note.start - time) * pixelsPerSecond;
  const top = hitLine - (note.end - time) * pixelsPerSecond;
  const y = Math.max(top, -8);
  const height = Math.min(bottom, hitLine) - y;
  return { x: key.x + inset, y, width: key.width - 2 * inset, height };
}

function drawTile(note, rect, withLabel) {
  const palette = handPalette(note.hand);
  const radius = Math.min(5, rect.width / 3, rect.height / 2);

  const fill = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
  fill.addColorStop(0, palette.base);
  fill.addColorStop(1, palette.light);

  ctx.globalAlpha = 0.6 + 0.4 * (note.velocity / 127);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fill();
  ctx.strokeStyle = palette.dark;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (!withLabel || state.convention === "none" || rect.height < 18) return;
  const label = noteName(note.pitch, state.convention);
  if (!fitFont(label, '"League Gothic", "Arial Narrow", sans-serif', 15, 9, rect.width - 3)) return;
  ctx.fillStyle = COLORS.tileLabel;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height - 3);
}

/** Light beam rising from the hit line above every key being played. */
function drawBeams(activeNotes, hitLine) {
  for (const note of activeNotes) {
    const key = state.layout.get(note.pitch);
    if (!key) continue;
    const palette = handPalette(note.hand);
    const beam = ctx.createLinearGradient(0, hitLine - 46, 0, hitLine);
    beam.addColorStop(0, "rgba(0, 0, 0, 0)");
    beam.addColorStop(1, palette.light);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = beam;
    ctx.fillRect(key.x - 3, hitLine - 46, key.width + 6, 46);
  }
  ctx.globalAlpha = 1;
}

/** The lacquered fallboard: a glossy black band that mirrors the tiles above it. */
function drawFallboard(tiles, hitLine) {
  const lacquer = ctx.createLinearGradient(0, hitLine, 0, hitLine + FALLBOARD_HEIGHT);
  lacquer.addColorStop(0, COLORS.lacquerTop);
  lacquer.addColorStop(1, COLORS.lacquerBottom);
  ctx.fillStyle = lacquer;
  ctx.fillRect(0, hitLine, state.width, FALLBOARD_HEIGHT);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hitLine, state.width, FALLBOARD_HEIGHT);
  ctx.clip();
  ctx.translate(0, 2 * hitLine);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.28;
  for (const { note, rect } of tiles) {
    if (rect.y + rect.height < hitLine - FALLBOARD_HEIGHT) continue;
    ctx.fillStyle = handPalette(note.hand).base;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();

  ctx.fillStyle = COLORS.lacquerShine;
  ctx.fillRect(0, hitLine, state.width, 1);

  ctx.fillStyle = COLORS.felt;
  ctx.fillRect(0, hitLine + FALLBOARD_HEIGHT, state.width, FELT_HEIGHT);
}

// ---------------------------------------------------------------------------
// Drawing: keyboard
// ---------------------------------------------------------------------------

function drawWhiteKeys(top, height, activeKeys) {
  const surfaceHeight = height - KEY_FRONT;
  const ivory = ctx.createLinearGradient(0, top, 0, top + surfaceHeight);
  ivory.addColorStop(0, COLORS.ivoryShade);
  ivory.addColorStop(0.18, COLORS.ivory);
  ivory.addColorStop(1, COLORS.ivory);

  for (const [pitch, key] of state.layout) {
    if (key.black) continue;
    const hand = activeKeys.get(pitch);
    const pressed = hand !== undefined;
    const offset = pressed ? PRESS_DEPTH : 0;

    if (pressed) {
      const palette = handPalette(hand);
      const lit = ctx.createLinearGradient(0, top, 0, top + surfaceHeight);
      lit.addColorStop(0, palette.base);
      lit.addColorStop(1, palette.light);
      ctx.fillStyle = lit;
    } else {
      ctx.fillStyle = ivory;
    }
    ctx.fillRect(key.x, top + offset, key.width, surfaceHeight);

    ctx.fillStyle = pressed ? handPalette(hand).dark : COLORS.ivoryFront;
    ctx.fillRect(key.x, top + offset + surfaceHeight, key.width, KEY_FRONT - offset);

    ctx.fillStyle = COLORS.keyGap;
    ctx.fillRect(key.x, top, 1, height);
  }
}

function drawBlackKeys(top, height, activeKeys) {
  const blackHeight = height * 0.6;

  for (const [pitch, key] of state.layout) {
    if (!key.black) continue;
    const hand = activeKeys.get(pitch);
    const pressed = hand !== undefined;
    const offset = pressed ? PRESS_DEPTH - 1 : 0;

    // Shadow cast on the white keys.
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.beginPath();
    ctx.roundRect(key.x + 2, top, key.width, blackHeight + 3, [0, 0, 3, 3]);
    ctx.fill();

    let body;
    if (pressed) {
      const palette = handPalette(hand);
      body = ctx.createLinearGradient(0, top, 0, top + blackHeight);
      body.addColorStop(0, palette.dark);
      body.addColorStop(1, palette.base);
    } else {
      body = ctx.createLinearGradient(0, top, 0, top + blackHeight);
      body.addColorStop(0, COLORS.ebonyTop);
      body.addColorStop(0.25, COLORS.ebony);
      body.addColorStop(1, COLORS.ebony);
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(key.x, top + offset, key.width, blackHeight - offset, [0, 0, 3, 3]);
    ctx.fill();

    // The sloped front of the key catches a little light.
    if (!pressed) {
      ctx.fillStyle = COLORS.ebonySlope;
      ctx.beginPath();
      ctx.roundRect(key.x + 1.5, top + blackHeight - 8, key.width - 3, 6, 2);
      ctx.fill();
    }
  }
}

function drawKeyLabels(top, height, activeKeys) {
  if (state.convention === "none") return;
  const surfaceBottom = top + height - KEY_FRONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  for (const [pitch, key] of state.layout) {
    const pressed = activeKeys.has(pitch);
    const name = noteName(pitch, state.convention);
    const cx = key.x + key.width / 2;

    if (key.black) {
      // Black keys are narrow: the name and the sharp sign go on two lines.
      const base = name.replace("♯", "");
      const bottom = top + height * 0.6 - 10 + (pressed ? PRESS_DEPTH - 1 : 0);
      if (!fitFont(base, '"League Gothic", "Arial Narrow", sans-serif', 14, 8, key.width - 2)) continue;
      ctx.fillStyle = pressed ? COLORS.ivory : COLORS.blackKeyLabel;
      ctx.fillText(base, cx, bottom - 11);
      ctx.fillText("♯", cx, bottom);
      continue;
    }

    const offset = pressed ? PRESS_DEPTH : 0;
    const color = pressed ? COLORS.tileLabel : COLORS.whiteKeyLabel;
    if (!fitFont(name, '"Newsreader", Georgia, serif', 13, 8, key.width - 3)) continue;
    ctx.fillStyle = color;
    ctx.fillText(name, cx, surfaceBottom + offset - 17);

    const octave = String(octaveNumber(pitch, state.convention));
    ctx.font = `${pitch % 12 === 0 ? 500 : 400} 10px "Newsreader", Georgia, serif`;
    ctx.globalAlpha = pitch % 12 === 0 ? 1 : 0.65;
    ctx.fillText(octave, cx, surfaceBottom + offset - 5);
    ctx.globalAlpha = 1;
  }
}

function drawKeyboard(top, height, activeKeys) {
  drawWhiteKeys(top, height, activeKeys);

  // The felt and the fallboard cast a soft shadow on the keys.
  const shadow = ctx.createLinearGradient(0, top, 0, top + 12);
  shadow.addColorStop(0, COLORS.feltShadow);
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(0, top, state.width, 12);

  drawBlackKeys(top, height, activeKeys);
  drawKeyLabels(top, height, activeKeys);
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function drawFrame(now) {
  const dt = state.lastFrame ? Math.min((now - state.lastFrame) / 1000, 0.1) : 0;
  state.lastFrame = now;

  const time = state.audio.currentTime;
  const keyboardTop = state.height - state.keyboardHeight;
  const hitLine = keyboardTop - FELT_HEIGHT - FALLBOARD_HEIGHT;
  const pixelsPerSecond = hitLine / SECONDS_VISIBLE;

  // Sparks only for notes reached by normal playback, not when jumping around.
  const elapsed = time - state.lastTime;
  const playingForward = !state.audio.paused && elapsed > 0 && elapsed < 0.25;

  drawStage(hitLine);

  const tiles = [];
  const activeNotes = [];
  const activeKeys = new Map();
  if (state.song) {
    for (const note of state.song.notes) {
      if (note.start > time + SECONDS_VISIBLE) break; // notes are sorted by start time
      if (note.end < time) continue;
      const key = state.layout.get(note.pitch);
      if (!key) continue;

      if (note.start <= time) {
        activeKeys.set(note.pitch, note.hand);
        activeNotes.push(note);
        if (playingForward && note.start > state.lastTime) {
          spawnSparks(key.x + key.width / 2, hitLine, handPalette(note.hand).light);
        }
      }
      const rect = tileRect(note, key, time, hitLine, pixelsPerSecond);
      if (rect.height > 0) tiles.push({ note, rect });
    }
  }
  state.lastTime = time;

  drawBeams(activeNotes, hitLine);
  // White-key tiles first, so that the narrower black-key tiles stay visible on top.
  for (const tile of tiles) if (!state.layout.get(tile.note.pitch).black) drawTile(tile.note, tile.rect, true);
  for (const tile of tiles) if (state.layout.get(tile.note.pitch).black) drawTile(tile.note, tile.rect, true);

  drawFallboard(tiles, hitLine);
  drawKeyboard(keyboardTop, state.keyboardHeight, activeKeys);
  updateAndDrawSparks(dt);

  updateTimeline(time);
  requestAnimationFrame(drawFrame);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function songDuration() {
  return Number.isFinite(state.audio.duration) ? state.audio.duration : state.song?.duration ?? 0;
}

function togglePlayback() {
  if (!state.song) return;
  if (state.audio.paused) {
    state.audio.play().catch((error) => console.error(error));
  } else {
    state.audio.pause();
  }
}

function seekTo(seconds) {
  state.audio.currentTime = Math.min(Math.max(seconds, 0), songDuration());
}

function skip(seconds) {
  seekTo(state.audio.currentTime + seconds);
}

function setSliderFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const percent = max > min ? ((Number(slider.value) - min) / (max - min)) * 100 : 0;
  slider.style.setProperty("--fill", `${percent}%`);
}

function setSpeed(rate) {
  for (const player of Object.values(players)) {
    player.preservesPitch = true;
    player.playbackRate = rate;
  }
  controls.speedValue.textContent = `×${rate.toLocaleString("fr-FR")}`;
  setSliderFill(controls.speed);
}

/** Switch between the full mix and the isolated piano, keeping the position. */
function setSource(name) {
  const next = players[name];
  if (next === state.audio) return;

  const wasPlaying = !state.audio.paused;
  const position = state.audio.currentTime;
  state.audio.pause();

  next.currentTime = position;
  state.audio = next;
  state.lastTime = position;
  if (wasPlaying) togglePlayback();

  for (const button of controls.sourceButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.source === name));
  }
}

function updatePlayButton() {
  const playing = !state.audio.paused;
  controls.play.dataset.playing = String(playing);
  controls.play.setAttribute("aria-label", playing ? "Pause" : "Lecture");
}

function updateTimeline(time) {
  const duration = songDuration();
  controls.seek.max = duration;
  if (!state.seeking) controls.seek.value = time;
  setSliderFill(controls.seek);
  controls.clockNow.textContent = formatTime(time);
  controls.clockTotal.textContent = formatTime(duration);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function connectControls() {
  canvas.addEventListener("click", togglePlayback);
  controls.play.addEventListener("click", togglePlayback);
  controls.back.addEventListener("click", () => skip(-SKIP_SECONDS));
  controls.forward.addEventListener("click", () => skip(SKIP_SECONDS));

  controls.seek.addEventListener("pointerdown", () => { state.seeking = true; });
  controls.seek.addEventListener("pointerup", () => { state.seeking = false; });
  controls.seek.addEventListener("input", () => seekTo(Number(controls.seek.value)));

  controls.speed.addEventListener("input", () => setSpeed(Number(controls.speed.value)));

  controls.names.value = state.convention;
  controls.names.addEventListener("change", () => {
    state.convention = controls.names.value;
    saveConvention(state.convention);
  });

  for (const button of controls.sourceButtons) {
    button.addEventListener("click", () => setSource(button.dataset.source));
  }

  for (const player of Object.values(players)) {
    player.addEventListener("play", updatePlayButton);
    player.addEventListener("pause", updatePlayButton);
  }

  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && !libraryUi.panel.hidden) {
      setLibraryOpen(false);
      return;
    }
    // Buttons, sliders and lists already react to the keyboard on their own.
    if (event.target.closest("button, input, select")) return;

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.code === "ArrowLeft") {
      skip(-SKIP_SECONDS);
    } else if (event.code === "ArrowRight") {
      skip(SKIP_SECONDS);
    }
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  queued: "En attente",
  processing: "Traitement en cours…",
  ready: "Prêt",
  error: "Échec du traitement",
};

function rememberSong(id) {
  try {
    localStorage.setItem("lastSong", id);
  } catch {
    // Not remembered: the most recent song will be opened next time.
  }
}

function rememberedSong() {
  try {
    return localStorage.getItem("lastSong");
  } catch {
    return null;
  }
}

function showLibraryMessage(text, isError = false) {
  libraryUi.message.textContent = text;
  libraryUi.message.classList.toggle("is-error", isError);
}

function setLibraryOpen(open) {
  libraryUi.panel.hidden = !open;
  libraryUi.toggle.setAttribute("aria-expanded", String(open));
  if (open) libraryUi.addButton.focus();
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Build the list of songs. Titles go through textContent, never innerHTML. */
function renderSongList() {
  const items = state.songs.map((info) => {
    const item = document.createElement("li");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "song";
    button.disabled = info.status !== "ready";
    button.setAttribute("aria-current", String(info.id === state.currentId));
    button.addEventListener("click", () => openSong(info));

    const title = document.createElement("span");
    title.className = "song-title";
    title.textContent = info.title;

    const status = document.createElement("span");
    status.className = "song-status";
    status.textContent = info.status === "ready"
      ? `Ajouté le ${formatDate(info.created_at)}`
      : STATUS_LABELS[info.status];
    if (info.status === "error") {
      status.classList.add("is-error");
      status.title = info.error ?? "";
    }
    button.append(title, status);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button delete";
    const confirming = state.pendingDelete === info.id;
    remove.textContent = confirming ? "Confirmer" : "Supprimer";
    remove.classList.toggle("is-confirming", confirming);
    remove.setAttribute("aria-label", `${confirming ? "Confirmer la suppression de" : "Supprimer"} ${info.title}`);
    remove.hidden = info.status === "queued" || info.status === "processing";
    remove.addEventListener("click", () => deleteSong(info));

    item.append(button, remove);
    return item;
  });
  libraryUi.list.replaceChildren(...items);

  const count = state.songs.length;
  libraryUi.toggle.textContent = count ? `Bibliothèque (${count})` : "Bibliothèque";
}

/** Tell the user when a song they were waiting for is ready, or has failed. */
function reportFinishedSongs(previous) {
  for (const info of state.songs) {
    const before = previous.get(info.id);
    if (before !== "queued" && before !== "processing") continue;
    if (info.status === "ready") {
      showLibraryMessage(`« ${info.title} » est prêt. Cliquez sur son titre pour le jouer.`);
    } else if (info.status === "error") {
      showLibraryMessage(`Le traitement de « ${info.title} » a échoué : ${info.error}`, true);
    }
  }
}

async function refreshLibrary() {
  clearTimeout(state.pollTimer);
  try {
    const response = await fetch(API_SONGS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const previous = new Map(state.songs.map((info) => [info.id, info.status]));
    state.songs = await response.json();
    reportFinishedSongs(previous);
  } catch (error) {
    showLibraryMessage("Le serveur ne répond pas. Lancez « uv run piano-tiles-ai serve », puis rechargez la page.", true);
    console.error(error);
    return;
  }

  // The song being played may have been deleted.
  if (state.currentId && !state.songs.some((info) => info.id === state.currentId)) {
    closeSong();
  }
  renderSongList();

  const busy = state.songs.some((info) => info.status === "queued" || info.status === "processing");
  if (busy) state.pollTimer = setTimeout(refreshLibrary, POLL_INTERVAL);

  if (!state.currentId) {
    const ready = state.songs.filter((info) => info.status === "ready");
    const preferred = ready.find((info) => info.id === rememberedSong()) ?? ready[0];
    if (preferred) {
      await openSong(preferred);
    } else if (!busy) {
      document.getElementById("details").textContent = "Aucun morceau pour l'instant";
      setLibraryOpen(true);
    }
  }
}

async function openSong(info) {
  const base = `${API_SONGS}/${info.id}/files`;
  try {
    const response = await fetch(`${base}/song.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const song = await response.json();

    for (const player of Object.values(players)) player.pause();
    state.song = song;
    state.currentId = info.id;
    state.lastTime = 0;
    state.sparks = [];
    players.mix.src = `${base}/mix.mp3`;
    players.piano.src = `${base}/piano.mp3`;

    document.getElementById("title").textContent = song.title;
    document.getElementById("details").textContent =
      `${song.notes.length} notes, ${formatTime(song.duration)}`;
    rememberSong(info.id);
    renderSongList();
  } catch (error) {
    showLibraryMessage(`Impossible d'ouvrir « ${info.title} ».`, true);
    console.error(error);
  }
}

function closeSong() {
  for (const player of Object.values(players)) {
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  state.song = null;
  state.currentId = null;
  document.getElementById("title").textContent = "Piano Tiles AI";
  document.getElementById("details").textContent = "Aucun morceau sélectionné";
}

async function uploadSong(file) {
  setLibraryOpen(true);
  showLibraryMessage(`Envoi de « ${file.name} »…`);

  const form = new FormData();
  form.append("file", file);
  let response;
  try {
    response = await fetch(API_SONGS, { method: "POST", body: form });
  } catch (error) {
    showLibraryMessage("Le serveur ne répond pas : le fichier n'a pas été envoyé.", true);
    console.error(error);
    return;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showLibraryMessage(body.detail ?? `L'envoi a échoué (erreur ${response.status}).`, true);
    return;
  }

  const info = await response.json();
  showLibraryMessage(info.status === "ready"
    ? `« ${info.title} » était déjà dans la bibliothèque.`
    : `« ${info.title} » est en cours de traitement. Comptez une à deux minutes.`);
  await refreshLibrary();
}

async function deleteSong(info) {
  // First click asks for confirmation, second click deletes.
  if (state.pendingDelete !== info.id) {
    state.pendingDelete = info.id;
    renderSongList();
    setTimeout(() => {
      if (state.pendingDelete === info.id) {
        state.pendingDelete = null;
        renderSongList();
      }
    }, 4000);
    return;
  }

  state.pendingDelete = null;
  const response = await fetch(`${API_SONGS}/${info.id}`, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showLibraryMessage(body.detail ?? "La suppression a échoué.", true);
  } else {
    showLibraryMessage(`« ${info.title} » a été supprimé.`);
  }
  await refreshLibrary();
}

function connectLibrary() {
  libraryUi.toggle.addEventListener("click", () => setLibraryOpen(libraryUi.panel.hidden));
  libraryUi.close.addEventListener("click", () => setLibraryOpen(false));
  libraryUi.addButton.addEventListener("click", () => libraryUi.fileInput.click());
  libraryUi.fileInput.addEventListener("change", () => {
    const [file] = libraryUi.fileInput.files;
    if (file) uploadSong(file);
    libraryUi.fileInput.value = "";
  });

  // Drag and drop anywhere on the page. dragenter and dragleave also fire
  // when moving between child elements, hence the depth counter.
  const carriesFiles = (event) => event.dataTransfer?.types.includes("Files");
  window.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    state.dragDepth++;
    libraryUi.overlay.hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (carriesFiles(event)) event.preventDefault(); // allows dropping
  });
  window.addEventListener("dragleave", (event) => {
    if (!carriesFiles(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) libraryUi.overlay.hidden = true;
  });
  window.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault(); // otherwise the browser opens the file itself
    state.dragDepth = 0;
    libraryUi.overlay.hidden = true;
    const [file] = event.dataTransfer.files;
    if (file) uploadSong(file);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  connectControls();
  connectLibrary();
  setSpeed(1);
  requestAnimationFrame(drawFrame);
  refreshLibrary();
}

main();
