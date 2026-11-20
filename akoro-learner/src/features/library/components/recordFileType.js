const AUDIO_RE = /^audio\//, VIDEO_RE = /^video\//, IMAGE_RE = /^image\//;
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv']);
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i, VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const TEXT_EXT  = /\.(txt|md|csv)$/i;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const recordFileType = (r) => {
  if (!r || r.kind !== 'upload') return null;
  const mime = r.mime || '', name = r.name || '';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (AUDIO_RE.test(mime) || AUDIO_EXT.test(name)) return 'audio';
  if (VIDEO_RE.test(mime) || VIDEO_EXT.test(name)) return 'video';
  if (IMAGE_RE.test(mime)) return 'image';
  if (TEXT_MIME.has(mime) || TEXT_EXT.test(name)) return 'text';
  if (mime === DOCX_MIME || /\.docx$/i.test(name)) return 'docx';
  if (mime === PPTX_MIME || /\.pptx$/i.test(name)) return 'pptx';
  return 'other';
};
