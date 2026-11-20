/**
 * FolderReaderSession.jsx — a Library folder opened IN the content reader.
 *
 * Original Content shows the folder's contents as a grid; tapping a record
 * opens it in the same reader (its own teaching session), with the folder's
 * contents in a scrollable row under the tab pills — led by a back arrow —
 * so the learner can switch documents without leaving the reader. Back
 * (the row's arrow, or the reader's own back in the Ask state) returns to
 * the contents grid; the grid's ✕ leaves the folder.
 *
 * Non-record items (topics, videos, links) are listed for completeness but
 * keep their own openers — only records read here in v1.
 */

import { useEffect, useMemo, useState } from 'react';
import { SessionReaderModal } from '../../teaching/index.js';
import RecordTeachSession from './RecordTeachSession.jsx';
import { listFolderItems, getAskHistory, askRecord, generateRecordTool, startRecordPodcast, getRecordPodcast, listRecordArtifacts, saveRecordArtifact, updateRecordArtifact, deleteRecordArtifact } from '../../../services/recordsApi.js';
import { Icon } from '../../../components/common/Icons.jsx';

const ITEM_ICON = { pdf: 'ti-file-text', image: 'ti-photo', audio: 'ti-headphones', video: 'ti-video',
  docx: 'ti-file-text', pptx: 'ti-presentation', text: 'ti-file-text', paste: 'ti-clipboard' };

export default function FolderReaderSession({ folder, records = [], onClose }) {
  const [items, setItems] = useState(null);        // folder item snapshots
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null);  // the open record
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setLoadError(false);
    setSelected(null);
    if (!folder?.id) { setItems([]); return undefined; }
    listFolderItems(folder.id)
      .then((rows) => { if (alive) setItems(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) { setItems([]); setLoadError(true); } });
    return () => { alive = false; };
  }, [folder?.id, reloadKey]);

  /* Record items resolve to shelf records (the reader needs the record
     itself, not the snapshot); anything unresolved stays listed but inert. */
  const recordItems = useMemo(() => (items || [])
    .filter((it) => it.itemType === 'record')
    .map((it) => {
      const rec = records.find((r) => String(r.id) === String(it.itemRef));
      return rec ? { item: it, record: rec } : null;
    })
    .filter(Boolean), [items, records]);
  const otherItems = useMemo(() => (items || []).filter((it) => it.itemType !== 'record'), [items]);

  /* Folder-level reader services: Ask, the study tools and the saved
     items all anchor on the folder — the server pools the folder's
     documents for grounding and cites the document each item came from. */
  const folderTarget = useMemo(() => ({ folderId: folder?.id }), [folder?.id]);
  const ask = useMemo(() => (folder?.id ? {
    load: () => getAskHistory(folderTarget),
    send: (opts) => askRecord({ ...folderTarget, ...opts }),
  } : null), [folderTarget]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tools = useMemo(() => (folder?.id ? {
    generate: (tool, args) => generateRecordTool({ ...folderTarget, tool, scope: 'document', values: args?.values || {} }),
    podcast: {
      start: (args) => startRecordPodcast({ ...folderTarget, scope: 'document', values: args?.values || {} }),
      get: (id) => getRecordPodcast(id),
    },
  } : null), [folderTarget]);   // eslint-disable-line react-hooks/exhaustive-deps
  const artifacts = useMemo(() => (folder?.id ? {
    list: () => listRecordArtifacts(folderTarget),
    save: (body) => saveRecordArtifact(folderTarget, body),
    update: (id, patch) => updateRecordArtifact(id, patch),
    remove: (id) => deleteRecordArtifact(id),
  } : null), [folderTarget]);   // eslint-disable-line react-hooks/exhaustive-deps
  /* A folder citation names its source document: open it here. */
  const openForeignCite = (cite) => {
    const hit = recordItems.find(({ record }) => String(record.id) === String(cite?.sourceRecordId));
    if (hit) setSelected(hit.record);
  };

  if (!folder) return null;

  if (selected) {
    return (
      <RecordTeachSession
        record={selected}
        folderNav={{
          items: recordItems.map(({ record }) => ({ id: record.id, name: record.name })),
          activeId: selected.id,
          onSelect: (id) => {
            const hit = recordItems.find(({ record }) => String(record.id) === String(id));
            if (hit) setSelected(hit.record);
          },
          onBack: () => setSelected(null),
        }}
        onClose={() => setSelected(null)}
        onMinimize={() => setSelected(null)}
      />
    );
  }

  const grid = (
    <div style={{ width: '100%', padding: '6px 2px 10px', fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--ak-text)', marginBottom: 4 }}>Folder contents</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)', marginBottom: 14 }}>
        {items === null ? 'Loading…' : `${recordItems.length + otherItems.length} item${recordItems.length + otherItems.length === 1 ? '' : 's'}`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {recordItems.map(({ item, record }) => (
          <button key={item.id || record.id} type="button" onClick={() => setSelected(record)}
            style={{ border: '1.5px solid var(--ak-border)', borderRadius: 16, padding: '16px 12px 12px', background: 'var(--ak-surface)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ak-tag-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Icon name={ITEM_ICON[item.kind] || 'ti-file-text'} size={22} color="var(--ak-accent)"/>
            </span>
            <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12.5, fontWeight: 900, lineHeight: 1.3, color: 'var(--ak-text)' }}>{record.name}</span>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 5, textTransform: 'capitalize' }}>{item.kind || record.kind}</span>
            {item.sub ? <span style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--ak-accent)', marginTop: 3 }}>{item.sub}</span> : null}
          </button>
        ))}
        {otherItems.map((it) => (
          <div key={it.id || it.itemRef} style={{ border: '1.5px solid var(--ak-border)', borderRadius: 16, padding: '16px 12px 12px', background: 'var(--ak-surface)', opacity: 0.75, fontFamily: 'inherit' }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ak-tag-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Icon name={ITEM_ICON[it.kind] || 'ti-box'} size={22} color="var(--ak-accent)"/>
            </span>
            <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 12.5, fontWeight: 900, lineHeight: 1.3, color: 'var(--ak-text)' }}>{it.title}</span>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', marginTop: 5, textTransform: 'capitalize' }}>{it.kind || it.itemType}</span>
          </div>
        ))}
      </div>
      {items !== null && loadError && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>
          The contents couldn't load.{' '}
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}
            style={{ border: 'none', background: 'none', color: 'var(--ak-accent)', fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, padding: 0 }}>Retry</button>
        </div>
      )}
      {items !== null && !loadError && recordItems.length === 0 && otherItems.length === 0 && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ak-text-muted)' }}>This folder is empty.</div>
      )}
    </div>
  );

  return (
    <SessionReaderModal
      docTitle={folder.name}
      sourceName="Library record · folder"
      pages={[]}
      folderHome={grid}
      chatState="ask"
      ask={ask}
      tools={tools}
      artifacts={artifacts}
      onForeignCite={openForeignCite}
      onClose={onClose}
      onExplainSelection={() => {}}
    />
  );
}
