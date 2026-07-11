/**
 * FDEAdminPage — constants + section/child components.
 */
/**
 * FDEAdminPage — Forward Deployed Engineers tool management console.
 * Routes: /fde-admin  (admin role required; backend enforces it too)
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../services/api.js';

// ─── palette / tokens ────────────────────────────────────────────────────────

const BRAND  = "#7C3AED";
const SURFACE = "var(--ak-bg)";
const BORDER  = "var(--ak-border2)";

const EXECUTOR_COLORS = {
  llm_prompt:    { bg: "#EDE9FE", text: "#6D28D9" },
  notify:        { bg: "#FEF9C3", text: "#92400E" },
  create_battle: { bg: "#FCE7F3", text: "#9D174D" },
  http_webhook:  { bg: "#D1FAE5", text: "#065F46" },
};

const EXECUTOR_DESCRIPTIONS = {
  llm_prompt:    "Sends a prompt to Claude and returns the response.",
  notify:        "Creates an in-app notification for a user.",
  create_battle: "Creates a 1v1 quiz battle between students.",
  http_webhook:  "POSTs data to an external URL (partner system integration).",
};

const SCOPE_COLORS = {
  global: { bg: "#DBEAFE", text: "#1E40AF" },
  user:   { bg: "#F3E8FF", text: "#6D28D9" },
  school: { bg: "#D1FAE5", text: "#065F46" },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function Badge({ label, colorMap }) {
  const c = colorMap?.[label] ?? { bg: "var(--ak-tag-bg)", text: "var(--ak-text-sec)" };
  return (
    <span style={{ background: c.bg, color: c.text, borderRadius: 100, padding: "2px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Chip({ label, onRemove }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#EDE9FE", color: BRAND, borderRadius: 100, padding: "2px 8px 2px 10px", fontSize: 12, fontWeight: 600 }}>
      {label}
      {onRemove && (
        <span onClick={onRemove} style={{ cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</span>
      )}
    </span>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--ak-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ak-text-sec)", display: "block", marginBottom: 4 }}>{label}</label>}
      <input
        style={{ width: "100%", padding: "8px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13, outline: "none", boxSizing: "border-box" }}
        {...props}
      />
    </div>
  );
}

function Textarea({ label, rows = 3, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ak-text-sec)", display: "block", marginBottom: 4 }}>{label}</label>}
      <textarea
        rows={rows}
        style={{ width: "100%", padding: "8px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
        {...props}
      />
    </div>
  );
}

function Select({ label, options, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ak-text-sec)", display: "block", marginBottom: 4 }}>{label}</label>}
      <select
        style={{ width: "100%", padding: "8px 12px", borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 13, outline: "none", background: "var(--ak-surface)", boxSizing: "border-box" }}
        {...props}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, style: s }) {
  const variants = {
    primary:   { background: BRAND, color: "#fff", border: "none" },
    secondary: { background: "var(--ak-surface)", color: "var(--ak-text-sec)", border: `1px solid ${BORDER}` },
    danger:    { background: "#FEE2E2", color: "#DC2626", border: "1px solid #FCA5A5" },
    ghost:     { background: "transparent", color: "var(--ak-text-sub)", border: "none" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, ...variants[variant], ...s }}
    >
      {children}
    </button>
  );
}

// ─── Executor config fields ───────────────────────────────────────────────────

function LlmPromptConfig({ config, onChange }) {
  return (
    <>
      <Textarea label="Prompt template (use {{variable}} for inputs)" value={config.prompt ?? ""} onChange={e => onChange({ ...config, prompt: e.target.value })} rows={4} />
      <Input label="System prompt (optional)" value={config.system ?? ""} onChange={e => onChange({ ...config, system: e.target.value })} placeholder="You are a helpful teaching assistant…" />
      <Input label="Max tokens" type="number" value={config.maxTokens ?? 1024} onChange={e => onChange({ ...config, maxTokens: Number(e.target.value) })} />
      <Select label="Output type" options={[{value:"message",label:"Message"},{value:"quiz",label:"Quiz"},{value:"explanation",label:"Explanation"}]} value={config.outputType ?? "message"} onChange={e => onChange({ ...config, outputType: e.target.value })} />
    </>
  );
}

function NotifyConfig({ config, onChange }) {
  return (
    <>
      <Input label="Message template (use {{variable}})" value={config.messageTemplate ?? ""} onChange={e => onChange({ ...config, messageTemplate: e.target.value })} placeholder="{{message}}" />
      <Input label="Notification title" value={config.title ?? ""} onChange={e => onChange({ ...config, title: e.target.value })} />
      <Select label="Notification type" options={[{value:"agent",label:"Agent"},{value:"reminder",label:"Reminder"},{value:"alert",label:"Alert"}]} value={config.notifType ?? "agent"} onChange={e => onChange({ ...config, notifType: e.target.value })} />
    </>
  );
}

function CreateBattleConfig({ config, onChange }) {
  return (
    <>
      <Input label="Default topic" value={config.defaultTopic ?? ""} onChange={e => onChange({ ...config, defaultTopic: e.target.value })} />
      <Input label="Subject" value={config.subject ?? ""} onChange={e => onChange({ ...config, subject: e.target.value })} placeholder="Mathematics" />
      <Select label="Difficulty" options={[{value:"easy",label:"Easy"},{value:"medium",label:"Medium"},{value:"hard",label:"Hard"}]} value={config.difficulty ?? "medium"} onChange={e => onChange({ ...config, difficulty: e.target.value })} />
      <Input label="XP prize" type="number" value={config.xpPrize ?? 100} onChange={e => onChange({ ...config, xpPrize: Number(e.target.value) })} />
      <Input label="Time limit (seconds)" type="number" value={config.timeLimitSeconds ?? 600} onChange={e => onChange({ ...config, timeLimitSeconds: Number(e.target.value) })} />
    </>
  );
}

function HttpWebhookConfig({ config, onChange }) {
  const [headerKey, setHeaderKey]   = useState("");
  const [headerVal, setHeaderVal]   = useState("");
  const headers = config.headers ?? {};

  const addHeader = () => {
    if (!headerKey.trim()) return;
    onChange({ ...config, headers: { ...headers, [headerKey.trim()]: headerVal.trim() } });
    setHeaderKey(""); setHeaderVal("");
  };
  const removeHeader = (k) => {
    const next = { ...headers }; delete next[k];
    onChange({ ...config, headers: next });
  };

  return (
    <>
      <Input label="Webhook URL" value={config.url ?? ""} onChange={e => onChange({ ...config, url: e.target.value })} placeholder="https://partner.example.com/api/akoro-hook" />
      <Select label="HTTP method" options={[{value:"POST",label:"POST"},{value:"GET",label:"GET"},{value:"PUT",label:"PUT"},{value:"PATCH",label:"PATCH"}]} value={config.method ?? "POST"} onChange={e => onChange({ ...config, method: e.target.value })} />
      <Input label="Shared secret (sent as X-Webhook-Secret header)" value={config.secret ?? ""} onChange={e => onChange({ ...config, secret: e.target.value })} placeholder="optional" />
      <Input label="Timeout (ms)" type="number" value={config.timeoutMs ?? 10000} onChange={e => onChange({ ...config, timeoutMs: Number(e.target.value) })} />
      <Input label="Response field to use as output text (optional)" value={config.responseField ?? ""} onChange={e => onChange({ ...config, responseField: e.target.value })} placeholder="message" />
      <Select label="Output type" options={[{value:"message",label:"Message"},{value:"reminder",label:"Reminder"}]} value={config.outputType ?? "message"} onChange={e => onChange({ ...config, outputType: e.target.value })} />
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ak-text-sec)", display: "block", marginBottom: 4 }}>Custom headers</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input value={headerKey} onChange={e => setHeaderKey(e.target.value)} placeholder="Header name" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }} />
          <input value={headerVal} onChange={e => setHeaderVal(e.target.value)} placeholder="Value" style={{ flex: 2, padding: "6px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }} />
          <Btn variant="secondary" onClick={addHeader} style={{ padding: "6px 12px" }}>Add</Btn>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(headers).map(([k, v]) => (
            <Chip key={k} label={`${k}: ${v}`} onRemove={() => removeHeader(k)} />
          ))}
        </div>
      </div>
    </>
  );
}

const CONFIG_EDITORS = {
  llm_prompt:    LlmPromptConfig,
  notify:        NotifyConfig,
  create_battle: CreateBattleConfig,
  http_webhook:  HttpWebhookConfig,
};

// ─── JSON Schema input schema builder ─────────────────────────────────────────

function SchemaBuilder({ schema, onChange }) {
  const props = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const [name, setName] = useState("");
  const [type, setType] = useState("string");
  const [desc, setDesc] = useState("");

  const add = () => {
    if (!name.trim()) return;
    const next = {
      type: "object",
      properties: { ...props, [name.trim()]: { type, description: desc.trim() || undefined } },
      required: [...required, name.trim()],
    };
    onChange(next);
    setName(""); setDesc(""); setType("string");
  };

  const remove = (key) => {
    const next = { ...props }; delete next[key];
    onChange({ type: "object", properties: next, required: required.filter(r => r !== key) });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ak-text-sec)", display: "block", marginBottom: 4 }}>Input parameters</label>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12, background: "#FAFAFA" }}>
        {Object.entries(props).length === 0 && (
          <div style={{ color: "var(--ak-text-muted)", fontSize: 12, marginBottom: 8 }}>No parameters yet. Add below.</div>
        )}
        {Object.entries(props).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ fontSize: 12 }}>
              <b>{k}</b>
              <span style={{ color: "var(--ak-text-sub)" }}> ({v.type})</span>
              {v.description && <span style={{ color: "var(--ak-text-muted)" }}> — {v.description}</span>}
              {required.includes(k) && <span style={{ color: BRAND, marginLeft: 4 }}>*</span>}
            </span>
            <Btn variant="ghost" onClick={() => remove(k)} style={{ padding: "2px 8px", fontSize: 12 }}>✕</Btn>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="param name" style={{ flex: 2, padding: "6px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }} />
          <select value={type} onChange={e => setType(e.target.value)} style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }}>
            {["string","number","boolean"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="description" style={{ flex: 3, padding: "6px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }} />
          <Btn variant="secondary" onClick={add} style={{ padding: "6px 12px" }}>+</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Tool Form (create / edit) ─────────────────────────────────────────────────

const BLANK_FORM = {
  name: "", description: "", executor: "llm_prompt", config: {},
  scope: "global", ownerUserId: "", schoolId: "", intentKeywords: [],
  inputSchema: { type: "object", properties: {} },
};

function ToolForm({ initial, schools, teachers, onSave, onCancel, saving }) {
  const [form, setForm] = useState(() => initial ? {
    ...BLANK_FORM,
    name:          initial.name ?? "",
    description:   initial.description ?? "",
    executor:      initial.executor ?? "llm_prompt",
    config:        initial.config ?? {},
    scope:         initial.scope ?? "global",
    ownerUserId:   initial.owner_user_id ?? "",
    schoolId:      initial.school_id ?? "",
    intentKeywords: initial.intent_keywords ?? [],
    inputSchema:   initial.input_schema ?? { type: "object", properties: {} },
  } : { ...BLANK_FORM });

  const [kwInput, setKwInput] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addKw = () => {
    const kw = kwInput.trim().toLowerCase();
    if (!kw || form.intentKeywords.includes(kw)) return;
    set("intentKeywords", [...form.intentKeywords, kw]);
    setKwInput("");
  };

  const ConfigEditor = CONFIG_EDITORS[form.executor];

  return (
    <div style={{ padding: 24 }}>
      <Section title="Identity">
        <Input label="Tool name (snake_case)" value={form.name} onChange={e => set("name", e.target.value)} placeholder="send_sms_reminder" disabled={!!initial} />
        <Textarea label="Description (shown to the AI agent)" value={form.description} onChange={e => set("description", e.target.value)} rows={2} />
      </Section>

      <Section title="Executor">
        <Select
          label="Executor type"
          value={form.executor}
          onChange={e => set("executor", e.target.value)}
          options={Object.keys(CONFIG_EDITORS).map(k => ({ value: k, label: k }))}
        />
        <div style={{ fontSize: 12, color: "var(--ak-text-sub)", marginTop: -8, marginBottom: 12 }}>
          {EXECUTOR_DESCRIPTIONS[form.executor]}
        </div>
        {ConfigEditor && <ConfigEditor config={form.config} onChange={v => set("config", v)} />}
      </Section>

      <Section title="Input schema">
        <SchemaBuilder schema={form.inputSchema} onChange={v => set("inputSchema", v)} />
      </Section>

      <Section title="Scope">
        <Select
          label="Who can use this tool?"
          value={form.scope}
          onChange={e => set("scope", e.target.value)}
          options={[{value:"global",label:"Global (all partners)"},{value:"user",label:"Specific teacher/user"},{value:"school",label:"Specific school"}]}
        />
        {form.scope === "user" && (
          <Select label="Teacher" value={form.ownerUserId} onChange={e => set("ownerUserId", e.target.value)}
            options={[{value:"",label:"— select teacher —"}, ...teachers.map(t => ({ value: t.id, label: `${t.full_name} (${t.email})` }))]}
          />
        )}
        {form.scope === "school" && (
          <Select label="School" value={form.schoolId} onChange={e => set("schoolId", e.target.value)}
            options={[{value:"",label:"— select school —"}, ...schools.map(s => ({ value: s.id, label: s.name }))]}
          />
        )}
      </Section>

      <Section title="Intent keywords (optional)">
        <div style={{ fontSize: 12, color: "var(--ak-text-sub)", marginBottom: 6 }}>Phrases the agent uses to detect this tool's intent.</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input value={kwInput} onChange={e => setKwInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addKw()} placeholder="e.g. send sms" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12 }} />
          <Btn variant="secondary" onClick={addKw} style={{ padding: "6px 12px" }}>Add</Btn>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {form.intentKeywords.map(k => <Chip key={k} label={k} onRemove={() => set("intentKeywords", form.intentKeywords.filter(x => x !== k))} />)}
        </div>
      </Section>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => onSave(form)} disabled={saving}>{saving ? "Saving…" : initial ? "Save changes" : "Create tool"}</Btn>
      </div>
    </div>
  );
}

// ─── Tool list row ─────────────────────────────────────────────────────────────

function ToolRow({ tool, onEdit, onDelete, onToggle }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto auto", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, background: tool.enabled ? "var(--ak-surface)" : "#FAFAFA" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: tool.enabled ? "var(--ak-text)" : "var(--ak-text-muted)" }}>{tool.name}</div>
        <div style={{ fontSize: 12, color: "var(--ak-text-sub)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340 }}>{tool.description}</div>
      </div>
      <Badge label={tool.executor} colorMap={EXECUTOR_COLORS} />
      <Badge label={tool.scope} colorMap={SCOPE_COLORS} />
      <span style={{ fontSize: 12, color: tool.enabled ? "#059669" : "var(--ak-text-muted)", fontWeight: 700 }}>{tool.enabled ? "enabled" : "disabled"}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn variant="secondary" onClick={() => onEdit(tool)} style={{ padding: "5px 10px", fontSize: 12 }}>Edit</Btn>
        <Btn variant="secondary" onClick={() => onToggle(tool)} style={{ padding: "5px 10px", fontSize: 12 }}>{tool.enabled ? "Disable" : "Enable"}</Btn>
        <Btn variant="danger" onClick={() => onDelete(tool)} style={{ padding: "5px 10px", fontSize: 12 }}>Delete</Btn>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────


export { BRAND, SURFACE, BORDER, EXECUTOR_COLORS, EXECUTOR_DESCRIPTIONS, SCOPE_COLORS, Badge, Chip, Section, Input, Textarea, Select, Btn, LlmPromptConfig, NotifyConfig, CreateBattleConfig, HttpWebhookConfig, CONFIG_EDITORS, SchemaBuilder, BLANK_FORM, ToolForm, ToolRow };
