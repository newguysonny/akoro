// gp-ssrf.mjs — outbound requests to a URL somebody else supplied.
//
// The old guard parsed the hostname and refused what looked internal. That
// stops the obvious attempt and leaves two holes a hostname string cannot
// close, both tested here against real sockets:
//
//   · DNS REBINDING — the check validates a NAME, the socket connects to an
//     ADDRESS resolved afterwards.
//   · REDIRECTS — fetch follows them, so a legitimate host answering
//     "302 -> 169.254.169.254" walks straight past a check applied only to the
//     first URL.

import http from 'node:http';
import { safeFetch, isBlockedAddress, BlockedAddressError } from '../../lib/safeFetch.js';

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓ ' : '✗ FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

console.log('\n═══ SSRF ═══');

console.log('\n· Addresses that must never be reachable');
for (const [ip, why] of [
  ['169.254.169.254', 'cloud metadata'],
  ['127.0.0.1',       'loopback'],
  ['10.0.0.5',        'private'],
  ['192.168.1.1',     'private'],
  ['172.16.0.1',      'private'],
  ['100.64.0.1',      'CGNAT'],
  ['0.0.0.0',         'unspecified'],
  ['::1',             'IPv6 loopback'],
  ['fd00::1',         'IPv6 ULA'],
  ['fe80::1',         'IPv6 link-local'],
  ['::ffff:169.254.169.254', 'metadata as IPv4-mapped IPv6'],
]) check(`${why} (${ip})`, isBlockedAddress(ip) === true);

check('a public address is allowed (93.184.216.34)', isBlockedAddress('93.184.216.34') === false);

console.log('\n· A literal internal URL is refused');
for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:4800/api/admin/stats', 'http://[::1]:4800/']) {
  let blocked = false, msg = '';
  try { await safeFetch(u, { method: 'GET' }); } catch (e) { blocked = e instanceof BlockedAddressError; msg = e.message; }
  check(u.slice(0, 44), blocked, msg.slice(0, 60));
}

console.log('\n· A hostname that RESOLVES internally is refused at connect time');
// localtest.me and friends resolve to 127.0.0.1 — a public DNS name pointing
// inside, which is exactly the rebinding shape without needing a mutable zone.
let rebindBlocked = false, rebindMsg = '';
try { await safeFetch('http://localtest.me:4800/api/battle/health', { method: 'GET', timeoutMs: 4000 }); }
catch (e) { rebindBlocked = e instanceof BlockedAddressError; rebindMsg = e.message; }
check('a public name resolving to 127.0.0.1 is blocked', rebindBlocked, rebindMsg.slice(0, 70));

console.log('\n· A redirect toward an internal address is refused, not followed');
// Proved against a real socket rather than by reading the source: the server
// answers 302 -> 169.254.169.254, which fetch() would have followed.
const server = http.createServer((req, res) => {
  if (req.url === '/redirect') {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: true }));
});
await new Promise(r => server.listen(4931, '127.0.0.1', r));

// allowAddresses exists so a test can have a reachable server; nothing in the
// webhook path passes it, and it cannot be set from config or from a URL.
const REACHABLE = { allowAddresses: ['127.0.0.1'] };

let redirectErr = null;
try { await safeFetch('http://127.0.0.1:4931/redirect', { method: 'GET', ...REACHABLE }); }
catch (e) { redirectErr = e; }
check('a 302 toward the metadata endpoint is refused',
  redirectErr instanceof BlockedAddressError && /redirect/i.test(redirectErr.message),
  redirectErr?.message?.slice(0, 70));

console.log('\n· And an ordinary request still works');
const ok = await safeFetch('http://127.0.0.1:4931/hook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: { hello: 'world' }, ...REACHABLE,
});
check('200 with a body', ok.status === 200 && JSON.parse(ok.text).received === true,
  `status=${ok.status} body=${ok.text.slice(0, 40)}`);

// Without the explicit allowance, the same URL is refused — the guard is not
// weakened by the option existing.
let stillBlocked = false;
try { await safeFetch('http://127.0.0.1:4931/hook'); } catch (e) { stillBlocked = e instanceof BlockedAddressError; }
check('the same URL is refused without the explicit allowance', stillBlocked);

server.close();

console.log(`\nSSRF: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
