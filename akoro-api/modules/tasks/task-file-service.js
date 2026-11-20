import { TaskFileDB } from "./lib/db.js";
import { createPresignedUpload } from "./lib/storage.js";
import { extractTextFromUrl } from "./lib/ocr.js";
import { updateTaskFileOcr } from "./task-store.js";

// ─── POST /api/tasks/upload-url ───────────────────────────────────────────────
export async function uploadUrl(req, res) {
  try {
    const { fileName, fileType, sizeBytes } = req.body;
    if (!fileName || !fileType) return res.status(400).json({ error: "fileName and fileType are required" });
    if (sizeBytes > 2 * 1024 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 2GB)" });

    const result = await createPresignedUpload(fileName, fileType, req.user.id, { sizeBytes, origin: req.headers.origin || null });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /api/tasks/files/confirm ───────────────────────────────────────────
export async function confirmFile(req, res) {
  try {
    const { fileKey, fileName, fileType, sizeBytes, publicUrl } = req.body;
    const file = await TaskFileDB.create({
      teacher_id: req.user.id, file_key: fileKey,
      file_name: fileName, file_type: fileType,
      size_bytes: sizeBytes, file_url: publicUrl,
    });

    // OCR extract in background
    extractTextFromUrl(publicUrl, fileType, fileName).then(async (result) => {
      if (result.success) {
        await updateTaskFileOcr(file.id, result.text);
      }
    }).catch(() => {});

    res.status(201).json({ file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/tasks/files/:id ─────────────────────────────────────────────────
// Poll a file's OCR status/result (ocr_text is populated in the background).
export async function getFile(req, res) {
  try {
    const file = await TaskFileDB.findById(req.params.id);
    if (!file) return res.status(404).json({ error: "File not found" });
    if (file.teacher_id && file.teacher_id !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({
      id:       file.id,
      fileName: file.file_name,
      fileUrl:  file.file_url,
      ocrText:  file.ocr_text ?? null,
      ocrReady: file.ocr_text != null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
