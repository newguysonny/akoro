/**
 * AgentTab.jsx — Akoro Student App (drop-in replacement)
 *
 * Exports:
 *   AgentChatTab   — Mini ChatGPT + agentic tool execution
 *   TeachAgentModal — Learn-by-teaching via adaptive-learning API
 *
 * Zero direct Anthropic calls — all AI proxied through backend.
 */

import { useState, useEffect, useRef, useCallback } from "react";

const BRAND = "#6C3BFF";
const GOLD  = "#F59E0B";
const GREEN = "#10B981";
const RED   = "#EF4444";
const API   = "";
const jwt   = () => (typeof localStorage !== "undefined" && localStorage.getItem("akoro_token")) || "";

async function apiPost(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function apiGet(path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${jwt()}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function apiPatch(path) {
  const r = await fetch(`${API}${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${jwt()}` } });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

const TOOL_META = {
  check_progress:  { icon: "📊", label: "Checking your progress"   },
  create_task:     { icon: "✅", label: "Creating task"             },
  list_tasks:      { icon: "📋", label: "Loading your tasks"        },
  find_battles:    { icon: "⚔️",  label: "Searching for battles"    },
  get_ranking:     { icon: "🏆", label: "Checking your ranking"     },
  get_weak_topics: { icon: "🧠", label: "Scanning knowledge gaps"   },
};

function ToolCard({ execution, done }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[execution.tool] || { icon: "⚙️", label: execution.tool };

  const oneLiner = () => {
    const r = execution.result || {};
    if (execution.tool === "create_task"     && r.created)      return `Created "${r.title}"`;
    if (execution.tool === "check_progress"  && r.courses)      return `${r.courses.length} courses · ${(r.total_xp||0).toLocaleString()} XP`;
    if (execution.tool === "list_tasks"      && r.count != null) return `${r.count} pending task${r.count !== 1 ? "s" : ""}`;
    if (execution.tool === "find_battles"    && r.battles)      return `${r.battles.length} battle${r.battles.length !== 1 ? "s" : ""} found`;
    if (execution.tool === "get_ranking"     && r.entries)      return r.entries[0] ? `Rank ${r.entries[0].rank} · ${(r.entries[0].total_xp||0).toLocaleString()} XP` : "No ranking yet";
    if (execution.tool === "get_weak_topics" && r.weak_topics)  return `${r.weak_topics.length} weak topic${r.weak_topics.length !== 1 ? "s" : ""}`;
    return null;
  };

  return (
    <div style={{ margin: "3px 0 7px", borderRadius: 10, border: `1px solid ${BRAND}20`, background: `${BRAND}06`, overflow: "hidden" }}>
      <button onClick={() => done && setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", background: "transparent", border: "none", cursor: done ? "pointer" : "default", fontFamily: "'Nunito',sans-serif", textAlign: "left" }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{done ? meta.icon : "⏳"}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: done ? BRAND : "#9CA3AF", flex: 1 }}>{meta.label}{done ? "" : "…"}</span>
        {done && oneLiner() && <span style={{ fontSize: 10.5, color: BRAND, fontWeight: 600, flexShrink: 0 }}>{oneLiner()}</span>}
        {done && <span style={{ fontSize: 10, color: "#9CA3AF", flexShrink: 0, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>}
      </button>
      {open && done && (
        <pre style={{ fontSize: 10.5, color: "#374151", background: "#F9FAFB", borderRadius: "0 0 10px 10px", padding: "8px 10px", overflow: "auto", margin: 0, fontFamily: "monospace", lineHeight: 1.5, maxHeight: 140, borderTop: `1px solid ${BRAND}12` }}>
          {JSON.stringify(execution.result, null, 2)}
        </pre>
      )}
    </div>
  );
}

const QUICK_PROMPTS = [
  { label: "What's due today?",   prompt: "What tasks do I have due today?"              },
  { label: "Check progress",      prompt: "How am I doing across all my courses?"        },
  { label: "Find battles",        prompt: "Are there any active battles I can join?"     },
  { label: "My ranking",          prompt: "What's my current rank and XP?"               },
  { label: "Weak topics",         prompt: "What topics should I study most urgently?"    },
  { label: "Make a reminder",     prompt: "Remind me to revise calculus tomorrow morning"},
  { label: "Explain chain rule",  prompt: "Can you explain the chain rule step by step?" },
  { label: "Build a study plan",  prompt: "Help me make a study plan for this week"      },
];

const AGENT_AVATARS = ["🤖","🧠","👾","🦉","🎓","⚡","🌟","🔮","🦋","🎯","🚀","💡"];

/* ══════════════════════════════════════════════════════
   AgentChatTab — Mini ChatGPT + Agentic
══════════════════════════════════════════════════════ */
export function AgentChatTab({ onStartTeach }) {
  const [messages,     setMessages]     = useState([{
    id: 1, from: "agent", tools: [],
    text: "Hi! I'm your personal learning agent 🤖\n\nI can check your progress, create study reminders, find battles, explain topics, and track your XP. What would you like to do?",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }]);
  const [input,        setInput]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [agentName,    setAgentName]    = useState("Aria");
  const [agentEmoji,   setAgentEmoji]   = useState("🤖");
  const [custOpen,     setCustOpen]     = useState(false);
  const [draftName,    setDraftName]    = useState("Aria");
  const [draftEmoji,   setDraftEmoji]   = useState("🤖");
  const [innerTab,     setInnerTab]     = useState("chat");
  const [tasks,        setTasks]        = useState([]);
  const [taskFilter,   setTaskFilter]   = useState("pending");
  const [tasksLoading, setTasksLoading] = useState(false);
  const feedRef = useRef(null);

  const PRI_COLOR = { high: RED, medium: GOLD, low: GREEN };
  const PRI_BG    = { high: `${RED}15`, medium: `${GOLD}15`, low: `${GREEN}15` };

  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [messages, loading]);
  useEffect(() => { if (innerTab === "tasks") loadTasks(); }, [innerTab]);

  const loadTasks = async () => {
    setTasksLoading(true);
    try { const d = await apiGet("/api/tasks"); setTasks(d.tasks ?? []); } catch {}
    setTasksLoading(false);
  };

  const toggleTask = async (id) => {
    try { await apiPatch(`/api/tasks/${id}/toggle`); setTasks(prev => prev.map(t => t.id === id ? { ...t, status: t.status === "done" ? "pending" : "done" } : t)); } catch {}
  };

  const buildHistory = (msgs) => msgs.slice(-12).map(m => ({ role: m.from === "me" ? "user" : "assistant", content: m.text }));

  const send = useCallback(async (override) => {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    if (!override) setInput("");
    const t   = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const pid = Date.now() + 1;
    setMessages(prev => [...prev, { id: Date.now(), from: "me", text, time: t, tools: [] }, { id: pid, from: "agent", text: "", time: t, tools: [], pending: true }]);
    setLoading(true);
    try {
      const data = await apiPost("/api/adaptive/agent/chat", { message: text, history: buildHistory(messages) });
      setMessages(prev => prev.map(m => m.id === pid ? { ...m, text: data.reply, tools: data.toolExecutions ?? [], pending: false } : m));
      if ((data.toolExecutions ?? []).some(te => te.tool === "create_task")) loadTasks();
    } catch {
      setMessages(prev => prev.map(m => m.id === pid ? { ...m, text: "Connection issue — please try again.", tools: [], pending: false } : m));
    }
    setLoading(false);
  }, [input, loading, messages]);

  const saveCustomise = async () => {
    setAgentName(draftName || "Aria"); setAgentEmoji(draftEmoji); setCustOpen(false);
    try { await fetch(`${API}/api/user/agent`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt()}` }, body: JSON.stringify({ agent_name: draftName, agent_emoji: draftEmoji }) }); } catch {}
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { id: Date.now(), from: "agent", text: `Updated! I'm ${draftName} ${draftEmoji} now.`, time: t, tools: [] }]);
  };

  const pendingCount = tasks.filter(t => t.status === "pending").length;
  const doneCount    = tasks.filter(t => t.status === "done").length;
  const urgentCount  = tasks.filter(t => t.priority === "high" && t.status === "pending").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px 11px", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `${BRAND}15`, border: `2px solid ${BRAND}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, position: "relative" }}>
            {agentEmoji}
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 12, height: 12, borderRadius: "50%", background: GREEN, border: "2px solid #fff", animation: "pulse-dot 2s ease-in-out infinite" }}/>
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 900, color: "#111827", margin: 0 }}>{agentName}</p>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN }}/>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#9CA3AF" }}>Online · Your learning agent</span>
            </div>
          </div>
        </div>
        <button onClick={() => { setDraftName(agentName); setDraftEmoji(agentEmoji); setCustOpen(true); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, border: "1.5px solid #E5E7EB", background: "#F9FAFB", fontSize: 11.5, fontWeight: 700, color: "#6B7280", cursor: "pointer", fontFamily: "'Nunito',sans-serif" }}>
          ✏️ Customise
        </button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
        {[{ key: "chat", label: "Chat", icon: "💬", badge: null }, { key: "tasks", label: "Tasks", icon: "📋", badge: pendingCount }].map(({ key, label, icon, badge }) => (
          <button key={key} onClick={() => setInnerTab(key)} style={{ flex: 1, padding: "9px 4px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: innerTab === key ? 800 : 600, color: innerTab === key ? BRAND : "#9CA3AF", borderBottom: `2.5px solid ${innerTab === key ? BRAND : "transparent"}`, transition: "all .2s", fontFamily: "'Nunito',sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <span style={{ fontSize: 13 }}>{icon}</span>{label}
            {badge > 0 && <span style={{ fontSize: 9, fontWeight: 900, background: innerTab === key ? BRAND : "#F3F4F6", color: innerTab === key ? "#fff" : "#9CA3AF", borderRadius: 8, padding: "1px 5px" }}>{badge}</span>}
          </button>
        ))}
      </div>

      {innerTab === "chat" && (
        <>
          <div style={{ display: "flex", gap: 6, padding: "9px 16px 8px", overflowX: "auto", scrollbarWidth: "none", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
            {QUICK_PROMPTS.map(q => (
              <button key={q.label} onClick={() => send(q.prompt)} style={{ flexShrink: 0, padding: "5px 11px", borderRadius: 20, border: `1px solid ${BRAND}25`, background: `${BRAND}07`, color: BRAND, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Nunito',sans-serif", whiteSpace: "nowrap" }}>{q.label}</button>
            ))}
          </div>

          <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map(msg => {
              const isMe = msg.from === "me";
              return (
                <div key={msg.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 8 }}>
                  {!isMe && <div style={{ width: 30, height: 30, borderRadius: "50%", background: `${BRAND}15`, border: `1.5px solid ${BRAND}40`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{agentEmoji}</div>}
                  <div style={{ maxWidth: "80%" }}>
                    {!isMe && (msg.tools ?? []).map((te, i) => <ToolCard key={i} execution={te} done={!msg.pending}/>)}
                    {(msg.text || msg.pending) && (
                      <div style={{ padding: "10px 14px", borderRadius: isMe ? "18px 18px 4px 18px" : "4px 18px 18px 18px", background: isMe ? `linear-gradient(135deg,${BRAND},#4C1DCC)` : "#F3F1FF", border: isMe ? "none" : `1px solid ${BRAND}18`, color: isMe ? "#fff" : "#111827", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", fontWeight: 500 }}>
                        {msg.pending ? <div style={{ display: "flex", gap: 4, alignItems: "center" }}>{[0,.25,.5].map((d,i)=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:BRAND,animation:`bounce-dot .7s ease-in-out ${d}s infinite alternate` }}/>)}</div> : msg.text}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3, textAlign: isMe ? "right" : "left" }}>{msg.time}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ padding: "10px 16px 12px", borderTop: "1px solid #F3F4F6", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#F9FAFB", borderRadius: 50, border: "1.5px solid #E5E7EB", padding: "7px 8px 7px 16px" }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Ask ${agentName} anything…`} style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13.5, color: "#111827", fontFamily: "'Nunito',sans-serif" }}/>
              <button onClick={() => send()} disabled={!input.trim() || loading} style={{ width: 36, height: 36, borderRadius: "50%", background: input.trim() && !loading ? `linear-gradient(135deg,${BRAND},#4C1DCC)` : "#E5E7EB", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !loading ? "pointer" : "default", flexShrink: 0, transition: "background .2s" }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={input.trim()&&!loading?"#fff":"#9CA3AF"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </>
      )}

      {innerTab === "tasks" && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "12px 16px 10px", borderBottom: "1px solid #F3F4F6" }}>
            {[{ val: pendingCount, label: "Pending", color: RED }, { val: doneCount, label: "Done", color: GREEN }, { val: urgentCount, label: "Urgent", color: GOLD }].map(({ val, label, color }) => (
              <div key={label} style={{ textAlign: "center", background: "#F9FAFB", borderRadius: 12, padding: "10px 6px", border: "1px solid #F3F4F6" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color }}>{val}</div>
                <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 1 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 8px" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[["pending","To do"],["done","Done"]].map(([k,l]) => (
                <button key={k} onClick={() => setTaskFilter(k)} style={{ padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${taskFilter===k?BRAND:"#E5E7EB"}`, background: taskFilter===k?`${BRAND}10`:"transparent", color: taskFilter===k?BRAND:"#9CA3AF", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Nunito',sans-serif" }}>{l}</button>
              ))}
            </div>
            <button onClick={() => { setInnerTab("chat"); setTimeout(() => send("Create a new study task"), 100); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, border: "none", background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "'Nunito',sans-serif" }}>+ Ask agent</button>
          </div>
          <div style={{ flex: 1, padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {tasksLoading && <div style={{ textAlign: "center", padding: 24, color: "#9CA3AF" }}>Loading…</div>}
            {!tasksLoading && tasks.filter(t => taskFilter==="done" ? t.status==="done" : t.status!=="done").length===0 && (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "#9CA3AF" }}>
                <span style={{ fontSize: 40, opacity: .3 }}>📋</span>
                <p style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>{taskFilter==="done" ? "No completed tasks yet." : 'Tell the agent to "remind me to…"'}</p>
              </div>
            )}
            {!tasksLoading && tasks.filter(t => taskFilter==="done"?t.status==="done":t.status!=="done").map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "12px 14px", borderRadius: 14, background: "#fff", border: "1px solid #F3F4F6", opacity: t.status==="done"?.6:1 }}>
                <button onClick={() => toggleTask(t.id)} style={{ marginTop: 2, width: 22, height: 22, borderRadius: 6, border: `2px solid ${t.status==="done"?GREEN:"#D1D5DB"}`, background: t.status==="done"?GREEN:"#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                  {t.status==="done" && <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, fontWeight: t.status==="done"?500:700, color: t.status==="done"?"#9CA3AF":"#111827", textDecoration: t.status==="done"?"line-through":"none", margin: "0 0 4px" }}>{t.title}</p>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: PRI_BG[t.priority]||`${GOLD}15`, color: PRI_COLOR[t.priority]||GOLD }}>{((t.priority||"medium").charAt(0).toUpperCase()+(t.priority||"medium").slice(1))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {custOpen && (
        <>
          <div onClick={() => setCustOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(6,6,18,.55)", backdropFilter: "blur(5px)" }}/>
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 2100, background: "#fff", borderRadius: "22px 22px 0 0", padding: "0 20px 48px", boxShadow: "0 -8px 40px rgba(0,0,0,.14)", animation: "sheet-up .3s cubic-bezier(.32,1.2,.64,1)", fontFamily: "'Nunito',sans-serif", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ width: 38, height: 4, borderRadius: 2, background: "#D1D5DB", margin: "14px auto 20px" }}/>
            <p style={{ fontSize: 16, fontWeight: 900, color: "#111827", margin: "0 0 18px" }}>✨ Customise Your Agent</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", display: "block", marginBottom: 6 }}>NAME</label>
              <input value={draftName} onChange={e => setDraftName(e.target.value)} style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1.5px solid #E5E7EB", background: "#F9FAFB", fontSize: 14, fontWeight: 600, color: "#111827", fontFamily: "'Nunito',sans-serif", outline: "none" }} onFocus={e=>e.target.style.borderColor=BRAND} onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>
            </div>
            <div style={{ marginBottom: 22 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", display: "block", marginBottom: 10 }}>AVATAR</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {AGENT_AVATARS.map(em => <button key={em} onClick={() => setDraftEmoji(em)} style={{ width: 46, height: 46, borderRadius: 12, border: `2px solid ${draftEmoji===em?BRAND:"#E5E7EB"}`, background: draftEmoji===em?`${BRAND}12`:"#F9FAFB", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}>{em}</button>)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setCustOpen(false)} style={{ flex: 1, padding: "13px", borderRadius: 14, border: "1.5px solid #E5E7EB", background: "#F9FAFB", fontSize: 13, fontWeight: 800, color: "#6B7280", cursor: "pointer", fontFamily: "'Nunito',sans-serif" }}>Cancel</button>
              <button onClick={saveCustomise} style={{ flex: 1.5, padding: "13px", borderRadius: 14, border: "none", background: `linear-gradient(135deg,${BRAND},#4C1DCC)`, fontSize: 13, fontWeight: 800, color: "#fff", cursor: "pointer", fontFamily: "'Nunito',sans-serif" }}>Save agent</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   TeachAgentModal — Learn by teaching (adaptive API)
══════════════════════════════════════════════════════ */
export function TeachAgentModal({ session, onClose }) {
  const sc = session ? ({ maths:"#6C3BFF", english:"#0EA5E9", science:"#10B981" }[session.subject] || BRAND) : BRAND;

  const [phase,      setPhase]      = useState("chat");
  const [sessionId,  setSessionId]  = useState(null);
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState("");
  const [loading,    setLoading]    = useState(true);
  const [summary,    setSummary]    = useState(null);
  const [turns,      setTurns]      = useState(0);
  const [initMeta,   setInitMeta]   = useState(null);

  const scrollRef = useRef(null);
  const MAX_TURNS = 4;

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, loading]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await apiPost("/api/adaptive/teach-back/start", {
          topic: session?.topic || "your topic", subject: session?.subject || "General",
          sessionId: session?.id || null, level: session?.level || "intermediate",
        });
        setSessionId(data.session_id);
        setInitMeta(data);
        setMessages([{ role: "agent", text: data.first_question, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
      } catch {
        setMessages([{ role: "agent", text: `Hi! Explain "${session?.topic || "the topic"}" to me as if I've never heard of it.`, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
      }
      setLoading(false);
    })();
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const t       = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const updated = [...messages, { role: "user", text, time: t }];
    setMessages(updated);
    const newTurns = turns + 1;
    setTurns(newTurns);
    setLoading(true);
    if (newTurns >= MAX_TURNS) { await finalizeSession(updated); return; }
    try {
      const history = updated.map(m => ({ role: m.role==="agent"?"assistant":"user", content: m.text }));
      const data = await apiPost(`/api/adaptive/teach-back/${sessionId}/message`, { studentText: text, history: history.slice(-8) });
      setMessages(prev => [...prev, { role: "agent", text: data.follow_up, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    } catch {
      setMessages(prev => [...prev, { role: "agent", text: "Interesting! Can you tell me more?", time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    }
    setLoading(false);
  };

  const finalizeSession = async (currentMsgs) => {
    setLoading(true);
    try {
      const history = (currentMsgs ?? messages).map(m => ({ role: m.role==="agent"?"assistant":"user", content: m.text }));
      const data = await apiPost(`/api/adaptive/teach-back/${sessionId}/end`, { history });
      setSummary(data);
    } catch {
      setSummary({ teachingScore: 75, xpEarned: 90, agentFeedback: "Great session!", strengthAreas: ["Clear communication"], gapsIdentified: [], keyConcepts: [session?.topic], confidenceDelta: 0.05 });
    }
    setPhase("summary");
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "#080812", display: "flex", flexDirection: "column", fontFamily: "'Nunito',sans-serif", animation: "sheet-up .36s cubic-bezier(.32,1.1,.64,1)" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "52px 20px 14px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: sc, animation: "pulse-dot 1.4s ease-in-out infinite" }}/>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: sc, letterSpacing: .5 }}>LEARN BY TEACHING</span>
          </div>
          <p style={{ fontSize: 15, fontWeight: 900, color: "#F1F5F9", margin: 0 }}>{session?.topic || "Teaching Session"}</p>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#475569", margin: 0 }}>
            {session?.id} · {session?.level}
            {initMeta?.existing_confidence && <span style={{ color: sc }}> · Confidence: {initMeta.existing_confidence}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {phase==="chat" && turns>=2 && !loading && (
            <button onClick={() => finalizeSession()} style={{ display:"flex",alignItems:"center",gap:5,background:`${sc}22`,border:`1px solid ${sc}44`,borderRadius:12,padding:"7px 12px",cursor:"pointer",fontSize:11,fontWeight:800,color:sc,fontFamily:"'Nunito',sans-serif" }}>✨ Summarise</button>
          )}
          <div onClick={onClose} style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.07)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer" }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
        </div>
      </div>

      {summary && (
        <div style={{ display:"flex",background:"rgba(255,255,255,.04)",borderBottom:"1px solid rgba(255,255,255,.06)" }}>
          {[{key:"chat",label:"💬 Teaching Chat"},{key:"summary",label:"✨ Summary"}].map(({key,label})=>(
            <button key={key} onClick={()=>setPhase(key)} style={{ flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",fontSize:12,fontWeight:phase===key?800:600,color:phase===key?sc:"#475569",borderBottom:`2px solid ${phase===key?sc:"transparent"}`,fontFamily:"'Nunito',sans-serif",transition:"all .2s" }}>{label}</button>
          ))}
        </div>
      )}

      {phase==="chat" && (
        <>
          <div ref={scrollRef} style={{ flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12 }}>
            {loading && messages.length===0 && (
              <div style={{ display:"flex",alignItems:"center",justifyContent:"center",padding:40 }}>
                <div style={{ display:"flex",gap:5,alignItems:"center" }}>
                  {[0,.25,.5].map((d,i)=><div key={i} style={{ width:8,height:8,borderRadius:"50%",background:sc,animation:`bounce-dot .8s ease-in-out ${d}s infinite alternate` }}/>)}
                  <span style={{ fontSize:12,color:"#475569",marginLeft:8 }}>Loading your knowledge profile…</span>
                </div>
              </div>
            )}
            {messages.map((m,i)=>(
              <div key={i} style={{ display:"flex",flexDirection:m.role==="agent"?"row":"row-reverse",gap:9,alignItems:"flex-end" }}>
                {m.role==="agent" && <div style={{ width:30,height:30,borderRadius:"50%",background:`${sc}22`,border:`1.5px solid ${sc}44`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center" }}>🤖</div>}
                <div style={{ maxWidth:"78%" }}>
                  <div style={{ padding:"10px 13px",borderRadius:m.role==="agent"?"4px 16px 16px 16px":"16px 4px 16px 16px",background:m.role==="agent"?"rgba(255,255,255,.07)":`${sc}22`,border:m.role==="agent"?"1px solid rgba(255,255,255,.08)":`1px solid ${sc}35` }}>
                    <p style={{ fontSize:13,fontWeight:600,color:m.role==="agent"?"#CBD5E1":"#E2E8F0",margin:0,lineHeight:1.55,whiteSpace:"pre-wrap" }}>{m.text}</p>
                  </div>
                  <p style={{ fontSize:10,color:"#475569",margin:"3px 0 0",textAlign:m.role==="agent"?"left":"right" }}>{m.time}</p>
                </div>
              </div>
            ))}
            {loading && messages.length>0 && (
              <div style={{ display:"flex",gap:9,alignItems:"flex-end" }}>
                <div style={{ width:30,height:30,borderRadius:"50%",background:`${sc}22`,border:`1.5px solid ${sc}44`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center" }}>🤖</div>
                <div style={{ padding:"12px 16px",borderRadius:"4px 16px 16px 16px",background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.08)",display:"flex",gap:5,alignItems:"center" }}>
                  {[0,.25,.5].map((d,i)=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:sc,animation:`bounce-dot .8s ease-in-out ${d}s infinite alternate` }}/>)}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding:"10px 14px 28px",background:"rgba(255,255,255,.03)",borderTop:"1px solid rgba(255,255,255,.06)" }}>
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
              <div style={{ flex:1,display:"flex",alignItems:"center",background:"rgba(255,255,255,.07)",border:"1.5px solid rgba(255,255,255,.10)",borderRadius:12,padding:"8px 12px",gap:8 }}>
                <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();} }} placeholder={`Explain ${session?.topic||"the topic"} to me…`} style={{ flex:1,background:"none",border:"none",outline:"none",fontSize:13,fontWeight:600,color:"#CBD5E1",fontFamily:"'Nunito',sans-serif" }}/>
              </div>
              <div onClick={sendMessage} style={{ width:40,height:40,borderRadius:12,background:input.trim()?`linear-gradient(135deg,${sc},${sc}BB)`:"rgba(255,255,255,.06)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .2s",flexShrink:0 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={input.trim()?"#fff":"#475569"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <span style={{ fontSize:10.5,fontWeight:600,color:"#334155" }}>Turns: {turns} / {MAX_TURNS}</span>
              <div style={{ display:"flex",gap:3 }}>{Array.from({length:MAX_TURNS}).map((_,i)=><div key={i} style={{ width:20,height:4,borderRadius:2,background:i<turns?sc:"rgba(255,255,255,.10)",transition:"background .3s" }}/>)}</div>
            </div>
          </div>
        </>
      )}

      {phase==="summary" && (
        <div style={{ flex:1,overflowY:"auto",padding:"16px" }}>
          {loading && !summary ? (
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",gap:16 }}>
              <div style={{ width:56,height:56,borderRadius:"50%",background:`${sc}22`,border:`2px solid ${sc}`,display:"flex",alignItems:"center",justifyContent:"center",animation:"pulse-dot 1.2s ease-in-out infinite",fontSize:22 }}>✨</div>
              <p style={{ fontSize:14,fontWeight:700,color:"#475569",margin:0 }}>Generating your session summary…</p>
              <p style={{ fontSize:11,color:"#334155",margin:0 }}>Updating knowledge profile</p>
            </div>
          ) : summary ? (
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <div style={{ background:`linear-gradient(135deg,${sc}22,${sc}10)`,border:`1.5px solid ${sc}30`,borderRadius:18,padding:"18px 16px" }}>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
                  <div>
                    <p style={{ fontSize:11,fontWeight:800,color:sc,margin:"0 0 3px",letterSpacing:.4 }}>TEACHING SCORE</p>
                    <p style={{ fontSize:38,fontWeight:900,color:"#F1F5F9",margin:0,fontFamily:"monospace" }}>{summary.teachingScore}<span style={{ fontSize:16,color:"#475569" }}>/100</span></p>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <p style={{ fontSize:10,fontWeight:700,color:"#475569",margin:"0 0 4px" }}>XP Earned</p>
                    <div style={{ display:"flex",alignItems:"center",gap:5,justifyContent:"flex-end" }}><span style={{ fontSize:14 }}>⚡</span><span style={{ fontSize:20,fontWeight:900,color:GOLD }}>+{summary.xpEarned}</span></div>
                    {summary.confidenceDelta>0 && <p style={{ fontSize:10,color:sc,fontWeight:700,margin:"4px 0 0" }}>Confidence +{Math.round(summary.confidenceDelta*100)}% ✓</p>}
                  </div>
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                <p style={{ fontSize:10.5,fontWeight:800,color:sc,margin:"0 0 8px",letterSpacing:.3 }}>AGENT FEEDBACK</p>
                <p style={{ fontSize:13,fontWeight:600,color:"#CBD5E1",margin:0,lineHeight:1.6 }}>{summary.agentFeedback}</p>
              </div>
              {(summary.keyConcepts??[]).length>0 && (
                <div style={{ background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",borderRadius:14,padding:"14px" }}>
                  <p style={{ fontSize:10.5,fontWeight:800,color:"#94A3B8",margin:"0 0 10px",letterSpacing:.3 }}>📌 KEY CONCEPTS COVERED</p>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>
                    {summary.keyConcepts.map((c,i)=><div key={i} style={{ background:`${sc}18`,border:`1px solid ${sc}30`,borderRadius:8,padding:"4px 11px" }}><span style={{ fontSize:11.5,fontWeight:700,color:sc }}>{c}</span></div>)}
                  </div>
                </div>
              )}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                <div style={{ background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.20)",borderRadius:14,padding:"12px" }}>
                  <p style={{ fontSize:10,fontWeight:800,color:GREEN,margin:"0 0 8px",letterSpacing:.3 }}>✅ STRENGTHS</p>
                  {(summary.strengthAreas??[]).map((s,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#A7F3D0",margin:"0 0 4px",lineHeight:1.4 }}>· {s}</p>)}
                  {!(summary.strengthAreas?.length)&&<p style={{ fontSize:11.5,color:"#475569",margin:0 }}>Keep going!</p>}
                </div>
                <div style={{ background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.20)",borderRadius:14,padding:"12px" }}>
                  <p style={{ fontSize:10,fontWeight:800,color:GOLD,margin:"0 0 8px",letterSpacing:.3 }}>⚡ TO REVIEW</p>
                  {(summary.gapsIdentified??[]).map((g,i)=><p key={i} style={{ fontSize:11.5,fontWeight:600,color:"#FDE68A",margin:"0 0 4px",lineHeight:1.4 }}>· {g}</p>)}
                  {!(summary.gapsIdentified?.length)&&<p style={{ fontSize:11.5,color:"#475569",margin:0 }}>None found 🎉</p>}
                </div>
              </div>
              <button onClick={onClose} style={{ padding:"13px",borderRadius:14,border:"none",background:`linear-gradient(135deg,${sc},${sc}CC)`,fontSize:13,fontWeight:800,color:"#fff",cursor:"pointer",fontFamily:"'Nunito',sans-serif",marginBottom:8 }}>Save &amp; close session</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
