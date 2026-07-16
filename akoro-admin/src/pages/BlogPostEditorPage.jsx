import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Toast, Inp, Txa, Sel, Skeleton } from '../components/Primitives.jsx';
import MarkdownEditor, { blocksToMarkdown, markdownToBlocks } from '../components/MarkdownEditor.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { apiPatch } from '../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, FONT } from '../constants.js';

const CATS = ['Learning Science', 'Product', 'Education', 'AI & Future', 'Case Studies'];
const STATUSES = ['draft', 'published', 'archived'];

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

export default function BlogPostEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const api = useAdminAPI();
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [form, setForm] = useState({
    title: '', slug: '', excerpt: '', category: CATS[0], author: '', author_role: '',
    read_min: 5, image: '', featured: false, status: 'draft',
  });
  const [markdown, setMarkdown] = useState('');

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };
  const setField = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  useEffect(() => {
    if (isNew) return;
    api.getBlogPosts().then(posts => {
      const post = posts.find(p => p.id === id);
      if (!post) { showToast('Post not found', 'error'); navigate('/content/blog'); return; }
      setForm({ title: post.title || '', slug: post.slug || '', excerpt: post.excerpt || '', category: post.category || CATS[0], author: post.author || '', author_role: post.author_role || '', read_min: post.read_min || 5, image: post.image || '', featured: !!post.featured, status: post.status || 'draft' });
      setMarkdown(blocksToMarkdown(post.body || []));
    }).catch(() => showToast('Failed to load post', 'error')).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!form.title) return showToast('Title is required', 'error');
    setSaving(true);
    const payload = { ...form, read_min: parseInt(form.read_min) || 5, body: markdownToBlocks(markdown) };
    if (!payload.slug) payload.slug = slugify(form.title);
    try {
      if (isNew) { await api.createBlogPost(payload); showToast('Post created'); navigate('/content/blog'); }
      else { await api.updateBlogPost(id, payload); showToast('Post saved'); }
    } catch (e) { showToast(e.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <PageLayout title="Blog Editor"><Skeleton height={400} /></PageLayout>;

  const card = { background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, padding: 24, marginBottom: 20 };
  const label = { fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6, display: 'block' };

  return (
    <PageLayout
      title={isNew ? 'New Post' : 'Edit Post'}
      subtitle={isNew ? 'Create a new blog article' : form.title}
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={() => navigate('/content/blog')}><ArrowLeft size={14} /> Back</Btn>
          <Btn onClick={handleSave} disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save'}</Btn>
        </div>
      }>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        {/* Main */}
        <div>
          <div style={card}>
            <Inp label="Title *" value={form.title} onChange={e => { setField('title')(e); if (isNew) setForm(f => ({ ...f, slug: slugify(e.target.value) })); }} placeholder="Article title" />
            <Inp label="Slug" value={form.slug} onChange={setField('slug')} placeholder="url-slug" style={{ marginTop: 14 }} />
            <div style={{ marginTop: 14 }}>
              <label style={label}>Excerpt</label>
              <Txa value={form.excerpt} onChange={setField('excerpt')} rows={3} placeholder="Short description shown on the blog listing page" />
            </div>
          </div>

          {/* Body — rich markdown editor */}
          <div style={card}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>Article Body</span>
            </div>
            <MarkdownEditor value={markdown} onChange={setMarkdown} />
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <div style={card}>
            <label style={label}>Status</label>
            <Sel value={form.status} onChange={setField('status')} style={{ marginBottom: 14 }}>
              {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </Sel>
            <label style={label}>Category</label>
            <Sel value={form.category} onChange={setField('category')} style={{ marginBottom: 14 }}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </Sel>
            <Inp label="Author" value={form.author} onChange={setField('author')} style={{ marginBottom: 14 }} />
            <Inp label="Author Role" value={form.author_role} onChange={setField('author_role')} style={{ marginBottom: 14 }} />
            <Inp label="Read time (minutes)" type="number" value={form.read_min} onChange={setField('read_min')} style={{ marginBottom: 14 }} />
            <Inp label="Cover image URL" value={form.image} onChange={setField('image')} placeholder="https://…" style={{ marginBottom: 14 }} />
            {form.image && <img src={form.image} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 14 }} />}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: INK }}>
              <input type="checkbox" checked={form.featured} onChange={setField('featured')} />
              Featured article
            </label>
          </div>
          <Btn onClick={handleSave} disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save post'}
          </Btn>
        </div>
      </div>
    </PageLayout>
  );
}
