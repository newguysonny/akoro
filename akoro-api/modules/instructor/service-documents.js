/**
 * instructor/service-documents.js — the instructor's printable document
 * templates (own + the shared default gallery), AI template extraction from a
 * sample, HTML rendering and saved document records.
 */
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { parseJsonLoose } from "../tasks/index.js";
import { renderDocument, DEFAULT_DOC_TEMPLATES, getDefaultDoc } from "../school/index.js";
import { DOC_FIELDS } from "./rules.js";
import {
  templatesByUser, templateByName, insertTemplateId, insertTemplateRow,
  templateByIdForUser, updateTemplate, deleteTemplate, insertDocumentRecord,
} from "./store-documents.js";

async function ensureInstrDocTemplate(userId, id) {
  if (!String(id).startsWith("default:")) return id;
  const def = getDefaultDoc(String(id).slice("default:".length));
  if (!def) return null;
  const { data: existing } = await templateByName(userId, def.name);
  if (existing) return existing.id;
  const { data: row, error } = await insertTemplateId({
    user_id: userId, name: def.name, description: def.description, category: def.category,
    page_size: def.page_size, orientation: def.orientation, body: def.body, css: def.css || null, variables: def.variables || [],
  });
  if (error) throw new Error(error.message);
  return row.id;
}

const loadDoc = async (userId, id) => {
  if (String(id).startsWith("default:")) return getDefaultDoc(String(id).slice("default:".length));
  const { data } = await templateByIdForUser(userId, id);
  return data;
};

export const listDocTemplates = async (req, res) => {
  try {
    const { data } = await templatesByUser(req.user.id, req.query.category);
    const own = (data || []).map((t) => ({ ...t, isDefault: false }));
    const names = new Set(own.map((t) => t.name));
    const defaults = DEFAULT_DOC_TEMPLATES
      .filter((t) => !names.has(t.name) && (!req.query.category || t.category === req.query.category))
      .map((t) => ({ id: `default:${t.id}`, name: t.name, description: t.description, category: t.category, page_size: t.page_size, orientation: t.orientation, variables: t.variables, isDefault: true }));
    res.json({ success: true, data: [...own, ...defaults] });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

export const createDocTemplate = async (req, res) => {
  try {
    if (!req.body.name?.trim()) return res.status(400).json({ error: "name is required" });
    const row = { user_id: req.user.id };
    for (const f of DOC_FIELDS) if (req.body[f] !== undefined) row[f] = req.body[f];
    const { data, error } = await insertTemplateRow(row);
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "You already have a template with that name" : error.message });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// AI-create a document template from an uploaded sample's OCR text.
export const createDocTemplateFromSample = async (req, res) => {
  try {
    const { name, category = "form", sourceText } = req.body;
    if (!name?.trim())       return res.status(400).json({ error: "name is required" });
    if (!sourceText?.trim()) return res.status(400).json({ error: "sourceText is required (upload a sample first)" });

    const prompt =
      `A teacher uploaded a sample of an existing printable document (extracted text below). ` +
      `Recreate it as a reusable, print-friendly HTML template that mirrors its headings, sections, order and layout. ` +
      `Replace every value that would change between documents (names, dates, scores, IDs, addresses, amounts) with a {{snake_case_placeholder}} token. ` +
      `Use self-contained inline styles only.\n\n` +
      `Return JSON only:\n{\n  "description": "<one short line>",\n  "body": "<HTML using inline styles and {{placeholders}}>",\n  "variables": [{ "key": "<snake_case>", "label": "<Human label>" }]\n}\n\n` +
      `SAMPLE:\n"""${String(sourceText).slice(0, 8000)}"""`;

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = parseJsonLoose(resp.choices?.[0]?.message?.content ?? "");
    const body = String(parsed.body || "").trim();
    if (!body) return res.status(422).json({ error: "Could not build a template from that sample" });

    const row = {
      user_id:     req.user.id,
      name:        name.trim(),
      description: parsed.description || null,
      category,
      page_size:   "A4",
      orientation: "portrait",
      body,
      css:         null,
      variables:   Array.isArray(parsed.variables) ? parsed.variables : [],
    };
    const { data, error } = await insertTemplateRow(row);
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "You already have a template with that name" : error.message });
    res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[documents/from-sample]", e.message);
    res.status(500).json({ error: e.message });
  }
};

export const updateDocTemplate = async (req, res) => {
  try {
    const patch = { updated_at: new Date() };
    for (const f of DOC_FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
    const { data, error } = await updateTemplate(req.user.id, req.params.id, patch);
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

export const deleteDocTemplate = async (req, res) => {
  try {
    const { error } = await deleteTemplate(req.user.id, req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

export const docTemplateHtml = async (req, res) => {
  try {
    const tpl = await loadDoc(req.user.id, req.params.id);
    if (!tpl) return res.status(404).type("html").send("<h1>Template not found</h1>");
    const data = req.query.sample === "1" ? (tpl.sample || {}) : {};
    res.type("html").send(renderDocument({ body: tpl.body, css: tpl.css, pageSize: tpl.page_size, orientation: tpl.orientation, data }));
  } catch (e) { res.status(500).type("html").send("<h1>Something went wrong</h1>"); }
};

export const renderDocTemplate = async (req, res) => {
  try {
    const tpl = await loadDoc(req.user.id, req.params.id);
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    const values = req.body.data || {};
    const html = renderDocument({ body: tpl.body, css: tpl.css, pageSize: tpl.page_size, orientation: tpl.orientation, data: values });
    let record = null;
    if (req.body.save) {
      const templateId = await ensureInstrDocTemplate(req.user.id, req.params.id);
      const serial = `DOC-${Date.now().toString(36).toUpperCase()}`;
      const { data: rec } = await insertDocumentRecord({
        user_id: req.user.id, template_id: templateId || null, title: req.body.title || tpl.name, serial_no: serial, data: values,
      });
      record = rec;
    }
    res.json({ success: true, html, record });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

export const previewDocument = (req, res) => {
  const { body = "", css = "", page_size = "A4", orientation = "portrait", data = {} } = req.body || {};
  res.json({ success: true, html: renderDocument({ body, css, pageSize: page_size, orientation, data }) });
};
