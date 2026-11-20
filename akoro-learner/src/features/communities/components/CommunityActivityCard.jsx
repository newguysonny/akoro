import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND, RED, GREEN } from '../../../constants.js';
import Spinner from '../../../components/common/Spinner.jsx';
import { dueInfo, typeMeta, stageKindName, timeAgo } from './communityActivityMeta.js';

/* One activity, in the reference's row language: a solid accent thumb with
   the type's line icon, then name / meta / due / stages / the submit row. */
export default function CommunityActivityCard({ a, canSubmit, onSubmit, submitting = false, accent }) {
  const due = dueInfo(a.dueAt);
  const tm = typeMeta(a.type);
  const meta = [tm.name, a.subject, a.class_name].filter(Boolean).join(' · ');
  return (
    <div style={{ padding: '13px 15px', background: 'var(--ak-surface)', borderRadius: 'var(--r-lg)', border: '1px solid var(--ak-border2)', display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-start' }}>
      <div style={{ width: 42, height: 42, borderRadius: 'var(--r-sm)', flexShrink: 0, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={tm.icon} size={18}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 900, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.name}
        </div>
        {meta && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2 }}>{meta}</div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 2 }}>
          {due
            ? <span style={{ color: due.overdue ? RED : 'var(--ak-text-muted)', fontWeight: due.overdue ? 800 : 400 }}>Due {due.text}{due.overdue ? ' · Overdue' : ''}</span>
            : 'No due date'}
          <span>  ·  Posted {timeAgo(a.created_at)}</span>
        </div>
        {a.instructions && (
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-muted)', marginTop: 3, lineHeight: 1.5 }}>{a.instructions}</div>
        )}
        {Array.isArray(a.stages) && a.stages.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {a.stages.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', background: `${BRAND}14`, color: BRAND, fontSize: 9.5, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--ak-text-muted)', background: 'var(--ak-border)', padding: '1px 6px', borderRadius: 5, flexShrink: 0 }}>{stageKindName(s.kind)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: BRAND, background: `${BRAND}12`, borderRadius: 'var(--r-full)', padding: '2px 9px' }}>
            <Icon name="ti-inbox" size={11}/>
            {a.submissions_count || 0} submission{(a.submissions_count || 0) === 1 ? '' : 's'}
          </span>
          {a.creator_name && (
            <span style={{ fontSize: 11, color: 'var(--ak-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              by {a.creator_name}
            </span>
          )}
          {canSubmit && (
            <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {a.my_submitted ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 800, color: GREEN, background: 'rgba(16,185,129,.10)', borderRadius: 'var(--r-full)', padding: '3px 10px' }}>
                  <Icon name="ti-circle-check" size={12}/>
                  Submitted
                </span>
              ) : (
                <button onClick={() => onSubmit(a)} disabled={submitting}
                  style={{ border: `1.5px solid ${BRAND}`, background: 'transparent', color: BRAND, borderRadius: 'var(--r-full)', padding: '3px 12px', fontSize: 10.5, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? .7 : 1, fontFamily: "'Nunito',sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {submitting ? <Spinner size={11} color={BRAND}/> : 'Submit'}
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
