/** The in-chat cards of the onboarding conversation: each stages its pick; the composer's send commits it. */
import { useState } from 'react';
import { Icon } from '../../components/common/Icons.jsx';
import { AgentAvatar } from '../../components/common/AgentAvatar.jsx';
import { initials } from '../../lib/onboardingChat.js';

const GRADIENTS = ['linear-gradient(135deg,#6C3BFF,#9B7BFF)', 'linear-gradient(135deg,#4DA3FF,#38C9A0)', 'linear-gradient(135deg,#EC4899,#F59E0B)', 'linear-gradient(135deg,#10B981,#3B82F6)'];

export function TermsCard({ checked, onChange, label, accent }) {
  return (
    <label className="ob-terms">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: accent }}/>
      <span>{label}</span>
    </label>
  );
}

export function AgentCard({ emoji, onPick, accent }) {
  return (
    <div className="ob-pick" role="radiogroup" aria-label="Pick an avatar">
      <div className="ob-avas">
        {['🧠', '🤖', '👾', '🦉', '🎓', '⚡', '🌟', '🔮', '🦋', '🎯', '🚀', '💡'].map((em) => (
          <button key={em} type="button" role="radio" aria-checked={emoji === em} aria-label={`Avatar ${em}`} onClick={() => onPick(em)}
            className={`ob-avopt${emoji === em ? ' on' : ''}`} style={emoji === em ? { borderColor: accent, boxShadow: `0 0 0 4px ${accent}26` } : undefined}>
            <AgentAvatar emoji={em} size={30}/>
          </button>
        ))}
      </div>
    </div>
  );
}

function TeacherRow({ teacher, selected, accent, onPick, index }) {
  const [broken, setBroken] = useState(false);
  const photo = !broken && teacher.avatar_url;
  const sub = [teacher.school_name || (teacher.username ? `@${teacher.username}` : ''), teacher.student_count > 0 ? `${teacher.student_count} students` : 'New'].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`ob-tcard${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onPick}
      style={selected ? { borderColor: accent, boxShadow: `0 6px 16px ${accent}2E` } : undefined}>
      {photo
        ? <img src={teacher.avatar_url} alt="" loading="lazy" onError={() => setBroken(true)} className="ob-tphoto" style={{ objectFit: 'cover' }}/>
        : <span className="ob-tphoto" style={{ background: GRADIENTS[index % GRADIENTS.length] }}>{initials(teacher.full_name)}</span>}
      <span className="ob-tinfo">
        <span className="ob-tn">{teacher.full_name || 'Teacher'}</span>
        <span className="ob-ts">{sub}</span>
        {teacher.subjects?.length > 0 && (
          <span className="ob-tchips">{teacher.subjects.slice(0, 2).map((s) => <i key={s} style={{ background: `${accent}1A`, color: accent }}>{s}</i>)}</span>
        )}
      </span>
      {selected && <span className="ob-tick" style={{ background: accent }}><Icon name="ti-check" size={13} color="#fff"/></span>}
    </button>
  );
}

export function TeacherCards({ teachers, selectedId, onPick, accent, emptyText }) {
  if (!teachers.length) return <div className="ob-empty">{emptyText}</div>;
  return (
    <div className="ob-tlist" aria-label="Choose your teacher">
      {teachers.map((tt, i) => <TeacherRow key={tt.id} teacher={tt} index={i} selected={selectedId === tt.id} accent={accent} onPick={() => onPick(tt)}/>)}
    </div>
  );
}

/**
 * The search field shown in the chat (school and teacher steps). The learner types in the composer, as
 * everywhere else in this conversation; this box mirrors that text and the results sit under it.
 * Tapping it puts the cursor in the composer.
 */
export function SearchBox({ value, placeholder, accent, onFocusComposer }) {
  return (
    <div className="ob-search" role="search" aria-label={placeholder} onClick={onFocusComposer} style={{ '--ob-accent': accent }}>
      <Icon name="ti-search" size={17} color="var(--ak-text-muted)"/>
      <span className={value ? 'ob-search-val' : 'ob-search-ph'}>{value || placeholder}</span>
    </div>
  );
}

/** Schools on Akoro matching the search; tapping one stages it. A school we don't list is kept as typed. */
export function SchoolResults({ schools, query, selectedName, onPick, accent, listedLabel, noMatchText }) {
  const q = query.trim();
  if (!q) return null;
  if (!schools.length) return <div className="ob-empty">{noMatchText}</div>;
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  return (
    <div className="ob-tlist" aria-label="Schools">
      {schools.slice(0, 5).map((sc, i) => {
        const on = selectedName && same(selectedName, sc.name);
        return (
          <button key={sc.id} type="button" className={`ob-tcard${on ? ' on' : ''}`} aria-pressed={!!on} onClick={() => onPick(sc)}
            style={on ? { borderColor: accent, boxShadow: `0 6px 16px ${accent}2E` } : undefined}>
            {sc.logo_url
              ? <img src={sc.logo_url} alt="" loading="lazy" className="ob-tphoto" style={{ objectFit: 'cover' }}/>
              : <span className="ob-tphoto" style={{ background: GRADIENTS[i % GRADIENTS.length] }}>{initials(sc.name)}</span>}
            <span className="ob-tinfo">
              <span className="ob-tn">{sc.name}</span>
              <span className="ob-ts">{sc.address || listedLabel}</span>
            </span>
            {on && <span className="ob-tick" style={{ background: accent }}><Icon name="ti-check" size={13} color="#fff"/></span>}
          </button>
        );
      })}
    </div>
  );
}

export function PrefsCard({ labels, languages, language, onLanguage, mode, onMode, accents, accent, onAccent }) {
  return (
    <div className="ob-pick">
      <div className="ob-plabel">{labels.language}</div>
      <div className="ob-minichips">
        {languages.map((l) => (
          <button key={l.code} type="button" className={`ob-chip sm${language === l.label ? ' on' : ''}`} onClick={() => onLanguage(l.label)}
            style={language === l.label ? { background: accent, borderColor: accent } : undefined}>{l.label}</button>
        ))}
      </div>
      <div className="ob-plabel">{labels.theme}</div>
      <div className="ob-seg">
        {['light', 'dark', 'system'].map((m) => (
          <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => onMode(m)}>{m}</button>
        ))}
      </div>
      <div className="ob-plabel">{labels.accent}</div>
      <div className="ob-dots">
        {accents.map((c) => (
          <button key={c} type="button" aria-label={c} aria-pressed={accent === c} className={`ob-dot${accent === c ? ' on' : ''}`} onClick={() => onAccent(c)} style={{ background: c }}/>
        ))}
      </div>
    </div>
  );
}

export function SummaryCard({ rows }) {
  return (
    <div className="ob-sum">
      {rows.map(([k, v]) => <div className="r" key={k}><span>{k}</span><b>{v}</b></div>)}
    </div>
  );
}
