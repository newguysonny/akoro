import { Icon } from '../../../components/common/Icons.jsx';
import { BRAND } from '../../../constants.js';
import { pagedStatusText } from '../../../lib/usePagedList.js';
import { LibraryItem } from './LibraryCards.jsx';
import { getMeta } from './libraryMeta.js';

export default function LibraryContent({
  loading, folders, deletedCount, foldersTotal, foldersSentinelRef, setFolderPage, setDeletedOpen,
  qResults, qBusy, q, openSearchHit, qSentinelRef, qHasMore,
  visibleDisplayed, filter, activeLabel, listTotal, recordsTab, kindLocal, recordsSentinelRef,
  listShown, listHasMore, openAddTarget, openLibraryItem,
}) {
  return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 80px' }}>
        {/* Folders — the shelf's organization layer. Created from the
            Add-to-library sheet; opening one (adding items) comes next. */}
        {!loading && (folders.length > 0 || deletedCount > 0) && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', margin: '0 0 8px', letterSpacing: .3 }}>
              FOLDERS
              {foldersTotal > 20 && (
                <span style={{ letterSpacing: 0, fontWeight: 700 }}> · {pagedStatusText({ shown: folders.length, total: foldersTotal, hasMore: foldersTotal > folders.length })}</span>
              )}
            </p>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
              {folders.map(f => (
                <button key={f.id} onClick={() => setFolderPage(f)}
                  title={f.description || f.name}
                  style={{ flex: '0 0 128px', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: "'Nunito',sans-serif" }}>
                  {f.coverUrl
                    ? <img src={f.coverUrl} alt="" style={{ display: 'block', width: '100%', height: 72, objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: 72, background: `linear-gradient(135deg, ${BRAND}, #4C1DCC)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="ti-folder" size={26} color="rgba(255,255,255,.9)"/>
                      </div>}
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                      <Icon name={f.visibility === 'public' ? 'ti-world' : 'ti-lock'} size={11}/>
                      {f.visibility === 'public' ? 'Public' : 'Private'}
                    </div>
                  </div>
                </button>
              ))}
              {foldersTotal > folders.length && <div ref={foldersSentinelRef} style={{ flex: '0 0 2px' }} />}
              {deletedCount > 0 && (
                <button type="button" data-recently-deleted-tile="" onClick={() => setDeletedOpen(true)} title="Recently deleted"
                  style={{ flex: '0 0 128px', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: "'Nunito',sans-serif" }}>
                  <div style={{ width: '100%', height: 72, background: 'var(--ak-surface-hover)', borderBottom: '1px dashed var(--ak-border2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="ti-trash" size={26} color="var(--ak-text-muted)"/>
                  </div>
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ak-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Recently deleted</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
                      <Icon name="ti-clock" size={11}/> {deletedCount} · 30 days
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        )}
        {qResults !== null ? (
          /* SEARCH RESULTS — chunk hits, best match first. */
          (qBusy && qResults.length === 0) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
            </div>
          ) : qResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 10, color: BRAND }}><Icon name="ti-search" size={40} /></div>
              <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>No matches for “{q.trim()}”</p>
              <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', fontWeight: 600, marginTop: 4 }}>
                Try different words — search looks inside your files, pastes and recordings.
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ak-text-muted)', margin: '0 0 8px', letterSpacing: .3 }}>
                {qResults.length} MATCH{qResults.length === 1 ? '' : 'ES'} · “{q.trim()}”
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {qResults.map((hit, i) => {
                  const meta = hit.chunkKind === 'page' ? `Page ${hit.pageNumber}`
                    : hit.chunkKind === 'transcript' && hit.startMs != null
                      ? `${Math.floor(hit.startMs / 60000)}:${String(Math.floor((hit.startMs % 60000) / 1000)).padStart(2, '0')}`
                      : hit.chunkKind === 'paste' ? 'Pasted text' : 'Title';
                  const emoji = hit.kind === 'link' ? 'ti-link' : hit.kind === 'paste' ? 'ti-clipboard' : 'ti-paperclip';
                  return (
                    <button key={`${hit.recordId}-${i}`} onClick={() => openSearchHit(hit)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '11px 13px',
                        borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={emoji} size={18} color={BRAND} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hit.name}</p>
                          <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, color: BRAND, background: `${BRAND}14`, padding: '2px 7px', borderRadius: 100 }}>{meta}</span>
                        </div>
                        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: '2px 0 0', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{hit.snippet}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {qResults.length >= 12 && (
                <div ref={qSentinelRef} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', padding: '12px 0 4px' }}>
                  {qBusy ? 'Fetching more…' : qHasMore ? `Showing ${qResults.length} — scroll for more` : `All ${qResults.length} shown`}
                </div>
              )}
            </>
          )
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3,4].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : visibleDisplayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: filter === 'records' ? BRAND : getMeta(filter).color }}>
              <Icon name={filter === 'records' ? 'ti-file-text' : getMeta(filter).icon} size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
              {filter === 'all' ? 'Nothing saved yet' : `No ${activeLabel.toLowerCase()} yet`}
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {visibleDisplayed.map(a => <LibraryItem key={a.id} item={a} onMore={openAddTarget} onOpen={openLibraryItem} />)}
            </div>
            {listTotal > 12 && (
              <div ref={recordsTab ? recordsSentinelRef : kindLocal.sentinelRef}
                style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)', padding: '14px 0 4px' }}>
                {pagedStatusText({ shown: listShown, total: listTotal, hasMore: listHasMore })}
              </div>
            )}
          </>
        )}
      </div>
  );
}
