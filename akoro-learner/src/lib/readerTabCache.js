// Reader tab cache — the pills and the Ask tab must be there the instant the
// reader opens, not after /artifacts returns. We store the last known tab
// state per document (same key the reader uses for page/zoom) and hydrate it
// synchronously; the server list then reconciles it (closed/deleted items are
// dropped, fresher content wins).
//
// Cache is best-effort: quota/permission failures are silent and a large tab
// set is skipped rather than risking localStorage pressure.
const PREFIX = "akoro_reader_tabs:";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 400_000;

export function readerTabsKey(readerPosKey) {
  return readerPosKey ? PREFIX + String(readerPosKey) : null;
}

export function loadReaderTabs(readerPosKey) {
  const key = readerTabsKey(readerPosKey);
  if (!key || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (value.at && Date.now() - value.at > MAX_AGE_MS) return null;
    return value;
  } catch { return null; }
}

export function saveReaderTabs(readerPosKey, state) {
  const key = readerTabsKey(readerPosKey);
  if (!key || typeof localStorage === "undefined") return;
  try {
    const json = JSON.stringify({ ...state, at: Date.now() });
    if (json.length > MAX_BYTES) return;   // a huge tool payload is not worth the quota risk
    localStorage.setItem(key, json);
  } catch { /* cache only */ }
}

/** Turn a cached snapshot into initial state, remapping result ids so they
    cannot collide with tabs the server adds a moment later. */
export function hydrateReaderTabs(cached) {
  const tabs = Array.isArray(cached?.resultTabs) ? cached.resultTabs : [];
  const resultTabs = tabs.map((t, i) => ({ ...t, id: `r${i + 1}`, loading: false }));
  const oldActive = cached?.activeTabId;
  let activeTabId = oldActive || "reader";
  const m = /^r(\d+)$/.exec(String(oldActive || ""));
  if (m) {
    const n = Number(m[1]);
    activeTabId = n >= 1 && n <= resultTabs.length ? `r${n}` : "reader";
  }
  return {
    resultTabs,
    nextResultId: resultTabs.length + 1,
    activeTabId,
    communityTabsOpen: Array.isArray(cached?.communityTabsOpen) ? cached.communityTabsOpen : [],
    savedItems: Array.isArray(cached?.savedItems) ? cached.savedItems : [],
  };
}
