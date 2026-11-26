#!/usr/bin/env node
/**
 * Documentation secret scan.
 *
 * Dependency-free scan of the documentation trees for credential-shaped
 * content:
 *   - private-key blocks;
 *   - common token prefixes (OpenAI-style keys, GitHub, AWS, Slack, Google);
 *   - JWT-shaped strings;
 *   - Bearer headers carrying a real-looking token;
 *   - credential assignments with non-placeholder literal values;
 *   - long high-entropy strings in prose (outside code fences in Markdown).
 *
 * Scans akoro-documentation/ and, when present, akoro-docs/content/.
 * Documented demo credentials and obvious placeholders are allowlisted.
 * Matched values are never printed in full.
 *
 * Run from the repository root:
 *   node akoro-documentation/scripts/validate-secrets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { docRoot, repoRoot } from "./lib.mjs";

const SCAN_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".yaml", ".yml", ".json", ".csv", ".mjs", ".js",
]);
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const MAX_FILE_BYTES = 1024 * 1024;

// Values that are documentation, not credentials: placeholders, markers and
// the sandbox demo credentials the smoke scripts and docs use on purpose.
const PLACEHOLDER = /example|demo|placeholder|sample|xxxx|changeme|change-me|redacted|your[-_]|<[^>]*>|\*\*\*|dummy|password123!/i;
const ENV_NAME_ONLY = /^[A-Z][A-Z0-9_]+$/; // a bare env var NAME is a reference

const RULES = [
  {
    id: "private-key",
    description: "private key block",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  {
    id: "token-prefix",
    description: "known token prefix (OpenAI/GitHub/AWS/Slack/Google)",
    pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}|(?<![A-Za-z0-9])(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{50,}|\bAKIA[0-9A-Z]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "jwt",
    description: "JWT-shaped string",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "bearer-token",
    description: "Bearer header with a non-placeholder token",
    pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}={0,2})/g,
    valueGroup: 1,
  },
  {
    id: "credential-assignment",
    description: "credential assigned a literal value",
    pattern: /\b(?:password|passwd|pwd|api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    valueGroup: 1,
  },
  {
    id: "credential-assignment-bare",
    description: "credential assigned a bare literal value",
    pattern: /\b(?:password|passwd|api[_-]?key|apikey|secret)\s*:\s+([^\s`"']{8,})/gi,
    valueGroup: 1,
    proseOnly: true,
  },
];

function shannonEntropy(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isPlaceholder(value) {
  return PLACEHOLDER.test(value) || ENV_NAME_ONLY.test(value);
}

function redact(value) {
  return value.length <= 6 ? "…" : `${value.slice(0, 4)}…(${value.length} chars)`;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

const findings = [];
let filesScanned = 0;

function scanFile(file) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) return;
  filesScanned += 1;
  const isProse = PROSE_EXTENSIONS.has(path.extname(file).toLowerCase());
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inFence = false;
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;
    for (const rule of RULES) {
      if (rule.proseOnly && !isProse) continue;
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        const value = rule.valueGroup ? match[rule.valueGroup] : match[0];
        if (value && isPlaceholder(value)) continue;
        findings.push({ file, line: lineNo, rule: rule.id, description: rule.description, value: value || match[0] });
      }
    }
    // Entropy check: prose only, outside code fences, URLs stripped first.
    if (isProse && !inFence) {
      const withoutUrls = line.replace(/https?:\/\/\S+/g, " ");
      for (const token of withoutUrls.match(/[A-Za-z0-9+/=_-]{48,}/g) || []) {
        if (isPlaceholder(token)) continue;
        if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) continue;
        if (token.includes(".") || token.includes("_") && !/[A-Z]/.test(token)) continue;
        if (shannonEntropy(token) < 4.2) continue;
        findings.push({ file, line: lineNo, rule: "high-entropy", description: "long high-entropy string in prose", value: token });
      }
    }
  });
}

const roots = [docRoot];
const publicContent = path.join(repoRoot, "akoro-docs", "content");
if (fs.existsSync(publicContent)) roots.push(publicContent);
else console.log("note: akoro-docs/content not present; scanning akoro-documentation only.");

for (const root of roots) {
  for (const file of walk(root)) scanFile(file);
}

if (findings.length) {
  console.error(`Secret scan failed (${findings.length} finding${findings.length === 1 ? "" : "s"}):`);
  for (const finding of findings) {
    const shown = path.relative(repoRoot, finding.file).split(path.sep).join("/");
    console.error(`- ${shown}:${finding.line}: ${finding.rule} — ${finding.description}: ${redact(finding.value)}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed: ${filesScanned} files scanned, no credential-shaped content found.`);
