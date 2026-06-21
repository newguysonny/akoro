import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AkoroLogo from '../components/common/AkoroLogo.jsx';

const B   = '#6C3BFF';
const B2  = '#4C1DCC';
const INK = '#1A1A2E';
const MUTED = '#6B7280';
const LIGHT = '#F5F3FF';
const BORDER = '#E9E6FF';
const GREEN = '#10B981';

const TOPICS = [
  { id: 'general',     label: 'General enquiry',      icon: '💬' },
  { id: 'support',     label: 'Technical support',    icon: '🛠️' },
  { id: 'schools',     label: 'School / institution', icon: '🏫' },
  { id: 'billing',     label: 'Billing or payments',  icon: '💳' },
  { id: 'press',       label: 'Press & media',        icon: '📰' },
  { id: 'partnership', label: 'Partnerships',         icon: '🤝' },
];

const CHANNELS = [
  { icon: '📧', title: 'General', email: 'hello@akoro.app', desc: 'General enquiries and feedback.' },
  { icon: '🛠️', title: 'Support', email: 'support@akoro.app', desc: 'Technical issues, bugs, and account help.' },
  { icon: '🏫', title: 'Schools', email: 'schools@akoro.app', desc: 'Pilot programmes, enterprise plans, and school onboarding.' },
  { icon: '⚖️', title: 'Legal / Privacy', email: 'legal@akoro.app', desc: 'Privacy requests, data subject rights, and legal enquiries.' },
  { icon: '📰', title: 'Press', email: 'press@akoro.app', desc: 'Media enquiries, interview requests, and press assets.' },
  { icon: '💳', title: 'Billing', email: 'billing@akoro.app', desc: 'Payment issues, refunds, and subscription queries.' },
];

