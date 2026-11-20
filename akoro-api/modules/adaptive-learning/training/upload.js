// =============================================================
// training/upload.js
// The upload directory, the accepted media types, and temp cleanup.
// =============================================================

import multer from "multer";
import { v4 as uuid } from "uuid";
import fs   from "fs";
import path from "path";

// ── Multer ────────────────────────────────────────────────────
const UPLOAD_DIR = path.join("/tmp", "akoro-uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  "audio/mpeg","audio/mp3","audio/wav","audio/x-wav","audio/wave",
  "audio/x-m4a","audio/m4a","audio/mp4","audio/ogg","audio/webm",
  "audio/aac","audio/x-aac","audio/flac","audio/x-flac","audio/3gpp",
  "video/mp4","video/quicktime","video/x-matroska","video/webm",
  "video/x-msvideo","video/mpeg","video/x-ms-wmv","video/3gpp",
  "application/octet-stream", // fallback for undetected MIME types
]);

class UnsupportedFileError extends Error {
  constructor(mime) { super(`Unsupported file type: ${mime}`); this.status = 400; }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (_req,  file, cb) => cb(null, uuid() + path.extname(file.originalname)),
  }),
  limits:     { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ALLOWED_MIME.has(file.mimetype) ? cb(null, true) : cb(new UnsupportedFileError(file.mimetype)),
});

// ── Helpers ───────────────────────────────────────────────────
const cleanTmp = (p) => { try { fs.unlinkSync(p); } catch (_) {} };

export { UPLOAD_DIR, upload, cleanTmp };
