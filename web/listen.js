// Listens to the microphone and recognizes the piano notes being struck.
//
// The notes are found by Basic Pitch, a small neural network by Spotify
// (Bittner et al., ICASSP 2022), run in the browser by TensorFlow.js.
//
//   microphone ──▶ AudioWorklet ──▶ last 1.8 s of sound ──▶ Basic Pitch ──▶ onsets
//                                                          (Web Worker)
//   (48 kHz)       (copies the       (resampled to          (every 100 ms)   (for each
//                   samples)          22 050 Hz)                              of the 88 keys,
//                                                                              "was it just struck?")
//
// Basic Pitch reads 2 s of sound and answers 86 times per second, for each
// key, the probability that a note starts there ("onset"), and that a note
// sounds there ("frame").
//
// The model runs in a Web Worker (listen-worker.js), on its own thread: the
// animation of the page never waits for it.
//
// This file defines window.PianoListener.

(function () {
  "use strict";

  const SAMPLE_RATE = 22050;               // what the model was trained on
  const WINDOW = 43844;                    // samples read by the model (2 s minus one hop)
  const HOP = 256;                         // samples between two output frames
  const MARGIN = 15 * HOP;                 // the model is unreliable on 15 frames at each end
  const FRAMES_PER_SECOND = SAMPLE_RATE / HOP;
  const ANALYSIS_INTERVAL = 100;           // ms between two analyses

  // Runs in the audio thread: hands every block of 128 samples to the page.
  const WORKLET = `
    class Tap extends AudioWorkletProcessor {
      process(inputs) {
        const channel = inputs[0][0];
        if (channel) this.port.postMessage(channel.slice(0));
        return true;
      }
    }
    registerProcessor("piano-tap", Tap);
  `;

  /** Linear resampling: good enough for a model that looks for notes, not for hi-fi. */
  function resample(samples, from, to) {
    if (from === to) return samples;
    const ratio = from / to;
    const out = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, samples.length - 1);
      const weight = position - left;
      out[i] = samples[left] * (1 - weight) + samples[right] * weight;
    }
    return out;
  }

  /**
   * @param {object} callbacks
   * @param {(struck: Map<number, number>, sounding: Set<number>, time: number, duration: number) => void} callbacks.onNotes
   *        Called after each analysis with the pitches struck since the previous
   *        analysis (and their probability), the pitches sounding now, the time
   *        of the analysis (performance.now(), in ms) and how long it took (ms).
   * @param {(level: number) => void} [callbacks.onLevel]  Loudness of the microphone, 0 to 1.
   */
  function createListener({ onNotes, onLevel = () => {}, onBackend = () => {}, workerUrl = "listen-worker.js" }) {
    let context = null;
    let stream = null;
    let worker = null;
    let timer = null;
    let busy = false;
    let lastAnalysis = 0;
    let sentAt = 0;

    // The real sound fills the window except its last MARGIN samples, which
    // stay silent: the model sees the newest sound away from its unreliable edge.
    const keep = WINDOW - MARGIN;
    const ring = new Float32Array(keep);  // ring buffer of the newest sound
    let writeAt = 0;
    let pending = [];  // blocks at the microphone's rate, not resampled yet
    let pendingLength = 0;

    function push(block) {
      pending.push(block);
      pendingLength += block.length;
      let sum = 0;
      for (const value of block) sum += value * value;
      onLevel(Math.min(1, Math.sqrt(sum / block.length) * 6));
    }

    function flush() {
      if (!pendingLength) return;
      const joined = new Float32Array(pendingLength);
      let offset = 0;
      for (const block of pending) {
        joined.set(block, offset);
        offset += block.length;
      }
      pending = [];
      pendingLength = 0;
      for (const value of resample(joined, context.sampleRate, SAMPLE_RATE)) {
        ring[writeAt] = value;
        writeAt = (writeAt + 1) % keep;
      }
    }

    /** The model input: the recent sound, oldest first, then silence. */
    function modelInput() {
      const input = new Float32Array(WINDOW);
      input.set(ring.subarray(writeAt), 0);
      input.set(ring.subarray(0, writeAt), keep - writeAt);
      return input;
    }

    /** Send the newest sound to the worker, unless it is still busy with the previous one. */
    function analyze() {
      if (busy || !worker || !context) return;
      busy = true;
      flush();
      sentAt = performance.now();
      const newFrames = Math.ceil(((sentAt - lastAnalysis) / 1000) * FRAMES_PER_SECOND) + 2;
      lastAnalysis = sentAt;
      const input = modelInput();
      worker.postMessage({ type: "analyze", input, newFrames }, [input.buffer]); // moved, not copied
    }

    function startWorker() {
      return new Promise((resolve, reject) => {
        worker = new Worker(workerUrl);
        worker.onmessage = ({ data }) => {
          if (data.type === "ready") {
            onBackend(data.backend);
            resolve();
          } else if (data.type === "error") {
            busy = false;
            reject(new Error(data.message));
            console.error(data.message);
          } else if (data.type === "result") {
            busy = false;
            onNotes(new Map(data.struck), new Set(data.sounding), sentAt, data.duration);
          }
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({ type: "load" });
      });
    }

    /** Ask for the microphone and load the model. Rejects if the user refuses. */
    async function start() {
      // Echo cancellation and noise suppression are made for voices: they
      // would remove the very piano notes we want to hear.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      try {
        context = new AudioContext({ sampleRate: SAMPLE_RATE }); // Chrome resamples the mic itself
        context.createMediaStreamSource(stream);
      } catch {
        await context?.close();
        context = new AudioContext(); // Firefox refuses: we resample ourselves (flush)
      }
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = context.createMediaStreamSource(stream);
      const tap = new AudioWorkletNode(context, "piano-tap");
      tap.port.onmessage = (event) => push(event.data);
      source.connect(tap); // not connected to the speakers: we only listen

      if (!worker) await startWorker();
      lastAnalysis = performance.now();
      timer = setInterval(analyze, ANALYSIS_INTERVAL);
    }

    function stop() {
      clearInterval(timer);
      timer = null;
      busy = false;
      stream?.getTracks().forEach((track) => track.stop());
      context?.close();
      stream = null;
      context = null;
      ring.fill(0);
      pending = [];
      pendingLength = 0;
      onLevel(0);
    }

    return { start, stop };
  }

  window.PianoListener = { createListener };
})();
