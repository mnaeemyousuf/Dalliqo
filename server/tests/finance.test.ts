import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DEFAULT_TRANSACTION_CATEGORIES, ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { runMigrations } from '../src/migrations';
import { TransactionCategory } from '../src/models/TransactionCategory';
import { createClient } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const member = (owner: Session, template: keyof typeof ROLE_PRESETS) => addActiveMember(app, owner, { permissions: [...ROLE_PRESETS[template]] });

async function categories(s: Session): Promise<{ _id: string; key?: string; type: string; name: string }[]> {
  return (await request(app).get('/api/transaction-categories').set(bearer(s.accessToken))).body.data;
}
const cat = async (s: Session, key: string) => (await categories(s)).find((c) => c.key === key)!._id;

async function record(s: Session, body: Record<string, unknown>) {
  const res = await request(app).post('/api/transactions').set(bearer(s.accessToken)).send(body);
  if (res.status !== 201) throw new Error(`create transaction failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

describe('income & expense', () => {
  it('seeds the built-in categories (with Urdu names) at registration; the migration back-fills and is idempotent', async () => {
    const owner = await registerOwner(app);
    const list = await categories(owner);
    expect(list).toHaveLength(DEFAULT_TRANSACTION_CATEGORIES.length);
    expect(list.find((c) => c.key === 'COMMISSION')).toMatchObject({ type: 'INCOME', nameUr: 'کمیشن', isSystem: true });

    // An older business without categories gets them from migration 002; a second run creates nothing.
    await TransactionCategory.deleteMany({ businessId: owner.businessId });
    const first = (await runMigrations())['002-finance-categories'] as { categoriesCreated: number };
    expect(first.categoriesCreated).toBeGreaterThanOrEqual(DEFAULT_TRANSACTION_CATEGORIES.length);
    expect(await categories(owner)).toHaveLength(DEFAULT_TRANSACTION_CATEGORIES.length);
    const again = (await runMigrations())['002-finance-categories'] as { categoriesCreated: number };
    expect(again.categoriesCreated).toBe(0);
  });

  it('records, filters, edits and deletes entries; category type must match; custom categories', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const rent = await cat(owner, 'OFFICE_RENT');
    const uuid = randomUUID();
    const t = await record(owner, { uuid, type: 'EXPENSE', categoryId: rent, amount: 85_000, date: '2026-10-01', description: 'October rent', reference: 'RCPT-77' });
    expect(t).toMatchObject({ type: 'EXPENSE', amount: 85_000, method: 'CASH', source: 'MANUAL', branchId: expect.any(String) });
    // Replays by uuid return the same entry.
    expect((await record(owner, { uuid, type: 'EXPENSE', categoryId: rent, amount: 85_000, date: '2026-10-01' }))._id).toBe(t._id);
    // An expense category cannot be used for income.
    expect((await request(app).post('/api/transactions').set(auth).send({ type: 'INCOME', categoryId: rent, amount: 1, date: '2026-10-01' })).status).toBe(400);
    expect((await request(app).post('/api/transactions').set(auth).send({ type: 'EXPENSE', categoryId: rent, amount: 0, date: '2026-10-01' })).status).toBe(400);

    const custom = await request(app).post('/api/transaction-categories').set(auth).send({ name: 'Stationery', nameUr: 'اسٹیشنری', type: 'EXPENSE' });
    expect(custom.status).toBe(201);
    expect((await request(app).post('/api/transaction-categories').set(auth).send({ name: 'stationery', type: 'EXPENSE' })).status).toBe(409);
    await record(owner, { type: 'EXPENSE', categoryId: custom.body.data._id, amount: 2_500, date: '2026-10-12', method: 'JAZZCASH' });
    await record(owner, { type: 'INCOME', categoryId: await cat(owner, 'CONSULTANCY'), amount: 25_000, date: '2026-09-20' });

    const byType = await request(app).get('/api/transactions?type=EXPENSE').set(auth);
    expect(byType.body.data).toHaveLength(2);
    expect(byType.body.data[0].categoryId).toMatchObject({ name: 'Stationery' });
    expect((await request(app).get('/api/transactions?q=october').set(auth)).body.data).toHaveLength(1);
    expect((await request(app).get('/api/transactions?from=2026-10-01&to=2026-10-31').set(auth)).body.data).toHaveLength(2);

    const edited = await request(app).patch(`/api/transactions/${t._id}`).set(auth).send({ amount: 90_000, baseVersion: t.version });
    expect(edited.body.data.amount).toBe(90_000);
    expect((await request(app).patch(`/api/transactions/${t._id}`).set(auth).send({ amount: 1, baseVersion: t.version })).status).toBe(409);
    expect((await request(app).delete(`/api/transactions/${t._id}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/transactions/${t._id}`).set(auth)).status).toBe(404);

    // Built-ins can be archived (hidden from pickers) but not renamed.
    expect((await request(app).patch(`/api/transaction-categories/${rent}`).set(auth).send({ name: 'Rent' })).status).toBe(400);
    expect((await request(app).patch(`/api/transaction-categories/${rent}`).set(auth).send({ archived: true })).status).toBe(200);
    expect((await categories(owner)).some((c) => c._id === rent)).toBe(false);

    const timeline = await request(app).get(`/api/activities?entityId=${t._id}`).set(auth);
    expect(timeline.body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['TRANSACTION_RECORDED', 'TRANSACTION_UPDATED', 'TRANSACTION_DELETED']));
  });

  it('creates commission income from deal payments exactly once, removes it with the payment, and respects the setting', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const client = await createClient(app, owner);
    const deal = (await request(app).post('/api/deals').set(auth).send({ clientId: client._id, finalPrice: 20_000_000 })).body.data;
    const paymentId = randomUUID();
    const pay = () => request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ id: paymentId, side: 'BUYER', amount: 200_000, date: '2026-10-05', method: 'BANK_TRANSFER', reference: 'TT-55' });
    expect((await pay()).status).toBe(201);
    await pay(); // retried request
    const income = (await request(app).get(`/api/transactions?dealId=${deal._id}`).set(auth)).body.data;
    expect(income).toHaveLength(1);
    expect(income[0]).toMatchObject({ type: 'INCOME', amount: 200_000, source: 'COMMISSION', method: 'BANK_TRANSFER', reference: 'TT-55', categoryId: { key: 'COMMISSION' } });
    // The payment records the income entry it produced; commission income is changed on the deal only.
    const got = (await request(app).get(`/api/deals/${deal._id}`).set(auth)).body.data;
    expect(got.payments[0].transactionId).toBe(income[0]._id);
    expect((await request(app).patch(`/api/transactions/${income[0]._id}`).set(auth).send({ amount: 1 })).status).toBe(409);
    expect((await request(app).delete(`/api/transactions/${income[0]._id}`).set(auth)).status).toBe(409);

    // A payment synced from a phone (inside a deal update) is handled the same way.
    const offlineId = randomUUID();
    const push = await request(app).post('/api/sync/push').set(auth).send({
      mutations: [{ mutationId: randomUUID(), entity: 'deals', op: 'update', uuid: deal.uuid, data: { payments: [...got.payments.map((p: Record<string, unknown>) => ({ _id: p._id, side: p.side, amount: p.amount, date: p.date })), { _id: offlineId, side: 'SELLER', amount: 150_000, date: '2026-10-09' }] } }],
    });
    expect(push.body.data.results[0].status).toBe('applied');
    expect((await request(app).get(`/api/transactions?dealId=${deal._id}`).set(auth)).body.data).toHaveLength(2);

    expect((await request(app).delete(`/api/deals/${deal._id}/payments/${paymentId}`).set(auth)).status).toBe(200);
    const left = (await request(app).get(`/api/transactions?dealId=${deal._id}`).set(auth)).body.data;
    expect(left.map((t: { amount: number }) => t.amount)).toEqual([150_000]);

    // Re-adding a removed payment id brings its income back (still one entry).
    expect((await pay()).status).toBe(201);
    expect((await request(app).get(`/api/transactions?dealId=${deal._id}`).set(auth)).body.data).toHaveLength(2);

    // Setting off: payments no longer create income.
    expect((await request(app).patch('/api/settings').set(auth).send({ commission: { autoCreateIncome: false } })).status).toBe(200);
    await request(app).post(`/api/deals/${deal._id}/payments`).set(auth).send({ side: 'SELLER', amount: 10_000, date: '2026-10-20' });
    expect((await request(app).get(`/api/transactions?dealId=${deal._id}`).set(auth)).body.data).toHaveLength(2);
  });

  it('reports income, expense and net by month and by category; dashboard tiles; exports', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    await record(owner, { type: 'INCOME', categoryId: await cat(owner, 'CONSULTANCY'), amount: 50_000, date: '2026-09-10T10:00:00Z' });
    await record(owner, { type: 'EXPENSE', categoryId: await cat(owner, 'OFFICE_RENT'), amount: 30_000, date: '2026-09-15T10:00:00Z' });
    await record(owner, { type: 'EXPENSE', categoryId: await cat(owner, 'UTILITIES'), amount: 5_000, date: '2026-10-02T10:00:00Z' });

    const monthly = (await request(app).get('/api/reports/finance?groupBy=month&from=2026-09-01&to=2026-10-31').set(auth)).body.data;
    expect(monthly.rows).toEqual([
      expect.objectContaining({ key: '2026-09', income: 50_000, expense: 30_000, net: 20_000, count: 2 }),
      expect.objectContaining({ key: '2026-10', income: 0, expense: 5_000, net: -5_000, count: 1 }),
    ]);
    expect(monthly.totals).toEqual({ income: 50_000, expense: 35_000, net: 15_000 });
    const byCat = (await request(app).get('/api/reports/finance?groupBy=category').set(auth)).body.data;
    expect(byCat.rows[0]).toMatchObject({ label: 'Consultancy', labelUr: 'مشاورت', income: 50_000 });

    const now = new Date();
    await record(owner, { type: 'INCOME', categoryId: await cat(owner, 'OTHER_INCOME'), amount: 7_000, date: now.toISOString() });
    const dash = (await request(app).get('/api/dashboard').set(auth)).body.data;
    expect(dash.finance).toMatchObject({ incomeThisMonth: 7_000 });

    const xlsx = await request(app).get('/api/exports/transactions?format=xlsx').set(auth);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await request(app).get('/api/exports/finance?format=pdf&groupBy=category').set(auth);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('pdf');
  });

  it('permission templates: agents see no finance, viewers read only, accountants manage', async () => {
    const owner = await registerOwner(app);
    const [agent, viewer, accountant, manager] = await Promise.all([member(owner, 'AGENT'), member(owner, 'VIEWER'), member(owner, 'ACCOUNTANT'), member(owner, 'MANAGER')]);
    const rent = await cat(owner, 'OFFICE_RENT');
    const body = { type: 'EXPENSE', categoryId: rent, amount: 1_000, date: '2026-10-01' };

    expect((await request(app).get('/api/transactions').set(bearer(agent.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/reports/finance').set(bearer(agent.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/exports/transactions').set(bearer(agent.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/dashboard').set(bearer(agent.accessToken))).body.data.finance).toBeUndefined();
    expect((await request(app).get('/api/sync/pull').set(bearer(agent.accessToken))).body.data.changes.transactions).toBeUndefined();

    expect((await request(app).get('/api/transactions').set(bearer(viewer.accessToken))).status).toBe(200);
    expect((await request(app).post('/api/transactions').set(bearer(viewer.accessToken)).send(body)).status).toBe(403);

    const t = await record(accountant, body);
    expect((await request(app).patch(`/api/transactions/${t._id}`).set(bearer(accountant.accessToken)).send({ amount: 2_000 })).status).toBe(200);
    expect((await request(app).delete(`/api/transactions/${t._id}`).set(bearer(manager.accessToken))).status).toBe(200);
  });

  it('keeps entries inside their business and branch; syncs offline without duplicates', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const t = await record(a, { type: 'EXPENSE', categoryId: await cat(a, 'MARKETING'), amount: 12_000, date: '2026-10-01' });
    expect((await request(app).get(`/api/transactions/${t._id}`).set(bearer(b.accessToken))).status).toBe(404);
    expect((await request(app).get('/api/transactions').set(bearer(b.accessToken))).body.data).toHaveLength(0);
    // Another business's category cannot be used.
    expect((await request(app).post('/api/transactions').set(bearer(b.accessToken)).send({ type: 'EXPENSE', categoryId: await cat(a, 'MARKETING'), amount: 1, date: '2026-10-01' })).status).toBe(400);
    expect((await request(app).get('/api/reports/finance').set(bearer(b.accessToken))).body.data.totals).toEqual({ income: 0, expense: 0, net: 0 });

    const clifton = (await request(app).post('/api/branches').set(bearer(a.accessToken)).send({ name: 'Clifton' })).body.data;
    const restricted = await addActiveMember(app, a, { permissions: [...ROLE_PRESETS.ACCOUNTANT], branchAccess: 'SELECTED', branchIds: [clifton._id] });
    expect((await request(app).get(`/api/transactions/${t._id}`).set(bearer(restricted.accessToken))).status).toBe(404);
    const own = await record(restricted, { type: 'EXPENSE', categoryId: await cat(a, 'FUEL_TRAVEL'), amount: 3_000, date: '2026-10-03' });
    expect(own.branchId).toBe(clifton._id);
    expect((await request(app).get('/api/reports/finance').set(bearer(restricted.accessToken))).body.data.totals.expense).toBe(3_000);
    expect((await request(app).get('/api/reports/finance').set(bearer(a.accessToken))).body.data.totals.expense).toBe(15_000);

    const uuid = randomUUID();
    const mutation = { mutationId: randomUUID(), entity: 'transactions', op: 'create', uuid, data: { type: 'EXPENSE', categoryId: await cat(a, 'UTILITIES'), amount: 4_400, date: '2026-10-04' } };
    const first = await request(app).post('/api/sync/push').set(bearer(a.accessToken)).send({ mutations: [mutation] });
    expect(first.body.data.results[0].status).toBe('applied');
    await request(app).post('/api/sync/push').set(bearer(a.accessToken)).send({ mutations: [mutation] });
    await request(app).post('/api/sync/push').set(bearer(a.accessToken)).send({ mutations: [{ ...mutation, mutationId: randomUUID() }] });
    const pulled = (await request(app).get('/api/sync/pull').set(bearer(a.accessToken))).body.data.changes;
    expect(pulled.transactions.filter((x: { uuid: string }) => x.uuid === uuid)).toHaveLength(1);
    expect(pulled.transactionCategories.length).toBeGreaterThanOrEqual(DEFAULT_TRANSACTION_CATEGORIES.length);
  });
});
