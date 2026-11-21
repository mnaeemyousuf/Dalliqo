// Update paths with foreign ids (control = same edit with own ids). LOCAL ONLY.
import { randomUUID } from 'node:crypto';
const BASE = process.argv[2] ?? 'http://localhost:4300/api';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE)) throw new Error('local only');
const MARK = 'ZZSECRETB';
async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'Demo1234!' } })).json.data;
const A = await login('owner@demo.recrm.test');
const B = (await call('POST', '/auth/register', { body: { fullName: 'Bee Owner', email: `b3-${Date.now()}@pentest.recrm.test`, password: 'Str0ngPassw0rd!', businessName: `${MARK} Three` } })).json.data;
const tB = B.accessToken, tA = A.accessToken;
const get1 = async (t, p) => (await call('GET', p, { token: t })).json.data;
const bClient = (await call('POST', '/clients', { token: tB, body: { fullName: `${MARK} Client`, mobileNumber: '03001112233' } })).json.data;
const bOwner = (await call('POST', '/owners', { token: tB, body: { fullName: `${MARK} Owner`, mobileNumber: '03001112244' } })).json.data;
const bProp = (await call('POST', '/properties', { token: tB, body: { propertyType: 'HOUSE', size: 200, sizeUnit: 'SQ_YARD', askingPrice: 3e7, ownerId: bOwner._id } })).json.data;
const bDeal = (await call('POST', '/deals', { token: tB, body: { clientId: bClient._id, title: `${MARK} D` } })).json.data;
const bCat = (await get1(tB, '/transaction-categories')).find((c) => c.type === 'INCOME');
const bBranch = (await get1(tB, '/branches'))[0];
const bClientCat = (await call('POST', '/client-categories', { token: tB, body: { name: `${MARK} Cat` } })).json?.data;
const aClient = (await get1(tA, '/clients?limit=2'))[1];
const aProp = (await get1(tA, '/properties?limit=2'))[1];
const aOwner = (await get1(tA, '/owners?limit=2'))[1];
const aFollow = (await get1(tA, '/followups?limit=1'))[0];
const aTx = (await get1(tA, '/transactions?limit=1'))[0];
const aAgr = (await get1(tA, '/agreements?limit=1'))[0];
const aDeal = (await get1(tA, '/deals?limit=1'))[0];
const aLease = (await get1(tA, '/leases?limit=1'))?.[0];
const aPlan = (await get1(tA, '/installments?limit=1'))?.[0];

const cases = [
  ['client → foreign branch', 'PATCH', `/clients/${aClient._id}`, { branchId: bBranch._id }],
  ['client → foreign category', 'PATCH', `/clients/${aClient._id}`, { categoryId: bClientCat?._id }],
  ['client reassign → foreign user', 'POST', `/clients/${aClient._id}/assign`, { userId: B.user._id }],
  ['property → foreign co-owner', 'PATCH', `/properties/${aProp._id}`, { coOwnerIds: [bOwner._id] }],
  ['property → foreign agent', 'PATCH', `/properties/${aProp._id}`, { agentIds: [B.user._id] }],
  ['property → foreign branch', 'PATCH', `/properties/${aProp._id}`, { branchId: bBranch._id }],
  ['follow-up → foreign property', 'PATCH', `/followups/${aFollow._id}`, { propertyId: bProp._id }],
  ['follow-up → foreign client', 'PATCH', `/followups/${aFollow._id}`, { clientId: bClient._id }],
  ['follow-up → foreign assignee', 'PATCH', `/followups/${aFollow._id}`, { assignedTo: B.user._id }],
  ['transaction → foreign category', 'PATCH', `/transactions/${aTx._id}`, { categoryId: bCat._id }],
  ['transaction → foreign client', 'PATCH', `/transactions/${aTx._id}`, { clientId: bClient._id }],
  ['transaction → foreign deal', 'PATCH', `/transactions/${aTx._id}`, { dealId: bDeal._id }],
  ['agreement → foreign owner', 'PATCH', `/agreements/${aAgr._id}`, { ownerId: bOwner._id }],
  ['agreement → foreign property', 'PATCH', `/agreements/${aAgr._id}`, { propertyId: bProp._id }],
  ['agreement → foreign deal', 'PATCH', `/agreements/${aAgr._id}`, { dealId: bDeal._id }],
  ['deal → foreign agent', 'PATCH', `/deals/${aDeal._id}`, { agents: [{ userId: B.user._id, sharePct: 100 }] }],
  ['deal → foreign property', 'PATCH', `/deals/${aDeal._id}`, { propertyId: bProp._id }],
  ['owner portal for foreign owner', 'POST', '/portal-links', { kind: 'OWNER', partyId: bOwner._id }],
  ['lease → foreign tenant', 'PATCH', `/leases/${aLease?._id}`, { tenantId: bClient._id }],
  ['plan → foreign property', 'PATCH', `/installments/${aPlan?._id}`, { propertyId: bProp._id }],
  ['note on foreign deal', 'POST', '/notes', { entityType: 'deal', entityId: bDeal._id, content: 'x' }],
  ['document list foreign client', 'GET', `/documents?entityType=client&entityId=${bClient._id}`, null],
  ['match update foreign', 'PATCH', `/matches/${bClient._id}`, { status: 'REJECTED' }],
  ['sync update A client → B branch', 'SYNC', 'clients', { branchId: bBranch._id }],
  ['sync update A property → B owner', 'SYNC', 'properties', { ownerId: bOwner._id }],
];
const ids = { clients: aClient, properties: aProp };
for (const [label, m, path, body] of cases) {
  let r;
  if (m === 'SYNC') {
    r = await call('POST', '/sync/push', { token: tA, body: { mutations: [{ mutationId: randomUUID(), entity: path, op: 'update', uuid: ids[path].uuid ?? ids[path]._id, data: body, force: true }] } });
    const res = r.json?.data?.results?.[0];
    console.log(`${res?.status === 'applied' ? 'ISSUE' : 'ok   '} ${label}: ${res?.status} ${res?.code ?? ''}`);
    continue;
  }
  r = await call(m, path, { token: tA, body: body ?? undefined });
  const leak = r.text.includes(MARK);
  const target = path.match(/^\/(\w+)\/([a-f0-9]{24})/);
  let after = '';
  if (r.status < 300 && target && m !== 'GET') after = (await call('GET', `/${target[1]}/${target[2]}`, { token: tA })).text;
  const bad = leak || after.includes(MARK) || (m !== 'GET' && r.status < 300 && Object.values(body ?? {}).flat().some((v) => typeof v === 'string' && after.includes(v)) );
  console.log(`${leak || after.includes(MARK) ? 'CRITICAL' : bad ? 'ISSUE   ' : 'ok      '} ${label}: ${r.status} ${r.json?.code ?? ''} ${(r.json?.message ?? '').slice(0, 70)}`);
}
