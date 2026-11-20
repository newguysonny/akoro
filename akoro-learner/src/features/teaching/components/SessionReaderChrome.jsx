// Reader chrome: the slim header, the tab pills and the folder row.
import { Icon } from '../../../components/common/Icons.jsx';
import { tabLabel, toolById } from './sessionReaderModel.js';

function TabIcon({ tab }) {
  if (tab.id === "reader") return <Icon name="ti-book-2" size={14}/>;
  const def = toolById(tab.id) || toolById(tab.toolId);
  return <Icon name={def ? def.icon : "ti-circle-check"} size={14}/>;
}

function TabPill({ tab, active, onSelect, onClose }) {
  return (
    <div
      onClick={onSelect}
      className={`folio-tab-pill flex items-center gap-1.5 flex-shrink-0 max-w-36 pl-2.5 pr-1.5 py-1.5 rounded-full border cursor-pointer text-xs whitespace-nowrap transition-colors ${active ? "active" : ""}`}
    >
      <TabIcon tab={tab}/>
      <span className="truncate">{tabLabel(tab)}</span>
      {Number.isInteger(tab.count) && tab.count > 0 && (
        <span className="flex-shrink-0 font-ui-mono" style={{ background: "var(--ak-accent)", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "1px 6px", lineHeight: 1.5 }}>{tab.count}</span>
      )}
      {tab.id !== "reader" && !tab.noClose && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-4 h-4 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-black/10 flex-shrink-0"
        >
          <Icon name="ti-x" size={10}/>
        </button>
      )}
    </div>
  );
}

function PillsBar({ tabs, activeTabId, activeResultTab, switchTabTo, closeTab, onOpenChat, showChatButton }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-3 flex-shrink-0">
      <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {tabs.map((t) => (
          <TabPill key={t.id} tab={t} active={t.id === activeTabId || (!!t.toolId && activeResultTab?.toolId === t.toolId)} onSelect={() => switchTabTo(t.id)} onClose={() => closeTab(t.id)}/>
        ))}
      </div>
      {showChatButton && (
        <button
          type="button"
          onClick={onOpenChat}
          title="Back to the session chat"
          aria-label="Back to the session chat"
          className="folio-btn-outline flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center"
        >
          <Icon name="ti-message-circle" size={14}/>
        </button>
      )}
    </div>
  );
}

export default function SessionReaderChrome({ reader }) {
  const {
    docTitle, sourceName, onClose, chatState, split, isMobile,
    allTabs, activeTabId, activeResultTab, switchTabTo, closeTab, onOpenChat,
    folderNav,
  } = reader;
  const safeTop = "env(safe-area-inset-top, 0px)";

  return (
    <>
        {/* Slim reader header — the modal's counterpart of Fortizo's app shell. */}
        <div className="flex items-center justify-between gap-3 flex-shrink-0 border-b"
          style={{ borderColor: "var(--ak-border)", padding: `calc(${safeTop} + 10px) 14px 10px` }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(108,59,255,.18)", border: "1px solid rgba(108,59,255,.35)" }}>
              <Icon name="ti-book-2" size={16} color="var(--ak-accent)"/>
            </span>
            <div className="min-w-0">
              <div className="text-sm font-extrabold truncate" style={{ color: "var(--ak-text)" }}>{docTitle}</div>
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon name="ti-file-text" size={10} color="var(--ak-text-sub)"/>
                <span className="text-[10.5px] font-semibold truncate" style={{ color: "var(--ak-text-sub)" }}>{sourceName}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={chatState === "ask" ? "Back" : split ? "Close the reader" : "Back to the session chat"}
            aria-label={chatState === "ask" ? "Back" : split ? "Close the reader" : "Back to the session chat"}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--ak-tag-bg)" }}
          >
            <Icon name="ti-x" size={15} color="var(--ak-text-sub)"/>
          </button>
        </div>

        {/* Tab strip. First tab is the document itself. */}
        <div className="flex-shrink-0 border-b" style={{ borderColor: "var(--ak-border)", background: "var(--ak-tag-bg)" }}>
          <PillsBar tabs={allTabs} showChatButton={isMobile && chatState !== "ask"}/>
        </div>

        {/* Folder contents row — this document was opened from a folder:
            a back arrow returns to the folder's contents, and the folder's
            documents sit in a scrollable row for switching in place. */}
        {folderNav && activeTabId === "reader" && (
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b overflow-x-auto" style={{ borderColor: "var(--ak-border)", background: "var(--ak-surface)", scrollbarWidth: "none" }}>
            <button type="button" className="ak-folder-back" onClick={folderNav.onBack} title="Back to folder contents" aria-label="Back to folder contents">
              <Icon name="ti-chevron-left" size={15}/>
            </button>
            {(folderNav.items || []).map((it) => (
              <button key={it.id} type="button" className={`ak-folder-chip${it.id === folderNav.activeId ? " on" : ""}`} onClick={() => folderNav.onSelect(it.id)}>
                <Icon name="ti-file-text" size={13} color="var(--ak-accent)"/>
                <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
              </button>
            ))}
          </div>
        )}
    </>
  );
}
