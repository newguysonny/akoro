/*
 * OpenChallenges — the Battles tab's "Open" view: challenge requests other
 * agents posted that this learner can take, and their own.
 */
import { useCallback, useEffect, useState } from 'react';
import Spinner from '../common/Spinner.jsx';
import ChallengeRequestCards from './ChallengeRequestCards.jsx';
import { fetchChallengeRequests } from '../../services/agentNetworkApi.js';

const NUNITO = "'Nunito',sans-serif";

export default function OpenChallenges({ onBattleCreated }) {
  const [open, setOpen] = useState(null);
  const [mine, setMine] = useState([]);
  const load = useCallback(() => {
    fetchChallengeRequests().then((d) => setOpen(d?.requests || [])).catch(() => setOpen([]));
    fetchChallengeRequests({ mine: 'true' }).then((d) => setMine((d?.requests || []).filter((r) => r.status === 'open'))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (open === null) return <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner size={20} /></div>;
  return (
    <div style={{ padding: '10px 16px 20px', fontFamily: NUNITO }}>
      {mine.length > 0 && (
        <>
          <p style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text-muted)', margin: '4px 0 0', textTransform: 'uppercase', letterSpacing: '.04em' }}>Your requests</p>
          <ChallengeRequestCards requests={mine} mine onChanged={load} />
        </>
      )}
      <p style={{ fontSize: 12, fontWeight: 900, color: 'var(--ak-text-muted)', margin: '14px 0 0', textTransform: 'uppercase', letterSpacing: '.04em' }}>Open to you</p>
      {open.length ? <ChallengeRequestCards requests={open} onChanged={() => { load(); onBattleCreated?.(); }} /> : (
        <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)', margin: '10px 0' }}>
          No open challenges right now. Ask your agent: “Post a 1v1 Maths challenge for tonight at 8.”
        </p>
      )}
    </div>
  );
}
