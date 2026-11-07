/*
 * ApprovalButtons — the ONE set of buttons every approval card uses
 * (2026-11-06): Allow / Reject / Later.
 *
 *   Allow   does it (the card's own action: accept, confirm, approve)
 *   Reject  declines it (the card's own reject / dismiss)
 *   Later   changes nothing on the server: the item stays pending and waits in
 *           Tasks → Needs you; the card shows "Saved for later" with a way back.
 *
 * Cards keep their own content (what would change, the preview); only the
 * decision row is shared, so every approval reads and behaves the same.
 */
import { useState } from 'react';
import { BRAND } from '../../../constants.js';
import { Icon } from '../../common/Icons.jsx';

const NUNITO = "'Nunito',sans-serif";
const base = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: NUNITO };

export default function ApprovalButtons({ onAllow, onReject, busy = false, busyLabel = null, style = null }) {
  const [later, setLater] = useState(false);
  if (later) {
    return (
      <div data-approval-later="" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', fontFamily: NUNITO, ...style }}>
        <Icon name="ti-clock" size={13} />Saved for later — it waits in Tasks → Needs you.
        <button type="button" onClick={() => setLater(false)} style={{ border: 'none', background: 'none', color: BRAND, fontWeight: 900, fontSize: 11.5, cursor: 'pointer', fontFamily: NUNITO, padding: 0 }}>Decide now</button>
      </div>
    );
  }
  return (
    <div data-approval-buttons="" style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 9, ...style }}>
      <button type="button" onClick={onAllow} disabled={busy}
        style={{ ...base, border: 'none', color: '#fff', background: busy ? 'var(--ak-border)' : `linear-gradient(135deg,${BRAND},#4C1DCC)` }}>
        <Icon name="ti-check" size={13} />{busy ? (busyLabel || 'Working…') : 'Allow'}
      </button>
      <button type="button" onClick={onReject} disabled={busy}
        style={{ ...base, border: '1.5px solid var(--ak-border2)', background: 'var(--ak-surface)', color: 'var(--ak-text)' }}>
        <Icon name="ti-x" size={13} />Reject
      </button>
      <button type="button" onClick={() => setLater(true)} disabled={busy}
        style={{ ...base, border: 'none', background: 'none', color: 'var(--ak-text-muted)' }}>
        <Icon name="ti-clock" size={13} />Later
      </button>
    </div>
  );
}
