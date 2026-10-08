/**
 * modules/hfmirror/engine.js — the Hugging Face model mirror engine.
 *
 * A Node port of the classic three-step Python flow:
 *
 *   snapshot_download(repo_id=…)  →  list every file in the source revision
 *   create_repo(…)                →  create the destination model repo
 *   upload_folder(…)              →  transfer the files
 *
 * The Hub library's newer copy APIs (copyFolder / copyFiles) only target
 * Buckets, not model repos, so the transfer here is per-file: each source
 * file streams from the resolve endpoint to a temp file on disk, is
 * re-uploaded from that disk-backed FileBlob (lazy reads — the file is
 * never fully buffered in RAM), then deleted. One file in flight keeps
 * RAM and disk flat on a small Render instance, and on xet-backed repos
 * the re-upload dedupes server-side, so weight files the Hub already
 * stores move very little actual data.
 *
 * The engine reports progress through the onLog hook and returns a
 * summary — no console, no process.exit — so the HTTP console, a CLI
 * script and the contract test can all drive it. Tokens never reach the
 * log: every line and failure message goes through scrub(), which
 * redacts anything shaped like hf_****.
 */
import { openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepo, listFiles, uploadFiles, whoAmI } from "@huggingface/hub";

export const DEFAULT_HUB_URL    = "https://huggingface.co";
export const DEFAULT_REVISION   = "main";
export const DEFAULT_MAX_FILE_MB = 8192;   // 8 GB per file — Render disks are small

/* ── Pure helpers (exported for the contract test) ────────────────────── */

const HF_TOKEN_RE = /\bhf_[A-Za-z0-9]{16,}\b/g;

/** Redact anything shaped like an access token ("hf_…") from free text. */
export const scrub = (text) => String(text ?? "").replace(HF_TOKEN_RE, "hf_***");

/**
 * parseRepoId — accept "org/name", a full hf.co URL, or "models/org/name",
 * and return { ok, id } or { ok: false, error }. Pure.
 */
export function parseRepoId(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return { ok: false, error: "a repo id like 'org/model' is required" };
  s = s.replace(/^https?:\/\/[^/]+\//i, "").replace(/^models\//i, "").replace(/\.git$/i, "");
  const parts = s.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: `'${s}' is not a valid repo id — use owner/name` };
  }
  if (s.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(parts[0]) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(parts[1])) {
    return { ok: false, error: `'${s}' has characters the Hub doesn't allow` };
  }
  return { ok: true, id: `${parts[0]}/${parts[1]}` };
}

/** resolveTarget — explicit target wins; otherwise account/source-name. */
export function resolveTarget({ target, sourceId, accountName }) {
  if (target) {
    const t = parseRepoId(target);
    if (!t.ok) return t;
    return { ok: true, id: t.id };
  }
  if (!accountName) return { ok: false, error: "no target given and the token doesn't identify an account" };
  return { ok: true, id: `${accountName}/${sourceId.split("/")[1]}` };
}

