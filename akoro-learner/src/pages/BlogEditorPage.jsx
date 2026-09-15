/**
 * BlogEditorPage — the learner blog page (higherEd library).
 *
 * Opened from the Library page's + menu ("Write a blog") or by tapping one
 * of your blogs on the shelf. The body is the platform's markdown-subset —
 * the SAME subset the agent chat renders — written in a plain textarea with
 * a marker toolbar and rendered for preview through the shared RichText
 * path. No HTML exists anywhere in this pipeline, so nothing can inject
 * markup. Save draft keeps it on your shelf; Publish stamps it published.
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BRAND, GOLD, GREEN, RED } from '../constants.js';
import { Icon } from '../components/common/Icons.jsx';
import RichText from '../components/common/RichText.jsx';
import Spinner from '../components/common/Spinner.jsx';
import { useInFlight } from '../hooks/useInFlight.js';
import { confirmDialog } from '../components/common/ConfirmHost.jsx';
import { fetchBlog, createBlog, updateBlog, deleteBlog, BLOG_TITLE_MAX } from '../services/blogApi.js';

/* Toolbar actions: markdown-subset markers, applied around the selection. */
const TOOLS = [
  { key: 'bold',   label: 'B',        title: 'Bold',        before: '**', after: '**' },
  { key: 'italic', label: 'I',        title: 'Italic',      before: '*',  after: '*'  },
  { key: 'h2',     label: 'H2',       title: 'Heading',     before: '## ', after: '' },
  { key: 'h3',     label: 'H3',       title: 'Subheading',  before: '### ', after: '' },
  { key: 'ul',     label: '• List',   title: 'Bullet list', before: '- ',  after: '' },
  { key: 'ol',     label: '1. List',  title: 'Numbered list', before: '1. ', after: '' },
  { key: 'quote',  label: '❝',        title: 'Quote',       before: '> ',  after: '' },
  { key: 'code',   label: '</>',      title: 'Code',        before: '`',   after: '`' },
];

