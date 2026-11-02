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
  heard: "#7fc8a9",   // verdigris, the green of aged brass: what the microphone hears
  wrong: "#e88b7a",
};

const SAVE_DELAY = 600;     // ms of calm before corrections are sent to the server
const CHORD_WINDOW = 0.03;  // s: notes starting this close together form a chord
const SCRUB_SPEED = 0.004;  // s of music per pixel of mouse wheel, in edit mode

// Practice mode: the song waits until you play the right notes.
const PRACTICE_LEAD = 0.05;    // s: stop this much before a chord, so the recording never plays it
// Basic Pitch probability above which a note counts as struck. The model is
// less sure of itself on low notes (weak fundamental, slower attack): measured
// on a rendered piano, 0.4 below C3 recognizes 97 % of the chords instead of
// 87.5 %, and still accepts no chord played a semitone off.
const ONSET_THRESHOLD = 0.5;
const ONSET_THRESHOLD_LOW = 0.4;
const LOW_NOTES_BELOW = 48;    // C3
const EARLY_WINDOW = 400;      // ms: notes struck this long before the wait still count
const GRACE = 300;             // ms the song keeps going while the microphone answers
const REFRACTORY = 150;        // ms: a second onset of the same key this soon is the same strike
const WRONG_FLASH = 450;       // ms a wrong key stays marked
const SLOW_ANALYSIS = 300;     // ms: above this, the microphone answers too late

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
  linkForm: document.getElementById("link-form"),
  linkInput: document.getElementById("link-input"),
  message: document.getElementById("library-message"),
  list: document.getElementById("song-list"),
  overlay: document.getElementById("drop-overlay"),
};

const practiceUi = {
  toggle: document.getElementById("practice-toggle"),
  bar: document.getElementById("practice-bar"),
  hand: document.getElementById("practice-hand"),
  sound: document.getElementById("practice-sound"),
  skip: document.getElementById("practice-skip"),
  level: document.getElementById("mic-level"),
  status: document.getElementById("practice-status"),
  score: document.getElementById("practice-score"),
};

const editUi = {
  toggle: document.getElementById("edit-toggle"),
  bar: document.getElementById("edit-bar"),
  undo: document.getElementById("undo"),
  count: document.getElementById("edit-count"),
  status: document.getElementById("edit-status"),
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
  pendingSave: null,  // function that saves corrections not yet sent
  dragDepth: 0,
  tiles: [],          // tiles drawn in the last frame, to find the one under the mouse
  editing: false,     // hand-correction mode
  hovered: null,      // note under the mouse in edit mode
  history: [],        // past corrections, for undo: each entry is a list of {note, hand}
  saveTimer: null,
  practice: {
    on: false,
    listener: null,
    hand: "both",       // which hand the player practices: "both", "left" or "right"
    chords: [],         // the chords to play, in order: {start, pitches: Set}
    lastDone: -Infinity, // chords up to this time were played, skipped, or are behind us
    waiting: null,      // {chord, confirmed: Set} while the song waits for the player
    recent: [],         // notes struck in the last moments: {pitch, time}
    sounding: new Set(), // notes the microphone hears right now
    wrong: new Map(),   // pitch -> time it was struck by mistake
    lastOnset: new Map(), // pitch -> time of its last onset, to count each strike once
    score: { played: 0, skipped: 0 },
  },
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

  if (note === state.hovered) {
    ctx.strokeStyle = COLORS.ivory;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (note.hand !== note.modelHand && rect.height > 8) {
    // A small ivory dot marks the notes corrected by hand.
    ctx.fillStyle = COLORS.ivory;
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + 5, Math.min(2.5, rect.width / 4), 0, 2 * Math.PI);
    ctx.fill();
  }

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
  state.tiles = tiles;

  drawBeams(activeNotes, hitLine);
  // White-key tiles first, so that the narrower black-key tiles stay visible on top.
  for (const tile of tiles) if (!state.layout.get(tile.note.pitch).black) drawTile(tile.note, tile.rect, true);
  for (const tile of tiles) if (state.layout.get(tile.note.pitch).black) drawTile(tile.note, tile.rect, true);

  drawFallboard(tiles, hitLine);
  drawKeyboard(keyboardTop, state.keyboardHeight, activeKeys);
  drawPracticeMarks(keyboardTop, state.keyboardHeight, hitLine);
  updateAndDrawSparks(dt);
  updatePractice(time);

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
  if (state.practice.waiting?.stopped) return; // the song is waiting for the player's notes
  if (state.audio.paused) {
    state.audio.play().catch((error) => console.error(error));
  } else {
    state.audio.pause();
  }
}

