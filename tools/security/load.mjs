// Load test against the LOCAL demo API: many simulated users mixing reads and writes.
// Usage: node stress.mjs [concurrency] [seconds]
import { randomUUID } from 'node:crypto';
const BASE = 'http://localhost:4300/api';
const CONC = Number(process.argv[2] ?? 50);
const SECS = Number(process.argv[3] ?? 30);
const EMAILS = ['owner', 'manager', 'agent', 'son', 'accounts', 'viewer'].map((u) => `${u}@demo.recrm.test`);

async function call(method, path, token, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, err: String(e.message ?? e) };
  }
}
// Several sessions per demo user so the per-session rate limit is not what we measure.
const sessions = [];
for (const email of EMAILS) for (let i = 0; i < 3; i++) {
  const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'mobile' }, body: JSON.stringify({ email, password: 'Demo1234!' }) });
  const j = await r.json();
  if (j.data?.accessToken) sessions.push({ email, token: j.data.accessToken });
}
const owner = sessions.find((s) => s.email.startsWith('owner'));
const clients = (await (await fetch(BASE + '/clients?limit=50', { headers: { Authorization: `Bearer ${owner.token}` } })).json()).data;
const props = (await (await fetch(BASE + '/properties?limit=50', { headers: { Authorization: `Bearer ${owner.token}` } })).json()).data;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const READS = [
  ['dashboard', () => '/dashboard'], ['my-day', () => '/my-day'], ['clients list', () => '/clients?limit=20'],
  ['client search', () => `/clients?q=${encodeURIComponent(pick(['ali', 'khan', 'ahmed', 'dha', '0300']))}`], ['client detail', () => `/clients/${pick(clients)._id}`],
  ['properties list', () => '/properties?limit=20'], ['property detail', () => `/properties/${pick(props)._id}`], ['matches', () => '/matches?limit=20'],
  ['follow-ups', () => '/followups?limit=20'], ['global search', () => `/search?q=${pick(['gul', 'dha', 'ali', 'plot'])}`], ['notifications', () => '/notifications?limit=20'],
  ['deals', () => '/deals?limit=20'], ['analytics', () => '/dashboard/analytics'], ['sync pull', () => '/sync/pull?limit=200'],
];
const stats = new Map();
const add = (name, r) => {
  const s = stats.get(name) ?? { ms: [], codes: {} };
  s.ms.push(r.ms); s.codes[r.status] = (s.codes[r.status] ?? 0) + 1;
  stats.set(name, s);
};
const end = Date.now() + SECS * 1000;
let n = 0;
async function worker(id) {
  const s = sessions[id % sessions.length];
  while (Date.now() < end) {
    n++;
    const roll = Math.random();
    if (roll < 0.8) {
      const [name, path] = pick(READS);
      add(name, await call('GET', path(), s.token));
    } else if (roll < 0.9 && /owner|manager|agent|son/.test(s.email)) {
      add('create follow-up', await call('POST', '/followups', s.token, { clientId: pick(clients)._id, type: 'CALL', dueAt: new Date(Date.now() + 864e5).toISOString(), notes: 'load test' }));
    } else if (/owner|manager|agent|son/.test(s.email)) {
      add('sync push note', await call('POST', '/sync/push', s.token, { mutations: [{ mutationId: randomUUID(), entity: 'notes', op: 'create', uuid: randomUUID(), data: { entityType: 'client', entityId: pick(clients)._id, content: 'load test note' } }] }));
    } else {
      add('clients list', await call('GET', '/clients?limit=20', s.token));
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));
const secs = (Date.now() - t0) / 1000;
const q = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
let total = 0, errors = 0;
console.log(`concurrency ${CONC}, ${secs.toFixed(0)} s, sessions ${sessions.length}`);
console.log('endpoint'.padEnd(18), 'count', '  p50', '  p95', '  p99', '  max', 'statuses');
for (const [name, s] of [...stats].sort()) {
  total += s.ms.length;
  errors += Object.entries(s.codes).filter(([c]) => Number(c) >= 500 || Number(c) === 0 || Number(c) === 429).reduce((a, [, v]) => a + v, 0);
  console.log(name.padEnd(18), String(s.ms.length).padStart(5), ...[0.5, 0.95, 0.99, 1].map((p) => String(Math.round(q(s.ms, p))).padStart(5)), JSON.stringify(s.codes));
}
console.log(`total ${total} requests, ${(total / secs).toFixed(0)} req/s, server errors / timeouts / rate-limited: ${errors}`);
