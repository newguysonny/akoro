/** Voice: transcription (Deepgram/OpenAI) and TTS. `streaming.js` (the realtime voice stream) is wired directly by `routes.js`. */

export { hasDeepgram, transcribeBufferDeepgram, transcribeFileDeepgram } from "./deepgram.js";
export {
  LIVE,
  createDeepgramTranscriber,
  deepgramLiveUrl,
  readDeepgramMessage,
} from "./deepgramLive.js";
export { createRealtimeTranscriber } from "./openaiRealtime.js";
export {
  AURA_VOICE,
  DEEPGRAM_TTS_MAX_CHARS,
  TTS_MODELS,
  auraVoiceFor,
  speakBuffer,
  speakStream,
  ttsPieces,
} from "./tts.js";