function seekTo(seconds) {
  const target = Math.min(Math.max(seconds, 0), songDuration());
  resetPracticePosition(target);
  state.audio.currentTime = target;
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
  canvas.addEventListener("click", (event) => {
    if (state.editing) {
      correctAt(event);
    } else {
      togglePlayback();
    }
  });
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

    if (state.practice.on && (event.code === "Enter" || event.code === "NumpadEnter")) {
      event.preventDefault();
      skipChord();
    } else if (state.editing && (event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
      event.preventDefault();
      undoCorrection();
    } else if (event.code === "Space") {
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
// Hand corrections
// ---------------------------------------------------------------------------

/** Notes are identified by pitch and start time, rounded like in song.json. */
function noteKey(pitch, start) {
  return `${pitch}@${start.toFixed(3)}`;
}

/** Load the corrections saved on the server and apply them to the notes. */
async function applySavedCorrections(songId, notes) {
  for (const note of notes) note.modelHand = note.hand; // keep the model's answer
  let corrections = [];
  try {
    const response = await fetch(`${API_SONGS}/${songId}/corrections`);
    if (response.ok) corrections = await response.json();
  } catch (error) {
    console.error(error); // without corrections, the song still plays
  }
  const hands = new Map(corrections.map((c) => [noteKey(c.pitch, c.start), c.hand]));
  for (const note of notes) {
    const hand = hands.get(noteKey(note.pitch, note.start));
    if (hand) note.hand = hand;
  }
}

function correctedNotes() {
  return state.song ? state.song.notes.filter((note) => note.hand !== note.modelHand) : [];
}

function setEditing(editing) {
  state.editing = editing && state.song !== null;
  state.hovered = null;
  canvas.style.cursor = "";
  editUi.toggle.setAttribute("aria-pressed", String(state.editing));
  editUi.bar.hidden = !state.editing;
  if (state.editing) {
    setPractice(false);
    state.audio.pause(); // a still image is easier to click
    updateEditBar();
  }
}

function updateEditBar() {
  const count = correctedNotes().length;
  editUi.count.textContent = count === 0 ? "Aucune correction"
    : count === 1 ? "1 note corrigée" : `${count} notes corrigées`;
  editUi.undo.disabled = state.history.length === 0;
}

function showEditStatus(text, isError = false) {
  editUi.status.textContent = text;
  editUi.status.classList.toggle("is-error", isError);
}

/** The tile under the mouse. Black-key tiles are drawn on top, so they win. */
function tileAt(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const inside = ({ rect }) =>
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  const isBlack = ({ note }) => state.layout.get(note.pitch).black;
  return state.tiles.find((tile) => isBlack(tile) && inside(tile))
    ?? state.tiles.find((tile) => !isBlack(tile) && inside(tile))
    ?? null;
}

function otherHand(hand) {
  return hand === "left" ? "right" : "left";
}

/** Move the clicked note (or, with Shift, its whole chord) to the other hand. */
function correctAt(event) {
  const tile = tileAt(event);
  if (!tile) return;
  const clicked = tile.note;
  const hand = otherHand(clicked.hand);

  // A chord: the notes that start with the clicked one and share its hand.
  const notes = event.shiftKey
    ? state.song.notes.filter((note) =>
      Math.abs(note.start - clicked.start) <= CHORD_WINDOW && note.hand === clicked.hand)
    : [clicked];

  state.history.push(notes.map((note) => ({ note, hand: note.hand })));
  for (const note of notes) note.hand = hand;
  afterCorrection();
}

function undoCorrection() {
  const last = state.history.pop();
  if (!last) return;
  for (const { note, hand } of last) note.hand = hand;
  afterCorrection();
}

function afterCorrection() {
  updateEditBar();
  scheduleSave();
}

/** Send the corrections a moment after the last click, not after every click. */
function scheduleSave() {
  clearTimeout(state.saveTimer);
  showEditStatus("Modifications non enregistrées…");
  const songId = state.currentId;
  const corrections = correctedNotes().map(({ pitch, start, hand }) => ({ pitch, start, hand }));
  state.saveTimer = setTimeout(() => saveCorrections(songId, corrections), SAVE_DELAY);
  state.pendingSave = () => saveCorrections(songId, corrections);
}

/** Save right away if a save is waiting (before switching songs). */
function flushCorrections() {
  if (!state.pendingSave) return;
  clearTimeout(state.saveTimer);
  state.pendingSave();
}

async function saveCorrections(songId, corrections) {
  state.pendingSave = null;
  try {
    const response = await fetch(`${API_SONGS}/${songId}/corrections`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corrections),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (songId === state.currentId) showEditStatus("Enregistré");
  } catch (error) {
    if (songId === state.currentId) showEditStatus("L'enregistrement a échoué. Réessayez.", true);
    console.error(error);
  }
}

function connectCorrections() {
  editUi.toggle.addEventListener("click", () => setEditing(!state.editing));
  editUi.undo.addEventListener("click", undoCorrection);

  canvas.addEventListener("pointermove", (event) => {
    if (!state.editing) return;
    state.hovered = tileAt(event)?.note ?? null;
    canvas.style.cursor = state.hovered ? "pointer" : "default";
  });
  canvas.addEventListener("pointerleave", () => { state.hovered = null; });

  // In edit mode, the mouse wheel moves through the song.
  canvas.addEventListener("wheel", (event) => {
    if (!state.editing) return;
    event.preventDefault();
    seekTo(state.audio.currentTime + event.deltaY * SCRUB_SPEED);
  }, { passive: false });

  // Last chance to save when the page is closed.
  window.addEventListener("pagehide", flushCorrections);
}

// ---------------------------------------------------------------------------
// Practice mode
// ---------------------------------------------------------------------------
//
// The song plays until the next chord of the practiced hand reaches the
// keyboard, then waits. The microphone listens (listen.js); when every note
// of the chord has been struck, the song goes on.

/** Load a script once, when it is first needed (TensorFlow.js weighs 1.4 MB). */
function loadScript(src) {
  loadScript.cache ??= new Map();
  if (!loadScript.cache.has(src)) {
    loadScript.cache.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
      document.head.append(script);
    }));
  }
  return loadScript.cache.get(src);
}

