import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, LogOut, User, AtSign, Mail, Phone, MapPin,
  Building2, GraduationCap, BookOpen, Pencil, Upload, Search, Bolt, Star,
  BarChart3, Clock, Languages, Moon, Palette, Bell, MessageCircle, HelpCircle,
  Bug, FileText, Shield, Key, Lock, PauseCircle, Trash2, Tag, Sparkles,
  Target, Award, Store, CheckCircle2, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  getProfile, patchProfile, patchAgent, patchNotifications,
  publishAgentToMarketplace, unpublishListing,
  loadLocalNotif, saveLocalNotif, loadListingId, saveListingId,
  setup2FA, enable2FA, disable2FA,
} from '../services/settingsApi.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, PURPLE, FONT } from '../constants.js';

const BRAND  = AMBER;
const FONTF  = FONT;

/* ─── Reference data ──────────────────────────────────────────── */
const ALL_SUBJECTS = [
  'Mathematics', 'Further Mathematics', 'English Language', 'English Literature',
  'Physics', 'Chemistry', 'Biology', 'Computer Science', 'Economics', 'Accounting',
  'Government / Civics', 'History', 'Geography', 'French', 'Yoruba', 'Igbo', 'Hausa',
  'Fine Art', 'Music', 'Business Studies', 'Commerce', 'Data Processing',
];
const SCHOOL_TYPES = ['Primary School', 'Junior Secondary School', 'Senior Secondary School', 'Sixth Form', 'College', 'University', 'Tutoring Centre', 'Independent'];
const LANGUAGES    = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Arabic'];
const COUNTRIES    = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Uganda', 'Tanzania', 'UK', 'USA', 'Canada', 'Other'];
const EMOJI_LIST   = ['🤖', '🧠', '👾', '🦉', '🎓', '⚡', '🌟', '🔮', '🦋', '🎯', '🚀', '💡', '🦁', '🐺', '🦊', '🎭', '🏆', '💎'];
const ACCENTS      = [AMBER, '#6C3BFF', '#3B82F6', '#10B981', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];

/* ─── Micro-components ────────────────────────────────────────── */
function Toggle({ on, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 42, height: 23, borderRadius: 12, position: 'relative', background: on ? BRAND : '#E5E7EB', transition: 'background .25s', cursor: 'pointer', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2.5, left: on ? 21 : 2.5, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .25s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </div>
  );
}
function ProgressBar({ pct, color }) {
  return (
    <div style={{ height: 5, background: '#F3F4F6', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: `linear-gradient(90deg,${color},${color}CC)` }} />
    </div>
  );
}
function SubjectChip({ label, onRemove, color = BRAND }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px 5px 10px', borderRadius: 20, background: `${color}10`, border: `1px solid ${color}25`, fontSize: 12, fontWeight: 700, color }}>
      {label}
      {onRemove && <span onClick={(e) => { e.stopPropagation(); onRemove(label); }} style={{ width: 14, height: 14, borderRadius: '50%', background: `${color}25`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: 1, fontSize: 9 }}>✕</span>}
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1.5, textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px', fontFamily: FONTF }}>{title}</p>
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,.05)', overflow: 'hidden', border: `1px solid ${BORDER}` }}>{children}</div>
    </div>
  );
}
const rowBase = { display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: `1px solid ${BORDER}`, background: '#fff', fontFamily: FONTF };
function Row({ icon: Icon, label, value, sub, danger, onClick, noArrow, children }) {
  return (
    <div style={{ ...rowBase, cursor: onClick ? 'pointer' : 'default' }}
      onMouseEnter={(e) => onClick && (e.currentTarget.style.background = LIGHT)}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
      onClick={onClick}>
      <span style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {Icon && <Icon size={17} color={danger ? RED : MUTED} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: danger ? RED : INK }}>{label}</p>
        {sub && <p style={{ fontSize: 11.5, color: MUTED2, marginTop: 2, margin: 0 }}>{sub}</p>}
      </div>
      {value !== undefined && <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, marginRight: 4, flexShrink: 0 }}>{value}</span>}
      {children}
      {onClick && !noArrow && <ChevronRight size={16} color="#D1D5DB" />}
    </div>
  );
}

/* ─── Avatar circle ───────────────────────────────────────────── */
function AvatarCircle({ photoUrl, emoji, color, size = 60, onPhotoClick }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: `${color}18`, border: `2px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer' }} onClick={onPhotoClick}>
        {photoUrl ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: size * 0.43 }}>{emoji}</span>}
      </div>
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: '50%', background: color, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={onPhotoClick}>
        <Pencil size={9} color="#fff" />
      </div>
    </div>
  );
}

/* ─── Bottom sheet wrapper ────────────────────────────────────── */
function Sheet({ children, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 3100, background: '#fff', borderRadius: '22px 22px 0 0', padding: '0 18px 40px', boxShadow: '0 -8px 40px rgba(0,0,0,.12)', animation: 'sheet-up .3s ease', fontFamily: FONTF, maxHeight: '88vh', overflowY: 'auto', maxWidth: 480, margin: '0 auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#D1D5DB', margin: '14px auto 18px' }} />
        {children}
      </div>
    </>
  );
}
function SheetButtons({ onClose, onSave, saveLabel = 'Save', danger, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
      <button onClick={onClose} style={{ flex: 1, padding: '13px', borderRadius: 14, border: `1.5px solid ${BORDER}`, background: LIGHT, fontSize: 13, fontWeight: 800, color: MUTED, cursor: 'pointer', fontFamily: FONTF }}>Cancel</button>
      <button onClick={onSave} disabled={disabled} style={{ flex: 1.5, padding: '13px', borderRadius: 14, border: 'none', background: disabled ? '#E5E7EB' : danger ? RED : `linear-gradient(135deg,${BRAND},#D4651E)`, color: disabled ? '#9CA3AF' : '#fff', fontSize: 13, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONTF }}>{saveLabel}</button>
    </div>
  );
}

