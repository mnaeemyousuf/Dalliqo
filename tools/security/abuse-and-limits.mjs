// Abuse, limits, portal, exports, webhooks, sockets. LOCAL ONLY.
import { createRequire } from 'node:module';
const { io } = createRequire(new URL('../../package.json', import.meta.url))('socket.io-client');
const ROOT = 'http://localhost:4300';
const BASE = ROOT + '/api';
const out = [];
const note = (bad, msg) => out.push(`${bad ? 'ISSUE' : 'ok   '} ${msg}`);
async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'Demo1234!' } })).json.data;
const A = await login('owner@demo.recrm.test');
const t = A.accessToken;

// Dangerous links
for (const u of ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
  const r = await call('POST', '/properties', { token: t, body: { propertyType: 'RESIDENTIAL_PLOT', size: 141, sizeUnit: 'SQ_YARD', askingPrice: 1e7, googleMapsUrl: u } });
  note(r.status < 300, `googleMapsUrl "${u.slice(0, 20)}" → ${r.status}`);
}
// Formula injection in exports
const f = await call('POST', '/clients', { token: t, body: { fullName: '=HYPERLINK("http://evil.example","Click")', mobileNumber: '03001237777', allowDuplicate: true, notes: '=cmd|"/c calc"!A1' } });
note(false, `client named "=HYPERLINK(…)" → ${f.status} ${f.json?.details?.[0]?.message ?? ''}`);
const c2 = await call('POST', '/clients', { token: t, body: { fullName: 'Formula Test', mobileNumber: '03001237778', allowDuplicate: true, address: '=1+2', notes: '@SUM(1,2)' } });
const ex = await fetch(BASE + '/exports/clients?format=csv', { headers: { Authorization: `Bearer ${t}` } });
const csv = await ex.text();
note(/(^|,|")[=@+\-](1\+2|SUM|HYPERLINK|cmd)/m.test(csv), `CSV export escapes formulas (status ${ex.status}, ${csv.includes('Formula Test') ? 'row present' : 'row missing'})`);
// Password policy
for (const pw of ['12345678', 'password', 'aaaaaaaa']) {
  const r = await call('POST', '/auth/register', { body: { fullName: 'Weak Pw', email: `weak${Math.random()}@x.test`, password: pw, businessName: 'Weak Co' } });
  note(r.status === 201, `register with password "${pw}" → ${r.status}`);
}
// Oversized and malformed bodies
const big = await call('POST', '/clients', { token: t, body: JSON.stringify({ fullName: 'x'.repeat(2_000_000), mobileNumber: '03001230000' }) });
note(big.status !== 413, `2 MB JSON body → ${big.status}`);
const bad = await call('POST', '/clients', { token: t, body: '{"fullName": ' });
note(bad.status >= 500, `malformed JSON → ${bad.status}`);
const longQ = await call('GET', '/clients?q=' + encodeURIComponent('(a+)+'.repeat(20) + 'b'.repeat(50)), { token: t });
note(longQ.status >= 500, `regex-like search text → ${longQ.status}`);
// WhatsApp webhook without a signature
const wh = await call('POST', '/public/whatsapp/webhook', { body: { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '923001234567', text: { body: 'hi' } }] } }] }] } });
note(wh.status < 300 && !/disabled|not configured/i.test(wh.text), `unsigned WhatsApp webhook → ${wh.status} ${wh.text.slice(0, 80)}`);
const whv = await call('GET', '/public/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123');
note(whv.status === 200 && whv.text.includes('123'), `webhook verify with wrong token → ${whv.status}`);
// Portal tokens
const client = (await call('GET', '/clients?limit=1', { token: t })).json.data[0];
const link = await call('POST', '/portal-links', { token: t, body: { kind: 'CLIENT', partyId: client._id } });
const url = link.json?.data?.url ?? '';
const token = url.split('/').pop() ?? link.json?.data?.token;
note((token ?? '').length < 32, `portal token length ${token?.length}`);
if (token) {
  const view = await call('GET', `/public/portal/${token}`);
  note(/mobileNumber|cnic|minimumPrice|assignedTo|"email"/.test(JSON.stringify(view.json?.data?.matches ?? [])), `portal matches hide private fields (status ${view.status})`);
  const otherMatch = (await call('GET', '/matches?limit=50', { token: t })).json.data.find((m) => String(m.clientId?._id ?? m.clientId) !== client._id);
  if (otherMatch) {
    const r = await call('POST', `/public/portal/${token}/matches/${otherMatch._id}`, { body: { reaction: 'FAVORITE' } });
    note(r.status < 300, `portal reacts to another client's match → ${r.status}`);
  }
  const docs = (await call('GET', '/documents?limit=50', { token: t })).json.data;
  const otherDoc = docs.find((d) => d.entityId !== client._id);
  if (otherDoc) {
    const r = await call('GET', `/public/portal/${token}/documents/${otherDoc._id}`);
    note(r.status === 200, `portal opens a document of another record → ${r.status}`);
  }
  let limited = false;
  for (let i = 0; i < 12; i++) { const r = await call('POST', `/public/portal/${token}/requests`, { body: { message: `flood ${i}` } }); if (r.status === 429) { limited = true; break; } }
  note(!limited, 'portal message flood is rate limited');
  await call('DELETE', `/portal-links/${link.json?.data?._id}`, { token: t });
  const revoked = await call('GET', `/public/portal/${token}`);
  note(revoked.status === 200, `revoked portal link → ${revoked.status}`);
}
// Login brute force
let locked = false, limitedLogin = false;
for (let i = 0; i < 25; i++) {
  const r = await call('POST', '/auth/login', { body: { email: 'son@demo.recrm.test', password: `wrong-${i}` } });
  if (r.status === 429) { limitedLogin = true; break; }
  if (r.status === 423) locked = true;
}
note(!locked && !limitedLogin, `25 wrong passwords → ${locked ? 'account locked' : ''}${limitedLogin ? ' rate limited' : ''}`);
// Socket.IO
const anon = await new Promise((resolve) => {
  const s = io(ROOT, { transports: ['websocket'], reconnection: false, timeout: 4000 });
  s.on('connect', () => { s.close(); resolve('connected'); });
  s.on('connect_error', (e) => { s.close(); resolve(`refused: ${e.message}`); });
  setTimeout(() => resolve('timeout'), 6000);
});
note(anon === 'connected', `socket without a token → ${anon}`);
const authed = await new Promise((resolve) => {
  const s = io(ROOT, { transports: ['websocket'], reconnection: false, auth: { token: t } });
  s.on('connect', () => {
    s.emit('join', { room: 'business:000000000000000000000000' });
    s.emit('subscribe', 'business:000000000000000000000000');
    setTimeout(() => { s.close(); resolve('connected'); }, 500);
  });
  s.on('connect_error', (e) => { s.close(); resolve(`refused: ${e.message}`); });
  setTimeout(() => resolve('timeout'), 6000);
});
note(authed !== 'connected', `socket with a valid token → ${authed}`);
console.log(out.join('\n'));
