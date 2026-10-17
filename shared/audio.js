// Thin wrapper around ggwave (vendor/ggwave.js must be loaded first; it defines
// the global ggwave_factory).
//
// Keep ONE ggwave instance per page: the library has a small fixed instance
// limit, and creating more silently breaks decoding.

export const PROTOCOLS = {
  normal: 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL',
  fast: 'GGWAVE_PROTOCOL_AUDIBLE_FAST',
  fastest: 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST',
};

let ctx, gg, instance, micStream, processor;

// Must be called from a user tap (iOS will not start audio otherwise).
export async function initAudio() {
  if (instance !== undefined) {
    await ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  gg = await ggwave_factory();
  gg.disableLog();
  const params = gg.getDefaultParameters();
  params.sampleRateInp = ctx.sampleRate;
  params.sampleRateOut = ctx.sampleRate;
  instance = gg.init(params);
}

export function encode(text, protocol = 'fast', volume = 25) {
  const raw = gg.encode(instance, text, gg.ProtocolId[PROTOCOLS[protocol]], volume);
  // raw is an Int8Array view of float32 bytes in wasm memory; copy it out.
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

export const durationOf = (samples) => samples.length / ctx.sampleRate;

export function play(samples) {
  return new Promise((resolve) => {
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = resolve;
    src.start();
  });
}

// Calls onText(string) for every decoded message and onLevel(0..1) per frame.
export async function listen(onText, onLevel) {
  // Browser voice processing destroys the tones, so turn all of it off.
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const source = ctx.createMediaStreamSource(micStream);
  processor = ctx.createScriptProcessor(1024, 1, 1);
  processor.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(0);
    if (onLevel) onLevel(rms(samples));
    const res = gg.decode(instance, new Int8Array(new Float32Array(samples).buffer));
    // res views a static wasm buffer, so copy before decoding.
    if (res && res.length > 0) onText(new TextDecoder().decode(new Uint8Array(res)));
  };
  source.connect(processor);
  processor.connect(ctx.destination);
}

export function stopListening() {
  if (processor) processor.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  processor = micStream = undefined;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}
