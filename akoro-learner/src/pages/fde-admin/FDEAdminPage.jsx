/**
 * FDEAdminPage — composes the components from ./parts.jsx.
 */
/**
 * FDEAdminPage — Forward Deployed Engineers tool management console.
 * Routes: /fde-admin  (admin role required; backend enforces it too)
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmDialog } from '../../components/common/ConfirmHost.jsx';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../services/api.js';

// ─── palette / tokens ────────────────────────────────────────────────────────
import { BRAND, SURFACE, BORDER, EXECUTOR_COLORS, EXECUTOR_DESCRIPTIONS, SCOPE_COLORS, Badge, Chip, Section, Input, Textarea, Select, Btn, LlmPromptConfig, NotifyConfig, CreateBattleConfig, HttpWebhookConfig, CONFIG_EDITORS, SchemaBuilder, BLANK_FORM, ToolForm, ToolRow } from './parts.jsx';

export default function FDEAdminPage() {
  const navigate = useNavigate();

  const [tools,    setTools]    = useState([]);
  const [schools,  setSchools]  = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);        // load failure — replaces the list
  const [actionErr, setActionErr] = useState('');       // save/delete/toggle — sits above it

  const [filterScope,    setFilterScope]    = useState("all");
  const [filterExecutor, setFilterExecutor] = useState("all");
  const [search,         setSearch]         = useState("");

  const [modal, setModal] = useState(null); // null | 'create' | { editing: tool }
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [toolsRes, partnersRes] = await Promise.all([
        apiGet("/api/tasks/admin/tools"),
        apiGet("/api/tasks/admin/partners"),
      ]);
      setTools(toolsRes.tools ?? []);
      setSchools(partnersRes.schools ?? []);
      setTeachers(partnersRes.teachers ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true); setActionErr('');
    try {
      if (modal?.editing) {
        await apiPatch(`/api/tasks/admin/tools/${modal.editing.id}`, {
          description:    form.description,
          config:         form.config,
          inputSchema:    form.inputSchema,
          intent_keywords: form.intentKeywords,
        });
      } else {
        await apiPost("/api/tasks/admin/tools", form);
      }
      setModal(null);
      await load();
    } catch (e) {
      setActionErr(e.message || 'Could not save the tool.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tool) => {
    if (!(await confirmDialog({
      title: `Delete "${tool.name}"?`,
      message: 'This tool is removed from every agent that can currently use it.',
      confirmLabel: 'Delete tool',
    }))) return;
    try {
      await apiDelete(`/api/tasks/admin/tools/${tool.id}`);
      setTools(ts => ts.filter(t => t.id !== tool.id));
    } catch (e) { setActionErr(e.message || 'Could not delete the tool.'); }
  };

  const handleToggle = async (tool) => {
    try {
      const res = await apiPatch(`/api/tasks/admin/tools/${tool.id}`, { enabled: !tool.enabled });
      setTools(ts => ts.map(t => t.id === tool.id ? res.tool : t));
    } catch (e) { setActionErr(e.message || 'Could not change that setting.'); }
  };

  const visible = tools.filter(t => {
    if (filterScope    !== "all" && t.scope    !== filterScope)    return false;
    if (filterExecutor !== "all" && t.executor !== filterExecutor) return false;
    if (search && !t.name.includes(search) && !t.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // ── render ──

  if (modal) {
    return (
      <div style={{ minHeight: "100vh", background: SURFACE, display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 680, background: "var(--ak-surface)", margin: "32px 16px", borderRadius: 18, border: `1px solid ${BORDER}`, overflow: "hidden", alignSelf: "flex-start" }}>
          <div style={{ padding: "18px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{modal === "create" ? "New dynamic tool" : `Edit: ${modal.editing.name}`}</div>
              <div style={{ fontSize: 12, color: "var(--ak-text-sub)" }}>Configure how this tool behaves at run time.</div>
            </div>
            <Btn variant="ghost" onClick={() => setModal(null)}>✕</Btn>
          </div>
          <ToolForm
            initial={modal?.editing ?? null}
            schools={schools}
            teachers={teachers}
            onSave={handleSave}
            onCancel={() => setModal(null)}
            saving={saving}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: SURFACE }}>
      {/* header */}
      <div style={{ background: "var(--ak-surface)", borderBottom: `1px solid ${BORDER}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Btn variant="ghost" onClick={() => navigate(-1)} style={{ padding: "6px 10px" }}>← Back</Btn>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: BRAND }}>FDE Admin Console</div>
            <div style={{ fontSize: 12, color: "var(--ak-text-sub)" }}>Manage config-only tools for partner deployments</div>
          </div>
        </div>
        <Btn onClick={() => setModal("create")}>+ New tool</Btn>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>

        {/* stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total tools",   value: tools.length },
            { label: "Enabled",       value: tools.filter(t => t.enabled).length },
            { label: "Schools",       value: schools.length },
            { label: "FDE partners",  value: teachers.length },
          ].map(s => (
            <div key={s.label} style={{ background: "var(--ak-surface)", borderRadius: 14, border: `1px solid ${BORDER}`, padding: "16px 20px" }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: BRAND }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--ak-text-sub)", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* filters */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tools…"
            style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13 }}
          />
          <select value={filterScope} onChange={e => setFilterScope(e.target.value)} style={{ padding: "8px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13 }}>
            <option value="all">All scopes</option>
            <option value="global">Global</option>
            <option value="user">User</option>
            <option value="school">School</option>
          </select>
          <select value={filterExecutor} onChange={e => setFilterExecutor(e.target.value)} style={{ padding: "8px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13 }}>
            <option value="all">All executors</option>
            {Object.keys(CONFIG_EDITORS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <Btn variant="secondary" onClick={load}>Refresh</Btn>
        </div>

        {/* tool list */}
        <div style={{ background: "var(--ak-surface)", borderRadius: 14, border: `1px solid ${BORDER}`, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto auto", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
            {["Tool", "Executor", "Scope", "Status", "Actions"].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 800, color: "var(--ak-text-muted)", textTransform: "uppercase" }}>{h}</div>
            ))}
            <div />
          </div>

          {actionErr && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0", padding: "10px 13px", background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 12 }}>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: "#991B1B" }}>{actionErr}</span>
              <button onClick={() => setActionErr('')} style={{ border: "none", background: "transparent", color: "#991B1B", cursor: "pointer", fontSize: 14, fontWeight: 900 }}>×</button>
            </div>
          )}
          {loading && <div style={{ padding: 32, textAlign: "center", color: "var(--ak-text-muted)" }}>Loading…</div>}
          {error   && <div style={{ padding: 32, textAlign: "center", color: "#DC2626" }}>Error: {error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div style={{ padding: 48, textAlign: "center", color: "var(--ak-text-muted)" }}>
              {tools.length === 0 ? "No tools yet. Create your first one →" : "No tools match your filters."}
            </div>
          )}
          {visible.map(t => (
            <ToolRow key={t.id} tool={t} onEdit={t => setModal({ editing: t })} onDelete={handleDelete} onToggle={handleToggle} />
          ))}
        </div>

        {/* partners section */}
        <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* schools */}
          <div style={{ background: "var(--ak-surface)", borderRadius: 14, border: `1px solid ${BORDER}` }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, fontWeight: 800, fontSize: 15 }}>
              Partner schools ({schools.length})
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {schools.map(s => (
                <div key={s.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
                  {s.logo_url && <img src={s.logo_url} alt="" style={{ width: 28, height: 28, borderRadius: 8, objectFit: "cover" }} />}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ak-text-muted)" }}>{s.id}</div>
                  </div>
                  <Btn variant="secondary" onClick={() => { setFilterScope("school"); /* TODO: filter by this school */ }} style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }}>Filter</Btn>
                </div>
              ))}
              {schools.length === 0 && <div style={{ padding: 24, color: "var(--ak-text-muted)", textAlign: "center", fontSize: 13 }}>No schools found.</div>}
            </div>
          </div>

          {/* teachers */}
          <div style={{ background: "var(--ak-surface)", borderRadius: 14, border: `1px solid ${BORDER}` }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, fontWeight: 800, fontSize: 15 }}>
              Teachers / Partners ({teachers.length})
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {teachers.map(t => (
                <div key={t.id} style={{ padding: "10px 18px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 100, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, color: BRAND }}>
                    {(t.full_name ?? "?")[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.full_name}</div>
                    <div style={{ fontSize: 11, color: "var(--ak-text-muted)" }}>{t.email}</div>
                  </div>
                  <Badge label={t.role} colorMap={{ teacher: { bg: "#EDE9FE", text: BRAND }, admin: { bg: "#FEE2E2", text: "#DC2626" } }} />
                </div>
              ))}
              {teachers.length === 0 && <div style={{ padding: 24, color: "var(--ak-text-muted)", textAlign: "center", fontSize: 13 }}>No teachers found.</div>}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

