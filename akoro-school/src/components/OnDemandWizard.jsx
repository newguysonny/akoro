import { useState } from 'react';
import { Btn, Modal, Inp, Txa, Sel, WizardSteps, FileUploadZone } from './Primitives.jsx';
import { GREEN, PURPLE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { fileToDataUrl } from '../utils/image.js';

const LEVELS = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced'], ['all', 'All Levels']];

/* ── Lesson row (video lesson inside a section) ─────────────────────── */
function LessonRow({ lesson, idx, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const upd = (patch) => onChange({ ...lesson, ...patch });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: C.brand, fontFamily: C.font, minWidth: 18 }}>{idx + 1}</span>
        <Ico ti="ti-player-play" size={13} color={lesson.videoUrl ? GREEN : C.muted2} style={{ flexShrink: 0 }} />
        <input placeholder="Lesson title (e.g. Intro to Variables)" value={lesson.title} onChange={(e) => upd({ title: e.target.value })}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, border: 'none', outline: 'none', fontFamily: C.font, color: C.ink }} />
        <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted2, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3, fontFamily: C.font }}>
          <Ico ti="ti-chevron-down" size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.15s' }} />
          {lesson.videoUrl ? 'Video ✓' : 'Add video'}
        </button>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}><Ico ti="ti-trash" size={14} /></button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
          {lesson.videoUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: GREEN, fontFamily: C.font }}>
              <Ico ti="ti-video" size={13} /> Video uploaded
              <button onClick={() => upd({ videoUrl: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 11, fontWeight: 700, fontFamily: C.font }}>Replace</button>
            </div>
          ) : (
            <FileUploadZone label="Upload lesson video" accept="video/*" onUploaded={({ fileUrl }) => upd({ videoUrl: fileUrl })} />
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
            <Inp type="number" value={lesson.duration} onChange={(e) => upd({ duration: e.target.value })} placeholder="Duration (min)" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, fontFamily: C.font, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={!!lesson.preview} onChange={(e) => upd({ preview: e.target.checked })} />
              Free preview
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Section (module) card ──────────────────────────────────────────── */
function SectionCard({ section, si, onChange, onRemove }) {
  const [open, setOpen] = useState(si === 0);
  const setLesson = (li, l) => onChange({ ...section, lessons: section.lessons.map((x, j) => j === li ? l : x) });
  const addLesson = () => onChange({ ...section, lessons: [...section.lessons, { title: '', videoUrl: null, duration: '', preview: false }] });
  const removeLesson = (li) => onChange({ ...section, lessons: section.lessons.filter((_, j) => j !== li) });

  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}>
          <Ico ti="ti-chevron-down" size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '.15s' }} />
        </button>
        <input value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} placeholder={`Section ${si + 1}`}
          style={{ flex: 1, fontSize: 14, fontWeight: 800, border: 'none', background: 'transparent', outline: 'none', fontFamily: C.font, color: C.ink }} />
        <span style={{ fontSize: 11, color: C.muted, fontFamily: C.font }}>
          {section.lessons.length} lesson{section.lessons.length !== 1 ? 's' : ''}
        </span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}><Ico ti="ti-trash" size={14} /></button>
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {section.lessons.map((l, li) => (
            <LessonRow key={li} lesson={l} idx={li} onChange={(nl) => setLesson(li, nl)} onRemove={() => removeLesson(li)} />
          ))}
          <Btn variant="secondary" size="sm" onClick={addLesson}><Ico ti="ti-plus" size={13} /> Add lesson</Btn>
        </div>
      )}
    </div>
  );
}

