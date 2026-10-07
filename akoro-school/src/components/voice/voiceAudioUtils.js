/**
 * voiceAudioUtils.js — raw PCM helpers for the Deepgram realtime voice agent.
 * Ported from the deepgram-voice-agent-demo reference app.
 */

export function createAudioBuffer(audioContext, data, sampleRate = 24000) {
  const audioDataView = new Int16Array(data);
  if (audioDataView.length === 0) return null;

  const buffer = audioContext.createBuffer(1, audioDataView.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < audioDataView.length; i++) channelData[i] = audioDataView[i] / 32768;
  return buffer;
}

export function playAudioBuffer(audioContext, buffer, startTimeRef, analyser) {
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  const currentTime = audioContext.currentTime;
  if (startTimeRef.current < currentTime) startTimeRef.current = currentTime;

  source.start(startTimeRef.current);
  startTimeRef.current += buffer.duration;
  return source;
}

export function downsample(buffer, fromSampleRate, toSampleRate) {
  if (fromSampleRate === toSampleRate) return buffer;
  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; }
    result[offsetResult] = accum / count;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

export function convertFloat32ToInt16(buffer) {
  let l = buffer.length;
  const buf = new Int16Array(l);
  while (l--) buf[l] = Math.min(1, buffer[l]) * 0x7fff;
  return buf.buffer;
}

export function normalizeVolume(analyser, dataArray, normalizationFactor) {
  analyser.getByteFrequencyData(dataArray);
  const sum = dataArray.reduce((acc, val) => acc + val, 0);
  return Math.min(sum / dataArray.length / normalizationFactor, 1);
}
