import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { useStartup } from '../contexts/StartupContext.jsx';
import { API } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, LIGHT, GREEN, RED, AMBER, ACCENT, FONT } from '../constants.js';

function CodeBlock({ children, id, copied, onCopy }) {
  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <pre style={{ background: '#0F1115', color: '#E5E7EB', borderRadius: 10, padding: '14px 16px', fontSize: 12, overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>{children}</pre>
      <button onClick={() => onCopy(id, children)} style={{ position: 'absolute', top: 8, right: 8, padding: '5px 8px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,.1)', color: '#E5E7EB', cursor: 'pointer', display: 'flex' }}>
        {copied === id ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function ErrRow({ status, reason, meaning }) {
  return (
    <tr style={{ borderTop: `1px solid ${BORDER}` }}>
      <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 800, color: status < 300 ? GREEN : status < 500 ? AMBER : RED, fontFamily: 'monospace' }}>{status}</td>
      <td style={{ padding: '9px 14px', fontSize: 12, fontFamily: 'monospace', color: INK }}>{reason}</td>
      <td style={{ padding: '9px 14px', fontSize: 12.5, color: MUTED }}>{meaning}</td>
    </tr>
  );
}

const LANGS = [
  { key: 'curl',   label: 'cURL' },
  { key: 'node',   label: 'Node.js' },
  { key: 'python', label: 'Python' },
  { key: 'php',    label: 'PHP' },
];

const SNIPPETS = {
  curl: (base) => `curl -X POST ${base}/api/vouchers/v1/validate \\
  -H "Authorization: Bearer $AKORO_VOUCHER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "voucher_code": "X9K7-MQPL-3R9T",
    "customer_id": "cust_456",
    "idempotency_key": "redeem_cust_456_X9K7"
  }'`,

  node: (base) => `const res = await fetch("${base}/api/vouchers/v1/validate", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.AKORO_VOUCHER_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    voucher_code: code,
    customer_id: user.id,
    idempotency_key: \`redeem_\${user.id}_\${code}\`,
  }),
});
const data = await res.json();

if (data.valid) {
  await addCreditsToUser(user.id, data.credits);
} else {
  // data.reason: 'not_found' | 'already_used' | 'expired' | ...
  return respondWithError(data.reason);
}`,

  python: (base) => `import os, requests

res = requests.post(
    "${base}/api/vouchers/v1/validate",
    headers={"Authorization": f"Bearer {os.environ['AKORO_VOUCHER_KEY']}"},
    json={
        "voucher_code": code,
        "customer_id": str(user.id),
        "idempotency_key": f"redeem_{user.id}_{code}",
    },
    timeout=10,
)
data = res.json()

if data.get("valid"):
    add_credits_to_user(user.id, data["credits"])
else:
    # data["reason"]: 'not_found' | 'already_used' | 'expired' | ...
    return respond_with_error(data.get("reason"))`,

  php: (base) => `<?php
$ch = curl_init("${base}/api/vouchers/v1/validate");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        "Authorization: Bearer " . getenv("AKORO_VOUCHER_KEY"),
        "Content-Type: application/json",
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "voucher_code"    => $code,
        "customer_id"     => (string) $user->id,
        "idempotency_key" => "redeem_{$user->id}_{$code}",
    ]),
]);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);

if (!empty($data["valid"])) {
    add_credits_to_user($user->id, $data["credits"]);
} else {
    // $data["reason"]: 'not_found' | 'already_used' | 'expired' | ...
    return respond_with_error($data["reason"] ?? "server_error");
}`,
};

function LangTabs({ lang, onPick }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
      {LANGS.map((l) => (
        <button key={l.key} onClick={() => onPick(l.key)} style={{
          padding: '6px 13px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 800,
          border: lang === l.key ? `1.5px solid ${ACCENT}` : `1px solid ${BORDER}`,
          background: lang === l.key ? `${ACCENT}12` : WHITE,
          color: lang === l.key ? ACCENT : MUTED,
        }}>{l.label}</button>
      ))}
    </div>
  );
}

export default function DocsPage() {
  const { current } = useStartup();
  const [lang, setLang] = useState('node');
  const [copied, setCopied] = useState(null);
  const onCopy = (id, text) => { navigator.clipboard?.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1600); };

  const base = API;
  const rate = current ? current.credit_rate_usd : 0.10;

  return (
    <PageLayout title="API Documentation" subtitle="Integrate voucher redemption into your own backend">
      <div style={{ maxWidth: 820 }}>

        {/* Overview */}
        <Section title="How it works">
          <p style={p}>
            Your database is never the source of truth for whether a code is valid — ours is. Your backend makes ONE
            server-to-server call to redeem a code; we check it atomically, credit your account for the redeemed
            value, and tell you how many credits to add to your customer's balance. A code can only ever be
            successfully redeemed once, even under concurrent retries.
          </p>
          <ol style={{ margin: '10px 0 0 18px', color: MUTED, fontSize: 13, lineHeight: 1.9 }}>
            <li>A customer buys a code from an agent (WhatsApp, a store, wherever) — off-platform, you're not involved.</li>
            <li>They enter it in your app's "Redeem a code" screen.</li>
            <li>Your backend calls <code style={ic}>POST /api/vouchers/v1/validate</code> with your API key.</li>
            <li>We respond with the credit amount (or a specific reason it failed) — you credit your own local wallet.</li>
          </ol>
        </Section>

        {/* Auth */}
        <Section title="Authentication">
          <p style={p}>Every request needs your API key as a bearer token. Get one from <strong>API Keys</strong> in the sidebar — it's shown once at creation, so store it in your server's secrets, never in client code.</p>
          <CodeBlock id="auth" copied={copied} onCopy={onCopy}>{`Authorization: Bearer sk_live_...`}</CodeBlock>
          <p style={{ ...p, marginTop: 10 }}>An <code style={ic}>x-api-key</code> header works too, for clients that can't set <code style={ic}>Authorization</code>.</p>
        </Section>

        {/* Validate endpoint */}
        <Section title="POST /v1/validate">
          <p style={p}>Redeems a voucher code and returns how many credits to grant. This is the only endpoint most integrations need.</p>

          <div style={sub}>Request body</div>
          <CodeBlock id="req" copied={copied} onCopy={onCopy}>{`{
  "voucher_code": "X9K7-MQPL-3R9T",
  "customer_id": "cust_456",        // optional — your user's id, for your own audit trail
  "idempotency_key": "req_abc123"   // optional but recommended — see Idempotency below
}`}</CodeBlock>

          <div style={sub}>Success response — 200</div>
          <CodeBlock id="res" copied={copied} onCopy={onCopy}>{`{
  "valid": true,
  "credits": 100,
  "currency": "USD",
  "transaction_id": "9c2f4a1e-..."
}`}</CodeBlock>

          <div style={sub}>Failure response</div>
          <CodeBlock id="res2" copied={copied} onCopy={onCopy}>{`{ "valid": false, "reason": "already_used" }`}</CodeBlock>

          <div style={sub}>Reasons & status codes</div>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
            <thead><tr>{['Status', 'reason', 'Meaning'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '9px 14px', fontSize: 11, fontWeight: 800, color: MUTED2, background: LIGHT }}>{h}</th>)}</tr></thead>
            <tbody>
              <ErrRow status={200} reason="—" meaning="Redeemed successfully — credit the customer." />
              <ErrRow status={400} reason="missing_api_key / voucher_code required" meaning="Malformed request." />
              <ErrRow status={401} reason="invalid_api_key" meaning="Key is wrong, revoked, or missing." />
              <ErrRow status={403} reason="startup_inactive" meaning="Your account is suspended." />
              <ErrRow status={404} reason="not_found" meaning="No such code for your account." />
              <ErrRow status={409} reason="already_used" meaning="Already redeemed — do not credit again." />
              <ErrRow status={409} reason="not_available" meaning="Refunded or otherwise unredeemable." />
              <ErrRow status={410} reason="expired" meaning="Past its expiry date." />
              <ErrRow status={410} reason="refunded" meaning="Voided by the platform." />
              <ErrRow status={429} reason="rate_limited" meaning="Too many requests — see Rate limits below." />
              <ErrRow status={500} reason="server_error" meaning="Something broke on our end — safe to retry." />
            </tbody>
          </table>
        </Section>

        {/* Idempotency */}
        <Section title="Idempotency">
          <p style={p}>
            Network calls fail and get retried. Pass a stable <code style={ic}>idempotency_key</code> (e.g. your own
            request id) and a retried call with the SAME key returns the SAME result — including on a
            success — instead of erroring. Without one, redemption is still safe (a code can't be redeemed twice
            either way), but a retry after a dropped response has no way to recover the original transaction id.
          </p>
        </Section>

        {/* Rate limits */}
        <Section title="Rate limits">
          <p style={p}><strong>300 requests / minute per API key</strong> on <code style={ic}>/v1/*</code>. Standard <code style={ic}>X-RateLimit-*</code> headers are included on every response; a <code style={ic}>429</code> means back off and retry after the window resets.</p>
        </Section>

        {/* Quick call — one request, in your language */}
        <Section title="Redeem a code">
          <p style={p}>The whole integration is one server-to-server call. Pick your stack:</p>
          <LangTabs lang={lang} onPick={setLang} />
          <CodeBlock id={`snippet-${lang}`} copied={copied} onCopy={onCopy}>{SNIPPETS[lang](base)}</CodeBlock>
          <p style={{ ...p, marginTop: 10 }}>
            ⚠️ Call this from your <strong>backend only</strong>. Your secret key must never ship in a
            web page, mobile binary, or anything a customer can read — anyone holding it can redeem
            every voucher you've issued.
          </p>
        </Section>

        {/* Full reference implementation */}
        <Section title="Full example — a top-up endpoint">
          <p style={p}>
            A complete “redeem a code and credit the customer” route, with the error handling you
            actually need in production. This is the same shape Akoro's own learner app uses.
          </p>
          <CodeBlock id="full" copied={copied} onCopy={onCopy}>{`// POST /redeem  { code }   — called by YOUR app's "Redeem a voucher" screen
app.post("/redeem", requireLogin, async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Enter a voucher code" });

  let data;
  try {
    const r = await fetch("${base}/api/vouchers/v1/validate", {
      method: "POST",
      headers: {
        "Authorization": \`Bearer \${process.env.AKORO_VOUCHER_KEY}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voucher_code: code,
        customer_id: req.user.id,          // your own user id, for your audit trail
        idempotency_key: \`redeem_\${req.user.id}_\${code}\`,  // stable → safe to retry
      }),
    });
    data = await r.json();
  } catch (e) {
    // Network/DNS/TLS — the code was NOT redeemed. Safe to retry.
    return res.status(502).json({ error: "Couldn't reach the voucher service. Try again." });
  }

  if (!data.valid) {
    const messages = {
      not_found:     "We don't recognise that code.",
      already_used:  "That code has already been used.",
      expired:       "That code has expired.",
      refunded:      "That code is no longer valid.",
      not_available: "That code isn't available for redemption.",
      rate_limited:  "Too many attempts — wait a moment and try again.",
    };
    return res.status(400).json({ error: messages[data.reason] || "Could not redeem that code." });
  }

  // Credit YOUR OWN balance table. Key the write on transaction_id so a
  // retry (or a double-tapped button) can never credit the same code twice.
  await creditCustomerOnce({
    userId: req.user.id,
    credits: data.credits,
    ref: \`akoro_voucher_\${data.transaction_id}\`,   // unique index on this column
  });

  res.json({ ok: true, credits: data.credits });
});`}</CodeBlock>
          <div style={sub}>The one thing to get right</div>
          <p style={p}>
            We guarantee a code can only be redeemed once — two concurrent calls can never both
            succeed. What we can't guarantee is <em>your</em> side: if you credit the customer and
            your own write is retried, you'd double-credit. Put a unique index on the reference
            column (<code style={ic}>akoro_voucher_&lt;transaction_id&gt;</code>) and let the database
            reject the duplicate.
          </p>
        </Section>

        {/* Redemptions feed */}
        <Section title="GET /v1/redemptions">
          <p style={p}>Your own redemption history, for reconciliation. Same auth as validate.</p>
          <CodeBlock id="redemptions" copied={copied} onCopy={onCopy}>{`curl ${base}/api/vouchers/v1/redemptions?limit=50 \\
  -H "Authorization: Bearer sk_live_..."`}</CodeBlock>
        </Section>

        {/* Pricing/settlement */}
        <Section title="How you get paid">
          <p style={p}>
            You earn on credits your customers actually redeem — not on codes an agent buys — at your rate
            ({`$${Number(rate).toFixed(2)}`} / credit right now, editable in Settings), minus the platform fee.
            Balance and payouts are on the <strong>Balance & Withdraw</strong> page.
          </p>
        </Section>

      </div>
    </PageLayout>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 900, color: INK, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

const p = { fontSize: 13, color: MUTED, lineHeight: 1.7, margin: 0 };
const sub = { fontSize: 11.5, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 16 };
const ic = { background: LIGHT, padding: '1px 6px', borderRadius: 5, fontFamily: 'monospace', fontSize: 12, color: ACCENT };