/** Chords of the practiced hand: notes struck together (within CHORD_WINDOW). */
function buildChords() {
  const practice = state.practice;
  const notes = state.song.notes.filter((note) => practice.hand === "both" || note.hand === practice.hand);
  const chords = [];
  for (const note of notes) { // notes are sorted by start time
    const last = chords[chords.length - 1];
    if (last && note.start - last.start <= CHORD_WINDOW) {
      last.pitches.add(note.pitch);
    } else {
      chords.push({ start: note.start, pitches: new Set([note.pitch]) });
    }
  }
  practice.chords = chords;
  practice.pendingRebuild = false;
  resetPracticePosition();
}

/** After a jump in the song: forget the wait, start again from the new position. */
function resetPracticePosition(time = state.audio.currentTime) {
  state.practice.lastDone = time - 0.01; // chords before this point are not asked for
  state.practice.waiting = null;
}

function setPracticeStatus(text, isError = false) {
  const { slow, analysisTime } = state.practice;
  // A slow computer answers late: say it in every message, not just once.
  practiceUi.status.textContent = slow ? `${text} (écoute lente : ${Math.round(analysisTime)} ms)` : text;
  practiceUi.status.classList.toggle("is-error", isError);
}

function updateScore() {
  const { played, skipped } = state.practice.score;
  practiceUi.score.textContent = `${played} joué${played > 1 ? "s" : ""} · ${skipped} passé${skipped > 1 ? "s" : ""}`;
}

