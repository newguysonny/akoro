import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost } from '../services/api.js';
import { SiteNav, SiteFooter } from '../components/SiteChrome.jsx';
import {
  Send, MessageCircle, CheckCircle2,
  MessageSquare, Wrench, School, CreditCard, Newspaper, Handshake,
  Mail, LifeBuoy, Scale,
  MapPin, Clock, Phone,
} from 'lucide-react';

const B      = '#6C3BFF';
const B2     = '#4C1DCC';
const INK    = '#0F0A1E';
const TEXT   = '#3F3A52';
const MUTED  = '#7A7588';
const BORDER = '#ECEAF4';
const SURFACE = '#FAFAFB';
const TINT   = '#F6F4FF';
const GREEN  = '#10B981';

const TOPICS = [
  { id: 'general',     label: 'General enquiry',      Icon: MessageSquare },
  { id: 'support',     label: 'Technical support',    Icon: Wrench },
  { id: 'schools',     label: 'School / institution', Icon: School },
  { id: 'billing',     label: 'Billing or payments',  Icon: CreditCard },
  { id: 'press',       label: 'Press & media',        Icon: Newspaper },
  { id: 'partnership', label: 'Partnerships',         Icon: Handshake },
];

const CHANNELS = [
  { Icon: Mail,       title: 'General', email: 'hello@akoro.app', desc: 'General enquiries and feedback.' },
  { Icon: LifeBuoy,   title: 'Support', email: 'support@akoro.app', desc: 'Technical issues, bugs, and account help.' },
  { Icon: School,     title: 'Schools', email: 'schools@akoro.app', desc: 'Pilot programmes, enterprise plans, and school onboarding.' },
  { Icon: Scale,      title: 'Legal / Privacy', email: 'legal@akoro.app', desc: 'Privacy requests, data subject rights, and legal enquiries.' },
  { Icon: Newspaper,  title: 'Press', email: 'press@akoro.app', desc: 'Media enquiries, interview requests, and press assets.' },
  { Icon: CreditCard, title: 'Billing', email: 'billing@akoro.app', desc: 'Payment issues, refunds, and subscription queries.' },
];