export default function ContactPage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [form, setForm] = useState({ name: '', email: '', organisation: '', message: '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message || !topic) return;
    setSending(true);
    // In production wire to your contact API / email service
    await new Promise(r => setTimeout(r, 1200));
    setSending(false);
    setSent(true);
  };

  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: 10,
    border: `1.5px solid ${BORDER}`, fontSize: 14, color: INK,
    fontFamily: "'DM Sans', sans-serif", outline: 'none',
    background: '#fff', transition: 'border-color .15s',
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:#fff}
        input:focus,textarea:focus,select:focus{border-color:${B}!important;box-shadow:0 0 0 3px ${B}18}
        .topic-btn:hover{border-color:${B}!important;background:${LIGHT}!important}
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif" }}>

        {/* Nav */}
        <div style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${BORDER}`, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'sticky', top: 0, zIndex: 200 }}>
          <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer' }}>
            <AkoroLogo size={32} radius={9} />
            <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>Akoro</span>
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => navigate('/about')} style={{ background: 'none', border: `1px solid ${BORDER}`, cursor: 'pointer', color: MUTED, padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>About us</button>
          <button onClick={() => navigate('/careers')} style={{ background: B, border: 'none', cursor: 'pointer', color: '#fff', padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>We're hiring →</button>
        </div>

        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(56px,7vw,80px) 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>👋</div>
          <h1 style={{ fontSize: 'clamp(28px,4.5vw,48px)', fontWeight: 900, color: '#fff', marginBottom: 14, fontFamily: "'Nunito', sans-serif" }}>Get in touch</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.85)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
            Whether you're a student, parent, teacher, or school administrator — we'd love to hear from you. We reply within one business day.
          </p>
        </div>

        <div style={{ maxWidth: 1040, margin: '0 auto', padding: 'clamp(40px,5vw,64px) 24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,.9fr)', gap: 48, alignItems: 'start' }}>

            {/* Form */}
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: INK, marginBottom: 6, fontFamily: "'Nunito', sans-serif" }}>Send us a message</h2>
              <p style={{ fontSize: 13.5, color: MUTED, marginBottom: 28 }}>We read every message and respond within 1 business day.</p>

              {sent ? (
                <div style={{ background: '#ECFDF5', border: '1.5px solid #6EE7B7', borderRadius: 16, padding: '36px 28px', textAlign: 'center' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: '#065F46', marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>Message sent!</h3>
                  <p style={{ fontSize: 14, color: '#047857', lineHeight: 1.7, marginBottom: 24 }}>Thanks, {form.name.split(' ')[0]}! We'll get back to you at {form.email} within one business day.</p>
                  <button onClick={() => { setSent(false); setForm({ name: '', email: '', organisation: '', message: '' }); setTopic(''); }}
                    style={{ background: GREEN, color: '#fff', padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Topic selector */}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>What's this about? *</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {TOPICS.map(({ id, label, icon }) => (
                        <button key={id} type="button" className="topic-btn" onClick={() => setTopic(id)}
                          style={{ padding: '10px 8px', borderRadius: 10, border: `1.5px solid ${topic === id ? B : BORDER}`, background: topic === id ? LIGHT : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: topic === id ? 700 : 500, color: topic === id ? B : MUTED, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, transition: 'all .15s' }}>
                          <span style={{ fontSize: 18 }}>{icon}</span>{label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Full name *</label>
                      <input required value={form.name} onChange={set('name')} placeholder="Your name" style={inputStyle} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Email *</label>
                      <input required type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" style={inputStyle} />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Organisation (optional)</label>
                    <input value={form.organisation} onChange={set('organisation')} placeholder="School, company, or institution" style={inputStyle} />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Message *</label>
                    <textarea required rows={5} value={form.message} onChange={set('message')} placeholder="Tell us what's on your mind…"
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 120 }} />
                  </div>

                  <button type="submit" disabled={sending || !topic}
                    style={{ background: (!topic || sending) ? '#D1D5DB' : B, color: '#fff', padding: '14px 28px', borderRadius: 12, border: 'none', cursor: (!topic || sending) ? 'not-allowed' : 'pointer', fontSize: 15, fontWeight: 800, fontFamily: "'Nunito', sans-serif", transition: 'background .2s' }}>
                    {sending ? 'Sending…' : 'Send message →'}
                  </button>
                </form>
              )}
            </div>

            {/* Contact channels + info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ background: LIGHT, borderRadius: 16, padding: '24px 22px', border: `1px solid ${BORDER}` }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 16, fontFamily: "'Nunito', sans-serif" }}>Direct contact channels</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {CHANNELS.map(({ icon, title, email, desc }) => (
                    <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fff', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{icon}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{title}</div>
                        <a href={`mailto:${email}`} style={{ fontSize: 12.5, color: B, fontWeight: 600, textDecoration: 'none' }}>{email}</a>
                        <p style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.5 }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#fff', borderRadius: 16, padding: '22px', border: `1px solid ${BORDER}` }}>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 14, fontFamily: "'Nunito', sans-serif" }}>Office</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { icon: '📍', text: '14 Bode Thomas Street, Surulere, Lagos, Nigeria' },
                    { icon: '🕐', text: 'Mon – Fri, 9 AM – 6 PM WAT' },
                    { icon: '📞', text: '+234 800 AKORO 00' },
                  ].map(({ icon, text }) => (
                    <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                      <span style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: `${B}10`, borderRadius: 16, padding: '20px 22px', border: `1px solid ${B}25` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>🏫 Are you a school?</div>
                <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6, marginBottom: 14 }}>We offer pilot programmes, bulk pricing, and dedicated onboarding for institutions. Let's talk.</p>
                <button onClick={() => navigate('/careers')}
                  style={{ background: B, color: '#fff', padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  Book a school demo →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer mini */}
        <div style={{ background: '#F5F2EC', padding: '24px', textAlign: 'center', borderTop: '1px solid #E2DDD6' }}>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            {[['/', 'Home'], ['/about', 'About'], ['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/careers', 'Careers']].map(([href, label]) => (
              <a key={label} href={href} style={{ fontSize: 13, color: MUTED, textDecoration: 'none', fontWeight: 500 }}
                onMouseEnter={e => e.target.style.color = B} onMouseLeave={e => e.target.style.color = MUTED}>{label}</a>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#9CA3AF' }}>© 2025 Akoro Technologies Ltd. All rights reserved.</p>
        </div>
      </div>
    </>
  );
}