function applyPracticeSound() {
  const mute = state.practice.on && !practiceUi.sound.checked;
  for (const player of Object.values(players)) player.muted = mute;
}

async function setPractice(on) {
  const practice = state.practice;
  if (on === practice.on) return;
  if (on && !state.song) return;
  practice.on = on;
  practiceUi.toggle.setAttribute("aria-pressed", String(on));
  practiceUi.bar.hidden = !on;
  applyPracticeSound();

  if (!on) {
    practice.listener?.stop();
    practice.waiting = null;
    practice.sounding = new Set();
    practiceUi.level.style.setProperty("--level", "0");
    return;
  }

  setEditing(false);
  state.audio.pause();
  practice.score = { played: 0, skipped: 0 };
  updateScore();
  buildChords();
  setPracticeStatus("Chargement du modèle d'écoute…");
  try {
    await loadScript("listen.js");
    practice.listener ??= PianoListener.createListener({
      onNotes: handleHeardNotes,
      onLevel: (level) => practiceUi.level.style.setProperty("--level", level.toFixed(3)),
    });
    await practice.listener.start();
  } catch (error) {
    console.error(error);
    const refused = error.name === "NotAllowedError";
    setPracticeStatus(refused
      ? "Micro refusé. Autorisez-le avec l'icône à gauche de l'adresse, puis réessayez."
      : `Impossible d'écouter le micro : ${error.message}`, true);
    practice.on = false;
    practiceUi.toggle.setAttribute("aria-pressed", "false");
    applyPracticeSound();
    return;
  }
  if (!practice.on) { // left while the model was loading
    practice.listener.stop();
    return;
  }
  setPracticeStatus("Prêt. Lancez la lecture : le morceau s'arrête à chaque accord à jouer.");
}

/**
 * Called every frame. When the next chord reaches the keyboard, the song
 * starts waiting for it, but keeps going for GRACE ms: the microphone needs a
 * moment to answer, and a player who is on time should never be stopped.
 * If the chord is still not heard after that, the song stops on it.
 */
function updatePractice(time) {
  const practice = state.practice;
  if (!practice.on || !state.song) return;
  if (practice.pendingRebuild) buildChords();

  const { waiting } = practice;
  if (waiting) {
    if (!waiting.stopped && performance.now() > waiting.deadline) {
      waiting.stopped = true;
      state.audio.pause();
      state.audio.currentTime = waiting.chord.start - PRACTICE_LEAD; // back onto the chord
      state.lastTime = state.audio.currentTime;
      showExpected();
    }
    return;
  }
  if (state.audio.paused) return;

  // The first chord not played yet. Never skipped, even when the song went
  // past it during the grace period of the previous chord.
  const next = practice.chords.find((chord) => chord.start > practice.lastDone);
  if (!next || next.start - PRACTICE_LEAD > time) return;

  const now = performance.now();
  practice.waiting = { chord: next, confirmed: new Set(), deadline: now + GRACE, stopped: false };

  // Notes struck a moment early (playing along) count too, once each.
  for (const onset of practice.recent) {
    if (!onset.used && now - onset.time <= EARLY_WINDOW && next.pitches.has(onset.pitch)) {
      onset.used = true;
      practice.waiting.confirmed.add(onset.pitch);
    }
  }
  if (practice.waiting.confirmed.size === next.pitches.size) finishChord(true);
}

function showExpected() {
  const { waiting } = state.practice;
  if (!waiting) return;
  const convention = state.convention === "none" ? "english" : state.convention;
  const missing = [...waiting.chord.pitches]
    .filter((pitch) => !waiting.confirmed.has(pitch))
    .sort((a, b) => a - b)
    .map((pitch) => `${noteName(pitch, convention)}${octaveNumber(pitch, convention)}`);
  setPracticeStatus(`À vous : ${missing.join(" ")}`);
}

