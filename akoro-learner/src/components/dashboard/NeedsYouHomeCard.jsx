/*
 * NeedsYouHomeCard — the learner Home's one card for what waits on them
 * (Phase 11, 2026-11-07). The "pick up where you left off" card and the Agent
 * Chat's Tasks → Needs you list are the same list: the card leads with the
 * item most worth continuing and links to the rest. Same server list
 * (GET /api/workflows/dashboard), so the count always matches the tab.
 */
import { useNavigate } from 'react-router-dom';
import { BRAND } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import { useNeedsYou } from '../../features/agent-chat/index.js';
import { useLang } from '../../contexts/LanguageContext.jsx';
import { homeNeedsYou, homeHref, NEEDS_YOU_HREF } from '../../lib/needsYouHome.js';

const NUNITO = "'Nunito',sans-serif";

export default function NeedsYouHomeCard() {
  const { t } = useLang();
  const navigate = useNavigate();
  const state = useNeedsYou();
  const view = homeNeedsYou(state.data);
  if (!view) return null;
  const { lead, more, working } = view;
  const sub = lead ? [lead.waitsFor?.label, lead.progress?.label].filter(Boolean).join(' · ') : '';

  return (
    <div data-needs-you-home="" style={{ margin: '10px 12px 0', fontFamily: NUNITO }}>
      {lead && (
        <div style={{ background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: '#fff', borderRadius: 18, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <Icon name="ti-bell-ringing" size={13} color="#fff" />{t('home.pick_up')}
          </div>
          <p style={{ fontSize: 17, fontWeight: 900, margin: '4px 0 2px', lineHeight: 1.3 }}>{lead.title}</p>
          {sub && <p style={{ fontSize: 12.5, opacity: 0.9, margin: 0 }}>{sub}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {lead.action && (
              <button type="button" onClick={() => navigate(homeHref(lead))}
                style={{ border: 'none', background: '#fff', color: BRAND, borderRadius: 20, padding: '8px 16px', fontWeight: 900, fontSize: 12.5, cursor: 'pointer', fontFamily: NUNITO, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon name="ti-player-play" size={13} color={BRAND} />{lead.action.label}
              </button>
            )}
            <button type="button" data-needs-you-all="" onClick={() => navigate(NEEDS_YOU_HREF)}
              style={{ border: '1px solid #ffffff66', background: 'transparent', color: '#fff', borderRadius: 20, padding: '7px 14px', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: NUNITO, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {more > 0 ? t('home.needs_more').replace('{n}', String(more)) : t('agent.needs_you')}
              <Icon name="ti-chevron-right" size={13} color="#fff" />
            </button>
          </div>
        </div>
      )}
      {!lead && working.length > 0 && (
        <button type="button" onClick={() => navigate(NEEDS_YOU_HREF)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', borderRadius: 14, padding: '10px 12px', cursor: 'pointer', fontFamily: NUNITO, color: 'var(--ak-text)', fontSize: 12.5, fontWeight: 800, textAlign: 'left' }}>
          <Icon name="ti-loader-2" size={15} color="#0EA5E9" />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('agent.working_on')} · {working.map((w) => w.title).join(', ')}
          </span>
          <Icon name="ti-chevron-right" size={14} color="var(--ak-text-muted)" />
        </button>
      )}
    </div>
  );
}