/* ─── Avatar picker ───────────────────────────────────────────── */
function AvatarPickerSheet({ current, onClose, onSavePhoto, onSaveEmoji, color }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [tab, setTab] = useState('emoji');
  const [selEmoji, setSelEmoji] = useState(current.emoji || '🤖');
  const handleFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target.result);
    reader.readAsDataURL(f);
  };
  return (
    <Sheet onClose={onClose}>
      <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: '0 0 16px' }}>Change Agent Photo</p>
      <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 12, padding: 3, marginBottom: 20, gap: 3 }}>
        {[['emoji', '🎭 Choose Emoji'], ['photo', '📷 Upload Photo']].map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', background: tab === t ? '#fff' : 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, fontFamily: FONTF, color: tab === t ? INK : MUTED, boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>{l}</button>
        ))}
      </div>
      {tab === 'emoji' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {EMOJI_LIST.map((em) => (
              <div key={em} onClick={() => setSelEmoji(em)} style={{ width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, cursor: 'pointer', background: selEmoji === em ? `${color}15` : LIGHT, border: `1.5px solid ${selEmoji === em ? color : BORDER}` }}>{em}</div>
            ))}
          </div>
          <SheetButtons onClose={onClose} onSave={() => { onSaveEmoji(selEmoji); onClose(); }} saveLabel="Save Emoji" />
        </>
      )}
      {tab === 'photo' && (
        <>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          {preview ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{ width: 100, height: 100, borderRadius: '50%', overflow: 'hidden', border: `3px solid ${color}` }}><img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>
              <button onClick={() => setPreview(null)} style={{ fontSize: 12.5, fontWeight: 700, color: RED, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONTF }}>Remove photo</button>
            </div>
          ) : (
            <div onClick={() => fileRef.current?.click()} style={{ border: `2px dashed ${BORDER}`, borderRadius: 16, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 20 }}>
              <Upload size={28} color={MUTED2} style={{ display: 'block', margin: '0 auto 10px' }} />
              <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: '0 0 4px' }}>Tap to upload photo</p>
              <p style={{ fontSize: 12, color: MUTED2, margin: 0 }}>JPG, PNG or WebP · Max 5MB</p>
            </div>
          )}
          <SheetButtons onClose={onClose} onSave={() => { if (preview) { onSavePhoto(preview); onClose(); } }} saveLabel="Save Photo" disabled={!preview} />
        </>
      )}
    </Sheet>
  );
}

/* ─── Subjects sheet ──────────────────────────────────────────── */
function SubjectsSheet({ current, onClose, onSave, color = BRAND }) {
  const [selected, setSelected] = useState([...current]);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState('');
  const available = ALL_SUBJECTS.filter((s) => !selected.includes(s) && s.toLowerCase().includes(search.toLowerCase()));
  const addCustom = () => { const c = custom.trim(); if (!c || selected.includes(c)) return; setSelected((p) => [...p, c]); setCustom(''); };
  return (
    <Sheet onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: 0 }}>Subjects You Teach</p>
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{selected.length} selected</span>
      </div>
      {selected.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {selected.map((s) => <SubjectChip key={s} label={s} color={color} onRemove={(x) => setSelected((p) => p.filter((y) => y !== x))} />)}
          </div>
        </div>
      )}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: MUTED2 }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subjects…" style={{ width: '100%', padding: '10px 13px 10px 34px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONTF, color: INK, boxSizing: 'border-box' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, maxHeight: 160, overflowY: 'auto', marginBottom: 14 }}>
        {available.map((s) => (
          <div key={s} onClick={() => { setSelected((p) => [...p, s]); setSearch(''); }} style={{ padding: '6px 12px', borderRadius: 20, border: `1px solid ${BORDER}`, background: LIGHT, fontSize: 12, fontWeight: 700, color: '#374151', cursor: 'pointer' }}>{s} +</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} placeholder="Custom subject…" style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONTF, color: INK }} />
        <button onClick={addCustom} style={{ padding: '11px 16px', borderRadius: 12, border: 'none', background: custom.trim() ? BRAND : '#E5E7EB', color: custom.trim() ? '#fff' : '#9CA3AF', fontSize: 13, fontWeight: 800, cursor: custom.trim() ? 'pointer' : 'default', fontFamily: FONTF, flexShrink: 0 }}>Add</button>
      </div>
      <SheetButtons onClose={onClose} onSave={() => { onSave(selected); onClose(); }} saveLabel="Save Subjects" />
    </Sheet>
  );
}