export default function BlogEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();                      // undefined → new post
  const areaRef = useRef(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState('write');       // write | preview
  const [loading, setLoading] = useState(Boolean(id));
  const [notMine, setNotMine] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState('draft');   // loaded post's state
  const saveRun = useInFlight();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetchBlog(id).then((d) => {
      const post = d?.data ?? d;
      if (!live) return;
      if (!post?.id || post.mine === false) { setNotMine(true); setLoading(false); return; }
      setTitle(post.title || '');
      setBody(post.body || '');
      setStatus(post.status || 'draft');
      setLoading(false);
    }).catch(() => { if (live) { setNotMine(true); setLoading(false); } });
    return () => { live = false; };
  }, [id]);

  /* Wrap/insert the tool's markers around the textarea selection. */
  const applyTool = (tool) => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const needsBlank = /h2|h3|ul|ol|quote/.test(tool.key);
    const lead = needsBlank && start > 0 && body[start - 1] !== '\n' ? '\n' : '';
    // paired markers wrap the selection (empty pair when nothing selected);
    // prefix markers (headings, lists, quote) just insert their prefix.
    const next = body.slice(0, start) + lead + tool.before + selected + tool.after + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const selStart = start + lead.length + tool.before.length;
      el.setSelectionRange(selStart, selStart + selected.length);
    });
  };

  const publishable = title.trim().length > 0 && body.trim().length > 0;

  const saveDraft = () => saveRun.run(async () => {
    setErr('');
    if (!title.trim()) { setErr('Give the blog a title first.'); return; }
    try {
      if (id) { await updateBlog(id, { title: title.trim(), body, status: status === 'published' ? 'published' : 'draft' }); }
      else { await createBlog({ title: title.trim(), body, status: 'draft' }); }
      setToast('Draft saved to your shelf');
      setTimeout(() => navigate('/library', { replace: true }), 700);
    } catch (e) { setErr(e?.message || "Couldn't save the draft."); }
  });

  const publish = () => saveRun.run(async () => {
    setErr('');
    if (!title.trim()) { setErr('Give the blog a title first.'); return; }
    if (!publishable) { setErr('Write something before publishing — save it as a draft to finish later.'); return; }
    try {
      if (id) { await updateBlog(id, { title: title.trim(), body, status: 'published' }); }
      else { await createBlog({ title: title.trim(), body, status: 'published' }); }
      setToast('Published');
      setTimeout(() => navigate('/library', { replace: true }), 700);
    } catch (e) { setErr(e?.message || "Couldn't publish the blog."); }
  });

  const remove = async () => {
    if (!id) return;
    const yes = await confirmDialog({
      title: 'Delete this blog?',
      message: `"${title.slice(0, 60)}" will be removed from your shelf for good.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    saveRun.run(async () => {
      try { await deleteBlog(id); navigate('/library', { replace: true }); }
      catch (e) { setErr(e?.message || "Couldn't delete the blog."); }
    });
  };

  const chip = (active) => ({
    padding: '5px 14px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 11.5, fontWeight: active ? 800 : 600,
    background: active ? BRAND : 'transparent', color: active ? '#fff' : 'var(--ak-text-muted)',
  });
  const actionBtn = (primary) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 100,
    border: primary ? 'none' : '1.5px solid var(--ak-border2)',
    background: primary ? `linear-gradient(135deg,${BRAND},#4C1DCC)` : 'transparent',
    color: primary ? '#fff' : 'var(--ak-text)', fontSize: 11.5, fontWeight: 800,
    cursor: saveRun.busy ? 'wait' : 'pointer', fontFamily: "'Nunito',sans-serif", flexShrink: 0,
  });

  if (loading) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif" }}>
        <Spinner size={22} />
      </div>
    );
  }
  if (notMine) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--ak-bg)', fontFamily: "'Nunito',sans-serif", padding: 24 }}>
        <Icon name="ti-lock" size={34} color="var(--ak-text-muted)" />
        <p style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>This blog can't be opened in the editor.</p>
        <button onClick={() => navigate('/library')} style={{ padding: '8px 18px', borderRadius: 100, border: 'none', background: BRAND, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>Back to Library</button>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 100, flexShrink: 0 }}>
        <button onClick={() => navigate('/library')} aria-label="Back to Library"
          style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 32, height: 32, cursor: 'pointer', color: BRAND, fontSize: 15, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {id ? 'Edit blog' : 'Write a blog'}
          </p>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: status === 'published' ? GREEN : GOLD, margin: 0, textTransform: 'uppercase', letterSpacing: .4 }}>
            {status === 'published' ? 'Published' : 'Draft'}
          </p>
        </div>
        {id && (
          <button onClick={remove} disabled={saveRun.busy} aria-label="Delete blog" title="Delete blog"
            style={{ width: 32, height: 32, borderRadius: 100, border: '1px solid rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', color: RED, cursor: saveRun.busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="ti-trash" size={14} />
          </button>
        )}
        <button onClick={saveDraft} disabled={saveRun.busy} style={actionBtn(false)}>
          {saveRun.busy ? <Spinner size={11} /> : <Icon name="ti-device-floppy" size={13} />}Save draft
        </button>
        <button onClick={publish} disabled={saveRun.busy} style={actionBtn(true)}>
          {saveRun.busy ? <Spinner size={11} color="#fff" /> : <Icon name="ti-world-upload" size={13} />}Publish
        </button>
      </div>

      {/* EDITOR */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 90px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760, width: '100%', margin: '0 auto' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={BLOG_TITLE_MAX}
          placeholder="Blog title" aria-label="Blog title"
          style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 17, fontWeight: 900, fontFamily: "'Nunito',sans-serif", outline: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 100, padding: 3 }}>
            <button style={chip(mode === 'write')} onClick={() => setMode('write')}>Write</button>
            <button style={chip(mode === 'preview')} onClick={() => setMode('preview')}>Preview</button>
          </div>
          {mode === 'write' && TOOLS.map((tool) => (
            <button key={tool.key} onClick={() => applyTool(tool)} title={tool.title} aria-label={tool.title}
              style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              {tool.label}
            </button>
          ))}
        </div>

        {mode === 'write' ? (
          <textarea ref={areaRef} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={'Write your blog…\n\nTip: use the toolbar for headings, lists and quotes — the same formatting the agent chat uses.'}
            aria-label="Blog body"
            style={{ width: '100%', minHeight: '46vh', padding: '14px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text)', fontSize: 14.5, lineHeight: 1.7, fontWeight: 500, fontFamily: "'Nunito',sans-serif", outline: 'none', resize: 'vertical' }} />
        ) : (
          <div style={{ padding: '6px 4px', color: 'var(--ak-text)' }}>
            {body.trim()
              ? <RichText text={body} />
              : <p style={{ fontSize: 13, color: 'var(--ak-text-muted)', fontWeight: 700 }}>Nothing to preview yet — write something first.</p>}
          </div>
        )}

        {err && (
          <div style={{ padding: '9px 12px', borderRadius: 12, background: 'rgba(239,68,68,.10)', border: `1px solid ${RED}35`, fontSize: 11.5, fontWeight: 700, color: RED }}>
            {err}
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
