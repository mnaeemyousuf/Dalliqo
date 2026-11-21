// Controlled re-check: each attack is paired with the same request using the agency's own ids.
// If the control fails too, the attack result proves nothing. LOCAL ONLY.
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
const login = async (email, password = 'Demo1234!') => (await call('POST', '/auth/login', { body: { email, password } })).json.data;
const A = await login('owner@demo.recrm.test');
const reg = await call('POST', '/auth/register', { body: { fullName: 'Bee Owner', email: `b2-${Date.now()}@pentest.recrm.test`, password: 'Str0ngPassw0rd!', businessName: `${MARK} Two` } });
const B = reg.json.data;
const mk = async (path, body) => (await call('POST', path, { token: B.accessToken, body })).json?.data;
const bClient = await mk('/clients', { fullName: `${MARK} Client`, mobileNumber: '03001112233' });
const bOwner = await mk('/owners', { fullName: `${MARK} Owner`, mobileNumber: '03001112244' });
const bProp = await mk('/properties', { propertyType: 'HOUSE', size: 200, sizeUnit: 'SQ_YARD', askingPrice: 30000000, society: `${MARK} Soc`, ownerId: bOwner._id });
const bDeal = await mk('/deals', { clientId: bClient._id, propertyId: bProp._id, title: `${MARK} Deal` });
const aClient = (await call('GET', '/clients?limit=1', { token: A.accessToken })).json.data[0];
const aProp = (await call('GET', '/properties?limit=1', { token: A.accessToken })).json.data[0];
const aOwner = (await call('GET', '/owners?limit=1', { token: A.accessToken })).json.data[0];
const aDeal = (await call('GET', '/deals?limit=1', { token: A.accessToken })).json.data[0];
const me = (await call('GET', '/auth/me', { token: A.accessToken })).json.data.user ?? A.user;
const due = new Date(Date.now() + 864e5).toISOString();
const now = new Date().toISOString();
const end = new Date(Date.now() + 3e10).toISOString();