/* ─── Generic field sheet ─────────────────────────────────────── */
function GenericSheet({ label, type, options, value, onClose, onSave, field }) {
  const [val, setVal] = useState(value ?? '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [del, setDel] = useState('');
  const inp = { width: '100%', padding: '11px 14px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14, fontFamily: FONTF, color: INK, boxSizing: 'border-box', marginTop: 6 };
  const handle = () => {
    if (type === 'change-password') {
      if (!pw.current) { alert('Enter current password'); return; }
      if (pw.next.length < 8) { alert('Need 8+ characters'); return; }
      if (pw.next !== pw.confirm) { alert("Passwords don't match"); return; }
    }
    if (type === 'delete-confirm' && del !== 'DELETE') return;
    onSave(field, type === 'change-password' ? pw : val);
    onClose();
  };
  return (
    <Sheet onClose={onClose}>
      <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: '0 0 16px' }}>{label}</p>
      {type === 'text' && <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={`Enter ${label.toLowerCase()}`} style={inp} />}
      {type === 'textarea' && <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={`Enter ${label.toLowerCase()}`} rows={3} style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />}
      {type === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((o) => (
            <div key={o} onClick={() => setVal(o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, cursor: 'pointer', border: `1.5px solid ${val === o ? BRAND : BORDER}`, background: val === o ? `${BRAND}08` : '#fff' }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, border: `2px solid ${val === o ? BRAND : '#D1D5DB'}`, background: val === o ? BRAND : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {val === o && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: val === o ? BRAND : '#374151' }}>{o}</span>
            </div>
          ))}
        </div>
      )}
      {type === 'display-mode' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {['light', 'dark', 'system'].map((m) => (
            <div key={m} onClick={() => setVal(m)} style={{ padding: '14px 8px', borderRadius: 12, textAlign: 'center', cursor: 'pointer', border: `1.5px solid ${val === m ? BRAND : BORDER}`, background: val === m ? `${BRAND}08` : LIGHT }}>
              <div style={{ fontSize: 22, marginBottom: 5 }}>{m === 'light' ? '☀️' : m === 'dark' ? '🌙' : '⚙️'}</div>
              <p style={{ margin: 0, fontSize: 11.5, fontWeight: 800, color: val === m ? BRAND : '#374151', textTransform: 'capitalize' }}>{m}</p>
            </div>
          ))}
        </div>
      )}
      {type === 'accent' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {ACCENTS.map((c) => (
            <div key={c} onClick={() => setVal(c)} style={{ width: 40, height: 40, borderRadius: '50%', background: c, cursor: 'pointer', border: `2px solid ${c}`, outline: val === c ? `3px solid ${INK}` : '3px solid transparent', outlineOffset: 2, transition: 'all .2s' }} />
          ))}
        </div>
      )}
      {type === 'change-password' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[['current', 'Current password'], ['next', 'New password'], ['confirm', 'Confirm new']].map(([k, l]) => (
            <div key={k}>
              <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>{l}</label>
              <input type="password" value={pw[k]} onChange={(e) => setPw((p) => ({ ...p, [k]: e.target.value }))} placeholder="••••••••" style={inp} />
            </div>
          ))}
        </div>
      )}
      {type === 'deactivate' && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: '#92400E' }}>⚠️ Deactivate your account?</p>
          <p style={{ margin: 0, fontSize: 13, color: '#78350F', lineHeight: 1.6 }}>Your account will be suspended. You can reactivate within 30 days by signing back in.</p>
        </div>
      )}
      {type === 'delete-confirm' && (
        <>
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
            <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 800, color: '#7F1D1D' }}>🗑️ Permanently delete your account?</p>
            <p style={{ margin: 0, fontSize: 13, color: '#991B1B', lineHeight: 1.6 }}>All data — courses, students, agent progress, and history — will be permanently deleted.</p>
          </div>
          <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>Type DELETE to confirm</label>
          <input value={del} onChange={(e) => setDel(e.target.value.toUpperCase())} placeholder="DELETE" style={{ ...inp, borderColor: del === 'DELETE' ? RED : BORDER, color: del === 'DELETE' ? RED : INK, letterSpacing: 1 }} />
        </>
      )}
      <SheetButtons onClose={onClose} onSave={handle}
        danger={type === 'delete-confirm' || type === 'deactivate'}
        disabled={type === 'delete-confirm' && del !== 'DELETE'}
        saveLabel={type === 'change-password' ? 'Update Password' : type === 'deactivate' ? 'Deactivate' : type === 'delete-confirm' ? 'Delete Account' : 'Save Changes'} />
    </Sheet>
  );
}

/* ─── Marketplace publish sheet ───────────────────────────────── */
function PublishSheet({ agent, defaultTitle, subjects, onClose, onPublish }) {
  const [title, setTitle] = useState(defaultTitle || `${agent.name}'s Coaching`);
  const [subject, setSubject] = useState(subjects?.[0] || 'Mathematics');
  const [description, setDescription] = useState(agent.personality || '');
  const [price, setPrice] = useState('0');
  const [busy, setBusy] = useState(false);
  const inp = { width: '100%', padding: '11px 14px', borderRadius: 12, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14, fontFamily: FONTF, color: INK, boxSizing: 'border-box', marginTop: 6 };
  return (
    <Sheet onClose={onClose}>
      <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: '0 0 6px' }}>Publish to Marketplace</p>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>List your trained agent so students can discover and use it. You can unpublish anytime.</p>
      <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>Listing title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} />
      <label style={{ fontSize: 12, fontWeight: 800, color: '#374151', display: 'block', marginTop: 14 }}>Subject</label>
      <select value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
        {[...new Set([...(subjects || []), ...ALL_SUBJECTS])].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label style={{ fontSize: 12, fontWeight: 800, color: '#374151', display: 'block', marginTop: 14 }}>Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What makes your agent's teaching style special?" style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
      <label style={{ fontSize: 12, fontWeight: 800, color: '#374151', display: 'block', marginTop: 14 }}>Price (₦) — set 0 for free</label>
      <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={inp} />
      <SheetButtons onClose={onClose} disabled={busy || !title.trim()} saveLabel={busy ? 'Publishing…' : 'Publish Agent'}
        onSave={async () => {
          setBusy(true);
          await onPublish({ title: title.trim(), subject, description, priceKobo: Math.max(0, Math.round(Number(price) || 0) * 100) });
          setBusy(false);
        }} />
    </Sheet>
  );
}

