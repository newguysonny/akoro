/**
 * modules/courses/video-store.js — the course-video rows, in Postgres.
 *
 * The upload route used to keep these in a module-level array. That was
 * fine while the encoder lived in the same process, but the media worker
 * calls back minutes later: an API restart (including every auto-deploy)
 * lost the row and the callback became a 404. The `videos` table already
 * exists in the base schema; this is the adapter the old comment asked for.
 */
import db from "../../db.js";

const TABLE = "videos";

const COLUMNS = {
  courseId:         "course_id",
  title:            "title",
  description:      "description",
  orderIndex:       "order_index",
  isPreview:        "is_preview",
  videoUrl:         "video_url",
  hlsPath:          "hls_path",
  sourceKey:        "source_key",
  variants:         "variants",
  duration:         "duration",
  fileSize:         "file_size",
  encodingStatus:   "encoding_status",
  encodingProgress: "encoding_progress",
  errorMessage:     "error_message",
};

const raise = (error) => {
  if (!error) return;
  const err = new Error(error.message || String(error));
  err.cause = error;
  throw err;
};

export function parseVariants(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/** DB row (snake_case) → the camelCase shape the routes return. */
export function rowToVideo(row) {
  if (!row) return null;
  return {
    id:               row.id,
    courseId:         row.course_id,
    title:            row.title,
    description:      row.description,
    orderIndex:       row.order_index,
    isPreview:        row.is_preview,
    videoUrl:         row.video_url,
    hlsPath:          row.hls_path,
    sourceKey:        row.source_key,
    variants:         parseVariants(row.variants),
    duration:         row.duration,
    fileSize:         row.file_size,
    encodingStatus:   row.encoding_status,
    encodingProgress: row.encoding_progress,
    errorMessage:     row.error_message,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  };
}

/** Partial camelCase patch → the columns that exist. Unknown keys are dropped. */
export function videoToRow(data = {}) {
  const row = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    let value = data[field];
    if (field === "variants") value = parseVariants(value);
    if (field === "isPreview") value = value === true || value === "true";
    if (field === "orderIndex") value = Number.isFinite(Number(value)) ? Number(value) : 0;
    if (field === "encodingProgress") value = Number.isFinite(Number(value)) ? Number(value) : 0;
    if (field === "fileSize" && value != null) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
    }
    if (field === "duration" && value != null) {
      const n = Number(value);
      value = Number.isFinite(n) ? n : null;
    }
    row[column] = value;
  }
  return row;
}

export const VideoStore = {
  async list(courseId) {
    const { data, error } = await db.from(TABLE).select("*")
      .eq("course_id", courseId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    raise(error);
    return (data || []).map(rowToVideo);
  },

  async get(id) {
    const { data, error } = await db.from(TABLE).select("*").eq("id", id).maybeSingle();
    raise(error);
    return rowToVideo(data);
  },

  async create(video) {
    const row = videoToRow(video);
    if (video?.id) row.id = video.id;
    if (!Object.prototype.hasOwnProperty.call(row, "encoding_status")) row.encoding_status = "queued";
    const { data, error } = await db.from(TABLE).insert(row).select("*").single();
    raise(error);
    return rowToVideo(data);
  },

  async update(id, patch) {
    const row = videoToRow(patch);
    if (Object.keys(row).length === 0) return VideoStore.get(id);
    row.updated_at = new Date().toISOString();
    const { data, error } = await db.from(TABLE).update(row).eq("id", id).select("*").maybeSingle();
    raise(error);
    return rowToVideo(data);
  },

  async delete(id) {
    const { data, error } = await db.from(TABLE).delete().eq("id", id).select("id");
    raise(error);
    return Array.isArray(data) && data.length > 0;
  },
};

export default VideoStore;
