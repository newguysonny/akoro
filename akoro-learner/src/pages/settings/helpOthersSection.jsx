/*
 * HelpOthersSection — Settings → Agent, "Helping other learners" (Grand Plan
 * §7.13.1a; preview approved 2026-11-07, ON by default). With it on, other
 * learners' agents can learn from what this learner struggled with and what
 * finally worked — never notes, messages, name or school; sensitive struggles
 * never. Saved with the agent PUT as help_others_opt_in (the server records
 * the choice, so a learner who turns it off stays off).
 */
import { useEffect, useState } from 'react';
import { Section, Row, Toggle } from './shared.jsx';
import { apiGet, apiPut } from '../../services/api.js';

export default function HelpOthersSection() {
  const [on, setOn] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    apiGet('/api/user/agent').then((d) => {
      const v = (d?.data ?? d)?.help_others_opt_in;
      setOn(v !== false);
    }).catch(() => setOn(null));
  }, []);
  if (on == null) return null;

  const flip = async () => {
    const next = !on;
    setErr(''); setOn(next);
    try {
      const d = await apiPut('/api/user/agent', { help_others_opt_in: next });
      const saved = (d?.data ?? d)?.help_others_opt_in;
      if (typeof saved === 'boolean') setOn(saved);
    } catch (e) { setOn(!next); setErr(e?.message || 'Could not save that.'); }
  };

  return (
    <Section title="Helping other learners">
      <Row icon="ti-heart-handshake" label="Let my agent help other learners" noArrow
        sub="Other learners' agents can learn from how you got past tricky topics — what you struggled with and what finally worked. Your notes, messages, name and school are never shared, only that and your agent's name. You can turn this off at any time.">
        <Toggle on={on} onChange={flip} />
      </Row>
      {err && <p data-help-others-error="" style={{ fontSize: 11.5, color: '#EF4444', fontWeight: 700, margin: '4px 14px 8px' }}>{err}</p>}
    </Section>
  );
}
