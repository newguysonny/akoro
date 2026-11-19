# voice

Speech in and out: Deepgram (batch and live) transcription, OpenAI realtime
transcription, Deepgram/OpenAI text-to-speech, and the websocket voice stream.

## Entry

`index.js` is the only cross-module entry point. `routes.js` is the module's
default export.

## Extend

Add a provider/helper file and export its public names from `index.js`. Voice
routes bill through the shared coin helpers; keep provider calls in `deepgram.js`
and `tts.js`.

## Limits

Provider keys choose the path (`DEEPGRAM_API_KEY`, `OPENAI_API_KEY`); without
them the endpoints return a clear 503/fallback rather than failing silently.
