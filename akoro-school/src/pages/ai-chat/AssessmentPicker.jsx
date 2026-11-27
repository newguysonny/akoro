/**
 * AssessmentPicker — "Assessment" option in the school AI chat.
 * Auto-syncs today's class timetable + what was taught today (classwork logs),
 * enriched with syllabus topics (RAG), into a list of after-school proctored
 * assessments the student can take. Backed by GET /api/adaptive/assessment/today.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../../services/api.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const GREEN = '#10B981';

export default function AssessmentPicker({ onClose, onStart }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    apiGet('/api/adaptive/assessment/today')
      .then((r) => { if (alive) setData(r?.data ?? r); })
      .catch((e) => { if (alive) setError(e?.message || 'Could not load today’s assessments'); });
    return () => { alive = false; };
  }, []);

  const options = data?.options || [];

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: C.font }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: C.surface, borderRadius: '20px 20px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 16, fontWeight: 900, color: C.ink }}>
              <Ico ti="ti-clipboard-check" size={18} color={C.brand} /> After-school assessment
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {data?.student?.class ? `${data.student.class}${data.student.section ? ' · ' + data.student.section : ''} — today's lessons` : 'Based on today’s timetable & lessons'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}><Ico ti="ti-x" size={20} /></button>
        </div>

        <div style={{ padding: '14px 16px 20px', overflowY: 'auto' }}>
          {/* proctor note */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: tint(5), border: `1px solid ${tint(13)}`, borderRadius: 12, padding: '9px 12px', marginBottom: 14, fontSize: 12, color: '#4A4A66', fontWeight: 600 }}>
            <Ico ti="ti-shield-check" size={15} color={C.brand} /> Each assessment is proctored — keep your face in frame and stay alone.
          </div>

          {error ? (
            <div style={{ color: '#EF4444', fontSize: 13, fontWeight: 700, padding: '20px 4px' }}>{error}</div>
          ) : !data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[1, 2, 3].map((i) => <div key={i} style={{ height: 70, borderRadius: 14, background: C.tagBg }} />)}</div>
          ) : data.enrolled === false ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: C.muted }}>
              <Ico ti="ti-book" size={30} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>No class linked yet</div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>{data.message || 'Ask your school to link your student account.'}</div>
            </div>
          ) : options.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: C.muted }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Nothing logged for today yet</div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>Once today’s lessons are recorded, they’ll appear here to assess.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {options.map((o, i) => (
                <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.brand, textTransform: 'uppercase', letterSpacing: 0.3 }}>{o.subject}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 2 }}>{o.topic || 'General revision'}</div>
                      {o.source === 'classwork' && <div style={{ fontSize: 11, color: GREEN, fontWeight: 700, marginTop: 2 }}>✓ Taught today</div>}
                      {o.syllabus?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {o.syllabus.map((s, j) => (
                            <span key={j} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: C.tagBg, color: C.muted }}>{s.topic}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => onStart(o)} style={{ flexShrink: 0, background: C.brand, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>Start</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
