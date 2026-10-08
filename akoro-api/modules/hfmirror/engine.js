/**
 * modules/hfmirror/engine.js — the Hugging Face model mirror engine.
 *
 * A Node port of the classic three-step Python flow:
 *
 *   snapshot_download(repo_id=…)  →  list every file in the source revision
 *   create_repo(…)                →  create the destination model repo
 *   upload_folder(…)              →  transfer the files
 *
 * The real run prefers the Hub's SERVER-SIDE duplicate
 * (POST /api/models/{src}/duplicate — the same call huggingface_hub's
 * duplicate_repo makes): git history and LFS/xet objects are copied by
 * the Hub itself, so not one byte of model weight crosses this process.
 * An 8 GB mirror costs a single HTTP call and cannot OOM a small
 * Render instance — which the previous file-by-file path did: the JS
 * xet uploader runs five parallel shard streams (~64 MB of buffers
 * each, plus the chunking WASM heap), and a 4.6 GB safetensors shard
 * took the service over its memory limit mid-run.
 *
 * The per-file path remains for everything duplicate can't do
 * (non-main revisions, or a duplicate the Hub refused), with two hard
 * lessons baked in:
 *
 *   · RESUME — the destination's file list is read once and any source
 *     file already present there is skipped. Git commits are atomic, so
 *     a file is either present complete or absent: after a crash or an
 *     OOM restart, re-running the mirror transfers only what's missing.
 *
 *   · BOUNDED MEMORY — the per-file uploads run with useXet:false, so
 *     each file rides a single basic/multipart stream instead of the
 *     parallel xet shard buffers.
 *
 * Each file is still handed to uploadFiles as its source *resolve URL* —
 * the library's WebBlob lazily range-fetches it (so gated sources work,
 * with the token attached) and nothing is ever buffered to disk.
 *
 * The engine reports progress through the onLog hook and returns a
 * summary — no console, no process.exit — so the HTTP console, a CLI
 * script and the contract test can all drive it. Tokens never reach the
 * log: every line and failure message goes through scrub(), which
 * redacts anything shaped like hf_****.
 */
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

  /* 3 · Server-side duplicate first — the whole repo (history, LFS and
     xet objects included) copied by the Hub, no bytes through here.
     Applies to the default revision only: a duplicate has no revision
     parameter, and mirroring a branch means deviating from main. */
  let duplicated = false;
  if (revision === DEFAULT_REVISION) {
    try {
      const res = await (fx ?? fetch)(`${hubUrl}/api/models/${src.id}/duplicate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${writeToken}`,
        },
        body: JSON.stringify({
          repository: dst.id,
          visibility: isPrivate ? "private" : "public",
        }),
      });
      const text = await res.text();
      if (res.ok) {
        const json = JSON.parse(text || "{}");
        duplicated = true;
        log(`[hf-mirror] server-side duplicate of ${src.id} → ${dst.id} accepted — no model bytes moved through this server`);
        if (json.filesCopyPending) log("[hf-mirror] the Hub is copying the LFS/xet files in the background — downloads may 404 briefly");
      } else if (res.status === 409 || /already|exist/i.test(text)) {
        log(`[hf-mirror] ${dst.id} already exists — resuming into it file-by-file`);
      } else {
        log(`[hf-mirror] server-side duplicate refused (${res.status}) — transferring file-by-file`);
      }
    } catch (err) {
      log(`[hf-mirror] server-side duplicate unavailable (${String(err?.message || err).slice(0, 120)}) — transferring file-by-file`);
    }
  }

  /* 4 · Create the destination repo when the duplicate path didn't make
     it ("already exists" in any of the Hub's phrasings is fine — the
     mirror just re-commits into it). */
  if (!duplicated) {
    try {
      await createRepo({
        repo: { name: dst.id, type: "model" },
        visibility: isPrivate ? "private" : "public",
        accessToken: writeToken, hubUrl, fetch: fx,
      });
      log(`[hf-mirror] created ${dst.id}${isPrivate ? " (private)" : ""}`);
    } catch (err) {
      if (!/already|exist/i.test(String(err?.message || err))) throw err;
      log(`[hf-mirror] ${dst.id} already exists — mirroring into it`);
    }
  }

  /* 5 · Transfer what's missing, one file at a time: each file is
     committed as its source resolve URL — the library lazily
     range-fetches it (auth attached) and streams the upload; useXet
     stays off so memory stays a single stream, not five shard buffers. */
  /* Resume: a git commit is atomic, so a file already in the
     destination is complete — skip it. After a crash or restart,
     re-running transfers only the missing files. */
  const already = new Set();
  if (!duplicated) {
    try {
      for await (const entry of listFiles({
        repo: { name: dst.id, type: "model" },
        accessToken: writeToken, hubUrl, fetch: fx,
      })) {
        if (entry?.type === "file") already.add(entry.path);
      }
    } catch (err) {
      log(`[hf-mirror] could not list the destination (${String(err?.message || err).slice(0, 120)}) — transferring everything`);
    }
  }

  const capBytes = maxFileMb * 1024 * 1024;
  const failures = [];
  let copied = 0;
  let transferred = 0;
  for (const [i, f] of files.entries()) {
    if (duplicated) break;
    const label = `[hf-mirror] (${i + 1}/${files.length}) ${f.path}`;
    if (already.has(f.path)) {
      copied += 1;
      transferred += f.size || 0;
      log(`${label} — already in the destination, skipped (resume)`);
      continue;
    }
    if ((f.size || 0) > capBytes) {
      log(`${label} — SKIPPED: ${formatBytes(f.size)} is over the ${maxFileMb} MB per-file cap (set HF_MAX_FILE_MB to raise it)`);
      failures.push({ path: f.path, error: `${formatBytes(f.size)} is over the ${maxFileMb} MB per-file cap` });
      continue;
    }
    try {
      const segs = f.path.split("/").map(encodeURIComponent).join("/");
      const url = new URL(`${hubUrl}/${src.id}/resolve/${encodeURIComponent(revision)}/${segs}`);
      const up = await uploadFiles({
        repo: { name: dst.id, type: "model" },
        files: [{ path: f.path, content: url }],
        commitTitle: `Mirror ${src.id}@${revision}`,
        accessToken: writeToken, hubUrl, fetch: fx,
        useXet: false,   // single-stream basic/multipart — the xet sharder's parallel buffers OOM small instances
      });
      copied += 1;
      transferred += f.size || 0;
      log(`${label} — done (${formatBytes(f.size)})`);
      void up;
    } catch (err) {
      const raw = String(err?.message || err);
      const friendly = /\b(401|403)\b/.test(raw)
        ? `${raw} — the token can't read this file (gated model? accept its licence with the source account first)`
        : raw;
      log(`${label} — FAILED: ${friendly}`);
      failures.push({ path: f.path, error: scrub(friendly) });
    }
  }

  const ok = failures.length === 0;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (duplicated) {
    log(`[hf-mirror] mirror complete (server-side duplicate): ${files.length} files · 0 B moved · ${seconds}s`);
    return { dryRun: false, ok: true, duplicated: true, source: src.id, target: dst.id, revision, files: files.length, copied: files.length, transferredBytes: 0, totalBytes, failures: [], durationMs: Date.now() - started };
  }
  log(`[hf-mirror] ${ok ? "mirror complete" : `mirror finished with ${failures.length} failure(s)`}: ${copied}/${files.length} files · ${formatBytes(transferred)} moved · ${seconds}s`);
  if (!ok) log("[hf-mirror] re-run the job to retry — files already in the destination are skipped, only the missing ones transfer.");
  return { dryRun: false, ok, duplicated: false, source: src.id, target: dst.id, revision, files: files.length, copied, transferredBytes: transferred, totalBytes, failures, durationMs: Date.now() - started };
}