/* ── Main wizard ────────────────────────────────────────────────────── */
export default function OnDemandWizard({ open, onClose, onSubmit }) {
  const [step, setStep] = useState(0);
  const [info, setInfo] = useState({ title: '', description: '', category: '', level: 'all', thumbnail: null });
  const [sections, setSections] = useState([{ title: 'Section 1', lessons: [{ title: '', videoUrl: null, duration: '', preview: false }] }]);
  const [pricing, setPricing] = useState({ isFree: true, price: '', discountPrice: '' });
  const [published, setPublished] = useState(true);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep(0);
    setInfo({ title: '', description: '', category: '', level: 'all', thumbnail: null });
    setSections([{ title: 'Section 1', lessons: [{ title: '', videoUrl: null, duration: '', preview: false }] }]);
    setPricing({ isFree: true, price: '', discountPrice: '' });
    setPublished(true);
  };

  const setSection = (si, s) => setSections((ss) => ss.map((x, j) => j === si ? s : x));
  const addSection = () => setSections((ss) => [...ss, { title: `Section ${ss.length + 1}`, lessons: [] }]);
  const removeSection = (si) => setSections((ss) => ss.filter((_, j) => j !== si));

  const totalLessons = sections.reduce((n, s) => n + s.lessons.length, 0);
  const totalMinutes = sections.reduce((n, s) => n + s.lessons.reduce((m, l) => m + (Number(l.duration) || 0), 0), 0);

  const close = () => { onClose(); };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSubmit({ info, sections, pricing, published });
      onClose(); reset();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={close} title="New On-Demand Course" width={620}>
      <WizardSteps steps={['Basics', 'Curriculum', 'Pricing', 'Publish']} current={step} />

      {/* ── Step 1 · Basics ─────────────────────────────────────────── */}
      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Inp label="Course Title" value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} placeholder="e.g. Python for Beginners" />
          <Txa label="Description" value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} placeholder="What will students learn?" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Inp label="Category" value={info.category} onChange={(e) => setInfo({ ...info, category: e.target.value })} placeholder="e.g. Programming" />
            <Sel label="Level" value={info.level} onChange={(e) => setInfo({ ...info, level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Sel>
          </div>
          <div>
            <label style={lbl}>Thumbnail (optional)</label>
            <FileUploadZone label="Upload course thumbnail" accept="image/*" upload={false}
              onFile={async (f) => { try { const url = await fileToDataUrl(f); setInfo((p) => ({ ...p, thumbnail: url })); } catch { /* ignore */ } }} />
            {info.thumbnail && <img src={info.thumbnail} alt="" style={{ marginTop: 10, width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.border}` }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="secondary" onClick={close}>Cancel</Btn>
            <Btn onClick={() => setStep(1)} disabled={!info.title.trim()}>Next: Curriculum</Btn>
          </div>
        </div>
      )}

      {/* ── Step 2 · Curriculum ─────────────────────────────────────── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: C.muted, fontFamily: C.font }}>{sections.length} sections · {totalLessons} lessons</span>
          </div>
          {sections.map((s, si) => (
            <SectionCard key={si} section={s} si={si} onChange={(ns) => setSection(si, ns)} onRemove={() => removeSection(si)} />
          ))}
          <Btn variant="secondary" size="sm" onClick={addSection}><Ico ti="ti-plus" size={13} /> Add section</Btn>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Btn variant="secondary" onClick={() => setStep(0)}>Back</Btn>
            <Btn onClick={() => setStep(2)} disabled={totalLessons === 0}>Next: Pricing</Btn>
          </div>
        </div>
      )}

      {/* ── Step 3 · Pricing ────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={lbl}>Pricing model</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPricing({ ...pricing, isFree: true })} style={priceTile(pricing.isFree)}>
                <Ico ti="ti-book" size={18} color={pricing.isFree ? C.brand : C.muted2} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Free</span>
                <span style={{ fontSize: 11, color: C.muted }}>Anyone can enrol</span>
              </button>
              <button onClick={() => setPricing({ ...pricing, isFree: false })} style={priceTile(!pricing.isFree)}>
                <Ico ti="ti-currency-dollar" size={18} color={!pricing.isFree ? C.brand : C.muted2} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Paid</span>
                <span style={{ fontSize: 11, color: C.muted }}>Set a price</span>
              </button>
            </div>
          </div>

          {!pricing.isFree && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Inp label="Price ($)" type="number" value={pricing.price} onChange={(e) => setPricing({ ...pricing, price: e.target.value })} placeholder="49" />
              <Inp label="Discount price ($, optional)" type="number" value={pricing.discountPrice} onChange={(e) => setPricing({ ...pricing, discountPrice: e.target.value })} placeholder="29" />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <Btn variant="secondary" onClick={() => setStep(1)}>Back</Btn>
            <Btn onClick={() => setStep(3)} disabled={!pricing.isFree && !pricing.price}>Next: Publish</Btn>
          </div>
        </div>
      )}

      {/* ── Step 4 · Publish ────────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: C.bg, borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: C.ink, margin: '0 0 4px', fontFamily: C.font }}>{info.title || 'Untitled course'}</h3>
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px', fontFamily: C.font }}>{info.description || 'No description'}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: C.muted }}>
              <span style={tag}><Ico ti="ti-book" size={10} /> {sections.length} sections</span>
              <span style={tag}><Ico ti="ti-player-play" size={10} /> {totalLessons} lessons</span>
              <span style={tag}><Ico ti="ti-clock" size={10} /> {totalMinutes} min</span>
              <span style={tag}><Ico ti="ti-tag" size={10} /> {pricing.isFree ? 'Free' : `$${pricing.discountPrice || pricing.price}`}</span>
            </div>
          </div>

          <div>
            <label style={lbl}>Visibility</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPublished(true)} style={priceTile(published)}>
                <Ico ti="ti-eye" size={18} color={published ? C.brand : C.muted2} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Publish now</span>
                <span style={{ fontSize: 11, color: C.muted }}>Visible to students</span>
              </button>
              <button onClick={() => setPublished(false)} style={priceTile(!published)}>
                <Ico ti="ti-file-text" size={18} color={!published ? C.brand : C.muted2} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Save as draft</span>
                <span style={{ fontSize: 11, color: C.muted }}>Hidden for now</span>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Btn variant="secondary" onClick={() => setStep(2)}>Back</Btn>
            <Btn onClick={handleSubmit} disabled={loading || !info.title.trim()}>
              {loading ? 'Creating…' : published ? 'Publish Course' : 'Save Draft'}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── styles ──────────────────────────────────────────────────────────── */
const lbl = { fontSize: 12, fontWeight: 700, color: C.ink, display: 'block', marginBottom: 6, fontFamily: C.font };
const tag = { background: C.surface, padding: '3px 10px', borderRadius: 20, border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', gap: 4 };
const priceTile = (active) => ({
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
  padding: '14px 16px', borderRadius: 12, cursor: 'pointer', fontFamily: C.font, textAlign: 'left',
  background: active ? tint(6) : C.surface, color: C.ink,
  border: `1.5px solid ${active ? C.brand : C.border}`, transition: 'all .15s',
});
