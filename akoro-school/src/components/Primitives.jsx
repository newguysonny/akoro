import { useState, useRef } from 'react';
import { Upload, X, Check } from 'lucide-react';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, BLUE, FONT } from '../constants.js';

/* ── Button ─────────────────────────────────────────────────────────── */
export function Btn({ children, variant = 'primary', size = 'md', onClick, disabled, style, type = 'button', ...rest }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    fontFamily: FONT, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', borderRadius: 10, transition: 'all .15s',
    opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
  };

  const sizes = {
    sm:  { padding: '6px 14px', fontSize: 12 },
    md:  { padding: '10px 18px', fontSize: 14 },
    lg:  { padding: '13px 24px', fontSize: 15 },
    xl:  { padding: '15px 28px', fontSize: 16 },
    icon:{ padding: '8px', fontSize: 14, borderRadius: 8 },
  };

  const variants = {
    primary:   { background: AMBER, color: WHITE, boxShadow: `0 2px 8px ${AMBER}44` },
    secondary: { background: WHITE, color: INK, border: `1.5px solid ${BORDER}` },
    ghost:     { background: 'transparent', color: MUTED },
    danger:    { background: RED, color: WHITE },
    dark:      { background: INK, color: WHITE },
    purple:    { background: PURPLE, color: WHITE, boxShadow: `0 2px 8px ${PURPLE}33` },
    blue:      { background: BLUE, color: WHITE, boxShadow: `0 2px 8px ${BLUE}33` },
    green:     { background: GREEN, color: WHITE },
    outline:   { background: 'transparent', color: AMBER, border: `1.5px solid ${AMBER}` },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ── Input ──────────────────────────────────────────────────────────── */
export function Inp({ label, error, style, containerStyle, ...props }) {
  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: `1.5px solid ${error ? RED : BORDER}`,
    outline: 'none', fontSize: 14, fontFamily: FONT, color: INK,
    background: WHITE, transition: 'border-color .15s',
    boxSizing: 'border-box', ...style,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...containerStyle }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: INK }}>{label}</label>}
      <input style={inputStyle} {...props} />
      {error && <span style={{ fontSize: 11, color: RED }}>{error}</span>}
    </div>
  );
}

/* ── Textarea ───────────────────────────────────────────────────────── */
export function Txa({ label, error, style, containerStyle, rows = 3, ...props }) {
  const taStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: `1.5px solid ${error ? RED : BORDER}`,
    outline: 'none', fontSize: 14, fontFamily: FONT, color: INK,
    background: WHITE, resize: 'vertical', minHeight: 80,
    boxSizing: 'border-box', ...style,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...containerStyle }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: INK }}>{label}</label>}
      <textarea style={taStyle} rows={rows} {...props} />
      {error && <span style={{ fontSize: 11, color: RED }}>{error}</span>}
    </div>
  );
}

/* ── Select ─────────────────────────────────────────────────────────── */
export function Sel({ label, error, style, containerStyle, children, ...props }) {
  const selStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: `1.5px solid ${error ? RED : BORDER}`,
    outline: 'none', fontSize: 14, fontFamily: FONT, color: INK,
    background: WHITE, cursor: 'pointer', boxSizing: 'border-box', ...style,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...containerStyle }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: INK }}>{label}</label>}
      <select style={selStyle} {...props}>{children}</select>
      {error && <span style={{ fontSize: 11, color: RED }}>{error}</span>}
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, width = 520, style }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26,26,46,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '20px', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: WHITE, borderRadius: 20, width: '100%', maxWidth: width,
          maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.2)',
          animation: 'fade-up .25s ease both', ...style,
        }}
      >
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 24px 0',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: 0 }}>{title}</h2>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: MUTED, padding: 4, borderRadius: 6,
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div style={{ padding: '20px 24px 24px' }}>{children}</div>
      </div>
    </div>
  );
}

/* ── SectionHead ────────────────────────────────────────────────────── */
export function SectionHead({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

/* ── WizardSteps ─────────────────────────────────────────────────────── */
export function WizardSteps({ steps, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: i < current ? GREEN : i === current ? AMBER : BORDER,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: i <= current ? WHITE : MUTED, fontSize: 12, fontWeight: 700,
              flexShrink: 0,
            }}>
              {i < current ? <Check size={14} /> : i + 1}
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: i === current ? INK : MUTED, whiteSpace: 'nowrap' }}>
              {step}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1, height: 2, margin: '0 4px', marginBottom: 16,
              background: i < current ? GREEN : BORDER,
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── StatusPill ─────────────────────────────────────────────────────── */
export function StatusPill({ status }) {
  const map = {
    live:      { bg: '#DCFCE7', color: GREEN, label: 'Live' },
    scheduled: { bg: '#FEF3C7', color: '#D97706', label: 'Scheduled' },
    draft:     { bg: '#F3F4F6', color: MUTED, label: 'Draft' },
    completed: { bg: '#EDE9FE', color: PURPLE, label: 'Completed' },
    cancelled: { bg: '#FEE2E2', color: RED, label: 'Cancelled' },
    active:    { bg: '#DCFCE7', color: GREEN, label: 'Active' },
    paused:    { bg: '#FEF3C7', color: '#D97706', label: 'Paused' },
    pending:   { bg: '#FEF3C7', color: '#D97706', label: 'Pending' },
    done:      { bg: '#DCFCE7', color: GREEN, label: 'Done' },
  };
  const cfg = map[status] || map.draft;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color, display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
      {cfg.label}
    </span>
  );
}

