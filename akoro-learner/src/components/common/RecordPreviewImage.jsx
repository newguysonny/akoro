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

const cache = new Map();     // record id -> object URL
const inFlight = new Map(); // record id -> Promise (rails render the same record more than once)

export default function RecordPreviewImage({ id, alt = '', style, fallback = null, onFail }) {
  const [url, setUrl] = useState(() => cache.get(id) || null);

  useEffect(() => {
    if (cache.has(id)) { setUrl(cache.get(id)); return undefined; }
    let alive = true;
    let request = inFlight.get(id);
    if (!request) {
      request = (async () => {
        const res = await fetch(`${API}/api/records/${id}/preview`, { credentials: 'include', headers: { 'X-Akoro-Portal': 'student' } });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        cache.set(id, objectUrl);
        return objectUrl;
      })().finally(() => inFlight.delete(id));
      inFlight.set(id, request);
    }
    request.then((objectUrl) => { if (alive) setUrl(objectUrl); })
      .catch((err) => { if (alive) { setUrl(null); onFail?.(err); } });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!url) return fallback;
  return <img src={url} alt={alt} loading="lazy" style={style}/>;
}