export default function ContactPage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [form, setForm] = useState({ name: '', email: '', organisation: '', message: '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message || !topic) return;
    setSending(true); setError('');
    try {
      await apiPost('/api/contact', {
        kind: 'contact',
        name: form.name, email: form.email,
        organisation: form.organisation, subject: topic, message: form.message,
      });
      setSent(true);
    } catch {
      setError("Couldn't send your message. Please try again, or email hello@akoro.app.");
    } finally {
      setSending(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 14px', borderRadius: 11,
    border: `1.5px solid ${BORDER}`, fontSize: 14.5, color: INK,
    fontFamily: "'DM Sans', sans-serif", outline: 'none',
    background: '#fff', transition: 'border-color .15s, box-shadow .15s',
  };

  const labelStyle = {
    fontSize: 11.5, fontWeight: 700, color: MUTED, letterSpacing: '0.08em',
    textTransform: 'uppercase', display: 'block', marginBottom: 7,
    fontFamily: "'DM Sans', sans-serif",
  };

  const cardStyle = {
    border: `1px solid ${BORDER}`, borderRadius: 16,
    boxShadow: '0 1px 2px rgba(16,10,30,.04)', background: '#fff',
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'DM Sans',sans-serif;background:#fff}
        input:focus,textarea:focus,select:focus{border-color:${B}!important;box-shadow:0 0 0 3px ${B}22}
        input::placeholder,textarea::placeholder{color:${MUTED};opacity:.7}
        .topic-btn:hover{border-color:${B}!important;background:${TINT}!important;color:${B}!important}
        .channel-row:hover{background:#fff}
        .footer-link:hover{color:${B}!important}
        .contact-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:48px;align-items:start}
        @media(max-width:860px){.contact-grid{grid-template-columns:1fr;gap:32px}}
        .contact-2up{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        @media(max-width:560px){.contact-2up{grid-template-columns:1fr}}
        .topic-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        @media(max-width:560px){.topic-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:560px){.nav-secondary{display:none!important}}
        @media(max-width:560px){.akoro-nav{padding:12px 18px!important}}
      `}</style>

      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'DM Sans', sans-serif", color: TEXT }}>

        {/* Nav */}
        <SiteNav />

        {/* Hero */}
        <div style={{ background: `linear-gradient(135deg, ${B} 0%, ${B2} 100%)`, padding: 'clamp(48px,7vw,80px) 20px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -80, right: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,.07)' }} />
          <div style={{ position: 'absolute', bottom: -100, left: -50, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,.06)' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ width: 72, height: 72, margin: '0 auto 20px', borderRadius: '50%', background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageCircle size={34} color="#fff" strokeWidth={2} />
            </div>
            <h1 style={{ fontSize: 'clamp(26px,4.5vw,48px)', fontWeight: 900, color: '#fff', marginBottom: 14, fontFamily: "'Nunito', sans-serif", letterSpacing: '-0.02em' }}>Get in touch</h1>
            <p style={{ fontSize: 'clamp(15px,1.6vw,17px)', color: 'rgba(255,255,255,.88)', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
              Whether you're a student, parent, teacher, or school administrator — we'd love to hear from you. We reply within one business day.
            </p>
          </div>
        </div>

        <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'clamp(40px,5vw,64px) clamp(24px,5vw,40px)' }}>
          <div className="contact-grid">

            {/* Form */}
            <div>
              <h2 style={{ fontSize: 'clamp(22px,3vw,28px)', fontWeight: 800, color: INK, marginBottom: 6, fontFamily: "'Nunito', sans-serif", letterSpacing: '-0.01em' }}>Send us a message</h2>
              <p style={{ fontSize: 14, color: MUTED, marginBottom: 28, lineHeight: 1.6 }}>We read every message and respond within 1 business day.</p>

              {sent ? (
                <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 16, padding: '40px 28px', textAlign: 'center', boxShadow: '0 1px 2px rgba(16,10,30,.04)' }}>
                  <div style={{ width: 64, height: 64, margin: '0 auto 18px', borderRadius: '50%', background: '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CheckCircle2 size={34} color={GREEN} strokeWidth={2.2} />
                  </div>
                  <h3 style={{ fontSize: 21, fontWeight: 800, color: '#065F46', marginBottom: 8, fontFamily: "'Nunito', sans-serif" }}>Message sent!</h3>
                  <p style={{ fontSize: 14.5, color: '#047857', lineHeight: 1.7, marginBottom: 24 }}>Thanks, {form.name.split(' ')[0]}! We'll get back to you at {form.email} within one business day.</p>
                  <button onClick={() => { setSent(false); setForm({ name: '', email: '', organisation: '', message: '' }); setTopic(''); }}
                    style={{ background: GREEN, color: '#fff', padding: '11px 24px', borderRadius: 11, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: "'Nunito', sans-serif" }}>
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Topic selector */}
                  <div>
                    <label style={labelStyle}>What's this about? *</label>
                    <div className="topic-grid">
                      {TOPICS.map(({ id, label, Icon }) => {
                        const active = topic === id;
                        return (
                          <button key={id} type="button" className="topic-btn" onClick={() => setTopic(id)}
                            style={{ padding: '14px 8px', borderRadius: 12, border: `1.5px solid ${active ? B : BORDER}`, background: active ? TINT : '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? B : TEXT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'all .15s', textAlign: 'center', lineHeight: 1.3 }}>
                            <Icon size={20} color={active ? B : MUTED} strokeWidth={2} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="contact-2up">
                    <div>
                      <label style={labelStyle}>Full name *</label>
                      <input required value={form.name} onChange={set('name')} placeholder="Your name" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Email *</label>
                      <input required type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" style={inputStyle} />
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Organisation (optional)</label>
                    <input value={form.organisation} onChange={set('organisation')} placeholder="School, company, or institution" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Message *</label>
                    <textarea required rows={5} value={form.message} onChange={set('message')} placeholder="Tell us what's on your mind…"
                      style={{ ...inputStyle, resize: 'vertical', minHeight: 130, lineHeight: 1.6 }} />
                  </div>

                  {error && <p style={{ color: '#DC2626', fontSize: 13.5, margin: 0, fontWeight: 600 }}>{error}</p>}

                  <button type="submit" disabled={sending || !topic}
                    style={{ background: (!topic || sending) ? '#D1D5DB' : B, color: '#fff', padding: '14px 28px', borderRadius: 12, border: 'none', cursor: (!topic || sending) ? 'not-allowed' : 'pointer', fontSize: 15, fontWeight: 800, fontFamily: "'Nunito', sans-serif", transition: 'background .2s, box-shadow .2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, boxShadow: (!topic || sending) ? 'none' : `0 4px 14px ${B}45` }}>
                    {sending ? 'Sending…' : <>Send message <Send size={17} strokeWidth={2.2} /></>}
                  </button>
                </form>
              )}
            </div>

            {/* Contact channels + info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ ...cardStyle, background: TINT, padding: '26px 24px' }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: INK, marginBottom: 18, fontFamily: "'Nunito', sans-serif" }}>Direct contact channels</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {CHANNELS.map(({ Icon, title, email, desc }) => (
                    <div key={title} className="channel-row" style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: '#fff', border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 2px rgba(16,10,30,.04)' }}>
                        <Icon size={18} color={B} strokeWidth={2} />
                      </div>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>{title}</div>
                        <a href={`mailto:${email}`} style={{ fontSize: 13, color: B, fontWeight: 600, textDecoration: 'none' }}>{email}</a>
                        <p style={{ fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.55 }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...cardStyle, padding: '24px' }}>
                <h3 style={{ fontSize: 14.5, fontWeight: 800, color: INK, marginBottom: 16, fontFamily: "'Nunito', sans-serif" }}>Office</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {[
                    { Icon: MapPin, text: '14 Bode Thomas Street, Surulere, Lagos, Nigeria' },
                    { Icon: Clock,  text: 'Mon – Fri, 9 AM – 6 PM WAT' },
                    { Icon: Phone,  text: '+234 800 AKORO 00' },
                  ].map(({ Icon, text }) => (
                    <div key={text} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                      <Icon size={16} color={B} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13.5, color: TEXT, lineHeight: 1.55 }}>{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ borderRadius: 16, padding: '22px 24px', background: `linear-gradient(135deg, ${B}0F, ${B}06)`, border: `1px solid ${B}25` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                  <School size={18} color={B} strokeWidth={2} />
                  <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontFamily: "'Nunito', sans-serif" }}>Are you a school?</div>
                </div>
                <p style={{ fontSize: 13.5, color: TEXT, lineHeight: 1.6, marginBottom: 16 }}>We offer pilot programmes, bulk pricing, and dedicated onboarding for institutions. Let's talk.</p>
                <button onClick={() => navigate('/careers')}
                  style={{ background: B, color: '#fff', padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: "'Nunito', sans-serif", boxShadow: `0 2px 8px ${B}40` }}>
                  Book a school demo →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <SiteFooter />
      </div>
    </>
  );
}