/* ── PlatBadge ──────────────────────────────────────────────────────── */
export function PlatBadge({ platform }) {
  const map = {
    zoom:    { bg: '#EFF6FF', color: BLUE, label: 'Zoom' },
    meet:    { bg: '#F0FDF4', color: GREEN, label: 'Meet' },
    teams:   { bg: '#EDE9FE', color: PURPLE, label: 'Teams' },
    custom:  { bg: '#FFF7ED', color: AMBER, label: 'Custom' },
    akoro:   { bg: '#FFF7ED', color: AMBER, label: 'Akoro Live' },
  };
  const cfg = map[platform?.toLowerCase()] || map.custom;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

/* ── CourseTypeBadge ────────────────────────────────────────────────── */
export function CoursTypeBadge({ type }) {
  const map = {
    live:      { bg: '#FFF7ED', color: AMBER, label: 'Live Course' },
    'on-demand': { bg: '#EDE9FE', color: PURPLE, label: 'On-Demand' },
    hybrid:    { bg: '#EFF6FF', color: BLUE, label: 'Hybrid' },
    workshop:  { bg: '#F0FDF4', color: GREEN, label: 'Workshop' },
  };
  const cfg = map[type] || map.live;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

/* ── FileUploadZone ─────────────────────────────────────────────────── */
// Real upload to R2 via uploadApi. `onUploaded(result)` gets { id, fileUrl, fileName }.
// Pass `upload={false}` to only capture the File locally (via onFile) without uploading.
export function FileUploadZone({ label = 'Drop files here or click to upload', accept, onFile, onUploaded, upload = true }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const startUpload = async (file) => {
    setFileName(file.name);
    setProgress(0);
    setDone(false);
    setError(null);
    if (onFile) onFile(file);
    if (!upload) { setProgress(100); setDone(true); return; }
    try {
      const { uploadFile } = await import('../services/uploadApi.js');
      const result = await uploadFile(file, setProgress);
      setProgress(100);
      setDone(true);
      if (onUploaded) onUploaded(result);
    } catch (err) {
      setError(err.message || 'Upload failed');
    }
  };

  const handleFiles = (files) => {
    if (files.length > 0) startUpload(files[0]);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${dragging ? AMBER : BORDER}`,
        borderRadius: 12, padding: '24px', textAlign: 'center',
        cursor: 'pointer', transition: 'all .2s',
        background: dragging ? `${AMBER}08` : LIGHT,
      }}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)} />
      {!fileName ? (
        <>
          <Upload size={24} color={MUTED} style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{label}</p>
        </>
      ) : (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: INK, margin: '0 0 8px' }}>{fileName}</p>
          <div style={{ height: 4, background: BORDER, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: done ? GREEN : AMBER, transition: 'width .2s' }} />
          </div>
          {done && !error && <p style={{ fontSize: 11, color: GREEN, marginTop: 6, fontWeight: 600 }}>Upload complete</p>}
          {error && <p style={{ fontSize: 11, color: RED, marginTop: 6, fontWeight: 600 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

/* ── Badge ──────────────────────────────────────────────────────────── */
export function Badge({ children, color = AMBER, bg, style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: bg || `${color}18`, color,
      ...style,
    }}>
      {children}
    </span>
  );
}

/* ── Toast ──────────────────────────────────────────────────────────── */
export function Toast({ message, type = 'success', onClose }) {
  const colors = { success: GREEN, error: RED, info: BLUE, warning: AMBER };
  const color = colors[type] || GREEN;
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: WHITE, borderRadius: 12, padding: '14px 18px',
      boxShadow: '0 8px 30px rgba(0,0,0,.12)',
      display: 'flex', alignItems: 'center', gap: 10,
      animation: 'fade-up .25s ease both',
      borderLeft: `4px solid ${color}`,
      maxWidth: 360,
    }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: INK, flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 2 }}>
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */
export function Skeleton({ width = '100%', height = 20, style }) {
  return (
    <div className="skeleton" style={{ width, height, borderRadius: 8, ...style }} />
  );
}
