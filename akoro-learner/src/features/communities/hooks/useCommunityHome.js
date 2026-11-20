import { useState, useEffect, useCallback } from 'react';
import {
  fetchCommunityStrict, fetchCommunityActivitiesStrict, fetchCommunityItems,
  submitCommunityActivity, joinCommunity, leaveCommunity,
} from '../../../services/communityApi.js';
import { useInFlight } from '../../../hooks/useInFlight.js';
import { useCommunityToast } from '../components/CommunityShell.jsx';
import { classifyError } from '../components/communityActivityMeta.js';

export default function useCommunityHome(communityId) {
  const [community, setCommunity]   = useState(null);
  const [activities, setActivities] = useState([]);
  const [items, setItems]           = useState([]);   // shared materials (the Popular materials rail)
  const [loading, setLoading]       = useState(true);
  const [sheetOpen, setSheetOpen]   = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [submittingId, setSubmittingId] = useState(null);
  const [showToast, toastNode] = useCommunityToast();
  // null = ok/loading; otherwise classifyError's verdict — 'missing' (the
  // API answered "no such community / not yours") falls through to the
  // not-found card below, every other kind gets its honest error card.
  // A degraded connection must never read as "Community not found".
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [c, list, shared] = await Promise.all([
        fetchCommunityStrict(communityId),
        fetchCommunityActivitiesStrict(communityId),
        fetchCommunityItems(communityId),
      ]);
      setCommunity(c);
      setActivities(list);
      setItems(shared);
      setError(null);
    } catch (e) {
      setError(classifyError(e));
    } finally { setLoading(false); }
  }, [communityId]);

  useEffect(() => { load(); }, [load]);
  const retry = () => { setLoading(true); setError(null); load(); };

  // ALL hooks must run before the early returns below — this one used to sit
  // after them, so the moment loading flipped to false the component rendered
  // MORE hooks than its previous pass and React threw ("Rendered more hooks
  // than during the previous render"), killing the page right as data landed.
  // One submission in the air at a time — a double-tapped Submit on a slow
  // connection used to fire the request twice.
  const { busy: submitBusy, run: runSubmit } = useInFlight();
  const submit = (a) => runSubmit(async () => {
    setSubmittingId(a.id);
    try {
      await submitCommunityActivity(a.id);
      setActivities(prev => prev.map(x => x.id === a.id
        ? { ...x, my_submitted: true, submissions_count: (x.submissions_count || 0) + 1 }
        : x));
      showToast('Submission recorded');
    } catch (e) {
      showToast(e?.message || 'Could not submit. Try again.');
    } finally { setSubmittingId(null); }
  });

  /* Follow / Following — wired to the real join + leave endpoints, with an
     optimistic flip that rolls back if the request fails. Owners never see
     the button (they delete the community instead). */
  const { busy: followBusy, run: runFollow } = useInFlight();
  const toggleFollow = () => runFollow(async () => {
    const wasMember = !!community.my_role;
    setCommunity(c => c && ({
      ...c,
      my_role: wasMember ? null : 'member',
      member_count: Math.max(0, (c.member_count || 1) + (wasMember ? -1 : 1)),
    }));
    try {
      if (wasMember) await leaveCommunity(communityId);
      else await joinCommunity(communityId);
    } catch (e) {
      setCommunity(c => c && ({
        ...c,
        my_role: wasMember ? 'member' : null,
        member_count: Math.max(0, (c.member_count || 1) + (wasMember ? 1 : -1)),
      }));
      showToast(e?.message || 'Could not update your membership. Try again.');
    }
  });

  return {
    community, activities, setActivities, items, loading, sheetOpen, setSheetOpen,
    typeFilter, setTypeFilter, submittingId, submitBusy, followBusy, showToast,
    toastNode, error, retry, submit, toggleFollow,
  };
}
