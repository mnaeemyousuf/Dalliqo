// In-agency authorization: what each demo role can reach. LOCAL ONLY.
const BASE = process.argv[2] ?? 'http://localhost:4300/api';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE)) throw new Error('local only');
async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'Demo1234!' } })).json.data;
const owner = await login('owner@demo.recrm.test');
const agent = await login('agent@demo.recrm.test');
const viewer = await login('viewer@demo.recrm.test');
const accts = await login('accounts@demo.recrm.test');
const perms = async (u) => (await call('GET', '/auth/me', { token: u.accessToken })).json.data.membership?.permissions ?? [];
const ap = await perms(agent), vp = await perms(viewer), cp = await perms(accts);
console.log('agent perms:', ap.join(' '));
console.log('viewer perms:', vp.join(' '));
const out = [];
const note = (bad, msg) => out.push(`${bad ? 'ISSUE' : 'ok   '} ${msg}`);

const tx = (await call('GET', '/transactions?limit=5', { token: owner.accessToken })).json.data;
const agr = (await call('GET', '/agreements?limit=5', { token: owner.accessToken })).json.data;
const deals = (await call('GET', '/deals?limit=50', { token: owner.accessToken })).json.data;
const agentId = agent.user._id;
const othersDeal = deals.find((d) => !(d.agents ?? []).some((a) => String(a.userId?._id ?? a.userId) === agentId));

// Notes on records the role cannot read
if (!ap.includes('finance:read') && tx[0]) {
  const r = await call('POST', '/notes', { token: agent.accessToken, body: { entityType: 'transaction', entityId: tx[0]._id, content: 'probe' } });
  note(r.status < 300, `agent (no finance) adds note to an income/expense entry → ${r.status}`);
}
if (othersDeal && !ap.includes('deals:read_all')) {
  const r = await call('POST', '/notes', { token: agent.accessToken, body: { entityType: 'deal', entityId: othersDeal._id, content: 'probe' } });
  note(r.status < 300, `agent adds note to another agent's deal → ${r.status}`);
  const g = await call('GET', `/deals/${othersDeal._id}`, { token: agent.accessToken });
  note(g.status === 200, `agent opens another agent's deal → ${g.status}`);
  const n = await call('GET', `/notes?entityType=deal&entityId=${othersDeal._id}`, { token: agent.accessToken });
  note(n.status === 200 && (n.json?.data ?? []).length > 0, `agent reads notes of another agent's deal → ${n.status} (${(n.json?.data ?? []).length})`);
}

// Documents attached to records the role cannot read
for (const [et, id, need] of [['transaction', tx[0]?._id, 'finance:read'], ['agreement', agr[0]?._id, 'agreements:read'], ['deal', othersDeal?._id, 'deals:read_all']]) {
  if (!id) continue;
  // owner attaches a harmless document first
  const f = new FormData();
  f.append('file', new Blob(['%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'], { type: 'application/pdf' }), `${et}-receipt.pdf`);
  f.append('entityType', et); f.append('entityId', id); f.append('category', 'OTHER');
  const up = await fetch(BASE + '/documents', { method: 'POST', headers: { Authorization: `Bearer ${owner.accessToken}` }, body: f });
  const doc = (await up.json()).data;
  for (const [who, token, p] of [['agent', agent.accessToken, ap], ['viewer', viewer.accessToken, vp]]) {
    if (p.includes(need) || !p.includes('documents:read')) continue;
    const l = await call('GET', `/documents?entityType=${et}&entityId=${id}`, { token });
    const d = doc ? await call('GET', `/documents/${doc._id}/download`, { token }) : { status: 0 };
    note(((l.json?.data ?? []).length > 0) || d.status === 200, `${who} (no ${need}) lists ${et} documents → ${(l.json?.data ?? []).length} found, download → ${d.status}`);
  }
}
const all = await call('GET', '/documents?limit=100', { token: agent.accessToken });
const types = [...new Set((all.json?.data ?? []).map((d) => d.entityType))];
note(!ap.includes('finance:read') && types.includes('transaction'), `agent's documents library contains entity types: ${types.join(', ')}`);

