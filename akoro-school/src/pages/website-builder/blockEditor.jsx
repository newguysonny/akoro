/**
 * Website Builder — visual block model + block editor panel.
 * Blocks render to HTML with no source code shown to the user.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles, Type, FileText, Image as ImageIcon, Link2, LayoutGrid, Minus, Code } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { GREEN, BLUE, PURPLE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';
import { BASE, slugify, pill, th, td, iconBtn, Tabs, addBtn, backBtn, toastEl, miniBtn } from './shared.jsx';

/* ── Visual page blocks (no source code) ─────────────────────────────────── */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => Math.random().toString(36).slice(2, 9);

const BLOCK_TYPES = [
  { type: 'hero', label: 'Hero', icon: Sparkles, ti: 'ti-sparkles', desc: 'Big headline + button' },
  { type: 'heading', label: 'Heading', icon: Type, ti: 'ti-typography', desc: 'Section title' },
  { type: 'text', label: 'Text', icon: FileText, ti: 'ti-file-text', desc: 'Paragraph(s)' },
  { type: 'image', label: 'Image', icon: ImageIcon, ti: 'ti-photo', desc: 'A picture' },
  { type: 'button', label: 'Button', icon: Link2, ti: 'ti-link', desc: 'A call-to-action' },
  { type: 'cards', label: 'Cards', icon: LayoutGrid, ti: 'ti-layout-grid', desc: 'Feature grid' },
  { type: 'divider', label: 'Divider', icon: Minus, ti: 'ti-minus', desc: 'A line break' },
  { type: 'html', label: 'Custom HTML', icon: Code, ti: 'ti-code', desc: 'Advanced / embed' },
];
const blockMeta = (t) => BLOCK_TYPES.find((b) => b.type === t) || { label: t, icon: FileText, ti: 'ti-file-text' };

function newBlock(type) {
  const id = uid();
  switch (type) {
    case 'hero': return { id, type, heading: 'Welcome to our school', subheading: 'A short line about what makes you special.', buttonText: 'Get Started', buttonLink: '/apply', align: 'center' };
    case 'heading': return { id, type, text: 'Section heading', level: 'h2', align: 'left' };
    case 'text': return { id, type, body: 'Write something here…' };
    case 'image': return { id, type, url: '', alt: '', align: 'center', width: '100%' };
    case 'button': return { id, type, label: 'Click here', link: '', align: 'left' };
    case 'cards': return { id, type, items: [{ emoji: '⭐', title: 'Feature', text: 'Describe it briefly.' }] };
    case 'divider': return { id, type };
    case 'html': return { id, type, html: '' };
    default: return { id, type };
  }
}

// Block → HTML. Uses theme CSS vars so it matches the site's colours.
function renderBlock(b) {
  switch (b.type) {
    case 'hero': return `<section style="text-align:${b.align || 'center'};padding:72px 24px;background:${b.bg || 'linear-gradient(160deg,#eef2ff,#fff)'}"><div style="max-width:760px;margin:0 auto"><h1 style="font-size:40px;font-weight:900;margin:0 0 14px;color:var(--primary,#1a1a2e)">${esc(b.heading)}</h1>${b.subheading ? `<p style="font-size:18px;color:var(--secondary,#6b7280);margin:0 auto 26px">${esc(b.subheading)}</p>` : ''}${b.buttonText ? `<a href="${esc(b.buttonLink || '#')}" style="display:inline-block;padding:14px 30px;border-radius:50px;font-weight:700;text-decoration:none;background:var(--primary,#1a56db);color:#fff">${esc(b.buttonText)}</a>` : ''}</div></section>`;
    case 'heading': return `<${b.level || 'h2'} style="text-align:${b.align || 'left'};font-weight:800;margin:20px 0 12px;color:var(--primary,#1a1a2e)">${esc(b.text)}</${b.level || 'h2'}>`;
    case 'text': return (b.body || '').split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.75;font-size:16px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    case 'image': return b.url ? `<figure style="margin:16px 0;text-align:${b.align || 'center'}"><img src="${esc(b.url)}" alt="${esc(b.alt)}" style="max-width:${esc(b.width || '100%')};border-radius:10px"></figure>` : '';
    case 'button': return `<div style="text-align:${b.align || 'left'};margin:16px 0"><a href="${esc(b.link || '#')}" style="display:inline-block;padding:12px 26px;border-radius:50px;font-weight:700;text-decoration:none;background:var(--primary,#1a56db);color:#fff">${esc(b.label)}</a></div>`;
    case 'cards': return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:18px 0">${(b.items || []).map((c) => `<div style="border:1px solid #e7e7ef;border-radius:12px;padding:22px"><div style="font-size:28px;line-height:1">${esc(c.emoji || '')}</div><h3 style="margin:8px 0 6px;font-size:17px">${esc(c.title)}</h3><p style="color:#555;line-height:1.6;margin:0;font-size:14px">${esc(c.text)}</p></div>`).join('')}</div>`;
    case 'divider': return `<hr style="border:none;border-top:1px solid #e7e7ef;margin:26px 0">`;
    case 'html': return b.html || '';
    default: return '';
  }
}
const renderBlocks = (blocks) => (blocks || []).map(renderBlock).join('\n');

