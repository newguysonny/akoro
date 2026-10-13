/**
 * TeacherToolSheet — teacher generation tools surfaced in the AI chat modal.
 *   kind = 'lesson'   → lesson plan / worksheet / quiz  (POST /ai/lesson)
 *   kind = 'website'  → newsletter / recap / social / event page (POST /ai/website-content)
 *   kind = 'teaching' → the shared teaching tool suite (POST /api/teaching/tools/*)
 * Generates content the teacher can drop into the chat or copy into the builder.
 */
import { useState } from 'react';
import { X, Sparkles, Copy, Check, MessageSquarePlus, Globe } from 'lucide-react';
import { apiPost } from '../../services/api.js';
import TeachingTools from '../../components/teaching/TeachingTools.jsx';
import ContentView, { contentViewStyles } from '../../components/ContentView.jsx';

const FONT = "'Nunito', sans-serif";
const BRAND = '#6C3BFF', MUTED = '#6B6B80', BORDER = '#EDE8E1', INK = '#1A1A2E';

const LESSON_TYPES = [
  { k: 'lesson_plan', label: 'Lesson plan' },
  { k: 'worksheet',   label: 'Worksheet' },
  { k: 'quiz',        label: 'Quiz' },
];
const WEB_TYPES = [
  { k: 'newsletter',  label: 'Newsletter' },
  { k: 'event_recap', label: 'Event recap' },
  { k: 'social_post', label: 'Social post' },
  { k: 'event_page',  label: 'Event page' },
];

export default function TeacherToolSheet({ kind, host, onClose, onInsert }) {
  // The teaching suite brings its own catalog, forms and output renderers, so
  // it only borrows this sheet's chrome.
  if (kind === 'teaching') {
    return (
      <Sheet title="Teaching tools" onClose={onClose}>
        <TeachingTools compact onInsert={(text) => { onInsert?.(text); onClose(); }} />
      </Sheet>
    );
  }
  return <LegacyToolSheet kind={kind} host={host} onClose={onClose} onInsert={onInsert} />;
}

// Shared bottom-sheet chrome.
function Sheet({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: FONT }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: '20px 20px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 10px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15.5, fontWeight: 900, color: INK }}>
            <Sparkles size={17} color={BRAND} /> {title}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={20} /></button>
        </div>
        <div style={{ padding: '14px 16px 18px', overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function LegacyToolSheet({ kind, host, onClose, onInsert }) {
  const isLesson = kind === 'lesson';
  const types = isLesson ? LESSON_TYPES : WEB_TYPES;
  const [type, setType] = useState(types[0].k);
  const [topic, setTopic] = useState('');
  const [subject, setSubject] = useState('');
  const [klass, setKlass] = useState('');
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [out, setOut] = useState('');
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(null);
  // Social posts aren't website pages; everything else can be published as one.
  const canPublish = !isLesson && type !== 'social_post';

  const generate = async () => {
    setBusy(true); setError(null); setOut('');
    try {
      let d;
      if (isLesson) {
        if (!topic.trim()) throw new Error('Enter a topic');
        d = await apiPost('/api/school/ai/lesson', { type, topic: topic.trim(), subject: subject.trim(), class: klass.trim() });
      } else {
        if (!brief.trim()) throw new Error('Tell me what it’s about');
        d = await apiPost('/api/school/ai/website-content', { type, brief: brief.trim() });
      }
      setOut((d?.data ?? d)?.content || 'No content returned.');
    } catch (e) { setError(e?.message || 'Could not generate that.'); }
    finally { setBusy(false); }
  };

  const copy = async () => { try { await navigator.clipboard.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };

  const publish = async () => {
    setBusy(true); setError(null);
    try {
      const pageTitle = title.trim() || brief.trim().slice(0, 60) || 'New page';
      const d = await apiPost('/api/school/ai/publish-page', { host, title: pageTitle, content: out, status: 'draft' });
      setPublished((d?.data ?? d) || { title: pageTitle });
    } catch (e) { setError(e?.message || 'Could not publish.'); }
    finally { setBusy(false); }
  };

  const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: '#fff', boxSizing: 'border-box' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: FONT }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: '20px 20px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 10px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15.5, fontWeight: 900, color: INK }}>
            <Sparkles size={17} color={BRAND} /> {isLesson ? 'Lesson tools' : 'Website content'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={20} /></button>
        </div>

        <div style={{ padding: '14px 16px 18px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {types.map((t) => (
              <button key={t.k} onClick={() => setType(t.k)}
                style={{ background: type === t.k ? BRAND : '#fff', color: type === t.k ? '#fff' : MUTED, border: `1px solid ${type === t.k ? BRAND : BORDER}`, borderRadius: 100, padding: '6px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, fontFamily: FONT }}>
                {t.label}
              </button>
            ))}
          </div>

          {isLesson ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (e.g. Photosynthesis)" style={inp} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" style={inp} />
                <input value={klass} onChange={(e) => setKlass(e.target.value)} placeholder="Class (e.g. JSS 2)" style={inp} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {canPublish && <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title (for the website)" style={inp} />}
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="What's it about? e.g. “Recap of our Inter-house Sports day — Blue house won”" style={{ ...inp, resize: 'vertical' }} />
            </div>
          )}

          <button onClick={generate} disabled={busy} style={{ width: '100%', background: busy ? '#C9BEFF' : BRAND, color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: FONT }}>
            {busy ? 'Generating…' : <><Sparkles size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />Generate</>}
          </button>
          {error && <div style={{ color: '#EF4444', fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>{error}</div>}

          {out && (
            <div style={{ marginTop: 14 }}>
              <div style={{ background: '#FAF8F5', border: `1px solid ${BORDER}`, borderRadius: 12, maxHeight: '40vh', overflowY: 'auto' }}>
                <style>{contentViewStyles}</style>
                <ContentView content={out} kind={type === 'social_post' ? 'social' : null} style={{ padding: '12px 14px' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={copy} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800, color: INK, cursor: 'pointer', fontFamily: FONT }}>
                  {copied ? <Check size={14} color="#10B981" /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
                </button>
                {canPublish ? (
                  <button onClick={publish} disabled={busy} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: BRAND, border: 'none', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800, color: '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: FONT }}>
                    <Globe size={14} />{busy ? 'Publishing…' : 'Publish to website'}
                  </button>
                ) : onInsert && (
                  <button onClick={() => { onInsert(out); onClose(); }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: BRAND, border: 'none', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: FONT }}>
                    <MessageSquarePlus size={14} />Add to chat
                  </button>
                )}
              </div>
              {published && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', fontSize: 12.5, fontWeight: 700 }}>
                  ✓ Saved as a draft page “{published.title}” — open <b>Website Builder</b> to review and publish it.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
