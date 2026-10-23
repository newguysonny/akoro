import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {Send, SlidersHorizontal, CheckCircle2, Info, Bell, AlertTriangle, Loader2, CreditCard, GraduationCap, ClipboardList, NotebookPen, KeyRound, BarChart3 } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiPut, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';
const BRAND = AMBER;

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: 0, border: 'none',
      background: 'transparent', cursor: 'pointer', fontFamily: FONT,
    }}>
      <span style={{ width: 42, height: 24, borderRadius: 999, background: on ? RED : '#D8D5CE', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

const ALERTS = [
  { icon: CreditCard, label: 'Fee collections (real-time)' },
  { icon: CheckCircle2, label: 'Attendance summaries' },
  { icon: GraduationCap, label: 'New student admissions' },
  { icon: ClipboardList, label: 'Leave requests' },
  { icon: NotebookPen, label: 'Homework assignments' },
  { icon: KeyRound, label: 'Staff logins' },
  { icon: BarChart3, label: 'Daily summary (9 PM)' },
];

export default function TelegramBotPage() {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [validated, setValidated] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/telegram')
      .then((res) => {
        const d = res.data || {};
        setActive(!!d.active);
        setHasToken(!!d.hasToken);
        setChatId(d.chatId || '');
        setValidated(!!d.hasToken);
      })
      .catch((e) => showToast(e.message || 'Could not load Telegram config'))
      .finally(() => setLoading(false));
  }, []);

  const validate = async () => {
    if (!token) return;
    setValidating(true);
    try {
      const res = await apiPost('/api/school/telegram/validate', { botToken: token });
      if (res.success) { setValidated(true); showToast(`Connected to @${res.data.username} ✓`); }
    } catch (e) { setValidated(false); showToast(e.message || 'Invalid bot token'); }
    finally { setValidating(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { chatId, active };
      if (token) body.botToken = token;
      await apiPut('/api/school/telegram', body);
      setHasToken(hasToken || !!token);
      setToken('');
      showToast('Saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await apiPost('/api/school/telegram/test', {});
      showToast(res.message || 'Test message sent!');
    } catch (e) { showToast(e.message || 'Could not send test message'); }
    finally { setTesting(false); }
  };

  const inputStyle = {
    width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`,
    outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
  };

  return (
    <PageLayout title="Telegram Bot Monitoring" subtitle="Get real-time school alerts sent to Telegram">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18 }}>
        <BackButton onClick={() => navigate('/settings-notifications')} label="Back to Notifications" />
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main column */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          <div style={{ background: WHITE, border: `1.5px solid ${BLUE}33`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: `1px solid ${BORDER}` }}>
              <SlidersHorizontal size={15} color={BLUE} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Bot Configuration</span>
            </div>

            <div style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Enable Telegram Monitoring</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Toggle on={active} onChange={setActive} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: active ? RED : MUTED2, fontFamily: FONT }}>{active ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
              <p style={{ fontSize: 12, color: MUTED, margin: '0 0 18px', fontFamily: FONT, paddingBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
                Receive real-time alerts for your school via Telegram.
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Bot Token</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input value={token} onChange={(e) => { setToken(e.target.value); setValidated(false); }} placeholder={hasToken ? 'Saved — enter a new token to replace it' : '123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                  <button onClick={validate} disabled={!token || validating} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${validated ? GREEN : BLUE}`, background: validated ? `${GREEN}10` : WHITE, color: validated ? GREEN : BLUE, fontSize: 12.5, fontWeight: 800, cursor: token ? 'pointer' : 'not-allowed', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                    {validating ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <CheckCircle2 size={13} />} {validated ? 'Validated' : 'Validate'}
                  </button>
                </div>
                {hasToken && !token && <p style={{ fontSize: 11, color: GREEN, margin: '6px 0 0', fontFamily: FONT, fontWeight: 700 }}>A bot token is already saved for this school.</p>}
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>Chat ID</label>
                <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="e.g. 123456789" style={inputStyle} />
                <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>
                  Your personal Chat ID or group Chat ID. Get it from <a href="#" style={{ color: AMBER, fontWeight: 700, textDecoration: 'none' }}>@userinfobot</a>.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '14px 20px', borderTop: `1px solid ${BORDER}`, background: LIGHT, flexWrap: 'wrap' }}>
              <button onClick={sendTest} disabled={testing || !hasToken || !chatId} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 9, border: 'none', background: (!hasToken || !chatId) ? '#E5E7EB' : '#0EA5E9', color: (!hasToken || !chatId) ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: (!hasToken || !chatId) ? 'not-allowed' : 'pointer', fontFamily: FONT }}>
                {testing ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Send size={13} />} Send Test Message
              </button>
              <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                {saving ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : null} {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>

        {/* Setup guide sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#0EA5E9', borderRadius: '14px 14px 0 0', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={15} color={WHITE} />
            <span style={{ fontSize: 13, fontWeight: 800, color: WHITE, fontFamily: FONT }}>Setup Guide</span>
          </div>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '16px 16px 18px', marginTop: -14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 1:</b> Open Telegram and message <a href="#" style={{ color: AMBER, fontWeight: 700, textDecoration: 'none' }}>@BotFather</a>.</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 2:</b> Send <code style={{ background: LIGHT, padding: '1px 5px', borderRadius: 4, color: '#D4651E' }}>/newbot</code> and follow prompts. Copy the <b style={{ color: INK }}>Token</b>.</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 3:</b> Start chatting with your bot (search by username → Start).</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 4:</b> Message <a href="#" style={{ color: AMBER, fontWeight: 700, textDecoration: 'none' }}>@userinfobot</a> to get your <b style={{ color: INK }}>Chat ID</b>.</p>
              <p style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}><b style={{ color: INK }}>Step 5:</b> Paste both values here and Save!</p>
            </div>

            <div style={{ height: 1, background: BORDER, margin: '16px 0' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
              <Bell size={13} color={INK} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Alerts you'll receive:</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ALERTS.map((a) => (
                <span key={a.label} style={{ fontSize: 12, color: MUTED, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'flex' }}><a.icon size={14} color={BRAND} /></span>{a.label}
                </span>
              ))}
            </div>
          </div>

          <div style={{ background: `${AMBER}0C`, border: `1px solid ${AMBER}33`, borderLeft: `3px solid ${AMBER}`, borderRadius: 10, padding: '13px 15px', display: 'flex', gap: 9 }}>
            <AlertTriangle size={15} color={AMBER} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}>
              <b style={{ color: INK }}>For group monitoring:</b> Add the bot to your Telegram group. The Chat ID will be a negative number (e.g. <code style={{ color: '#D4651E', background: `${AMBER}12`, padding: '1px 5px', borderRadius: 4 }}>-123456789</code>).
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
