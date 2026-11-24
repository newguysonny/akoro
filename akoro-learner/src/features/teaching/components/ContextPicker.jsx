// Context attachments for a study tool: pick files/folders from the library.
// They are reference material for the prompt (past questions, a syllabus,
// a related handout) — the tool still tests and cites the document itself.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../components/common/Icons.jsx";
import { listFolders, listRecords, searchRecords } from "../../../services/recordsApi.js";
import HelpTip from "./HelpTip.jsx";

const MAX_ITEMS = 6;

export default function ContextPicker({ value = [], onChange }) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState([]);
  const [folders, setFolders] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  const boxRef = useRef(null);

  useEffect(() => {
    alive.current = true;
    listFolders().then((f) => { if (alive.current) setFolders(Array.isArray(f) ? f : []); }).catch(() => {});
    listRecords().then((r) => { if (alive.current) setRecords(Array.isArray(r) ? r.slice(0, 12) : []); }).catch(() => {});
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);

  /* Click/tap anywhere outside the picker (or press Escape) closes the
     results list — it must not trap the learner until they choose. */
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = query.trim();
    if (!q) return undefined;
    timer.current = setTimeout(async () => {
      if (alive.current) setBusy(true);
      const hits = await searchRecords(q, 12).catch(() => []);
      if (!alive.current) return;
      const seen = new Set();
      const list = [];
      for (const h of hits) {
        if (!h?.recordId || seen.has(h.recordId)) continue;
        seen.add(h.recordId);
        list.push({ id: h.recordId, name: h.name || "Record", kind: h.kind });
      }
      setRecords(list);
      setBusy(false);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query]);

  const chosen = Array.isArray(value) ? value : [];
  const isChosen = (type, id) => chosen.some((c) => c.type === type && c.id === id);
  const full = chosen.length >= MAX_ITEMS;
  const add = (type, id, name) => {
    if (full || isChosen(type, id)) return;
    onChange([...chosen, { type, id, name }]);
    setOpen(false);
    setQuery("");
  };
  const remove = (type, id) => onChange(chosen.filter((c) => !(c.type === type && c.id === id)));

  const q = query.trim().toLowerCase();
  const visibleFolders = (q ? folders.filter((f) => String(f.name || "").toLowerCase().includes(q)) : folders).slice(0, 4);
  const visibleRecords = records
    .filter((r) => !isChosen("record", r.id))
    .slice(0, 6);
  const totalShown = visibleFolders.length + visibleRecords.length;

  return (
    <div ref={boxRef} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--ak-text-sub)" }}>
          Context (optional)
          <HelpTip text="Attach past questions, a syllabus or a related handout from your library. Only the parts related to this material are used; the tool follows their style and scope, while citations stay on this document."/>
        </span>
        <span className="text-[11px]" style={{ color: "var(--ak-text-sub)" }}>{chosen.length}/{MAX_ITEMS}</span>
      </div>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((c) => (
            <span key={`${c.type}:${c.id}`} className="flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-[11px] font-semibold"
              style={{ background: "var(--ak-surface-2, rgba(108,59,255,.10))", color: "var(--ak-text)", border: "1px solid var(--ak-border)" }}>
              <Icon name={c.type === "folder" ? "ti-folder" : "ti-file-text"} size={11}/>
              <span className="max-w-[140px] truncate">{c.name}</span>
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => remove(c.type, c.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-text-sub)", padding: 0, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      {!full && (
        <div className="relative">
          <input
            type="text"
            value={query}
            placeholder="Search files and folders to attach…"
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            className="folio-form-field border rounded-lg px-2.5 py-2 text-sm focus:outline-none w-full"
            style={{ color: "var(--ak-text)" }}
          />
          {open && totalShown > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 rounded-lg z-50 overflow-hidden"
              style={{ background: "var(--ak-surface, #fff)", border: "1px solid var(--ak-border)", maxHeight: 220, overflowY: "auto", boxShadow: "0 10px 28px rgba(15,23,42,.16)" }}>
              {visibleFolders.map((f) => (
                <button key={f.id} type="button" onClick={() => add("folder", f.id, f.name || "Folder")}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-text)" }}>
                  <Icon name="ti-folder" size={13}/><span className="truncate">{f.name}</span>
                  <span className="ml-auto text-[10px]" style={{ color: "var(--ak-text-sub)" }}>folder</span>
                </button>
              ))}
              {visibleRecords.map((r) => (
                <button key={r.id} type="button" onClick={() => add("record", r.id, r.name || "Record")}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ak-text)" }}>
                  <Icon name="ti-file-text" size={13}/><span className="truncate">{r.name}</span>
                  <span className="ml-auto text-[10px]" style={{ color: "var(--ak-text-sub)" }}>{r.kind || "file"}</span>
                </button>
              ))}
            </div>
          )}
          {open && busy && <div className="text-[11px] mt-1" style={{ color: "var(--ak-text-sub)" }}>Searching…</div>}
          {open && !busy && totalShown === 0 && query.trim() && (
            <div className="text-[11px] mt-1" style={{ color: "var(--ak-text-sub)" }}>No matches in your library.</div>
          )}
        </div>
      )}
    </div>
  );
}
