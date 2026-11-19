// gp-voice.mjs — the realtime transcription handshake.
//
// The bug this locks down was two mistaken assumptions written into the code as
// fact, and neither could fail loudly:
//
//   · The socket URL carried ?model=gpt-4o-transcribe. A model query parameter
//     tells OpenAI's realtime endpoint to open a CONVERSATION session, and a
//     conversation session rejects a transcription config. The file's own
//     comment asserted that ?intent=transcription had been "removed in GA" —
//     it had not.
//   · The session payload used the pre-GA flat shape (modalities /
//     input_audio_format / input_audio_transcription at the top of `session`)
//     instead of the GA nested audio.input form, which is ignored rather than
//     rejected.
//
// Both produce the same symptom: the socket opens, the client is told it is
// ready, audio streams into a session that will never transcribe, and nothing
// anywhere reports a fault. The learner taps the mic and gets silence.
//
// So this stands a fake realtime endpoint in front of the client and asserts
// what it SENDS and WHEN — no OpenAI key, no network, and it would have caught
// the original on the day it shipped.

import { check, score } from './golden.mjs';
import { WebSocketServer } from 'ws';

const PORT = 4988;
const state = { url: null, sent: [], auth: null };

const wss = new WebSocketServer({ port: PORT });
let behaviour = 'confirm';           // confirm | silent | reject

wss.on('connection', (ws, req) => {
  state.url  = req.url;
  state.auth = req.headers.authorization ?? null;
  state.beta = req.headers['openai-beta'] ?? null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    state.sent.push(msg);
    if (msg.type === 'session.update') {
      if (behaviour === 'confirm') ws.send(JSON.stringify({ type: 'session.updated' }));
      if (behaviour === 'reject')  ws.send(JSON.stringify({ type: 'error', error: { message: 'invalid_model' } }));
      // 'silent' answers nothing — the exact shape of the original failure.
    }
  });
});

process.env.REALTIME_STT_URL = `ws://127.0.0.1:${PORT}/v1/realtime?intent=transcription`;
process.env.OPENAI_API_KEY   = process.env.OPENAI_API_KEY || 'sk-test-local';

const { createRealtimeTranscriber } = await import('../../modules/voice/index.js');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const reset = () => { state.sent = []; state.url = null; state.auth = null; state.beta = null; };

console.log('\n═══ REALTIME VOICE HANDSHAKE ═══\n');

console.log('· A transcription session, not a conversation one');
reset();
let opened = false, errored = null;
let t = createRealtimeTranscriber({ onOpen: () => { opened = true; }, onError: (e) => { errored = e; } });
await wait(400);

// The whole bug, in one assertion.
check('the URL carries no ?model=', !/[?&]model=/.test(state.url ?? ''), state.url);
check('and asks for a transcription session', /intent=transcription/.test(state.url ?? ''), state.url);
check('the key is sent as a bearer token', /^Bearer /.test(state.auth ?? ''), state.auth ? 'Bearer …' : 'none');
// The beta interface was removed on 2026-05-07 and GA models REJECT a
// connection carrying its header — the handshake is refused, the session never
// exists, and the learner sees the voice button switch itself off the instant
// they press it. It survived the previous fix in this file because it looked
// like harmless legacy.
check('no OpenAI-Beta header — GA refuses connections that send it',
  !state.beta, state.beta ? `sent: ${state.beta}` : 'absent');

const upd = state.sent.find(m => m.type === 'session.update');
check('a session update is sent on open', !!upd, upd ? 'sent' : 'nothing sent');
// The GA shape. The old flat form is IGNORED rather than rejected, which is
// what made this survive: a config that does nothing looks exactly like a
// config that worked.
check('it declares the session type as transcription', upd?.session?.type === 'transcription',
  `type=${upd?.session?.type}`);
check('the model goes in the payload, not the URL',
  !!upd?.session?.audio?.input?.transcription?.model,
  upd?.session?.audio?.input?.transcription?.model ?? 'missing');
check('audio format is declared under audio.input, the GA shape',
  upd?.session?.audio?.input?.format?.rate === 24000,
  JSON.stringify(upd?.session?.audio?.input?.format ?? {}));
check('with server-side turn detection',
  upd?.session?.audio?.input?.turn_detection?.type === 'server_vad',
  upd?.session?.audio?.input?.turn_detection?.type ?? 'none');

console.log('\n· Ready means CONFIGURED, not merely connected');
check('the caller is told it is ready once the session is confirmed', opened, `opened=${opened}`);
t.close();

reset(); behaviour = 'silent';
opened = false; errored = null;
t = createRealtimeTranscriber({ onOpen: () => { opened = true; }, onError: (e) => { errored = e; } });
await wait(400);
// The original called onOpen on the socket opening, so a session that was
// never configured still reported ready — and the client happily streamed a
// whole answer into nothing.
check('a session that is never confirmed does NOT report ready', !opened, `opened=${opened}`);
// And audio must not leave until it can be transcribed: anything sent before
// configuration is discarded server-side, so the first words would vanish.
t.sendAudio('AAAA');
await wait(150);
check('and no audio is sent into an unconfigured session',
  !state.sent.some(m => m.type === 'input_audio_buffer.append'),
  `${state.sent.filter(m => m.type === 'input_audio_buffer.append').length} chunks sent`);
t.close();

console.log('\n· Failures are reported, not swallowed');
reset(); behaviour = 'reject';
opened = false; errored = null;
t = createRealtimeTranscriber({ onOpen: () => { opened = true; }, onError: (e) => { errored = e; } });
await wait(400);
check('a rejected session raises an error', !!errored, errored?.message ?? 'no error raised');
// "invalid_model" would have named this bug on day one if anything had been
// listening for it.
check('and carries the provider’s own wording', /invalid_model/.test(errored?.message ?? ''),
  errored?.message ?? '');
t.close();

console.log('\n· A missing key fails immediately, not thirty seconds later');
const savedKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
let noKeyErr = null;
const t2 = createRealtimeTranscriber({ onError: (e) => { noKeyErr = e; } });
await wait(60);
check('an unconfigured server says so up front', /not configured/i.test(noKeyErr?.message ?? ''),
  noKeyErr?.message ?? 'no error');
check('and hands back a safe no-op rather than throwing',
  typeof t2.sendAudio === 'function' && typeof t2.close === 'function', 'usable stub');
process.env.OPENAI_API_KEY = savedKey;

console.log('\n· Audio flows once configured');
reset(); behaviour = 'confirm';
opened = false;
const t3 = createRealtimeTranscriber({ onOpen: () => { opened = true; } });
await wait(400);
t3.sendAudio('QUJD');
await wait(150);
const chunks = state.sent.filter(m => m.type === 'input_audio_buffer.append');
check('a configured session accepts audio', chunks.length === 1 && chunks[0].audio === 'QUJD',
  `${chunks.length} chunk(s)`);
t3.close();

await new Promise(r => wss.close(r));
score();
process.exit(0);
