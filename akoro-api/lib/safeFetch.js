// lib/safeFetch.js
//
// Outbound HTTP to a URL somebody else supplied.
//
// The previous guard parsed the URL and refused a hostname that looked
// internal — localhost, private ranges, 169.254.169.254. That check is worth
// having and it stops the obvious attempt, but it leaves two holes that a
// hostname string cannot close:
//
//   1. DNS REBINDING. The check validates a NAME; the socket connects to an
//      ADDRESS resolved afterwards. `evil.example.com` can answer with a public
//      IP when checked and 169.254.169.254 a moment later when connected. The
//      only fix is to validate the address the socket is actually given, which
//      means doing it inside the lookup the socket uses — not before.
//
//   2. REDIRECTS. fetch() follows them by default, so a request to a perfectly
//      legitimate host that answers `302 -> http://169.254.169.254/latest/...`
//      sails through a hostname check that was only ever applied to the first
//      URL. Nothing about the original hostname is wrong; the destination is.
//
// So this uses node:http(s) with a guarded `lookup`, and does not follow
// redirects at all — a webhook has no reason to need one, and re-validating a
// redirect chain is a larger surface than simply refusing it.

import http  from "node:http";
import https from "node:https";
import dns   from "node:dns";
import { URL } from "node:url";

export class BlockedAddressError extends Error {
  constructor(msg) { super(msg); this.name = "BlockedAddressError"; }
}

/**
 * Is this a literal address we must never connect to?
 *
 * Covers loopback, private, link-local (which is where cloud metadata lives at
 * 169.254.169.254), carrier-grade NAT, multicast and reserved space — in both
 * families, including the IPv4-mapped IPv6 form that otherwise slips through an
 * IPv4-only check.
 */
export function isBlockedAddress(ip, family) {
  if (!ip) return true;
  const addr = String(ip).toLowerCase();

  // ::ffff:169.254.169.254 is the metadata endpoint wearing an IPv6 hat.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedAddress(mapped[1], 4);

  if (family === 6 || addr.includes(":")) {
    if (addr === "::" || addr === "::1") return true;      // unspecified, loopback
    if (/^f[cd]/.test(addr)) return true;                   // fc00::/7 unique-local
    if (/^fe[89ab]/.test(addr)) return true;                // fe80::/10 link-local
    if (/^ff/.test(addr)) return true;                      // multicast
    return false;
  }

  const p = addr.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0    ||                       // 0.0.0.0/8
    a === 10   ||                       // private
    a === 127  ||                       // loopback
    (a === 169 && b === 254) ||         // link-local — cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||  // CGNAT
    (a === 192 && b === 0)  ||          // IETF protocol assignments
    a >= 224                            // multicast + reserved
  );
}

/** Names that never need resolving to be refused. */
function isBlockedHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") ||
         h.endsWith(".local") || h.endsWith(".internal") ||
         h === "metadata.google.internal";
}

/**
 * A dns.lookup replacement that refuses blocked addresses.
 *
 * This is the whole point: it runs at CONNECT time, on the address the socket
 * is about to use, so there is no window between checking and connecting for
 * DNS to change its mind.
 */
function makeGuardedLookup(allowed = new Set()) {
  return function guardedLookup(hostname, options, callback) {
    const cb   = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : (options || {});

    dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [addresses];
      // ALL of them, not just the one we would pick: a host answering with one
      // public and one private address must not be reachable by retry.
      const bad = list.find((a) => !allowed.has(a.address) && isBlockedAddress(a.address, a.family));
      if (bad) {
        return cb(new BlockedAddressError(`Refusing to connect to ${hostname} (${bad.address}) — internal address`));
      }
      const first = list[0];
      if (opts.all) return cb(null, list);
      return cb(null, first.address, first.family);
    });
  };
}

/**
 * safeFetch — request a third-party URL with the guards above.
 *
 * Returns { status, headers, text } and never throws for an HTTP status; it
 * throws only when the request could not be made safely or at all.
 *
 * Deliberately minimal: no redirects, a hard timeout, and a capped response
 * body, because everything read here is attacker-influenced and none of it
 * should be able to hang a worker or exhaust its memory.
 */
export async function safeFetch(rawUrl, {
  method = "POST", headers = {}, body = null,
  timeoutMs = 10000, maxBytes = 256 * 1024,
  // Literal addresses to permit despite the rules above — for a deliberately
  // pinned internal integration, and for tests that need a reachable server.
  // No caller in the webhook path passes this; it cannot be set from config or
  // from a URL, only in code, on purpose.
  allowAddresses = [],
} = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new BlockedAddressError("Invalid URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new BlockedAddressError("URL must be http(s)");
  if (isBlockedHost(u.hostname))     throw new BlockedAddressError(`Host ${u.hostname} is not allowed`);
  // A literal address needs no DNS, so guardedLookup would never see it.
  const allowed = new Set(allowAddresses);
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) {
    const literal = u.hostname.replace(/^\[|\]$/g, "");
    if (!allowed.has(literal) && isBlockedAddress(literal)) {
      throw new BlockedAddressError(`Address ${u.hostname} is not allowed`);
    }
  }

  const client = u.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: u.protocol, hostname: u.hostname, port: u.port || undefined,
        path: u.pathname + u.search, method, headers,
        lookup: makeGuardedLookup(allowed),
        timeout: timeoutMs,
      },
      (res) => {
        // Not followed, on purpose — see the header. The caller is told what
        // happened rather than being silently redirected somewhere else.
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.destroy();
          return reject(new BlockedAddressError(
            `Refusing to follow a redirect (${res.statusCode} → ${res.headers.location ?? "?"})`));
        }
        let size = 0;
        const chunks = [];
        res.on("data", (c) => {
          size += c.length;
          if (size > maxBytes) { res.destroy(); return; }   // capped, not fatal
          chunks.push(c);
        });
        res.on("end", () => resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8"),
          truncated: size > maxBytes,
        }));
        res.on("error", reject);
      },
    );

    req.on("timeout", () => { req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)); });
    req.on("error", reject);
    if (body != null) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}
