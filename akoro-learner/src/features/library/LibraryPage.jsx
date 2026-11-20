import { useEffect } from 'react';
import { AppShell } from '../../components/AppShell.jsx';
import { useLibraryData } from './hooks/useLibraryData.js';
import LibraryHeader from './components/LibraryHeader.jsx';
import LibraryContent from './components/LibraryContent.jsx';
import LibraryModals from './components/LibraryModals.jsx';
import LibraryFolderPage from './components/LibraryFolderPage.jsx';
import FolderReaderSession from './components/FolderReaderSession.jsx';
import RecentlyDeletedPage from './components/RecentlyDeletedPage.jsx';

export default function LibraryPage() {
  const lib = useLibraryData();

  /* Warm the PDF reader in the background: pdf.js is its own chunk (and the
     parse is the slowest part of opening a document), so a learner who taps a
     PDF after this page has settled skips that load. Idle-only; failure is
     silent because the real open reports its own error. */
  useEffect(() => {
    const warm = () => { import('../../components/library/PdfPages.jsx').catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 1200);
    return () => clearTimeout(t);
  }, []);
  const {
    now, nowActs, records, setFolders, folderPage, setFolderPage, folderReader, setFolderReader,
    deletedOpen, setDeletedCount, closeDeleted, setToast, isMobile,
    openFolderItem, openNowFromLibrary,
  } = lib;

  const shellNowStudying = { ...now, onOpen: openNowFromLibrary, onAdd: () => lib.setSheetOpen(true), onDismiss: nowActs.dismiss };

  /* A folder open on tablet/desktop renders IN THE SHELL: the folder page
     becomes the page body — sidebar visible, the shell's tablet now-bar
     on the bottom edge — instead of the floating phone-column overlay.
     Mobile (≤768px) keeps the fixed overlay exactly as before. */
  if (deletedOpen && !isMobile) {
    return (
      <AppShell nowStudying={shellNowStudying}>
        <RecentlyDeletedPage shellMode onClose={closeDeleted} onChanged={setDeletedCount} onToast={setToast}/>
        {lib.toast && (
          <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: 'var(--ak-text)', color: '#fff', fontSize: 12.5, fontWeight: 800, padding: '9px 18px', borderRadius: 100, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
            {lib.toast}
          </div>
        )}
      </AppShell>
    );
  }
  if (folderPage && !isMobile) {
    return (
      <AppShell nowStudying={shellNowStudying}>
        <LibraryFolderPage
          folder={folderPage}
          shellMode
          onClose={() => setFolderPage(null)}
          onOpenItem={openFolderItem}
          onOpenInReader={() => setFolderReader(folderPage)}
          onRenamed={(f) => { setFolders((fs) => fs.map((x) => (x.id === f.id ? f : x))); setFolderPage(f); }}
          onDeleted={(id) => { setFolders((fs) => fs.filter((x) => x.id !== id)); setFolderPage(null); setToast('Folder deleted'); }}
        />
        {folderReader && (
          <FolderReaderSession folder={folderReader} records={records} onClose={() => setFolderReader(null)}/>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell nowStudying={shellNowStudying}>
    <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <LibraryHeader {...lib} />

      {/* CONTENT */}
      <LibraryContent {...lib} />

      <LibraryModals {...lib} />
    </div>
    </AppShell>
  );
}
