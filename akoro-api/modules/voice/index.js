/** Voice: transcription (Deepgram/OpenAI), TTS, and the realtime voice stream. */

export { hasDeepgram, transcribeBufferDeepgram, transcribeFileDeepgram } from "./deepgram.js";
export {
  LIVE,
  createDeepgramTranscriber,
  deepgramLiveUrl,
  readDeepgramMessage,
} from "./deepgramLive.js";
export { createRealtimeTranscriber } from "./openaiRealtime.js";
export { setupVoiceStreaming } from "./streaming.js";
export {
  AURA_VOICE,
  DEEPGRAM_TTS_MAX_CHARS,
  TTS_MODELS,
  auraVoiceFor,
  speakBuffer,
  speakStream,
  ttsPieces,
} from "./tts.js";