/** The microphone heard something (called about ten times a second). */
function handleHeardNotes(struck, sounding, now, duration) {
  const practice = state.practice;
  practice.sounding = sounding;
  practice.analysisTime = 0.8 * (practice.analysisTime ?? duration) + 0.2 * duration;
  practice.slow = practice.analysisTime > SLOW_ANALYSIS;
  practice.recent = practice.recent.filter(({ time }) => now - time <= EARLY_WINDOW);
  for (const [pitch, probability] of struck) {
    if (probability < (pitch < LOW_NOTES_BELOW ? ONSET_THRESHOLD_LOW : ONSET_THRESHOLD)) continue;
    // Two analyses in a row can see the same strike: count it once.
    if (now - (practice.lastOnset.get(pitch) ?? -Infinity) < REFRACTORY) continue;
    practice.lastOnset.set(pitch, now);

    const onset = { pitch, time: now, used: false };
    practice.recent.push(onset);
    const { waiting } = practice;
    if (!waiting) continue;
    if (waiting.chord.pitches.has(pitch)) {
      onset.used = true; // this strike cannot also validate the next chord
      waiting.confirmed.add(pitch);
    } else if (waiting.stopped) {
      practice.wrong.set(pitch, now);
    }
  }
  if (practice.waiting) {
    if (practice.waiting.confirmed.size === practice.waiting.chord.pitches.size) finishChord(true);
    else if (practice.waiting.stopped) showExpected();
  }
}

/** The chord was played (or skipped): the song goes on. */
function finishChord(played) {
  const practice = state.practice;
  const { chord, stopped } = practice.waiting;
  practice.waiting = null;
  practice.lastDone = chord.start;
  practice.score[played ? "played" : "skipped"]++;
  updateScore();
  setPracticeStatus(played ? "Bien joué." : "Accord passé.");

  if (played) {
    const hitLine = state.height - state.keyboardHeight - FELT_HEIGHT - FALLBOARD_HEIGHT;
    for (const pitch of chord.pitches) {
      const key = state.layout.get(pitch);
      if (key) spawnSparks(key.x + key.width / 2, hitLine, COLORS.heard);
    }
  }
  if (stopped) state.audio.play().catch((error) => console.error(error));
}

function skipChord() {
  if (state.practice.waiting) finishChord(false);
}

