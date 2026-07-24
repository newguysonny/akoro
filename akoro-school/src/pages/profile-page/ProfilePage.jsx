/**
 * ProfilePage — composes the components from ./parts.jsx.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { PageLayout } from '../../components/Layout.jsx';
import {
  User, AtSign, Mail, Phone, MapPin, Building2, GraduationCap, BookOpen,
  Pencil, Upload, Search, Bolt, Star, BarChart3, Palette,
  Tag, Sparkles, Store, CheckCircle2, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  getProfile, patchProfile, patchAgent,
  publishAgentToMarketplace, unpublishListing,
  loadListingId, saveListingId,
} from '../../services/settingsApi.js';
import { apiGet, apiPut } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, FONT } from '../../constants.js';

import { BRAND, FONTF, ALL_SUBJECTS, SCHOOL_TYPES, COUNTRIES, EMOJI_LIST, ACCENTS, ProgressBar, SubjectChip, Section, rowBase, Row, AvatarCircle, Sheet, SheetButtons, AvatarPickerSheet, SubjectsSheet, GenericSheet, PublishSheet, SubjectsRow, TPL_TOOLS, ToolTemplatesSection, ProfileTab, AgentTab, LoadingSkeleton } from './parts.jsx';

export default function ProfilePage() {
  const { user } = useAuth();
  const [tab,       setTab]       = useState('profile');
  const [profile,   setProfile]   = useState(null);
  const [agent,     setAgent]     = useState(null);
  const [stats,     setStats]     = useState({});
  const [listingId, setListingId] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };

  useEffect(() => {
    if (user?.id) setListingId(loadListingId(user.id));

    getProfile()
      .then((res) => {
        const d = res?.data ?? res ?? {};
        const a = d.agent ?? {};
        setProfile({
          id: d.id, email: d.email, username: d.username || d.email?.split('@')[0],
          fullName: d.full_name || d.fullName, avatarUrl: d.avatar_url, avatarEmoji: '👩🏾‍🏫',
          bio: d.bio, phone: d.phone, country: d.country, school: d.school_name,
          schoolType: d.school_type, subjects: d.subjects || [],
          accentColor: d.accent_color || BRAND,
        });
        setAgent({
          name: a.agent_name || 'My Agent', emoji: a.agent_emoji || '🤖', photoUrl: null,
          color: BRAND, personality: a.personality || '',
          level: a.level || 1, xpEarned: a.xp || 0, streakDays: a.streak_days || 0,
        });
      })
      .catch(() => {
        setProfile({
          id: user?.id, email: user?.email,
          username: user?.username || user?.email?.split('@')[0],
          fullName: user?.fullName, avatarEmoji: '👩🏾‍🏫', subjects: [], accentColor: BRAND,
        });
        setAgent({ name: 'My Agent', emoji: '🤖', color: BRAND, personality: '', level: 1, xpEarned: 0, streakDays: 0 });
        showToast('Offline — showing cached data');
      })
      .finally(() => setLoading(false));

    fetch(`${import.meta.env.VITE_API_URL || 'https://akoro.app'}/api/instructor/stats`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'school' } })
      .then((r) => r.json()).then((res) => setStats(res?.data ?? {})).catch(() => {});
  }, [user]);

  const saveProfileField = useCallback(async (field, val) => {
    setProfile((p) => ({ ...p, [field]: val }));
    const map = {
      fullName: 'full_name', username: 'username', phone: 'phone', bio: 'bio',
      avatarUrl: 'avatar_url', country: 'country', school: 'school_name',
      schoolType: 'school_type', subjects: 'subjects',
    };
    const apiKey = map[field];
    if (!apiKey) { showToast('Saved ✓'); return; }
    try { await patchProfile({ [apiKey]: val }); showToast('Saved ✓'); }
    catch (e) { showToast(e.message?.includes('username') ? 'Username already taken' : 'Failed to save'); }
  }, []);

  const saveAgent = useCallback(async (patch) => {
    try { await patchAgent(patch); showToast('Saved ✓'); }
    catch { showToast('Failed to save'); }
  }, []);

  const handlePublish = useCallback(async ({ title, subject, description, priceKobo }) => {
    try {
      const res = await publishAgentToMarketplace({
        teacherId: user?.id, agentId: agent?.agentId || user?.id,
        title, subject, description, priceKobo,
        teacherName: profile?.fullName, teacherAvatar: agent?.emoji,
        topicsCovered: profile?.subjects || [],
      });
      if (res?.success && res?.listing?.id) {
        setListingId(res.listing.id);
        saveListingId(user.id, res.listing.id);
        showToast('Published to marketplace ✓');
        return true;
      }
      showToast(res?.error || 'Could not publish');
      return false;
    } catch (e) { showToast('Publish failed: ' + e.message); return false; }
  }, [user, agent, profile]);

  const handleUnpublish = useCallback(async () => {
    if (!listingId) return;
    try {
      const res = await unpublishListing(listingId, user?.id);
      if (res?.success) { setListingId(null); saveListingId(user.id, null); showToast('Removed from marketplace'); }
      else showToast(res?.error || 'Could not unpublish');
    } catch (e) { showToast('Unpublish failed: ' + e.message); }
  }, [listingId, user]);

  const color = profile?.accentColor || BRAND;

  return (
    <PageLayout title="Profile" subtitle="Manage your info and AI agent">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', background: '#fff', borderRadius: 12, padding: 4, marginBottom: 24, border: `1px solid ${BORDER}`, gap: 4 }}>
          {[['profile', '👤 Profile'], ['agent', `${agent?.emoji || '🤖'} Agent`]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '9px 0', borderRadius: 9, border: 'none',
              background: tab === t ? BRAND : 'transparent',
              color: tab === t ? '#fff' : MUTED2,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONTF, transition: 'all .2s',
            }}>{label}</button>
          ))}
        </div>

        {loading || !profile ? <LoadingSkeleton /> : (
          tab === 'profile'
            ? <ProfileTab profile={profile} setProfile={setProfile} stats={stats} onSaveField={saveProfileField} />
            : <AgentTab agent={agent} setAgent={setAgent} profile={profile} onSaveAgent={saveAgent} onPublish={handlePublish} onUnpublish={handleUnpublish} listingId={listingId} />
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}

