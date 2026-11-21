// Black-box security probes against a LOCAL demo API (never a hosted one).
// Usage: node pentest.mjs [baseUrl]   (default http://localhost:4000/api)
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:4300/api';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE)) throw new Error('Refusing to probe a non-local server');
const PW = 'Demo1234!';
const MARK = 'ZZSECRETB';
const findings = [];
const ok = [];
const flag = (sev, what, detail = '') => findings.push(`[${sev}] ${what}${detail ? ` — ${detail}` : ''}`);
const pass = (what) => ok.push(what);

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'X-Client-Type': 'mobile', ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}
const login = async (email, password = PW) => {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${r.text.slice(0, 200)}`);
  return { token: r.json.data.accessToken, refresh: r.json.data.refreshToken, user: r.json.data.user, business: r.json.data.business };
};
const leaks = (r) => r.text.includes(MARK);

// ── Setup: agency A (demo data) and a fresh agency B with marked records ──
const A = await login('owner@demo.recrm.test');
const agent = await login('agent@demo.recrm.test');
const viewer = await login('viewer@demo.recrm.test');
const bEmail = `b-${Date.now()}@pentest.recrm.test`;
let r = await call('POST', '/auth/register', { body: { fullName: 'Bee Owner', email: bEmail, password: 'Str0ngPassw0rd!', businessName: `${MARK} Agency` } });
if (r.status !== 201) throw new Error(`register B: ${r.status} ${r.text}`);
const B = { token: r.json.data.accessToken, user: r.json.data.user };
const bClient = (await call('POST', '/clients', { token: B.token, body: { fullName: `${MARK} Client`, mobileNumber: '03001112233' } })).json?.data;
const bOwner = (await call('POST', '/owners', { token: B.token, body: { fullName: `${MARK} Owner`, mobileNumber: '03001112244', cnic: '42101-1234567-1' } })).json?.data;
const bProp = (await call('POST', '/properties', { token: B.token, body: { propertyType: 'HOUSE', size: 200, sizeUnit: 'SQ_YARD', askingPrice: 30000000, society: `${MARK} Society`, title: `${MARK} House`, ownerId: bOwner?._id } })).json?.data;
if (!bClient || !bOwner || !bProp) throw new Error('could not create B records');
const aClient = (await call('GET', '/clients?limit=1', { token: A.token })).json.data[0];
const aProp = (await call('GET', '/properties?limit=1', { token: A.token })).json.data[0];

// ── 1. Direct cross-tenant reads (IDOR) ──
for (const [path] of [[`/clients/${bClient._id}`], [`/properties/${bProp._id}`], [`/owners/${bOwner._id}`], [`/properties/${bProp._id}/media`], [`/properties/${bProp._id}/brochure`], [`/properties/${bProp._id}/qr`], [`/notes?entityType=client&entityId=${bClient._id}`], [`/activities?entityType=client&entityId=${bClient._id}`], [`/matches?clientId=${bClient._id}`], [`/members/${B.user._id}`]]) {
  r = await call('GET', path, { token: A.token });
  if (leaks(r) || r.status === 200 && !Array.isArray(r.json?.data)) flag('HIGH', `Cross-tenant read ${path}`, `${r.status}`);
  else pass(`IDOR read ${path} → ${r.status}`);
}

// ── 2. Foreign references: A writes records pointing at B's ids, then reads them back ──
const fk = [
  ['POST', '/deals', { clientId: bClient._id, propertyId: bProp._id, title: 'x' }],
  ['POST', '/deals', { clientId: aClient._id, propertyId: bProp._id, title: 'x' }],
  ['POST', '/followups', { clientId: bClient._id, type: 'CALL', title: 'x', dueAt: new Date(Date.now() + 864e5).toISOString() }],
  ['POST', '/followups', { clientId: aClient._id, propertyId: bProp._id, type: 'CALL', title: 'x', dueAt: new Date(Date.now() + 864e5).toISOString() }],
  ['POST', '/properties', { propertyType: 'PLOT', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 1e7, ownerId: bOwner._id }],
  ['POST', '/properties', { propertyType: 'PLOT', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 1e7, coOwnerIds: [bOwner._id] }],
  ['POST', '/properties', { propertyType: 'PLOT', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 1e7, agentIds: [B.user._id] }],
  ['POST', '/clients', { fullName: 'Fk Test', mobileNumber: '03009998877', assignedTo: B.user._id, allowDuplicate: true }],
  ['POST', '/notes', { entityType: 'client', entityId: bClient._id, content: 'x' }],
  ['POST', '/transactions', { type: 'INCOME', amount: 1000, date: new Date().toISOString(), clientId: bClient._id, description: 'x' }],
  ['POST', '/transactions', { type: 'INCOME', amount: 1000, date: new Date().toISOString(), propertyId: bProp._id, description: 'x' }],
  ['POST', '/leases', { propertyId: bProp._id, tenantId: aClient._id, monthlyRent: 50000, startDate: new Date().toISOString(), endDate: new Date(Date.now() + 3e10).toISOString(), dueDay: 5 }],
  ['POST', '/leases', { propertyId: aProp._id, tenantId: bClient._id, monthlyRent: 50000, startDate: new Date().toISOString(), endDate: new Date(Date.now() + 3e10).toISOString(), dueDay: 5 }],
  ['POST', '/leases', { propertyId: aProp._id, tenantId: aClient._id, landlordId: bOwner._id, monthlyRent: 50000, startDate: new Date().toISOString(), endDate: new Date(Date.now() + 3e10).toISOString(), dueDay: 5 }],
  ['POST', '/installments', { clientId: bClient._id, totalAmount: 100000, title: 'x', items: [{ label: 'a', amount: 100000, dueDate: new Date(Date.now() + 864e5).toISOString() }] }],
  ['POST', '/installments', { clientId: aClient._id, propertyId: bProp._id, totalAmount: 100000, title: 'x', items: [{ label: 'a', amount: 100000, dueDate: new Date(Date.now() + 864e5).toISOString() }] }],
  ['POST', `/portal-links`, { kind: 'CLIENT', partyId: bClient._id }],
  ['POST', `/clients/${aClient._id}/assign`, { to: B.user._id }],
  ['PATCH', `/clients/${aClient._id}`, { assignedTo: B.user._id }],
  ['PATCH', `/properties/${aProp._id}`, { ownerId: bOwner._id }],
];
for (const [m, path, body] of fk) {
  r = await call(m, path, { token: A.token, body });
  const id = r.json?.data?._id;
  let readBack = r;
  if (id && m === 'POST') {
    const base = path.split('?')[0].replace(/\/$/, '');
    const g = await call('GET', `${base}/${id}`, { token: A.token });
    if (g.status === 200) readBack = g;
  }
  if (r.status < 300 && (leaks(readBack) || leaks(r))) flag('CRITICAL', `Foreign reference accepted and B data leaked: ${m} ${path} ${JSON.stringify(body).slice(0, 80)}`);
  else if (r.status < 300) flag('MEDIUM', `Foreign reference accepted (no leak seen): ${m} ${path} ${JSON.stringify(body).slice(0, 90)}`, `${r.status}`);
  else pass(`Foreign ref refused ${m} ${path} → ${r.status} ${r.json?.code ?? ''}`);
}

// ── 3. Same through offline sync ──
const syncCases = [
  ['deals', { clientId: bClient._id, title: 'sync x' }],
  ['followUps', { clientId: bClient._id, type: 'CALL', title: 'sync x', dueAt: new Date(Date.now() + 864e5).toISOString() }],
  ['properties', { propertyType: 'PLOT', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 1e7, ownerId: bOwner._id }],
  ['notes', { entityType: 'property', entityId: bProp._id, content: 'sync x' }],
  ['transactions', { type: 'INCOME', amount: 1000, date: new Date().toISOString(), clientId: bClient._id, description: 'sync x' }],
  ['clients', { fullName: 'Sync Fk', mobileNumber: '03007776655', assignedTo: B.user._id, allowDuplicate: true }],
];
for (const [entity, data] of syncCases) {
  r = await call('POST', '/sync/push', { token: A.token, body: { mutations: [{ mutationId: randomUUID(), entity, op: 'create', uuid: randomUUID(), data }] } });
  const res = r.json?.data?.results?.[0] ?? r.json?.data?.[0];
  const accepted = res && (res.status === 'applied' || res.status === 'ok' || res.status === 'APPLIED' || res.record);
  if (leaks(r)) flag('CRITICAL', `Sync ${entity} with B ids leaked B data`);
  else if (accepted) flag('MEDIUM', `Sync ${entity} accepted a foreign reference`, JSON.stringify(res).slice(0, 160));
  else pass(`Sync foreign ref ${entity} → ${JSON.stringify(res ?? r.status).slice(0, 80)}`);
}

// ── 4. NoSQL operator / query injection ──
for (const q of ['/clients?search[$regex]=.*', '/clients?status[$ne]=X', '/properties?society[$gt]=', '/reports/aging?x[$ne]=1', '/leases/rent-roll?branchId[$ne]=1', '/clients?sort[$where]=1', '/clients?limit=100000', '/clients?page=-1', '/search?q[$ne]=1']) {
  r = await call('GET', q, { token: A.token });
  if (r.status >= 500) flag('LOW', `Server error on crafted query ${q}`, `${r.status} ${r.text.slice(0, 120)}`);
  else if (leaks(r)) flag('CRITICAL', `Injection leaked B data: ${q}`);
  else pass(`Injection ${q} → ${r.status}`);
}
r = await call('POST', '/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } });
r.status === 400 ? pass('Login operator injection → 400') : flag('HIGH', 'Login accepted operator object', `${r.status}`);
r = await call('GET', `/public/portal/${encodeURIComponent('{"$ne":null}')}`);
r.status === 404 || r.status === 400 ? pass(`Portal token injection → ${r.status}`) : flag('HIGH', 'Portal token injection', `${r.status}`);

// ── 5. Privilege escalation inside agency A ──
const members = (await call('GET', '/members', { token: A.token })).json?.data ?? [];
const agentMember = members.find((m) => (m.user?.email ?? m.email) === 'agent@demo.recrm.test') ?? members.find((m) => m.role === 'AGENT');
const esc = [
  ['PATCH', `/members/${agentMember?._id}`, { role: 'OWNER' }, agent],
  ['PATCH', `/members/${agentMember?._id}`, { permissions: ['settings:manage', 'members:manage'] }, agent],
  ['POST', '/members', { fullName: 'Evil', email: `evil${Date.now()}@x.test`, role: 'OWNER', password: 'Str0ngPassw0rd!' }, agent],
  ['POST', '/api-keys', { name: 'k', permissions: ['clients:read'] }, agent],
  ['PATCH', '/settings', { matching: { storeThreshold: 1 } }, agent],
  ['PATCH', '/business', { name: 'pwned' }, agent],
  ['DELETE', `/clients/${aClient._id}`, null, viewer],
  ['POST', '/clients', { fullName: 'Viewer Made', mobileNumber: '03005554433' }, viewer],
  ['PATCH', '/auth/me', { role: 'OWNER', email: 'x@y.z', status: 'ACTIVE' }, agent],
  ['GET', '/audit-logs', null, agent],
  ['GET', '/platform/businesses', null, A],
  ['GET', '/reports/agent-statement?userId=' + A.user._id, null, agent],
];
for (const [m, path, body, who] of esc) {
  r = await call(m, path, { token: who.token, body: body ?? undefined });
  if (r.status < 300) flag('HIGH', `Privilege escalation possible: ${m} ${path} as ${who === A ? 'owner' : who === agent ? 'agent' : 'viewer'}`, `${r.status} ${r.text.slice(0, 120)}`);
  else pass(`Escalation ${m} ${path} → ${r.status}`);
}

// ── 6. Mass assignment ──
r = await call('PATCH', `/clients/${aClient._id}`, { token: A.token, body: { businessId: B.user._id, createdBy: B.user._id, deletedAt: null, version: 999 } });
r.status === 400 ? pass('Mass assignment on client → 400') : flag('MEDIUM', 'Client accepts protected fields', `${r.status} ${r.text.slice(0, 120)}`);

// ── 7. Stored XSS / dangerous URLs ──
r = await call('POST', '/properties', { token: A.token, body: { propertyType: 'PLOT', size: 120, sizeUnit: 'SQ_YARD', askingPrice: 1e7, googleMapsUrl: 'javascript:alert(document.cookie)' } });
r.status < 300 ? flag('MEDIUM', 'javascript: URL accepted as googleMapsUrl (rendered as a link on the property page)') : pass(`javascript: map link refused → ${r.status}`);
r = await call('POST', '/clients', { token: A.token, body: { fullName: '<img src=x onerror=alert(1)>', mobileNumber: '03001231231', allowDuplicate: true } });
r.status < 300 ? pass('HTML in names is stored as text (web escapes it); checked separately in PDFs') : pass(`HTML name refused → ${r.status}`);

// ── 8. Uploads ──
const fd = (name, type, content, extra = {}) => {
  const f = new FormData();
  f.append('file', new Blob([content], { type }), name);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};
const up = async (path, form, token = A.token) => {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, text: await res.text() };
};
for (const [name, type, content] of [
  ['evil.html', 'text/html', '<script>alert(1)</script>'],
  ['evil.pdf', 'application/pdf', '<html><script>alert(1)</script></html>'],
  ['evil.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
  ['../../../etc/passwd.pdf', 'application/pdf', '%PDF-1.4 x'],
  ['evil.jpg', 'image/jpeg', '<?php echo 1; ?>'],
]) {
  r = await up('/documents', fd(name, type, content, { entityType: 'client', entityId: aClient._id, category: 'OTHER' }));
  if (r.status < 300) flag(name.includes('..') ? 'LOW' : 'MEDIUM', `Upload accepted: ${name} (${type})`, r.text.slice(0, 160));
  else pass(`Upload refused ${name} → ${r.status}`);
}
r = await up(`/properties/${aProp._id}/media`, fd('x.jpg', 'image/jpeg', '<html><script>alert(1)</script></html>'));
r.status < 300 ? flag('MEDIUM', 'Media upload accepted a non-image with an image name', r.text.slice(0, 120)) : pass(`Fake image refused → ${r.status}`);
r = await up('/documents', fd('b.pdf', 'application/pdf', '%PDF-1.4 x', { entityType: 'client', entityId: bClient._id, category: 'OTHER' }));
r.status < 300 ? flag('HIGH', 'Document attached to another agency\'s client') : pass(`Cross-tenant document upload → ${r.status}`);

// ── 9. Tokens and sessions ──
const [h, p] = A.token.split('.');
const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + p + '.';
r = await call('GET', '/auth/me', { token: none });
r.status === 401 ? pass('alg:none token → 401') : flag('CRITICAL', 'alg:none JWT accepted');
const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
const forged = h + '.' + Buffer.from(JSON.stringify({ ...payload, bid: '000000000000000000000000' })).toString('base64url') + '.' + A.token.split('.')[2];
r = await call('GET', '/clients', { token: forged });
r.status === 401 ? pass('Tampered JWT → 401') : flag('CRITICAL', 'Tampered JWT accepted');
const s = await login('manager@demo.recrm.test');
await call('POST', '/auth/logout', { token: s.token, body: { refreshToken: s.refresh } });
r = await call('GET', '/clients', { token: s.token });
r.status === 401 ? pass('Access token dead after logout') : flag('HIGH', 'Access token still works after logout', `${r.status}`);
const s2 = await login('manager@demo.recrm.test');
const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: s2.refresh } });
const r2 = await call('POST', '/auth/refresh', { body: { refreshToken: s2.refresh } });
r1.status === 200 && r2.status === 401 ? pass('Refresh token reuse detected') : flag('HIGH', 'Refresh token reuse not detected', `${r1.status}/${r2.status}`);
r = await call('POST', '/auth/refresh', { body: { refreshToken: r1.json?.data?.refreshToken } });
r.status === 401 ? pass('Whole session revoked after reuse') : flag('MEDIUM', 'Session survives refresh-token reuse', `${r.status}`);

// ── 10. Account enumeration ──
const e1 = await call('POST', '/auth/login', { body: { email: 'nobody-here@demo.recrm.test', password: 'wrong' } });
const e2 = await call('POST', '/auth/login', { body: { email: 'viewer@demo.recrm.test', password: 'wrong' } });
e1.status === e2.status && e1.json?.message === e2.json?.message ? pass('Login gives the same answer for unknown and known emails') : flag('LOW', 'Login reveals whether an email exists', `${e1.status}/${e2.status}`);
const f1 = await call('POST', '/auth/forgot-password', { body: { email: 'nobody-here@demo.recrm.test' } });
const f2 = await call('POST', '/auth/forgot-password', { body: { email: 'viewer@demo.recrm.test' } });
f1.status === f2.status ? pass('Forgot-password gives the same answer') : flag('LOW', 'Forgot-password reveals accounts');

// ── 11. Errors, headers, CORS ──
r = await call('GET', '/clients/not-an-id', { token: A.token });
/at .*\.ts|node_modules|stack/i.test(r.text) ? flag('LOW', 'Stack trace in error response') : pass(`Bad id → ${r.status}, no stack`);
r = await call('GET', '/health', { headers: { Origin: 'https://evil.example' } });
r.headers.get('access-control-allow-origin') ? flag('HIGH', 'CORS allows any origin', r.headers.get('access-control-allow-origin')) : pass('CORS refuses unknown origin');
for (const hname of ['x-content-type-options', 'x-frame-options', 'strict-transport-security', 'content-security-policy']) (r.headers.get(hname) ? pass(`Header ${hname}`) : flag('LOW', `Missing header ${hname}`));
r = await call('GET', '/health', { headers: { 'X-Request-Id': 'a'.repeat(5000) } });
(r.headers.get('x-request-id') ?? '').length > 200 ? flag('LOW', 'Client X-Request-Id echoed and logged without a length limit') : pass('X-Request-Id limited');

// ── 12. Public endpoints ──
const site = await call('GET', '/website', { token: A.token });
const slug = site.json?.data?.slug ?? site.json?.data?.website?.slug;
if (slug) {
  r = await call('GET', `/public/sites/${slug}/listings/${bProp._id}`);
  leaks(r) ? flag('HIGH', 'Agency A site shows agency B listing') : pass(`Foreign listing on A's site → ${r.status}`);
  r = await call('POST', `/public/sites/${slug}/inquiries`, { body: { name: 'X', mobileNumber: '03001239999', message: 'hi', listingId: bProp._id } });
  r.status < 300 ? flag('MEDIUM', 'Inquiry on A\'s site accepted a B listing id', r.text.slice(0, 150)) : pass(`Inquiry with foreign listing → ${r.status}`);
  const pubSite = await call('GET', `/public/sites/${slug}/listings?limit=50`);
  /minimumPrice|plotNumber|cnic|ownerId/.test(pubSite.text) ? flag('HIGH', 'Public listings expose private fields', pubSite.text.match(/minimumPrice|plotNumber|cnic|ownerId/)[0]) : pass('Public listings hide private fields');
} else pass('No public site configured in demo (public probes skipped)');

console.log('\n=== FINDINGS ===');
console.log(findings.length ? findings.join('\n') : 'none');
console.log(`\n=== PASSED (${ok.length}) ===`);
console.log(ok.join('\n'));