// [label, method, path, body with own ids, body with foreign ids]
const aCat = (await call('GET', '/transaction-categories', { token: A.accessToken })).json.data.find((c) => c.type === 'INCOME');
const bCat = (await call('GET', '/transaction-categories', { token: B.accessToken })).json.data.find((c) => c.type === 'INCOME');
const aBranch = (await call('GET', '/branches', { token: A.accessToken })).json.data[0];
const bBranch = (await call('GET', '/branches', { token: B.accessToken })).json.data[0];
const aTpl = (await call('GET', '/agreement-templates', { token: A.accessToken })).json?.data?.[0];
const bTpl = (await call('GET', '/agreement-templates', { token: B.accessToken })).json?.data?.[0];
const P = (n, extra) => ({ propertyType: 'RESIDENTIAL_PLOT', size: n, sizeUnit: 'SQ_YARD', askingPrice: 1e7, ...extra });
const F = (extra) => ({ clientId: aClient._id, type: 'CALL', dueAt: due, ...extra });
const T = (extra) => ({ type: 'INCOME', categoryId: aCat._id, amount: 1000, date: now, ...extra });
const I = (extra) => ({ clientId: aClient._id, totalAmount: 100000, frequency: 'MONTHLY', count: 2, startDate: due, ...extra });
const G = (extra) => ({ kind: 'SALE', clientId: aClient._id, ...extra });
const cases = [
  ['follow-up client', 'POST', '/followups', F({}), F({ clientId: bClient._id })],
  ['follow-up property', 'POST', '/followups', F({ propertyId: aProp._id }), F({ propertyId: bProp._id })],
  ['follow-up assignee', 'POST', '/followups', F({ assignedTo: me._id }), F({ assignedTo: B.user._id })],
  ['property owner', 'POST', '/properties', P(121, { ownerId: aOwner._id }), P(122, { ownerId: bOwner._id })],
  ['property co-owner', 'POST', '/properties', P(123, { coOwnerIds: [aOwner._id] }), P(124, { coOwnerIds: [bOwner._id] })],
  ['property agent', 'POST', '/properties', P(125, { agentIds: [me._id] }), P(126, { agentIds: [B.user._id] })],
  ['property branch', 'POST', '/properties', P(127, { branchId: aBranch._id }), P(128, { branchId: bBranch._id })],
  ['client branch', 'POST', '/clients', { fullName: 'Own Br', mobileNumber: '03009998811', branchId: aBranch._id, allowDuplicate: true }, { fullName: 'Fk Br', mobileNumber: '03009998812', branchId: bBranch._id, allowDuplicate: true }],
  ['client reassign', 'POST', , { userId: me._id }, { userId: B.user._id }],
  ['transaction category', 'POST', '/transactions', T({}), T({ categoryId: bCat._id })],
  ['transaction client', 'POST', '/transactions', T({ clientId: aClient._id }), T({ clientId: bClient._id })],
  ['transaction property', 'POST', '/transactions', T({ propertyId: aProp._id }), T({ propertyId: bProp._id })],
  ['transaction deal', 'POST', '/transactions', T({ dealId: aDeal?._id }), T({ dealId: bDeal?._id })],
  ['installment client', 'POST', '/installments', I({}), I({ clientId: bClient._id })],
  ['installment property', 'POST', '/installments', I({ propertyId: aProp._id }), I({ propertyId: bProp._id })],
  ['installment deal', 'POST', '/installments', I({ dealId: aDeal?._id }), I({ dealId: bDeal?._id })],
  ['agreement client', 'POST', '/agreements', G({}), G({ clientId: bClient._id })],
  ['agreement deal', 'POST', '/agreements', G({ dealId: aDeal?._id }), G({ dealId: bDeal?._id })],
  ['agreement owner', 'POST', '/agreements', G({ ownerId: aOwner._id }), G({ ownerId: bOwner._id })],
  ['agreement property', 'POST', '/agreements', G({ propertyId: aProp._id }), G({ propertyId: bProp._id })],
  ['agreement template', 'POST', '/agreements', G({ templateId: aTpl?._id }), G({ templateId: bTpl?._id })],
  ['portal link', 'POST', '/portal-links', { kind: 'CLIENT', partyId: aClient._id }, { kind: 'CLIENT', partyId: bClient._id }],
];
for (const [label, m, path, own, foreign] of cases) {
  const c = await call(m, path, { token: A.accessToken, body: own });
  const f = await call(m, path, { token: A.accessToken, body: foreign });
  let leak = f.text.includes(MARK);
  const id = f.json?.data?._id;
  if (id && f.status < 300) {
    const g = await call('GET', `${path}/${id}`, { token: A.accessToken });
    leak ||= g.text.includes(MARK);
  }
  const verdict = c.status >= 300 ? 'CONTROL FAILED (fix test)' : f.status < 300 ? (leak ? 'CRITICAL: accepted + LEAK' : 'ISSUE: foreign id accepted') : 'ok: refused';
  console.log(`${verdict.padEnd(28)} ${label}: own=${c.status} ${c.status >= 300 ? JSON.stringify(c.json?.details ?? c.json?.errors ?? c.json).slice(0, 260) : ''} | foreign=${f.status} ${f.json?.code ?? ''} ${(f.json?.message ?? '').slice(0, 60)}`);
}
// Sync: own vs foreign
for (const [entity, own, foreign] of [
  ['followUps', F({}), F({ clientId: bClient._id })],
  ['properties', P(131, { ownerId: aOwner._id }), P(132, { ownerId: bOwner._id })], ['properties', P(133, { branchId: aBranch._id }), P(134, { branchId: bBranch._id })],
  ['deals', { clientId: aClient._id, title: 's own' }, { clientId: bClient._id, title: 's fk' }],
  ['notes', { entityType: 'client', entityId: aClient._id, content: 's' }, { entityType: 'client', entityId: bClient._id, content: 's' }],
  ['transactions', T({}), T({ categoryId: bCat._id })], ['transactions', T({ clientId: aClient._id }), T({ clientId: bClient._id })],
  ['clients', { fullName: 'Sync Own', mobileNumber: '03007776601', assignedTo: me._id, allowDuplicate: true }, { fullName: 'Sync Fk', mobileNumber: '03007776602', assignedTo: B.user._id, allowDuplicate: true }],
]) {
  const push = async (data) => (await call('POST', '/sync/push', { token: A.accessToken, body: { mutations: [{ mutationId: randomUUID(), entity, op: 'create', uuid: randomUUID(), data }] } })).json?.data?.results?.[0];
  const c = await push(own), f = await push(foreign);
  const okc = c?.status === 'applied', okf = f?.status === 'applied';
  console.log(`${(!okc ? 'CONTROL FAILED (fix test)' : okf ? 'ISSUE: sync accepted foreign id' : 'ok: refused').padEnd(28)} sync ${entity}: own=${c?.status} ${!okc ? JSON.stringify(c).slice(0, 140) : ''} | foreign=${f?.status} ${JSON.stringify(f?.error ?? f?.code ?? '').slice(0, 80)}`);
}
