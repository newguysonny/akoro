// =============================================================
// training/agentTraining.js
// Entry point for the training feature. The stages live in
// runs.js (run state/SSE), upload.js (multer/temp files),
// extraction.js (GPT-4o + transcription), store.js (storage,
// embeddings, chunks, teacher profile), runner.js (the pipeline),
// routes.js (HTTP) and live.js (websocket + live stream).
// =============================================================

export { default } from "./routes.js";
export { attachTrainingWS, startLiveStream, receiveChunk, endLiveStream } from "./live.js";
