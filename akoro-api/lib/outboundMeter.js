/**
 * lib/outboundMeter.js — measure what Render bills as "Service-Initiated".
 *
 * Render's Hobby bandwidth cap counts EVERYTHING the service sends, and the
 * dashboard that suspended this workspace showed 5.67 GB of it in four days
 * with 15 MB of HTTP responses — the app itself was sending gigabytes out:
 * LLM prompts, speech-to-text audio, Supabase request bodies and header
 * volume. Nothing measured outbound bytes, so "what is eating it?" could
 * only be answered by elimination.
 *
 * This patches global fetch BEFORE any client library is constructed
 * (import it first in app.js) and counts, per destination host:
 *   - request body bytes (exact: strings, buffers, Blobs/Files, FormData)
 *   - + a header estimate (the wire also carries method, URL and ~15 headers;
 *     a service making a million small calls a day is billed for them too)
 *
 * Known gaps, on purpose: axios and the AWS SDK use node:http, not fetch —
 * R2 uploads and axios calls are NOT counted here (they remain visible in
 * Render's own per-service chart). ioredis traffic is RESP over TCP and is
 * not counted. This meter is for ATTRIBUTION (which host, what pattern);
 * Render's dashboard remains the source of truth for the invoice.
 */

const HEADER_ESTIMATE_BYTES = 400;

const state = {
  since: new Date().toISOString(),
  totalBytes: 0,
  requests: 0,
  byHost: new Map(),   // host → { requests, bytes }
  hours: [],            // rolling 24h ring: { hour, bytes }
};

const hourIndex = () => Math.floor(Date.now() / 3_600_000);

function tick(hour, bytes) {
  const last = state.hours[state.hours.length - 1];
  if (!last || last.hour !== hour) {
    state.hours.push({ hour, bytes });
    while (state.hours.length > 24) state.hours.shift();
  } else {
    last.bytes += bytes;
  }
}

export function recordOutbound(host, bytes) {
  const row = state.byHost.get(host) || { requests: 0, bytes: 0 };
  row.requests++; row.bytes += bytes;
  state.byHost.set(host, row);
  state.totalBytes += bytes;
  state.requests++;
  tick(hourIndex(), bytes);
}

export function outboundSummary() {
  return {
    since: state.since,
    totalBytes: state.totalBytes,
    requests: state.requests,
    last24hBytes: state.hours.reduce((s, h) => s + h.bytes, 0),
    hours: state.hours,
    hosts: [...state.byHost.entries()]
      .map(([host, v]) => ({ host, ...v, avgBytes: Math.round(v.bytes / Math.max(v.requests, 1)) }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

function bodyBytes(body) {
  try {
    if (body == null) return 0;
    if (typeof body === "string") return body.length;
    if (typeof body === "number" || typeof body === "boolean") return String(body).length;
    if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;   // File extends Blob
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString().length;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      let total = 0;
      for (const [, value] of body.entries()) {
        if (typeof value === "string") total += value.length;
        else if (value && typeof value.size === "number") total += value.size;
      }
      return total;
    }
    return 0;   // streams and unknowns: unmeasured, never blocked
  } catch {
    return 0;
  }
}

/* The node:http plane — axios (Zoom/Google calls in the live-session
   scheduler), the AWS SDK (R2 uploads), and anything else not on fetch.
   Patched on ClientRequest.prototype so it catches every client no matter
   how the request was created. Node's undici (global fetch) has its own
   connector and never touches ClientRequest, so nothing is double-counted.
   Loopback requests are left out — a service talking to itself is not the
   egress Render bills. */
import http from "node:http";
const CR = http.ClientRequest?.prototype;
if (CR && !Object.prototype.hasOwnProperty.call(CR, "__akoroMetered")) {
  try {
    Object.defineProperty(CR, "__akoroMetered", { value: true, configurable: true });
    const origWrite = CR.write;
    CR.write = function akoroMeteredWrite(chunk, ...rest) {
      try {
        if (chunk != null && (typeof chunk === "string" || typeof chunk === "object")) {
          this.__akoroSent = (this.__akoroSent || 0) + (chunk.length ?? 0);
        }
      } catch { /* metering must never break a request */ }
      return origWrite.call(this, chunk, ...rest);
    };
    const origEnd = CR.end;
    CR.end = function akoroMeteredEnd(chunk, ...rest) {
      try {
        let body = this.__akoroSent || 0;
        if (chunk != null && (typeof chunk === "string" || typeof chunk === "object") && typeof chunk !== "function") {
          body += chunk.length ?? 0;
        }
        const host = String(this.host || this.getHeader?.("host") || "(http-other)");
        // Loopback (the task worker calling this API over 127.0.0.1) is not
        // billable egress; everything else counts.
        if (!/^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(host)) {
          recordOutbound(host, HEADER_ESTIMATE_BYTES + body);
        }
        this.__akoroSent = 0;
      } catch { /* metering must never break a request */ }
      return origEnd.call(this, chunk, ...rest);
    };
  } catch { /* a metering patch failure must never stop the app */ }
}

const origFetch = globalThis.fetch?.bind(globalThis);
if (typeof origFetch === "function" && !globalThis.__akoroOutboundMetered) {
  globalThis.__akoroOutboundMetered = true;
  globalThis.fetch = function akoroMeteredFetch(input, init = undefined) {
    try {
      const url = typeof input === "string" || (typeof URL !== "undefined" && input instanceof URL)
        ? String(input)
        : (input && typeof input.url === "string" ? input.url : "");
      let host = "(other)";
      try { host = new URL(url).host || "(other)"; } catch { /* keep "(other)" */ }
      const body = init?.body !== undefined ? init.body : (input && typeof input === "object" && !input.blobUsed ? input.body : undefined);
      recordOutbound(host, HEADER_ESTIMATE_BYTES + url.length + bodyBytes(body));
    } catch { /* metering must never break a request */ }
    return origFetch(input, init);
  };
}
