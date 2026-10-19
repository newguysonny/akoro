/*
 * AutonomySection — Settings → Agent (Grand Plan §7.16.7, D46/D47): one switch
 * per part of what the agent does on its own, the learner's quiet hours and
 * time zone, and this week's background budget (paid by Akoro, not coins).
 * Agent Online is the main switch; the others are on by default with it.
 */
import { useEffect, useState } from 'react';
import { Section, Row, Toggle } from './shared.jsx';
import { apiGet, apiPatch } from '../../services/api.js';

const NUNITO = "'Nunito',sans-serif";
const ZONES = ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata'];
const HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const label12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const zoneLabel = (z) => { try { const off = new Intl.DateTimeFormat('en-GB', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value; return `${z.split('/').pop().replace(/_/g, ' ')} (${off})`; } catch { return z; } };
const select = { fontFamily: NUNITO, fontSize: 12.5, fontWeight: 800, padding: '6px 10px', borderRadius: 10, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)' };

export default function AutonomySection() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { apiGet('/api/agent/settings').then((d) => setS(d?.data || null)).catch(() => setS(null)); }, []);
  if (!s) return null;

  const save = async (patch) => {
    const before = s;
    setErr('');
    setS((x) => ({ ...x, ...patch }));
    try { const d = await apiPatch('/api/agent/settings', patch); if (d?.data) setS(d.data); }
    catch (e) { setS(before); setErr(e?.message || 'Could not save that.'); }
  };
  const zones = ZONES.includes(s.timeZone) ? ZONES : [s.timeZone, ...ZONES];

  return (
    <>
      <Section title="What your agent does on its own">
        <Row icon="ti-power" label="Agent Online" sub="The main switch. Off: your agent only answers when you talk to it." noArrow>
          <Toggle on={s.agentOnline} onChange={() => save({ agentOnline: !s.agentOnline })} />
        </Row>
        <Row icon="ti-bulb" label="Suggestions and ideas" sub="It looks over your goals, tasks, weak topics and library overnight and brings you a few ready next steps. Nothing happens until you say yes." noArrow>
          <Toggle on={s.proactive} onChange={() => save({ proactive: !s.proactive })} />
        </Row>
        <Row icon="ti-brain" label="Learn from my conversations" sub="After a chat goes quiet it notes what helps it help you — never health, feelings, money or contact details. See and delete them in Memory." noArrow>
          <Toggle on={s.learnFromChats} onChange={() => save({ learnFromChats: !s.learnFromChats })} />
        </Row>
        <Row icon="ti-clock-check" label="Task check-ins" sub="A short message when a task is due or overdue." noArrow>
          <Toggle on={s.checkins} onChange={() => save({ checkins: !s.checkins })} />
        </Row>
      </Section>
      <Section title="When">
        <Row icon="ti-moon" label="Quiet hours" sub="No messages from your agent in this time." noArrow>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select aria-label="Quiet hours start" value={s.quietStart} onChange={(e) => save({ quietStart: e.target.value })} style={select}>
              {HOURS.map((h) => <option key={h} value={h}>{label12(h)}</option>)}
            </select>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', fontFamily: NUNITO }}>to</span>
            <select aria-label="Quiet hours end" value={s.quietEnd} onChange={(e) => save({ quietEnd: e.target.value })} style={select}>
              {HOURS.map((h) => <option key={h} value={h}>{label12(h)}</option>)}
            </select>
          </span>
        </Row>
        <Row icon="ti-world" label="Time zone" sub="Used for quiet hours and check-in times." noArrow>
          <select aria-label="Time zone" value={s.timeZone} onChange={(e) => save({ timeZone: e.target.value })} style={{ ...select, maxWidth: 200 }}>
            {zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
          </select>
        </Row>
      </Section>
      {s.budget && (
        <Section title="This week">
          <div data-agent-budget="" style={{ padding: '12px 14px', fontFamily: NUNITO }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--ak-text)' }}>Background work this week</p>
            <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-muted)', lineHeight: 1.5 }}>
              Paid by Akoro, not your coins. {s.budget.paused ? 'Used up — suggestions pause until Monday.' : "When it's used up, suggestions pause until Monday."}
            </p>
            <div style={{ height: 6, borderRadius: 6, background: 'var(--ak-surface-hover)', overflow: 'hidden', marginTop: 8 }}>
              <i style={{ display: 'block', height: '100%', width: `${Math.max(2, s.budget.usedPct)}%`, background: s.budget.usedPct >= 80 ? '#D97706' : '#10B981' }} />
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 11.5, fontWeight: 600, color: 'var(--ak-text-muted)' }}>{s.budget.usedPct}% used</p>
          </div>
        </Section>
      )}
      {err && <div style={{ padding: '0 14px 10px', fontSize: 12, color: '#EF4444', fontFamily: NUNITO }}>{err}</div>}
    </>
  );
}