/* ── Block editor (left panel) ───────────────────────────────────────────── */
const bLabel = { display: 'block', fontSize: 11.5, fontWeight: 700, color: C.muted, margin: '0 0 5px', fontFamily: C.font };
const bInput = { ...inputStyle, fontSize: 13 };
const ALIGN = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];

function BlockFields({ block, update, onPickImage }) {
  const f = (k) => (e) => update({ [k]: e.target.value });
  switch (block.type) {
    case 'hero': return (<>
      <label style={bLabel}>Headline</label><input value={block.heading || ''} onChange={f('heading')} style={bInput} />
      <label style={bLabel}>Subheading</label><textarea value={block.subheading || ''} onChange={f('subheading')} style={{ ...bInput, minHeight: 56, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={bLabel}>Button text</label><input value={block.buttonText || ''} onChange={f('buttonText')} placeholder="(optional)" style={bInput} /></div>
        <div style={{ flex: 1 }}><label style={bLabel}>Button link</label><input value={block.buttonLink || ''} onChange={f('buttonLink')} placeholder="/apply" style={bInput} /></div>
      </div>
      <label style={bLabel}>Align</label><select value={block.align || 'center'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
    </>);
    case 'heading': return (<>
      <label style={bLabel}>Text</label><input value={block.text || ''} onChange={f('text')} style={bInput} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={bLabel}>Size</label><select value={block.level || 'h2'} onChange={f('level')} style={bInput}><option value="h2">Large (H2)</option><option value="h3">Medium (H3)</option></select></div>
        <div style={{ flex: 1 }}><label style={bLabel}>Align</label><select value={block.align || 'left'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
      </div>
    </>);
    case 'text': return (<>
      <label style={bLabel}>Text <span style={{ fontWeight: 400, color: C.muted2 }}>(blank line = new paragraph)</span></label>
      <textarea value={block.body || ''} onChange={f('body')} style={{ ...bInput, minHeight: 120, resize: 'vertical', lineHeight: 1.6 }} />
    </>);
    case 'image': return (<>
      <label style={bLabel}>Image</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={block.url || ''} onChange={f('url')} placeholder="https://…" style={{ ...bInput, flex: 1 }} />
        <button type="button" onClick={onPickImage} style={{ padding: '0 12px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, whiteSpace: 'nowrap' }}>Library</button>
      </div>
      {block.url && <img src={block.url} alt="" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, marginTop: 8, border: `1px solid ${C.border}` }} />}
      <label style={bLabel}>Alt text</label><input value={block.alt || ''} onChange={f('alt')} style={bInput} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={bLabel}>Align</label><select value={block.align || 'center'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
        <div style={{ flex: 1 }}><label style={bLabel}>Width</label><input value={block.width || '100%'} onChange={f('width')} placeholder="100% or 400px" style={bInput} /></div>
      </div>
    </>);
    case 'button': return (<>
      <label style={bLabel}>Label</label><input value={block.label || ''} onChange={f('label')} style={bInput} />
      <label style={bLabel}>Link</label><input value={block.link || ''} onChange={f('link')} placeholder="/apply or https://…" style={bInput} />
      <label style={bLabel}>Align</label><select value={block.align || 'left'} onChange={f('align')} style={bInput}>{ALIGN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
    </>);
    case 'cards': {
      const items = block.items || [];
      const setItem = (i, patch) => update({ items: items.map((it, j) => j === i ? { ...it, ...patch } : it) });
      return (<>
        {items.map((it, i) => (
          <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 9, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input value={it.emoji || ''} onChange={(e) => setItem(i, { emoji: e.target.value })} placeholder="⭐" style={{ ...bInput, width: 52, textAlign: 'center' }} />
              <input value={it.title || ''} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Title" style={{ ...bInput, flex: 1 }} />
              <button type="button" onClick={() => update({ items: items.filter((_, j) => j !== i) })} style={{ border: 'none', background: `${RED}12`, color: RED, borderRadius: 7, width: 28, height: 28, cursor: 'pointer' }}><Ico ti="ti-trash" size={12} /></button>
            </div>
            <textarea value={it.text || ''} onChange={(e) => setItem(i, { text: e.target.value })} placeholder="Description" style={{ ...bInput, minHeight: 44, resize: 'vertical' }} />
          </div>
        ))}
        <button type="button" onClick={() => update({ items: [...items, { emoji: '✅', title: 'New card', text: '' }] })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: `1.5px dashed ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}><Ico ti="ti-plus" size={13} /> Add card</button>
      </>);
    }
    case 'html': return (<>
      <label style={bLabel}>HTML / embed code</label>
      <textarea value={block.html || ''} onChange={f('html')} style={{ ...bInput, minHeight: 120, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
    </>);
    case 'divider': return <p style={{ fontSize: 12, color: C.muted2, fontFamily: C.font, margin: 0 }}>A horizontal line — nothing to configure.</p>;
    default: return null;
  }
}

function BlockEditor({ blocks, onChange, onPickImage }) {
  const [open, setOpen] = useState(null);   // expanded block id
  const [adding, setAdding] = useState(false);
  const update = (id, patch) => onChange(blocks.map((b) => b.id === id ? { ...b, ...patch } : b));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const copy = [...blocks]; [copy[i], copy[j]] = [copy[j], copy[i]]; onChange(copy); };
  const remove = (id) => onChange(blocks.filter((b) => b.id !== id));
  const add = (type) => { const b = newBlock(type); onChange([...blocks, b]); setAdding(false); setOpen(b.id); };

  return (
    <div>
      {blocks.length === 0 && <p style={{ fontSize: 12.5, color: C.muted2, fontFamily: C.font, textAlign: 'center', padding: '18px 0' }}>No sections yet — add your first block below.</p>}
      {blocks.map((b, i) => {
        const M = blockMeta(b.type);
        const isOpen = open === b.id;
        return (
          <div key={b.id} style={{ border: `1px solid ${isOpen ? C.brand : C.border}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: isOpen ? tint(5) : C.bg, cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : b.id)}>
              <Ico ti="ti-grip-vertical" size={14} color={C.muted2} />
              <Ico lucide={M.icon} ti={M.ti} size={14} color={C.brand} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{M.label}</span>
              <button onClick={(e) => { e.stopPropagation(); move(i, -1); }} disabled={i === 0} style={{ ...miniBtn, opacity: i === 0 ? 0.3 : 1 }}><Ico ti="ti-chevron-up" size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); move(i, 1); }} disabled={i === blocks.length - 1} style={{ ...miniBtn, opacity: i === blocks.length - 1 ? 0.3 : 1 }}><Ico ti="ti-chevron-down" size={13} /></button>
              <button onClick={(e) => { e.stopPropagation(); remove(b.id); }} style={{ ...miniBtn, color: RED }}><Ico ti="ti-trash" size={12} /></button>
            </div>
            {isOpen && <div style={{ padding: '12px 12px 14px' }}><BlockFields block={b} update={(patch) => update(b.id, patch)} onPickImage={() => onPickImage(b.id)} /></div>}
          </div>
        );
      })}

      {adding ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {BLOCK_TYPES.map((t) => (
              <button key={t.type} onClick={() => add(t.type)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', textAlign: 'left', fontFamily: C.font }}>
                <Ico lucide={t.icon} ti={t.ti} size={15} color={C.brand} />
                <span><span style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.ink }}>{t.label}</span><span style={{ fontSize: 10.5, color: C.muted2 }}>{t.desc}</span></span>
              </button>
            ))}
          </div>
          <button onClick={() => setAdding(false)} style={{ marginTop: 8, width: '100%', padding: '7px', borderRadius: 8, border: 'none', background: C.bg, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '11px', borderRadius: 10, border: `1.5px dashed ${tint(53)}`, background: tint(3), color: C.brandDeep, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, marginTop: 4 }}>
          <Ico ti="ti-plus" size={15} /> Add block
        </button>
      )}
    </div>
  );
}

export { newBlock, uid, renderBlocks, BlockEditor };