/** 1073741824 → "1.0 GB". Pure. */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
  return `${(v / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ── The job itself ────────────────────────────────────────────────────── */

/**
 * runMirrorJob — mirror one model repo into the caller's account.
 *
 * params:
 *   source       "org/model" (required)
 *   target       "org/name" or null → <token account>/<source name>
 *   isPrivate    destination visibility (default true — the safe default)
 *   revision     source git ref (default "main")
 *   dryRun       plan only, touch nothing (default true — the safe default)
 *   maxFileMb    per-file size cap (default DEFAULT_MAX_FILE_MB)
 *   writeToken   WRITE token for the destination account (required)
 *   sourceToken  read token for the source (default: writeToken — right
 *                for same-account mirrors and most gated models)
 *   hubUrl       override for tests
 *   fetchImpl    fetch override handed to the Hub calls (tests/proxies)
 *
 * hooks: { onLog(line) } — scrubbed, human-readable progress lines.
 *
 * Returns a summary { dryRun, ok, source, target, files, copied,
 * transferredBytes, totalBytes, failures[], durationMs }. Throws on
 * setup errors (bad id, bad token, empty source); per-file failures are
 * collected in failures[] so one bad file doesn't kill the mirror.
 */
export async function runMirrorJob(params, hooks = {}) {
  const {
    source, target = null, isPrivate = true, revision = DEFAULT_REVISION,
    dryRun = true, maxFileMb = DEFAULT_MAX_FILE_MB, hubUrl = DEFAULT_HUB_URL,
    writeToken, sourceToken = null, fetchImpl = null,
  } = params;
  const log = (line) => hooks.onLog?.(scrub(line));
  const fx = fetchImpl ?? undefined;          // hub treats undefined as absent
  const started = Date.now();

  const src = parseRepoId(source);
  if (!src.ok) throw new Error(src.error);
  log(`[hf-mirror] source ${src.id} @ ${revision}${dryRun ? " (dry run)" : ""}`);

  /* 1 · Whose token is this? Validates the token and names the default
     destination namespace in one call. */
  const me = await whoAmI({ accessToken: writeToken, hubUrl, fetch: fx });
  const accountName = me?.name;
  if (!accountName) throw new Error("that token doesn't identify an account — create a token with WRITE access at hf.co/settings/tokens");
  log(`[hf-mirror] token ok — account ${accountName}`);

  const dst = resolveTarget({ target, sourceId: src.id, accountName });
  if (!dst.ok) throw new Error(dst.error);

  /* 2 · Plan: list every file in the source revision. */
  const files = [];
  let totalBytes = 0;
  let lfsFiles = 0;
  for await (const entry of listFiles({
    repo: { name: src.id, type: "model" }, revision,
    accessToken: sourceToken || writeToken, hubUrl, fetch: fx,
  })) {
    if (entry?.type !== "file") continue;
    files.push(entry);
    totalBytes += entry.size || 0;
    if (entry.lfs) lfsFiles += 1;
  }
  if (!files.length) throw new Error(`no files found at ${src.id}@${revision} — check the repo id, the revision, and that the token can read it (gated models: accept the licence on the model page first)`);
  log(`[hf-mirror] plan: ${files.length} files · ${formatBytes(totalBytes)} (${lfsFiles} LFS/xet-backed) → ${dst.id}${isPrivate ? " (private)" : " (public)"}`);
  for (const f of files.slice(0, 15)) log(`[hf-mirror]   · ${f.path} (${formatBytes(f.size || 0)})`);
  if (files.length > 15) log(`[hf-mirror]   · … and ${files.length - 15} more`);

  if (dryRun) {
    log("[hf-mirror] dry run — nothing was created or uploaded. Re-run with dry run off to mirror for real.");
    return { dryRun: true, ok: true, source: src.id, target: dst.id, revision, files: files.length, copied: 0, transferredBytes: 0, totalBytes, failures: [], durationMs: Date.now() - started };
  }

  /* 3 · Create the destination repo ("already exists" is fine — the
     mirror just re-commits into it). */
  try {
    await createRepo({
      repo: { name: dst.id, type: "model" },
      visibility: isPrivate ? "private" : "public",
      accessToken: writeToken, hubUrl, fetch: fx,
    });
    log(`[hf-mirror] created ${dst.id}${isPrivate ? " (private)" : ""}`);
  } catch (err) {
    if (!/exist/i.test(String(err?.message || err))) throw err;
    log(`[hf-mirror] ${dst.id} already exists — mirroring into it`);
  }

  /* 4 · Transfer, one file at a time: resolve → temp file → FileBlob
     upload → delete. Sequential keeps RAM and disk flat. */
  const capBytes = maxFileMb * 1024 * 1024;
  const dir = await mkdtemp(join(tmpdir(), "hf-mirror-"));
  const failures = [];
  let copied = 0;
  let transferred = 0;
  try {
    for (const [i, f] of files.entries()) {
      const label = `[hf-mirror] (${i + 1}/${files.length}) ${f.path}`;
      if ((f.size || 0) > capBytes) {
        log(`${label} — SKIPPED: ${formatBytes(f.size)} is over the ${maxFileMb} MB per-file cap (set HF_MAX_FILE_MB to raise it)`);
        failures.push({ path: f.path, error: `${formatBytes(f.size)} is over the ${maxFileMb} MB per-file cap` });
        continue;
      }
      const tmpPath = join(dir, `file-${i}.bin`);
      try {
        const segs = f.path.split("/").map(encodeURIComponent).join("/");
        const url = `${hubUrl}/${src.id}/resolve/${encodeURIComponent(revision)}/${segs}`;
        const headers = {};
        if (sourceToken || writeToken) headers.authorization = `Bearer ${sourceToken || writeToken}`;
        const res = await fetch(url, { headers, redirect: "follow" });
        if (!res.ok || !res.body) {
          throw new Error(res.status === 401 || res.status === 403
            ? `HTTP ${res.status} — the token can't read this file (gated model? accept its licence with the source account first)`
            : `HTTP ${res.status} downloading the file`);
        }
        await pipeline(res.body, createWriteStream(tmpPath));
        const up = await uploadFiles({
          repo: { name: dst.id, type: "model" },
          files: [{ path: f.path, content: openAsBlob(tmpPath) }],
          commitTitle: `Mirror ${src.id}@${revision}`,
          accessToken: writeToken, hubUrl, fetch: fx,
        });
        copied += 1;
        transferred += f.size || 0;
        log(`${label} — done (${formatBytes(f.size)})`);
        void up;
      } catch (err) {
        log(`${label} — FAILED: ${err?.message || err}`);
        failures.push({ path: f.path, error: scrub(String(err?.message || err)) });
      } finally {
        await rm(tmpPath, { force: true }).catch(() => {});
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const ok = failures.length === 0;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  log(`[hf-mirror] ${ok ? "mirror complete" : `mirror finished with ${failures.length} failure(s)`}: ${copied}/${files.length} files · ${formatBytes(transferred)} moved · ${seconds}s`);
  if (!ok) log("[hf-mirror] re-run the job to retry — existing files re-commit idempotently, missing ones transfer.");
  return { dryRun: false, ok, source: src.id, target: dst.id, revision, files: files.length, copied, transferredBytes: transferred, totalBytes, failures, durationMs: Date.now() - started };
}
