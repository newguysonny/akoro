/**
 * lib/proxyTrust.js — proxy trust and the one-shot X-Forwarded-For diagnostic
 * (Phase 19 step 4). Called by app.js after the health routes and before the
 * rate-limit middleware, exactly where the block lived before.
 */

/** Private, loopback and carrier-grade-NAT ranges — never a real visitor. */
function isNonRoutable(ip) {
  if (!ip) return true;
  const v4 = String(ip).replace(/^::ffff:/, "");
  return /^(10\.|127\.|192\.168\.|169\.254\.|::1$|fc|fd)/.test(v4)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(v4)
      || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4);   // 100.64.0.0/10
}

/**
 * Proxy trust — deliberately opt-in.
 *
 * req.ip is the socket peer unless Express is told how many proxies sit in
 * front. On a platform edge that means every visitor shares one address, so
 * every IP-keyed limit (login: 5 per 15 min) is one bucket for everybody.
 *
 * The fix is a HOP COUNT, never `true`: trusting the whole chain lets a caller
 * spoof X-Forwarded-For and pick their own bucket, which is worse than sharing
 * one. Left unset by default so this change can't silently make things less
 * safe. The diagnostic below reads the hop count off a real request and tells
 * you the number to use — guessing it gets you an intermediate proxy, not the
 * visitor.
 */
export function applyProxyTrust(app) {
  if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== "") {
    const hops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
    console.log(`[security] trust proxy = ${process.env.TRUST_PROXY}`);
  }

  /**
   * One-shot diagnostic: print what the first API request actually looks like,
   * and work out the hop count rather than guessing it.
   *
   * X-Forwarded-For is built left-to-right: the leftmost entry is the original
   * client, and each proxy appends the address it received the request from. So
   * the number of entries IS the number of hops to trust — with two entries,
   * TRUST_PROXY=1 yields the intermediate proxy, not the visitor.
   */
  let ipProbed = false;
  app.use("/api", (req, _res, next) => {
    if (!ipProbed) {
      ipProbed = true;
      const xff  = req.headers["x-forwarded-for"];
      const hops = xff ? String(xff).split(",").length : 0;

      console.log("[security] first request — req.ip=%s socket=%s x-forwarded-for=%s trustProxy=%s",
        req.ip, req.socket?.remoteAddress, xff ?? "(none)", app.get("trust proxy") ?? "(unset)");

      if (!process.env.TRUST_PROXY && hops) {
        console.warn(`[security] X-Forwarded-For has ${hops} hop(s) but TRUST_PROXY is unset — ` +
          "IP-keyed limits (login, refresh) are keying on the proxy, i.e. ONE bucket for every " +
          `visitor. Set TRUST_PROXY=${hops} and redeploy.`);
      } else if (process.env.TRUST_PROXY) {
        // Two ways the count can be wrong, and only one of them LOOKS wrong.
        const trusted = Number(process.env.TRUST_PROXY);
        if (Number.isFinite(trusted) && hops > trusted) {
          // The case that slipped through the first time: req.ip resolved to a
          // proxy with a perfectly ordinary public address, so nothing looked
          // amiss — it was simply the wrong machine. Compare the counts rather
          // than judging the address. (A client can pad X-Forwarded-For, so this
          // is phrased as a prompt to check, not a verdict.)
          console.warn(`[security] TRUST_PROXY=${trusted} but X-Forwarded-For has ${hops} hop(s), so ` +
            `req.ip=${req.ip} is a proxy rather than the visitor — everyone behind it shares one ` +
            `rate-limit bucket. If ${hops} hops is your normal setup, set TRUST_PROXY=${hops}.`);
        } else if (isNonRoutable(req.ip)) {
          console.warn(`[security] TRUST_PROXY=${process.env.TRUST_PROXY} but req.ip=${req.ip} is a ` +
            `private or carrier-NAT address, so it is not the visitor. X-Forwarded-For has ` +
            `${hops} hop(s) — try TRUST_PROXY=${hops}.`);
        }
      }
    }
    next();
  });
}
