#!/usr/bin/env node
/**
 * Documentation gap report (report-only; always exits 0).
 *
 * Surfaces three kinds of drift for the weekly docs-health run:
 *   1. akoro-api module directories with no feature doc or category mention
 *      anywhere in akoro-documentation/;
 *   2. capabilities in capability-registry.yaml still at beta/planned —
 *      the live-verification backlog;
 *   3. documents whose frontmatter last_reviewed is older than 90 days.
 *
 * Prints a Markdown report to stdout.
 *
 * Run from the repository root:
 *   node akoro-documentation/scripts/check-doc-gaps.mjs [--modules-dir <path>]
 */
import fs from "node:fs";
import path from "node:path";
import { docRoot as root, repoRoot } from "./lib.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const modulesDir = path.resolve(arg("--modules-dir", path.join(repoRoot, "akoro-api", "modules")));
const STALE_DAYS = 90;
const today = new Date();
const todayIso = today.toISOString().slice(0, 10);

function walk(dir, extensions, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, extensions, out);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(repoRoot, p).split(path.sep).join("/");
const lines = [];
lines.push("# Documentation gap report", "", `Generated: ${todayIso}`, "");

// --- 1. Modules without documentation -------------------------------------
lines.push("## API modules with no documentation mention", "");
let undocumentedModules = [];
if (!fs.existsSync(modulesDir)) {
  lines.push(`Modules directory not found at \`${rel(modulesDir)}\`; pass --modules-dir to check this section.`, "");
} else {
  const moduleNames = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const docText = walk(root, new Set([".md"]))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n")
    .toLowerCase();
  undocumentedModules = moduleNames.filter((name) => {
    const spaced = name.replace(/[-_]+/g, " ");
    return !docText.includes(name.toLowerCase()) && !docText.includes(spaced);
  });
  if (undocumentedModules.length === 0) {
    lines.push("None. Every top-level module directory is mentioned in the documentation.", "");
  } else {
    lines.push(
      `${undocumentedModules.length} of ${moduleNames.length} module directories are not mentioned in any akoro-documentation Markdown file:`,
      "",
      ...undocumentedModules.map((name) => `- \`akoro-api/modules/${name}\``),
      "",
    );
  }
}

// --- 2. Capability verification backlog ------------------------------------
// Line-based read of the registry: the file's shape is stable (one
// "- id:" item per capability) and this script stays dependency-free.
lines.push("## Capability verification backlog (beta / planned)", "");
const backlog = [];
const registryPath = path.join(root, "capability-registry.yaml");
if (fs.existsSync(registryPath)) {
  let current = null;
  for (const line of fs.readFileSync(registryPath, "utf8").split("\n")) {
    const idMatch = line.match(/^\s*-\s+id:\s*(\S+)\s*$/);
    if (idMatch) {
      current = { id: idMatch[1] };
      backlog.push(current);
      continue;
    }
    if (!current) continue;
    const nameMatch = line.match(/^\s+name:\s*(.+)$/);
    if (nameMatch && !current.name) current.name = nameMatch[1].trim();
    const statusMatch = line.match(/^\s+status:\s*(\S+)\s*$/);
    if (statusMatch && !current.status) current.status = statusMatch[1];
    const verificationMatch = line.match(/^\s+verification_status:\s*(\S+)\s*$/);
    if (verificationMatch && !current.verificationStatus) current.verificationStatus = verificationMatch[1];
  }
}
const pending = backlog.filter((cap) => cap.status === "beta" || cap.status === "planned");
if (pending.length === 0) {
  lines.push("None. No capability is at beta or planned status.", "");
} else {
  lines.push(
    `${pending.length} of ${backlog.length} registered capabilities are not yet verified as implemented:`,
    "",
    "| Capability | Name | Status | Verification |",
    "| --- | --- | --- | --- |",
    ...pending.map((cap) => `| ${cap.id} | ${cap.name || ""} | ${cap.status} | ${cap.verificationStatus || "—"} |`),
    "",
  );
}

// --- 3. Stale documents ------------------------------------------------------
lines.push(`## Documents not reviewed in ${STALE_DAYS}+ days`, "");
const stale = [];
for (const file of walk(root, new Set([".md"]))) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^last_reviewed:\s*"?(\d{4}-\d{2}-\d{2})"?/m);
  if (!match) continue;
  const ageDays = Math.floor((today - new Date(`${match[1]}T00:00:00Z`)) / 86400000);
  if (ageDays > STALE_DAYS) stale.push({ file: rel(file), lastReviewed: match[1], ageDays });
}
stale.sort((a, b) => b.ageDays - a.ageDays);
if (stale.length === 0) {
  lines.push("None. Every document with a last_reviewed date is within the review window.", "");
} else {
  lines.push(
    "| Document | Last reviewed | Age (days) |",
    "| --- | --- | ---: |",
    ...stale.map((doc) => `| ${doc.file} | ${doc.lastReviewed} | ${doc.ageDays} |`),
    "",
  );
}

lines.push(
  "---",
  `Summary: ${undocumentedModules.length} undocumented modules, ${pending.length} capabilities awaiting verification, ${stale.length} stale documents.`,
);

console.log(lines.join("\n"));
