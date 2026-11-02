// Runs Basic Pitch in a Web Worker: a separate thread, so the heavy
// computation never freezes the animation of the page.
//
// Messages received:  {type: "load"}                         load the model
//                     {type: "analyze", input, newFrames}    analyze one window
// Messages sent:      {type: "ready", backend}
//                     {type: "error", message}
//                     {type: "result", struck, sounding, duration}

/* global tf */
importScripts("vendor/tf.min.js");

const MODEL_URL = "vendor/basic-pitch/model.json";
const WINDOW = 43844;
const HOP = 256;
const MARGIN = 15 * HOP;
const LOWEST_KEY = 21;
const LAST_FRAME = Math.floor((WINDOW - MARGIN) / HOP) - 1; // last frame that saw real sound

let model = null;

async function load() {
  await tf.ready(); // WebGL through OffscreenCanvas when the browser allows it, otherwise the CPU
  model = await tf.loadGraphModel(MODEL_URL);
  // The first run compiles the GPU programs and takes seconds: do it now,
  // while the page says "loading", not during the first chord.
  const zeros = tf.zeros([1, WINDOW, 1]);
  const outputs = model.execute(zeros, ["Identity_1", "Identity_2"]);
  await Promise.all(outputs.map((output) => output.data()));
  tf.dispose([zeros, ...outputs]);
}

async function analyze(input, newFrames) {
  const started = performance.now();
  const tensor = tf.tensor(input, [1, WINDOW, 1]);
  const [frames, onsets] = model.execute(tensor, ["Identity_1", "Identity_2"]);
  const frameRows = (await frames.array())[0];
  const onsetRows = (await onsets.array())[0];
  tf.dispose([tensor, frames, onsets]);

  // For each key, the highest onset probability in the frames since the last analysis.
  const struck = [];
  for (let column = 0; column < 88; column++) {
    let best = 0;
    for (let k = Math.max(0, LAST_FRAME - newFrames); k <= LAST_FRAME; k++) {
      best = Math.max(best, onsetRows[k][column]);
    }
    if (best > 0.1) struck.push([LOWEST_KEY + column, best]);
  }
  const sounding = [];
  frameRows[LAST_FRAME].forEach((probability, column) => {
    if (probability >= 0.5) sounding.push(LOWEST_KEY + column);
  });
  return { struck, sounding, duration: performance.now() - started };
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      await load();
      self.postMessage({ type: "ready", backend: tf.getBackend() });
    } else if (data.type === "analyze") {
      self.postMessage({ type: "result", ...(await analyze(data.input, data.newFrames)) });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
