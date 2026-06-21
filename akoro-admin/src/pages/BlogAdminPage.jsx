import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Edit2, Trash2, Star } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Toast, Skeleton } from '../components/Primitives.jsx';
import useAdminAPI from '../hooks/useAdminAPI.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, RED, FONT } from '../constants.js';

const STATUS_STYLE = {
  published: { bg: '#DCFCE7', color: '#166534' },
  draft:     { bg: '#FEF9C3', color: '#854D0E' },
  archived:  { bg: '#F3F4F6', color: '#6B7280' },
};

export default function BlogAdminPage() {
  const api = useAdminAPI();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteModal, setDeleteModal] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try { setPosts(await api.getBlogPosts()); }
    catch { showToast('Failed to load posts', 'error'); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    try { await api.deleteBlogPost(deleteModal.id); showToast('Post deleted'); load(); }
    catch { showToast('Failed to delete post', 'error'); }
    setDeleteModal(null);
  };

  const toggleFeatured = async (post) => {
    try { await api.updateBlogPost(post.id, { featured: !post.featured }); showToast(post.featured ? 'Removed from featured' : 'Set as featured'); load(); }
    catch { showToast('Failed to update', 'error'); }
  };

  const TH = { padding: '10px 16px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: LIGHT, borderBottom: `1px solid ${BORDER}` };
  const TD = { padding: '14px 16px', fontSize: 13.5, color: INK, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle' };

  return (
    <PageLayout title="Blog" subtitle="Manage blog posts and content"
      action={<Btn onClick={() => navigate('/content/blog/new')}><Plus size={15} /> New Post</Btn>}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ background: WHITE, borderRadius: 16, border: `1px solid ${BORDER}`, overflow: 'hidden', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>{['Image', 'Title', 'Category', 'Status', 'Author', 'Published', 'Actions'].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={7} style={TD}><Skeleton height={20} /></td></tr>
            )) : posts.length === 0 ? (
              <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: MUTED, padding: '40px' }}>No posts yet. <button onClick={() => navigate('/content/blog/new')} style={{ color: AMBER, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Create one →</button></td></tr>
            ) : posts.map(post => {
              const s = STATUS_STYLE[post.status] || STATUS_STYLE.draft;
              return (
                <tr key={post.id} onMouseEnter={e => e.currentTarget.style.background = LIGHT} onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <td style={TD}>
                    {post.image ? <img src={post.image} alt="" style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ width: 60, height: 40, borderRadius: 6, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={16} color={MUTED} /></div>}
                  </td>
                  <td style={TD}><span style={{ fontWeight: 600 }}>{post.title}</span></td>
                  <td style={{ ...TD, color: MUTED }}>{post.category}</td>
                  <td style={TD}><span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: s.bg, color: s.color }}>{post.status}</span></td>
                  <td style={{ ...TD, color: MUTED }}>{post.author}</td>
                  <td style={{ ...TD, color: MUTED }}>{post.published_at ? new Date(post.published_at).toLocaleDateString() : '—'}</td>
                  <td style={TD}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn variant="ghost" size="sm" onClick={() => toggleFeatured(post)} style={{ color: post.featured ? AMBER : MUTED }}><Star size={14} fill={post.featured ? AMBER : 'none'} /></Btn>
                      <Btn variant="ghost" size="sm" onClick={() => navigate(`/content/blog/${post.id}`)}><Edit2 size={14} /></Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setDeleteModal({ id: post.id, title: post.title })} style={{ color: RED }}><Trash2 size={14} /></Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!deleteModal} onClose={() => setDeleteModal(null)} title="Delete Post">
        <p style={{ color: MUTED, fontSize: 14, marginBottom: 20 }}>Delete "<strong>{deleteModal?.title}</strong>"? This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Btn>
          <Btn variant="danger" onClick={handleDelete}>Delete</Btn>
        </div>
      </Modal>
    </PageLayout>
  );
}
