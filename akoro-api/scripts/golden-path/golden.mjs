const API = 'http://127.0.0.1:4800';
const jar = new Map();
let pass = 0, fail = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
  return ok;
};

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Akoro-Portal': who.portal };
  if (jar.get(who.key)) headers.Cookie = jar.get(who.key);
  const res = await fetch(API + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const cur = new Map((jar.get(who.key) ?? '').split('; ').filter(Boolean).map(c => [c.split('=')[0], c]));
    for (const c of set) { const kv = c.split(';')[0]; cur.set(kv.split('=')[0], kv); }
    jar.set(who.key, [...cur.values()].join('; '));
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function login(key, portal, email, password) {
  const who = { key, portal };
  const r = await call(who, 'POST', '/api/auth/login', { email, password });
  check(`login ${email}`, r.status === 200, r.status !== 200 ? JSON.stringify(r.json).slice(0, 120) : `role=${r.json?.data?.user?.role}`);
  return who;
}

export { API, call, login, check, jar };
export const score = () => ({ pass, fail });