/* ─── Logout modal ────────────────────────────────────────────── */
function LogoutModal({ onClose, onConfirm }) {
  return (
    <Sheet onClose={onClose}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: `${RED}12`, border: `1.5px solid ${RED}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><LogOut size={22} color={RED} /></div>
        <p style={{ fontSize: 17, fontWeight: 900, color: INK, margin: '0 0 8px' }}>Sign out of Akoro?</p>
        <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px', lineHeight: 1.6 }}>You'll need to sign back in to manage your courses and students.</p>
        <SheetButtons onClose={onClose} onSave={onConfirm} saveLabel="Sign out" danger />
      </div>
    </Sheet>
  );
}

/* ─── Subjects row ────────────────────────────────────────────── */
function SubjectsRow({ subjects, onClick, color = BRAND }) {
  return (
    <div style={{ ...rowBase, flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = LIGHT)}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
      onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <span style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center' }}><BookOpen size={17} color={MUTED} /></span>
        <div style={{ flex: 1 }}><p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: INK }}>Subjects Taught</p></div>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, marginRight: 4 }}>{subjects.length} added</span>
        <ChevronRight size={16} color="#D1D5DB" />
      </div>
      {subjects.length > 0 && (
        <div style={{ paddingLeft: 28, paddingTop: 8, paddingBottom: 2, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {subjects.map((s) => <SubjectChip key={s} label={s} color={color} />)}
        </div>
      )}
    </div>
  );
}

/* ─── Notifications ───────────────────────────────────────────── */
function NotifSection({ notif, onToggle }) {
  const NotifRow = ({ icon: Icon, label, sub, field }) => (
    <div style={rowBase}>
      <span style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center' }}><Icon size={17} color={MUTED} /></span>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: INK }}>{label}</p>
        {sub && <p style={{ fontSize: 11.5, color: MUTED2, marginTop: 2, margin: 0 }}>{sub}</p>}
      </div>
      <Toggle on={!!notif[field]} onChange={() => onToggle(field)} />
    </div>
  );
  return (
    <Section title="Notifications">
      <NotifRow icon={Mail} label="Email Notifications" sub="Enrollments, payouts, reminders" field="email" />
      <NotifRow icon={Bell} label="Push Notifications" sub="In-app and device alerts" field="push" />
      <NotifRow icon={Clock} label="Session Reminders" sub="Before each live class" field="sessionReminders" />
      <NotifRow icon={Bolt} label="Announcements" sub="Platform & course announcements" field="announcements" />
      <NotifRow icon={MessageCircle} label="Student Q&A" sub="When a student asks a question" field="qaReplies" />
    </Section>
  );
}

/* ─── Account tab ─────────────────────────────────────────────── */
function AccountTab({ profile, setProfile, stats, notif, onToggleNotif, onSaveField, onLogout }) {
  const [sheet, setSheet] = useState(null);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [twoFaSheet, setTwoFaSheet] = useState(false);
  const color = profile.accentColor || BRAND;
  const openSheet = (field, label, type, options) => setSheet({ field, label, type, options });

  return (
    <div style={{ padding: '20px 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#fff', margin: '0 16px 20px', borderRadius: 18, padding: '18px 16px', border: `1px solid ${BORDER}`, boxShadow: '0 1px 6px rgba(0,0,0,.05)' }}>
        <AvatarCircle photoUrl={profile.avatarUrl} emoji={profile.avatarEmoji || '👩🏾‍🏫'} color={color} size={60} onPhotoClick={() => setAvatarSheet(true)} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 900, color: INK }}>{profile.fullName || '—'}</p>
          <p style={{ margin: '0 0 6px', fontSize: 12.5, color: MUTED }}>@{profile.username || profile.email?.split('@')[0]}</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${color}12`, borderRadius: 8, padding: '3px 10px' }}>
            <GraduationCap size={11} color={color} />
            <span style={{ fontSize: 11, fontWeight: 800, color }}>Instructor</span>
          </div>
        </div>
      </div>

      <Section title="Profile">
        <Row icon={User} label="Full Name" value={profile.fullName} onClick={() => openSheet('fullName', 'Full Name', 'text')} />
        <Row icon={AtSign} label="Username" value={`@${profile.username || '—'}`} onClick={() => openSheet('username', 'Username', 'text')} />
        <Row icon={Mail} label="Email" value={profile.email} />
        <Row icon={Pencil} label="Bio" sub={(profile.bio || 'Tell students about yourself').slice(0, 44)} onClick={() => openSheet('bio', 'Bio', 'textarea')} />
        <Row icon={Phone} label="Phone" value={profile.phone || 'Not set'} onClick={() => openSheet('phone', 'Phone Number', 'text')} />
        <Row icon={MapPin} label="Country" value={profile.country || 'Not set'} onClick={() => openSheet('country', 'Country', 'select', COUNTRIES)} />
      </Section>

      <Section title="Teaching">
        <Row icon={Building2} label="School / Centre" value={profile.school || 'Not set'} onClick={() => openSheet('school', 'School / Centre', 'text')} />
        <Row icon={GraduationCap} label="Institution Type" value={profile.schoolType || 'Not set'} onClick={() => openSheet('schoolType', 'Institution Type', 'select', SCHOOL_TYPES)} />
        <SubjectsRow subjects={profile.subjects || []} onClick={() => setSubjectSheet(true)} color={color} />
      </Section>

      <Section title="Overview">
        <Row icon={BookOpen} label="Active Courses" value={stats.active_courses ?? 0} />
        <Row icon={GraduationCap} label="Total Students" value={(stats.total_students ?? 0).toLocaleString()} />
        <Row icon={BarChart3} label="Revenue" value={`₦${(stats.total_revenue ?? 0).toLocaleString()}`} />
        <Row icon={Bolt} label="Agent XP" value={`${(stats.agent_xp ?? 0).toLocaleString()} XP`} />
      </Section>

      <Section title="Personalization">
        <Row icon={Languages} label="Language" value={profile.language || 'English'} onClick={() => openSheet('language', 'Language', 'select', LANGUAGES)} />
        <Row icon={Moon} label="Display Mode" value={(profile.displayMode || 'system').charAt(0).toUpperCase() + (profile.displayMode || 'system').slice(1)} onClick={() => openSheet('displayMode', 'Display Mode', 'display-mode')} />
        <Row icon={Palette} label="Theme Accent" onClick={() => openSheet('accentColor', 'Accent Colour', 'accent')}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: color, marginRight: 6, flexShrink: 0 }} />
        </Row>
      </Section>

      <NotifSection notif={notif} onToggle={onToggleNotif} />

      <Section title="Help & Support">
        <Row icon={MessageCircle} label="Contact Support" onClick={() => {}} />
        <Row icon={HelpCircle} label="Help Centre" onClick={() => {}} />
        <Row icon={Bug} label="Report a Bug" onClick={() => {}} />
      </Section>

      <Section title="About">
        <Row icon={FileText} label="App Version" value="v1.0.0" />
        <Row icon={Shield} label="Privacy Policy" onClick={() => {}} />
      </Section>

      <Section title="Privacy & Security">
        <Row icon={Key} label="Change Password" onClick={() => openSheet('password', 'Change Password', 'change-password')} />
        <div style={rowBase}>
          <span style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center' }}><Lock size={17} color={MUTED} /></span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: INK }}>Two-Factor Auth</p>
            <p style={{ fontSize: 11.5, color: MUTED2, marginTop: 2, margin: 0 }}>Extra security for your account</p>
          </div>
          <Toggle on={!!profile.twoFactor} onChange={() => setTwoFaSheet(true)} />
        </div>
        <Row icon={PauseCircle} label="Deactivate Account" danger sub="Suspend temporarily" onClick={() => openSheet('deactivate', 'Deactivate Account', 'deactivate')} />
        <Row icon={Trash2} label="Delete Account" danger sub="Permanently delete all data" onClick={() => openSheet('deleteAccount', 'Delete Account', 'delete-confirm')} />
      </Section>
      <div style={{ height: 40 }} />

      {avatarSheet && (
        <AvatarPickerSheet current={{ emoji: profile.avatarEmoji, photoUrl: profile.avatarUrl }} color={color}
          onClose={() => setAvatarSheet(false)}
          onSavePhoto={(url) => setProfile((p) => ({ ...p, avatarUrl: url }))}
          onSaveEmoji={(em) => setProfile((p) => ({ ...p, avatarEmoji: em, avatarUrl: null }))} />
      )}
      {subjectSheet && (
        <SubjectsSheet current={profile.subjects || []} color={color}
          onClose={() => setSubjectSheet(false)}
          onSave={(s) => { setProfile((p) => ({ ...p, subjects: s })); onSaveField('subjects', s); }} />
      )}
      {sheet && <GenericSheet {...sheet} value={profile[sheet.field]} onClose={() => setSheet(null)} onSave={(f, v) => { onSaveField(f, v); setSheet(null); }} />}
      {twoFaSheet && (
        <TwoFactorSheet
          enabled={!!profile.twoFactor}
          color={color}
          onClose={() => setTwoFaSheet(false)}
          onChanged={(enabled) => { setProfile((p) => ({ ...p, twoFactor: enabled })); setTwoFaSheet(false); }}
        />
      )}
    </div>
  );
}