/** Marks on the keyboard: keys to play, keys already played, keys heard. */
function drawPracticeMarks(top, height, hitLine) {
  const practice = state.practice;
  if (!practice.on) return;
  const now = performance.now();
  const pulse = REDUCED_MOTION ? 1 : 0.65 + 0.35 * Math.sin(now / 160);

  // Black keys: their whole body. White keys: the part below the black keys,
  // so that the frame never covers a neighbouring black key.
  const markKey = (pitch, color, alpha, filled) => {
    const key = state.layout.get(pitch);
    if (!key) return;
    const y = key.black ? top : top + height * 0.6 + 2;
    const keyHeight = key.black ? height * 0.6 : height * 0.4 - KEY_FRONT - 2;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(key.x + 1.5, y + 1.5, key.width - 3, keyHeight - 3, 3);
    if (filled) ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  if (practice.waiting) {
    for (const pitch of practice.waiting.chord.pitches) {
      if (practice.waiting.confirmed.has(pitch)) {
        markKey(pitch, COLORS.heard, 0.55, true);
      } else {
        const note = state.song.notes.find((n) => n.pitch === pitch && Math.abs(n.start - practice.waiting.chord.start) <= CHORD_WINDOW);
        markKey(pitch, handPalette(note?.hand).light, pulse, false);
      }
    }
  }
  for (const [pitch, struckAt] of practice.wrong) {
    const age = now - struckAt;
    if (age > WRONG_FLASH) practice.wrong.delete(pitch);
    else markKey(pitch, COLORS.wrong, 1 - age / WRONG_FLASH, false);
  }

  // A small verdigris dot under every key the microphone hears.
  ctx.fillStyle = COLORS.heard;
  for (const pitch of practice.sounding) {
    const key = state.layout.get(pitch);
    if (!key) continue;
    ctx.beginPath();
    ctx.arc(key.x + key.width / 2, hitLine + FALLBOARD_HEIGHT / 2, Math.min(4, key.width / 3), 0, 2 * Math.PI);
    ctx.fill();
  }
}

function connectPractice() {
  practiceUi.toggle.addEventListener("click", () => setPractice(!state.practice.on));
  practiceUi.skip.addEventListener("click", skipChord);
  practiceUi.sound.addEventListener("change", applyPracticeSound);
  practiceUi.hand.addEventListener("change", () => {
    state.practice.hand = practiceUi.hand.value;
    if (state.practice.on) buildChords();
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  queued: "En attente",
  downloading: "Téléchargement…",
  processing: "Traitement en cours…",
  ready: "Prêt",
  error: "Échec du traitement",
};

function isBusy(status) {
  return status === "queued" || status === "downloading" || status === "processing";
}

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
    remove.hidden = isBusy(info.status);
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
    if (!isBusy(before)) continue;
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

  const busy = state.songs.some((info) => isBusy(info.status));
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
    flushCorrections(); // the previous song may still have unsaved corrections

    for (const player of Object.values(players)) player.pause();
    state.song = song;
    state.currentId = info.id;
    state.lastTime = 0;
    state.sparks = [];
    players.mix.src = `${base}/mix.mp3`;
    players.piano.src = `${base}/piano.mp3`;

    setEditing(false);
    await applySavedCorrections(info.id, song.notes);
    if (state.practice.on) state.practice.pendingRebuild = true;
    state.history = [];

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
  setEditing(false);
  setPractice(false);
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
  await sendSong(fetch(API_SONGS, { method: "POST", body: form }));
}

/** A link to a video: the server downloads its sound, then processes it. */
async function addLink(url) {
  setLibraryOpen(true);
  showLibraryMessage("Envoi du lien…");
  await sendSong(fetch(`${API_SONGS}/from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }));
}

/** Common end of uploadSong and addLink: report the answer of the server. */
async function sendSong(request) {
  let response;
  try {
    response = await request;
  } catch (error) {
    showLibraryMessage("Le serveur ne répond pas : rien n'a été envoyé.", true);
    console.error(error);
    return false;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = response.status === 422 ? "Ce lien n'est pas valide (il doit commencer par https://)." : body.detail;
    showLibraryMessage(detail ?? `L'envoi a échoué (erreur ${response.status}).`, true);
    return false;
  }

  const info = await response.json();
  showLibraryMessage(info.status === "ready"
    ? `« ${info.title} » était déjà dans la bibliothèque.`
    : info.source_url
      ? "Lien reçu : le son va être téléchargé puis traité. Comptez deux à trois minutes."
      : `« ${info.title} » est en cours de traitement. Comptez une à deux minutes.`);
  await refreshLibrary();
  return true;
}

/** True for text that looks like a web link. */
function isLink(text) {
  try {
    const url = new URL(text.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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
  libraryUi.linkForm.addEventListener("submit", async (event) => {
    event.preventDefault(); // the page must not reload
    const url = libraryUi.linkInput.value.trim();
    if (!url) return;
    if (await addLink(url)) libraryUi.linkInput.value = "";
  });

  // Ctrl + V of a link anywhere on the page (except in a text field).
  window.addEventListener("paste", (event) => {
    if (event.target.closest("input, textarea")) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (isLink(text)) addLink(text.trim());
  });

  libraryUi.fileInput.addEventListener("change", () => {
    const [file] = libraryUi.fileInput.files;
    if (file) uploadSong(file);
    libraryUi.fileInput.value = "";
  });

  // Drag and drop anywhere on the page: a file, or a link dragged from another
  // tab. dragenter and dragleave also fire when moving between child
  // elements, hence the depth counter.
  const carriesFiles = (event) => {
    const types = event.dataTransfer?.types ?? [];
    return types.includes("Files") || types.includes("text/uri-list");
  };
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
    const link = event.dataTransfer.getData("text/uri-list").split("\n")[0].trim();
    if (file) {
      uploadSong(file);
    } else if (isLink(link)) {
      addLink(link);
    }
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
  connectCorrections();
  connectPractice();
  setSpeed(1);
  requestAnimationFrame(drawFrame);
  refreshLibrary();
}

main();
