// RNNoise AudioWorklet processor. Bundled to web/assets/noise-worklet.js.
// Runs in the guest's browser: mic audio passes through RNNoise in
// 480-sample frames (10ms at 48kHz) before being sent to the room.
import { createRNNWasmModuleSync } from "@jitsi/rnnoise-wasm";

const FRAME = 480;
const SCALE = 32768;

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.mod = createRNNWasmModuleSync();
    this.state = this.mod._rnnoise_create(0);
    this.framePtr = this.mod._malloc(FRAME * 4);
    this.frameIdx = this.framePtr >> 2;
    // FIFO buffers: collect render quanta into 480-sample frames,
    // emit processed samples with one frame of latency.
    this.inBuf = new Float32Array(FRAME);
    this.inLen = 0;
    this.outBuf = new Float32Array(FRAME * 4);
    this.outStart = 0;
    this.outEnd = 0;
    this.port.onmessage = (e) => {
      if (typeof e.data?.enabled === "boolean") this.enabled = e.data.enabled;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    if (!this.enabled) {
      output.set(input);
      return true;
    }

    // Feed input into the frame buffer; process each full frame
    let read = 0;
    while (read < input.length) {
      const take = Math.min(FRAME - this.inLen, input.length - read);
      this.inBuf.set(input.subarray(read, read + take), this.inLen);
      this.inLen += take;
      read += take;
      if (this.inLen === FRAME) {
        const heap = this.mod.HEAPF32;
        for (let i = 0; i < FRAME; i++) heap[this.frameIdx + i] = this.inBuf[i] * SCALE;
        this.mod._rnnoise_process_frame(this.state, this.framePtr, this.framePtr);
        for (let i = 0; i < FRAME; i++) {
          this.outBuf[this.outEnd % this.outBuf.length] = heap[this.frameIdx + i] / SCALE;
          this.outEnd++;
        }
        this.inLen = 0;
      }
    }

    // Emit processed samples (silence until the first frame is ready)
    for (let i = 0; i < output.length; i++) {
      output[i] = this.outStart < this.outEnd
        ? this.outBuf[this.outStart++ % this.outBuf.length]
        : 0;
    }
    return true;
  }
}

registerProcessor("rnnoise", RnnoiseProcessor);
