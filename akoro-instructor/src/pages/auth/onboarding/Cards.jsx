/** The in-chat pieces of the instructor onboarding: each stages its pick; the composer's send commits it. */
import { Ico } from '../../../theme/Ico.jsx';
import { initials, GUIDE_ICONS } from '../../../lib/onboardingChat.js';

const GRADIENTS = ['linear-gradient(135deg,#6C3BFF,#9B7BFF)', 'linear-gradient(135deg,#4DA3FF,#38C9A0)', 'linear-gradient(135deg,#EC4899,#F59E0B)', 'linear-gradient(135deg,#10B981,#3B82F6)'];

/** The search field shown in the chat. The instructor types in the composer; this box mirrors it, results sit beneath. */
export function SearchBox({ value, placeholder, onFocusComposer }) {
  return (
    <div className="ob-search" role="search" aria-label={placeholder} onClick={onFocusComposer}>
      <Ico ti="ti-search" size={17} color="var(--ak-text-muted)"/>
      <span className={value ? 'ob-search-val' : 'ob-search-ph'}>{value || placeholder}</span>
    </div>
  );
}

/** Schools on Akoro matching the search; tapping one stages it. A school is picked from this list, never typed free. */
export function SchoolResults({ schools, query, selectedId, onPick, noMatchText }) {
  if (!query.trim()) return null;
  if (!schools.length) return <div className="ob-empty">{noMatchText}</div>;
  return (
    <div className="ob-tlist" aria-label="Schools">
      {schools.slice(0, 5).map((sc, i) => {
        const on = selectedId === sc.id;
        return (
          <button key={sc.id} type="button" className={`ob-tcard${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onPick(sc)}>
            {sc.logo_url
              ? <img src={sc.logo_url} alt="" loading="lazy" className="ob-tphoto" style={{ objectFit: 'cover' }}/>
              : <span className="ob-tphoto" style={{ background: GRADIENTS[i % GRADIENTS.length] }}>{initials(sc.name)}</span>}
            <span className="ob-tinfo">
              <span className="ob-tn">{sc.name}</span>
              <span className="ob-ts">{sc.address || 'On Akoro'}</span>
            </span>
            {on && <span className="ob-tick"><Ico ti="ti-check" size={13} color="#fff"/></span>}
          </button>
        );
      })}
    </div>
  );
}

/** The teaching guide's face: twelve icons; the stored value is the emoji key the profile has always kept. */
export function GuideCard({ emoji, onPick }) {
  return (
    <div className="ob-pick" role="radiogroup" aria-label="Pick your guide's avatar">
      <div className="ob-avas">
        {GUIDE_ICONS.map(([em, ti]) => (
          <button key={em} type="button" role="radio" aria-checked={emoji === em} aria-label={ti.replace('ti-', '')} onClick={() => onPick(em)}
            className={`ob-avopt${emoji === em ? ' on' : ''}`}>
            <Ico ti={ti} size={22} color={emoji === em ? 'var(--ak-brand)' : 'var(--ak-text-sub)'}/>
          </button>
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