// Floor price and CNIC
const props = (await call('GET', '/properties?limit=50', { token: agent.accessToken })).json.data;
note(!ap.includes('properties:view_floor_price') && props.some((p) => p.minimumPrice != null), `agent property list exposes minimumPrice: ${props.filter((p) => p.minimumPrice != null).length}`);
const owners = (await call('GET', '/owners?limit=50', { token: agent.accessToken })).json.data;
note(!ap.includes('documents:read_sensitive') && owners.some((o) => /^\d{13}$/.test(o.cnic ?? '')), `agent owner list exposes full CNIC: ${owners.filter((o) => /^\d{13}$/.test(o.cnic ?? '')).length}`);

// Offline sync download: does the phone get records the role cannot open?
const boot = await call('GET', '/sync/bootstrap', { token: agent.accessToken });
const ch = boot.json?.data?.changes ?? {};
const counts = Object.fromEntries(Object.entries(ch).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
console.log('agent bootstrap entities:', JSON.stringify(counts));
note(!ap.includes('finance:read') && (counts.transactions ?? 0) > 0, `agent bootstrap includes ${counts.transactions ?? 0} income/expense entries`);
note(!ap.includes('agreements:read') && (counts.agreements ?? 0) > 0, `agent bootstrap includes ${counts.agreements ?? 0} agreements`);
const syncedDeals = ch.deals ?? [];
const foreignDeals = syncedDeals.filter((d) => !(d.agents ?? []).some((a) => String(a.userId?._id ?? a.userId) === agentId) && String(d.createdBy) !== agentId);
note(!ap.includes('deals:read_all') && foreignDeals.length > 0, `agent bootstrap includes ${foreignDeals.length} deals of other agents`);
note((ch.properties ?? []).some((p) => p.minimumPrice != null) && !ap.includes('properties:view_floor_price'), 'agent bootstrap exposes minimumPrice');
note((ch.owners ?? []).some((o) => /^\d{13}$/.test(o.cnic ?? '')) && !ap.includes('documents:read_sensitive'), 'agent bootstrap exposes full CNIC');
const vboot = await call('GET', '/sync/bootstrap', { token: viewer.accessToken });
const vch = vboot.json?.data?.changes ?? {};
note(!vp.includes('finance:read') && (vch.transactions ?? []).length > 0, `viewer bootstrap includes ${(vch.transactions ?? []).length} income/expense entries`);

// Activity feed and search
const act = await call('GET', '/activities?limit=100', { token: agent.accessToken });
const money = (act.json?.data ?? []).filter((a) => /RENT_RECEIVED|INSTALLMENT|TRANSACTION|COMMISSION|PAYOUT|INCOME|EXPENSE/.test(a.type ?? ''));
note(!ap.includes('finance:read') && money.length > 0, `agent activity feed shows ${money.length} money events (${[...new Set(money.map((a) => a.type))].join(', ')})`);
const s = await call('GET', '/search?q=a', { token: viewer.accessToken });
note(s.status === 200 && JSON.stringify(s.json?.data ?? {}).match(/"transactions"\s*:\s*\[\s*\{/) && !vp.includes('finance:read'), 'viewer search returns transactions');
const dash = await call('GET', '/dashboard', { token: agent.accessToken });
note(!ap.includes('finance:read') && /"income"\s*:\s*[1-9]|"netProfit"\s*:\s*[1-9]/.test(dash.text), 'agent dashboard shows income / profit totals');
const ex = await call('GET', '/exports/transactions?format=xlsx', { token: viewer.accessToken });
note(ex.status === 200 && !vp.includes('finance:read'), `viewer exports transactions → ${ex.status}`);
const ex2 = await call('GET', '/exports/clients?format=xlsx', { token: accts.accessToken });
note(ex2.status === 200 && !cp.includes('clients:read'), `accountant exports clients → ${ex2.status}`);

console.log(out.join('\n'));
