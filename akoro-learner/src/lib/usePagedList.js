/**
 * usePagedList.js — scroll-to-fetch-more, paged (never infinite).
 *
 * The house pattern (Matt, 2026-11-17, first shipped in the reader's
 * per-tool creation lists): a list renders one page at a time; a sentinel
 * at its end reveals/fetches the NEXT page only; a status line always
 * says "Showing N of M — scroll for more" and, at the end, "All M shown".
 *
 * Two modes:
 *  - useCursorList: pages come from the server. fetchPage(cursor) must
 *    resolve to { items, total, nextCursor } (nextCursor null = the end).
 *  - useLocalList: every item is already in hand (bounded lists the
 *    server composes in one call); the hook reveals pageSize at a time.
 *
 * Page sizes are per surface (screen fill ÷ row height, item weight,
 * grid fit): reader creations 10, library records 12, folders 20,
 * discover 12, chat drawer 20, dashboard sections 10.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Observe a sentinel element; call onHit whenever it nears the viewport.
 *  Callback-ref based, so a sentinel mounted late still gets observed. */
export function useSentinel(onHit, active = true) {
  const [node, setNode] = useState(null);
  const ref = useCallback((el) => setNode(el), []);
  const hitRef = useRef(onHit);
  hitRef.current = onHit;
  useEffect(() => {
    if (!node || !active || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) hitRef.current();
    }, { rootMargin: "240px" });
    io.observe(node);
    return () => io.disconnect();
  }, [node, active]);
  return ref;
}

/**
 * Server-paged list. `resetKey` changing restarts from the first page.
 * Returns the accumulated items plus the footer contract.
 */
export function useCursorList({ pageSize, fetchPage, resetKey = "", getId = (x) => x?.id }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const cursorRef = useRef(null);
  const loadingRef = useRef(false);
  const doneRef = useRef(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const loadMore = useCallback(async () => {
    if (loadingRef.current || doneRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await fetchRef.current(cursorRef.current);
      const fresh = page?.items || [];
      setItems((prev) => {
        const seen = new Set(prev.map(getId));
        return [...prev, ...fresh.filter((x) => !seen.has(getId(x)))];
      });
      if (typeof page?.total === "number") setTotal(page.total);
      cursorRef.current = page?.nextCursor || null;
      if (!page?.nextCursor || fresh.length === 0) { doneRef.current = true; setDone(true); }
    } catch {
      // A failed page leaves the list as-is; the sentinel can retry on the
      // next scroll pass (loading clears, done stays false).
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [getId]);

  useEffect(() => {
    cursorRef.current = null;
    doneRef.current = false;
    setItems([]);
    setTotal(null);
    setDone(false);
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const sentinelRef = useSentinel(loadMore, !done);
  const shownTotal = total ?? items.length;
  return {
    items, total: shownTotal, loading, done,
    hasMore: !done,
    loadMore, sentinelRef,
  };
}

/**
 * Locally-paged list: everything is fetched already; reveal pageSize at
 * a time as the sentinel nears. `resetKey` changing restarts the reveal.
 */
export function useLocalList(allItems, pageSize, resetKey = "") {
  const [shown, setShown] = useState(pageSize);
  useEffect(() => { setShown(pageSize); }, [resetKey, pageSize]);
  const total = allItems?.length || 0;
  const visible = (allItems || []).slice(0, shown);
  const hasMore = shown < total;
  const revealMore = useCallback(() => setShown((s) => s + pageSize), [pageSize]);
  const sentinelRef = useSentinel(revealMore, hasMore);
  return { visible, total, shown: visible.length, hasMore, sentinelRef };
}

/**
 * The standard status line under a paged list. Renders nothing when the
 * whole list fits in one page. Style it via `style` / `className`.
 */
export function pagedStatusText({ shown, total, hasMore }) {
  if (total <= 0) return "";
  if (hasMore) return `Showing ${shown} of ${total} — scroll for more`;
  return `All ${total} shown`;
}