/* ─── Two-Factor Auth setup sheet ──────────────────────────────────── */
function TwoFactorSheet({ enabled, color, onClose, onChanged }) {
  const [step, setStep] = useState(enabled ? 'disable' : 'intro'); // intro → setup → disable
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const beginSetup = async () => {
    setBusy(true); setErr('');
    try {
      const { secret, otpauthUrl } = await setup2FA();
      setSecret(secret); setOtpauthUrl(otpauthUrl); setStep('setup');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const confirmEnable = async () => {
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code'); return; }
    setBusy(true); setErr('');
    try { await enable2FA(code); onChanged(true); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const confirmDisable = async () => {
    if (!/^\d{6}$/.test(code)) { setErr('Enter the 6-digit code'); return; }
    setBusy(true); setErr('');
    try { await disable2FA(code); onChanged(false); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const qrSrc = otpauthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUrl)}`
    : null;

  const codeInput = (
    <input
      type="text" inputMode="numeric" maxLength={6} autoFocus value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      placeholder="000000"
      style={{ width: '100%', padding: '12px', borderRadius: 12, border: `1.5px solid ${BORDER}`,
        textAlign: 'center', letterSpacing: 8, fontSize: 20, fontWeight: 700, fontFamily: FONT,
        boxSizing: 'border-box', marginBottom: 12 }}
    />
  );

  return (
    <Sheet onClose={onClose}>
      <h3 style={{ fontSize: 17, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>
        Two-Factor Authentication
      </h3>

      {err && <p style={{ fontSize: 12.5, color: RED, fontWeight: 600, margin: '8px 0' }}>{err}</p>}

      {step === 'intro' && (
        <>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: '8px 0 18px' }}>
            Protect your account with an authenticator app (Google Authenticator, Authy, 1Password).
            You'll enter a 6-digit code each time you sign in.
          </p>
          <SheetButtons onClose={onClose} onSave={beginSetup} saveLabel={busy ? 'Loading…' : 'Set up'} disabled={busy} />
        </>
      )}

      {step === 'setup' && (
        <>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: '8px 0 14px' }}>
            Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
          </p>
          {qrSrc && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <img src={qrSrc} alt="2FA QR code" width={180} height={180} style={{ borderRadius: 12, border: `1px solid ${BORDER}` }} />
            </div>
          )}
          <p style={{ fontSize: 11, color: MUTED2, textAlign: 'center', margin: '0 0 4px' }}>Or enter this key manually:</p>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, textAlign: 'center', wordBreak: 'break-all',
            background: LIGHT, padding: '8px 10px', borderRadius: 8, margin: '0 0 16px', fontFamily: 'monospace' }}>
            {secret}
          </p>
          {codeInput}
          <SheetButtons onClose={onClose} onSave={confirmEnable} saveLabel={busy ? 'Verifying…' : 'Enable'} disabled={busy} />
        </>
      )}

      {step === 'disable' && (
        <>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, margin: '8px 0 16px' }}>
            Enter a current code from your authenticator app to turn off two-factor authentication.
          </p>
          {codeInput}
          <SheetButtons onClose={onClose} onSave={confirmDisable} saveLabel={busy ? 'Disabling…' : 'Disable'} danger disabled={busy} />
        </>
      )}
    </Sheet>
  );
}

/* ─── Agent tab (with marketplace publish toggle) ─────────────── */
function AgentTab({ agent, setAgent, profile, onSaveAgent, onPublish, onUnpublish, listingId, toast }) {
  const [sheet, setSheet] = useState(null);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [publishSheet, setPublishSheet] = useState(false);
  const color = agent.color || BRAND;
  const published = !!listingId;
  const openSheet = (field, label, type, options) => setSheet({ field, label, type, options });
  const saveField = (field, val) => { setAgent((a) => ({ ...a, [field]: val })); onSaveAgent({ [field]: val }); };

  const stats = [
    { icon: Award, label: 'Agent Level', value: `Lv ${agent.level || 1}` },
    { icon: Bolt, label: 'XP Earned', value: (agent.xpEarned || 0).toLocaleString() },
    { icon: Star, label: 'Streak', value: `${agent.streakDays || 0}d` },
    { icon: Store, label: 'Marketplace', value: published ? 'Live' : 'Private' },
  ];
  const levelPct = Math.min(100, ((agent.level || 1) / 10) * 100);

  return (
    <div style={{ padding: '20px 0 0' }}>
      <div style={{ background: '#fff', margin: '0 16px 16px', borderRadius: 18, padding: '18px 16px', border: `1.5px solid ${color}25`, boxShadow: '0 1px 6px rgba(0,0,0,.04)', display: 'flex', alignItems: 'center', gap: 14 }}>
        <AvatarCircle photoUrl={agent.photoUrl} emoji={agent.emoji || '🤖'} color={color} size={64} onPhotoClick={() => setAvatarSheet(true)} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: '0 0 2px', fontSize: 17, fontWeight: 900, color: INK }}>{agent.name || 'My Agent'}</p>
          <p style={{ margin: '0 0 8px', fontSize: 12.5, color: MUTED }}>Your teaching AI agent</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: `${color}15`, color }}>Lv.{agent.level || 1}</span>
            {published && <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: `${GREEN}15`, color: GREEN }}>● Marketplace</span>}
          </div>
        </div>
      </div>

      <div style={{ margin: '0 16px 16px', background: '#fff', borderRadius: 14, padding: '14px 16px', border: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#374151', display: 'flex', alignItems: 'center', gap: 5 }}><Star size={13} color={color} />Agent Level {agent.level || 1}</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: MUTED2 }}>{(agent.xpEarned || 0).toLocaleString()} XP</span>
        </div>
        <ProgressBar pct={levelPct} color={color} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px 20px' }}>
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} style={{ background: '#fff', borderRadius: 13, padding: '13px 14px', border: `1px solid ${BORDER}` }}>
            <Icon size={19} color={color} style={{ marginBottom: 5, display: 'block' }} />
            <p style={{ margin: '0 0 1px', fontSize: 18, fontWeight: 900, color: INK }}>{value}</p>
            <p style={{ margin: 0, fontSize: 11, color: MUTED2 }}>{label}</p>
          </div>
        ))}
      </div>

      <Section title="Agent Profile">
        <Row icon={Tag} label="Agent Name" value={agent.name} onClick={() => openSheet('name', 'Agent Name', 'text')} />
        <Row icon={Sparkles} label="Personality" sub={(agent.personality || 'Not set').slice(0, 40) + (agent.personality?.length > 40 ? '…' : '')} onClick={() => openSheet('personality', 'Agent Personality', 'textarea')} />
        <Row icon={Palette} label="Agent Colour" onClick={() => openSheet('color', 'Agent Colour', 'accent')}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', background: color, marginRight: 6, flexShrink: 0 }} />
        </Row>
      </Section>

      {/* ── Marketplace ── */}
      <Section title="Marketplace">
        <div style={rowBase}>
          <span style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center' }}><Store size={17} color={MUTED} /></span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, color: INK }}>Publish to Marketplace</p>
            <p style={{ fontSize: 11.5, color: MUTED2, marginTop: 2, margin: 0 }}>
              {published ? 'Your agent is live and discoverable by students' : 'List your trained agent for students to use'}
            </p>
          </div>
          <Toggle on={published} onChange={() => { if (published) onUnpublish(); else setPublishSheet(true); }} />
        </div>
        {published && (
          <Row icon={CheckCircle2} label="Listing Status" value="Active" noArrow />
        )}
      </Section>
      <div style={{ height: 40 }} />

      {avatarSheet && (
        <AvatarPickerSheet current={{ emoji: agent.emoji, photoUrl: agent.photoUrl }} color={color}
          onClose={() => setAvatarSheet(false)}
          onSavePhoto={(url) => { setAgent((a) => ({ ...a, photoUrl: url })); }}
          onSaveEmoji={(em) => { setAgent((a) => ({ ...a, emoji: em, photoUrl: null })); onSaveAgent({ emoji: em }); }} />
      )}
      {publishSheet && (
        <PublishSheet agent={agent} defaultTitle={`${agent.name}'s Coaching`} subjects={profile.subjects}
          onClose={() => setPublishSheet(false)}
          onPublish={async (payload) => { const okPub = await onPublish(payload); if (okPub) setPublishSheet(false); }} />
      )}
      {sheet && <GenericSheet {...sheet} value={agent[sheet.field]} onClose={() => setSheet(null)} onSave={(f, v) => { saveField(f, v); setSheet(null); }} />}
    </div>
  );
}

/* ─── Loading skeleton ────────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div style={{ padding: '20px 16px' }}>
      {[80, 60, 120, 100, 90].map((w, i) => (
        <div key={i} style={{ height: 16, width: `${w}%`, background: '#F3F4F6', borderRadius: 8, marginBottom: 16, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────── */
export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [tab, setTab] = useState('user');
  const [profile, setProfile] = useState(null);
  const [agent, setAgent] = useState(null);
  const [stats, setStats] = useState({});
  const [notif, setNotif] = useState({ email: true, push: true, sessionReminders: true, announcements: true, qaReplies: true });
  const [listingId, setListingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showLogout, setShowLogout] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };

  useEffect(() => {
    if (user?.id) {
      const ln = loadLocalNotif(user.id);
      if (ln) setNotif(ln);
      setListingId(loadListingId(user.id));
    }
    getProfile()
      .then((res) => {
        const d = res?.data ?? res ?? {};
        const a = d.agent ?? {};
        setProfile({
          id: d.id, email: d.email, username: d.username || d.email?.split('@')[0],
          fullName: d.full_name || d.fullName, avatarUrl: d.avatar_url, avatarEmoji: '👩🏾‍🏫',
          bio: d.bio, phone: d.phone, country: d.country, school: d.school_name,
          schoolType: d.school_type, subjects: d.subjects || [],
          language: d.language || 'English', displayMode: d.display_mode || 'system',
          accentColor: d.accent_color || BRAND, twoFactor: !!d.two_factor_enabled,
        });
        // Server-persisted notification prefs take priority over local cache
        if (d.notif) {
          setNotif((n) => ({
            ...n,
            ...Object.fromEntries(Object.entries(d.notif).filter(([, v]) => v != null)),
          }));
        }
        setAgent({
          name: a.agent_name || 'My Agent', emoji: a.agent_emoji || '🤖', photoUrl: null,
          color: BRAND, personality: a.personality || '',
          level: a.level || 1, xpEarned: a.xp || 0, streakDays: a.streak_days || 0,
        });
      })
      .catch(() => {
        // Fallback to auth context
        setProfile({
          id: user?.id, email: user?.email, username: user?.username || user?.email?.split('@')[0],
          fullName: user?.fullName, avatarEmoji: '👩🏾‍🏫', subjects: [],
          language: 'English', displayMode: 'system', accentColor: BRAND, twoFactor: false,
        });
        setAgent({ name: 'My Agent', emoji: '🤖', color: BRAND, personality: '', level: 1, xpEarned: 0, streakDays: 0 });
        showToast('Offline — showing cached profile');
      })
      .finally(() => setLoading(false));

    // Stats (best effort)
    fetch(`${import.meta.env.VITE_API_URL || 'https://akoro.app'}/api/instructor/stats`, { credentials: 'include' })
      .then((r) => r.json()).then((res) => setStats(res?.data ?? {})).catch(() => {});
  }, [user]);

  // Apply display mode + accent
  useEffect(() => {
    if (!profile) return;
    const root = document.documentElement;
    const mode = profile.displayMode || 'system';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', mode === 'dark' || (mode === 'system' && prefersDark) ? 'dark' : 'light');
    if (profile.accentColor) root.style.setProperty('--accent', profile.accentColor);
  }, [profile?.displayMode, profile?.accentColor]);

  /* ── Save handlers ── */
  const saveProfileField = useCallback(async (field, val) => {
    setProfile((p) => ({ ...p, [field]: val }));
    const map = {
      fullName: 'full_name', username: 'username', phone: 'phone', bio: 'bio',
      avatarUrl: 'avatar_url', country: 'country', school: 'school_name',
      schoolType: 'school_type', subjects: 'subjects', language: 'language',
      displayMode: 'display_mode', accentColor: 'accent_color', twoFactor: 'two_factor_enabled',
    };
    const apiKey = map[field];
    if (!apiKey) { showToast('Saved ✓'); return; }
    try { await patchProfile({ [apiKey]: val }); showToast('Saved ✓'); }
    catch (e) { showToast(e.message?.includes('username') ? 'Username already taken' : 'Failed to save'); }
  }, []);

  const saveAgent = useCallback(async (patch) => {
    try { await patchAgent(patch); showToast('Saved ✓'); }
    catch { showToast('Failed to save'); }
  }, []);

  const toggleNotif = useCallback((field) => {
    setNotif((n) => {
      const updated = { ...n, [field]: !n[field] };
      if (user?.id) saveLocalNotif(user.id, updated); // offline cache
      patchNotifications({ [field]: updated[field] }).catch(() => showToast('Saved locally (offline)'));
      return updated;
    });
  }, [user]);

  const handlePublish = useCallback(async ({ title, subject, description, priceKobo }) => {
    try {
      const res = await publishAgentToMarketplace({
        teacherId: user?.id, agentId: agent?.agentId || user?.id,
        title, subject, description, priceKobo,
        teacherName: profile?.fullName, teacherAvatar: agent?.emoji,
        topicsCovered: profile?.subjects || [],
      });
      if (res?.success && res?.listing?.id) {
        setListingId(res.listing.id);
        saveListingId(user.id, res.listing.id);
        showToast('Published to marketplace ✓');
        return true;
      }
      showToast(res?.error || 'Could not publish');
      return false;
    } catch (e) {
      showToast('Publish failed: ' + e.message);
      return false;
    }
  }, [user, agent, profile]);

  const handleUnpublish = useCallback(async () => {
    if (!listingId) return;
    try {
      const res = await unpublishListing(listingId, user?.id);
      if (res?.success) {
        setListingId(null);
        saveListingId(user.id, null);
        showToast('Removed from marketplace');
      } else {
        showToast(res?.error || 'Could not unpublish');
      }
    } catch (e) {
      showToast('Unpublish failed: ' + e.message);
    }
  }, [listingId, user]);

  const color = profile?.accentColor || BRAND;

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: FONTF, maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: `1px solid ${BORDER}`, boxShadow: '0 1px 6px rgba(0,0,0,.06)', height: 54, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}><ChevronLeft size={22} color={INK} /></button>
        <div style={{ width: 34, height: 34, borderRadius: '50%', overflow: 'hidden', border: `2px solid ${color}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${color}18`, fontSize: 16 }}>
          {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (profile?.avatarEmoji || '👩🏾‍🏫')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: 0, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.fullName || user?.fullName || '…'}</p>
          <p style={{ fontSize: 11, color: MUTED2, margin: 0 }}>@{profile?.username || user?.username || '…'}</p>
        </div>
        <button onClick={() => setShowLogout(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: FONTF, fontSize: 12, fontWeight: 700, color: MUTED, flexShrink: 0 }}>
          <LogOut size={15} color={MUTED} /> Sign Out
        </button>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: `1px solid ${BORDER}`, padding: '0 16px' }}>
        {[['user', 'Account'], ['agent', agent?.name || 'Agent']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '11px 0', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 900 : 600, color: tab === t ? BRAND : MUTED2, borderBottom: `2.5px solid ${tab === t ? BRAND : 'transparent'}`, transition: 'all .2s', fontFamily: FONTF, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {t === 'user' ? <><User size={14} /> Account</> : <><span>{agent?.emoji || '🤖'}</span> {label}</>}
          </button>
        ))}
      </div>

      {loading || !profile ? <LoadingSkeleton /> : (
        tab === 'user'
          ? <AccountTab profile={profile} setProfile={setProfile} stats={stats} notif={notif} onToggleNotif={toggleNotif} onSaveField={saveProfileField} onLogout={() => { setShowLogout(false); logout(); }} />
          : <AgentTab agent={agent} setAgent={setAgent} profile={profile} onSaveAgent={saveAgent} onPublish={handlePublish} onUnpublish={handleUnpublish} listingId={listingId} toast={toast} />
      )}

      {showLogout && <LogoutModal onClose={() => setShowLogout(false)} onConfirm={() => { setShowLogout(false); logout(); }} />}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </div>
  );
}
