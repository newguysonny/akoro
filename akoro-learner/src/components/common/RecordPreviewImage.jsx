/**
 * RecordPreviewImage — the stored page-1 image for a record.
 *
 * A plain <img src="…/preview"> does NOT carry the session cookie on a
 * cross-origin subresource request (SameSite), so the API answered 401 and the
 * card fell back to a blank tile. Fetch it with credentials, turn it into an
 * object URL and render that; cache the URL per record for the session.
 */
import { useEffect, useState } from 'react';
import { API } from '../../services/api.js';

const cache = new Map();   // record id -> object URL

export default function RecordPreviewImage({ id, alt = '', style, onFail }) {
  const [url, setUrl] = useState(() => cache.get(id) || null);

  useEffect(() => {
    if (cache.has(id)) { setUrl(cache.get(id)); return undefined; }
    let alive = true;
    let objectUrl = null;
    (async () => {
      try {
        const res = await fetch(`${API}/api/records/${id}/preview`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'student' } });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        cache.set(id, objectUrl);
        if (alive) setUrl(objectUrl);
      } catch {
        if (alive) onFail?.();
      }
    })();
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!url) return null;
  return <img src={url} alt={alt} loading="lazy" style={style}/>;
}
