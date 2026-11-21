import { createPortal } from 'react-dom';
import { Icon, XIcon } from '../../../components/common/Icons.jsx';
import { BRAND, STUDENT_ID } from '../../../constants.js';
import AddRecordModal from '../../../components/dashboard/AddRecordModal.jsx';
import CreateFolderSheet from '../../../components/library/CreateFolderSheet.jsx';
import AddToFolderPage from '../../../components/library/AddToFolderPage.jsx';
import AddToTargetSheet from '../../../components/library/AddToTargetSheet.jsx';
import { AddToCommunityPage } from '../../communities/index.js';
import NowStudyingBar from '../../../components/dashboard/NowStudyingBar.jsx';
import { listFolders, renameRecord, deleteRecord } from '../../../services/recordsApi.js';
import LibraryFolderPage from './LibraryFolderPage.jsx';
import FolderReaderSession from './FolderReaderSession.jsx';
import RecentlyDeletedPage from './RecentlyDeletedPage.jsx';
import RecordTeachSession from './RecordTeachSession.jsx';

export default function LibraryModals({
  toast, addOpen, setAddOpen, setSheetOpen, setFolderSheetOpen, higherEd, navigate,
  sheetOpen, openRecord, setRecords,
  folderSheetOpen, setFolders, setFoldersTotal, setToast,
  deletedOpen, closeDeleted, setDeletedCount,
  folderPage, setFolderPage, openFolderItem, setFolderReader, now, openNowFromLibrary, nowActs,
  addTarget, setAddTarget, setAddToFolder, setAddToCommunity, records, load, replaceFolders,
  addToFolder, addToCommunity, folderReader,
  viewer, viewerChat, viewerTool, viewerArtifact, setViewer, setViewerTool, setViewerArtifact,
  handleRecordOpened, handleRecordProgress,
}) {
  return (
    <>
      {/* Bottom toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}

      {/* + choice — upload or write a blog */}
      {addOpen && (
        <><div onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2400, background: 'rgba(6,6,18,.55)', backdropFilter: 'blur(5px)' }} />
        <div role="dialog" aria-label="Add to library" style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 2500, width: 'min(92vw,360px)', background: 'var(--ak-surface)', borderRadius: 20, border: '1px solid var(--ak-border)', padding: '18px 16px 14px', fontFamily: "'Nunito',sans-serif", animation: 'drawer-in .22s cubic-bezier(.32,1,.64,1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Add to library</p>
            <button onClick={() => setAddOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}><XIcon size={16} color="var(--ak-text-muted)" /></button>
          </div>
          <button onClick={() => { setAddOpen(false); setSheetOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)', cursor: 'pointer', textAlign: 'left', marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: `${BRAND}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-paperclip" size={19} color={BRAND} /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Upload a record</p>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Files, links or pasted text</p>
            </div>
          </button>
          <button onClick={() => { setAddOpen(false); setFolderSheetOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)', cursor: 'pointer', textAlign: 'left', marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#F59E0B14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-folder" size={19} color="#F59E0B" /></div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Create a folder</p>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Name, cover, description, visibility</p>
            </div>
          </button>
          {higherEd && (
            <button onClick={() => { setAddOpen(false); navigate('/write/blog/new'); }} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 13px', borderRadius: 14, border: '1px solid var(--ak-border)', background: 'var(--ak-surface-hover)', cursor: 'pointer', textAlign: 'left', fontFamily: "'Nunito',sans-serif" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: '#0EA5E914', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="ti-news" size={19} color="#0EA5E9" /></div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', margin: 0 }}>Write a blog</p>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ak-text-muted)', margin: 0 }}>Draft or publish an article on your shelf</p>
              </div>
            </button>
          )}
        </div></>
      )}

      {/* Add-record sheet — upload / link / paste, for every learner */}
      <AddRecordModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        user={{ id: STUDENT_ID }}
        onOpenRecord={openRecord}
        onRecordsChanged={setRecords}
      />

      {/* Create-folder sheet — name, cover, description, visibility */}
      <CreateFolderSheet
        open={folderSheetOpen}
        onClose={() => setFolderSheetOpen(false)}
        onCreated={(f) => { setFolders((fs) => [f, ...fs]); setFoldersTotal((n) => n + 1); setToast(`Folder “${f.name}” created`); }}
      />

      {deletedOpen && <RecentlyDeletedPage onClose={closeDeleted} onChanged={setDeletedCount} onToast={setToast}/>}

      {/* A folder opened full-screen — the Pharm.D folder UI, with
          rename + delete in its more sheet. */}
      {folderPage && (
        <LibraryFolderPage
          folder={folderPage}
          onClose={() => setFolderPage(null)}
          onOpenItem={openFolderItem}
          onOpenInReader={() => setFolderReader(folderPage)}
          nowItem={now.item}
          onNowOpen={openNowFromLibrary}
          onNowDismiss={nowActs.dismiss}
          onRenamed={(f) => { setFolders((fs) => fs.map((x) => (x.id === f.id ? f : x))); setFolderPage(f); }}
          onDeleted={(id) => { setFolders((fs) => fs.filter((x) => x.id !== id)); setFolderPage(null); setToast('Folder deleted'); }}
        />
      )}

      {/* ⋯ on any shelf row — folder or community. */}
      {addTarget && (
        <AddToTargetSheet
          item={addTarget}
          onClose={() => setAddTarget(null)}
          onPickFolder={(snap) => { setAddToFolder(snap); setAddTarget(null); }}
          onPickCommunity={(snap) => { setAddToCommunity(snap); setAddTarget(null); }}
          onAgentSession={(item) => {
            const r = (records || []).find((x) => String(x.id) === item.itemRef);
            if (r) openRecord(r, 'agent');
          }}
          onRename={async (item, name) => {
            await renameRecord(item.itemRef, { name });
            setToast('File renamed');
            await load();
          }}
          onDelete={async (item) => {
            await deleteRecord(item.itemRef);
            setToast('File deleted');
            await load();
          }}
        />
      )}
      {addToFolder && (
        <AddToFolderPage
          item={addToFolder}
          onClose={() => setAddToFolder(null)}
          onAdded={() => { listFolders().then(replaceFolders).catch(() => {}); }}
        />
      )}
      {addToCommunity && (
        <AddToCommunityPage
          item={addToCommunity}
          onClose={() => setAddToCommunity(null)}
        />
      )}

      {/* A folder opened in the content reader — contents grid, then the
          picked document with the folder's contents row. */}
      {folderReader && (
        <FolderReaderSession folder={folderReader} records={records} onClose={() => setFolderReader(null)}/>
      )}

      {/* The record as a TEACHING session — the learner teaches their agent
          over the real file; the content box opens it in the reader. */}
      {viewer && (
        <RecordTeachSession
          record={viewer}
          chatState={viewerChat}
          openTool={viewerTool}
          openArtifact={viewerArtifact}
          onClose={() => { setViewer(null); setViewerTool(null); setViewerArtifact(null); }}
          onMinimize={() => { setViewer(null); setViewerTool(null); setViewerArtifact(null); }}
          onOpened={handleRecordOpened}
          onProgress={handleRecordProgress}
        />
      )}

      {/* The Now-Studying bar, mobile — the tablet bar comes with AppShell.
          This page has no bottom nav of its own, so the bar rides the
          screen's bottom edge (the scoped style re-anchors it). */}
      {higherEd && now.item && !now.dismissed && !viewer && !folderPage && !addToFolder && !addToCommunity && !addTarget && createPortal(
        <div className="ak-lib-nowbar">
          <style>{`@media (min-width:769px){.ak-lib-nowbar{display:none}}.ak-lib-nowbar .ak-now-bar{bottom:env(safe-area-inset-bottom,0px)}`}</style>
          <NowStudyingBar item={now.item} onOpen={openNowFromLibrary} onAdd={() => setSheetOpen(true)} onDismiss={nowActs.dismiss}/>
        </div>, document.body)}
    </>
  );
}
