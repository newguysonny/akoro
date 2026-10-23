import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPatch, apiDelete } from '../../services/api.js';
import { useNavigate } from 'react-router-dom';
import { GREEN, PURPLE, RED } from '../../constants.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

export default function DraftsStrip({ refreshKey, onResolved }) {
  const [drafts, setDrafts]     = useState([]);
  const [routines, setRoutines] = useState([]);
  const navigate = useNavigate();
  const [loading, setLoading]   = useState(true);

  const load = useCallback(() => {
    apiGet('/api/self-study/drafts')
      .then(d => setDrafts(d?.data?.drafts ?? []))
      .catch(() => setDrafts([]))
      .finally(() => setLoading(false));
  }, []);
  const loadRoutines = useCallback(() => {
    apiGet('/api/self-study/routines')
      .then(d => setRoutines(d?.data?.routines ?? []))
      .catch(() => setRoutines([]));
  }, []);
  useEffect(() => { load(); loadRoutines(); }, [load, loadRoutines, refreshKey]);

  const flipRoutine = (r) => apiPatch(`/api/self-study/routines/${r.id}`, { status: r.status === 'active' ? 'paused' : 'active' }).then(loadRoutines).catch(() => {});
  const dropRoutine = (r) => apiDelete(`/api/self-study/routines/${r.id}`).then(loadRoutines).catch(() => {});
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading || (!drafts.length && !routines.length)) return null;
  return (
    <div style={{ background: `${PURPLE}08`, border: '1px solid rgba(168,85,247,.3)', borderRadius: 14, padding: '12px 16px', marginBottom: 18, fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Ico ti="ti-sparkles" size={14} color={PURPLE} />
        <span style={{ fontSize: 12, fontWeight: 900, color: PURPLE, letterSpacing: .3 }}>
          {drafts.length} AI-prepared draft{drafts.length === 1 ? '' : 's'} awaiting your review
        </span>
        <span style={{ fontSize: 11, color: C.muted2 }}>— nothing was sent to learners.</span>
      </div>
      {/* Weekly routines — preparation is automated, assignment stays human. */}
      {routines.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: drafts.length ? 8 : 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: .4, color: C.muted2, textTransform: 'uppercase' }}>Weekly routines</span>
          {routines.map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 11px', borderRadius: 20, background: C.surface, border: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: C.font }}>
              <span style={{ color: r.status === 'active' ? GREEN : C.muted2 }}>{'\u{1F501}'}</span>
              {DAY[r.day_of_week]} · {r.title}
              <button onClick={() => flipRoutine(r)} title={r.status === 'active' ? 'Pause' : 'Resume'}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10.5, fontWeight: 800, color: r.status === 'active' ? C.brand : GREEN, fontFamily: C.font, padding: '2px 4px' }}>
                {r.status === 'active' ? 'Pause' : 'Resume'}
              </button>
              <button onClick={() => dropRoutine(r)} title="Cancel routine"
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: RED, fontFamily: C.font, padding: '2px 5px' }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {drafts.map(d => (
          <button key={d.id} onClick={() => navigate(`/activities?draft=${d.id}`)}
            title="Preview this draft — assigning is your call"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
              border: '1px solid rgba(168,85,247,.45)', background: C.surface, color: PURPLE,
              fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, maxWidth: 320 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
            <span style={{ fontSize: 9.5, fontWeight: 900, background: 'rgba(168,85,247,.14)', padding: '1px 7px', borderRadius: 8, textTransform: 'uppercase', flexShrink: 0 }}>
              {(d.type || '').replace('_', ' ')}
            </span>
            Preview
          </button>
        ))}
      </div>
    </div>
  );
}

/* URL shell — the draft/detail pages are their own COMPONENTS, so navigating
   list → detail → list never changes one component's hook count (hooks were
   previously declared after these early returns: opening a card crashed the
   page with "rendered fewer hooks than expected"). */
