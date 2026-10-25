import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { AuditLog } from '../src/models/AuditLog';
import { createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();

const push = (s: Session, mutations: unknown[]) => request(app).post('/api/sync/push').set(bearer(s.accessToken)).send({ mutations });
const mutation = (entity: string, op: string, uuid: string, data?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  mutationId: randomUUID(),
  entity,
  op,
  uuid,
  data,
  ...extra,
});

describe('sync push', () => {
  it('applies offline creates, resolves uuid references, and is idempotent', async () => {
    const s = await registerOwner(app);
    const clientUuid = randomUUID();
    const followUpUuid = randomUUID();
    const createClient = mutation('clients', 'create', clientUuid, { fullName: 'Offline Client', mobileNumber: '03005556677', purchaseOrRental: 'PURCHASE' });
    const res = await push(s, [
      createClient,
      // References the client by its device uuid; the server id isn't known offline.
      mutation('followUps', 'create', followUpUuid, { clientId: clientUuid, type: 'CALL', dueAt: new Date(Date.now() + 3_600_000).toISOString() }),
      mutation('notes', 'create', randomUUID(), { entityType: 'client', entityId: clientUuid, content: 'Met at the office' }),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied', 'applied']);
    const serverId = res.body.data.results[0].serverId;
    expect(res.body.data.results[1].record.clientId).toBe(serverId);

    // The phone retries the same batch after a timeout: nothing is duplicated.
    const again = await push(s, [createClient]);
    expect(again.body.data.results[0]).toMatchObject({ status: 'applied', serverId });
    // Even a new mutation id for the same uuid is a no-op create.
    const dup = await push(s, [{ ...createClient, mutationId: randomUUID() }]);
    expect(dup.body.data.results[0].serverId).toBe(serverId);
    expect((await request(app).get('/api/clients').set(bearer(s.accessToken))).body.meta.total).toBe(1);
  });

  it('validates offline data with the same rules as the REST API', async () => {
    const s = await registerOwner(app);
    const res = await push(s, [mutation('clients', 'create', randomUUID(), { fullName: 'X', mobileNumber: 'nope' })]);
    expect(res.body.data.results[0]).toMatchObject({ status: 'rejected', code: 'VALIDATION_ERROR' });
  });

  it('respects permissions per mutation', async () => {
    const owner = await registerOwner(app);
    const son = await addActiveMember(app, owner);
    const uuid = randomUUID();
    await push(son, [mutation('clients', 'create', uuid, { fullName: 'Son Client', mobileNumber: '03001231231' })]);
    const del = await push(son, [mutation('clients', 'delete', uuid)]);
    expect(del.body.data.results[0]).toMatchObject({ status: 'rejected', code: 'FORBIDDEN' });
  });

  it('resolves ordinary conflicts last-write-wins and keeps the overwritten values in the audit log', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const uuid = randomUUID();
    await push(father, [mutation('clients', 'create', uuid, { fullName: 'Shared Client', mobileNumber: '03009998877', priority: 'LOW' })]);

    // Both edit version 1 while offline.
    const f = await push(father, [mutation('clients', 'update', uuid, { priority: 'HIGH' }, { baseVersion: 1 })]);
    expect(f.body.data.results[0].status).toBe('applied');
    const sres = await push(son, [mutation('clients', 'update', uuid, { priority: 'URGENT', notes: 'Call after Jummah' }, { baseVersion: 1 })]);
    expect(sres.body.data.results[0]).toMatchObject({ status: 'applied_with_conflict', version: 3 });
    expect(sres.body.data.results[0].record.priority).toBe('URGENT');

    const log = await AuditLog.findOne({ businessId: father.businessId, action: 'sync.conflict_overwritten' }).lean();
    expect(log!.changes).toEqual(expect.arrayContaining([{ field: 'priority', oldValue: 'HIGH', newValue: 'URGENT' }]));
  });

  it('asks the user before overwriting protected fields such as price and status', async () => {
    const father = await registerOwner(app);
    const son = await addActiveMember(app, father);
    const p = await createProperty(app, father, { askingPrice: 16_000_000 });

    await request(app).patch(`/api/properties/${p._id}`).set(bearer(father.accessToken)).send({ askingPrice: 15_500_000 }).expect(200);
    const offline = mutation('properties', 'update', p.uuid, { askingPrice: 15_000_000 }, { baseVersion: 1 });
    const conflict = await push(son, [offline]);
    expect(conflict.body.data.results[0]).toMatchObject({ status: 'conflict', code: 'VERSION_CONFLICT', version: 2 });
    expect(conflict.body.data.results[0].record.askingPrice).toBe(15_500_000);
    expect(conflict.body.data.results[0].message).toContain('askingPrice');

    // "Keep mine": a new, explicit mutation with force.
    const keep = await push(son, [{ ...offline, mutationId: randomUUID(), force: true }]);
    expect(keep.body.data.results[0].status).toBe('applied_with_conflict');
    expect((await request(app).get(`/api/properties/${p._id}`).set(bearer(father.accessToken))).body.data.askingPrice).toBe(15_000_000);
    expect(await AuditLog.countDocuments({ businessId: father.businessId, action: 'sync.conflict_kept_mine' })).toBe(1);
  });

  it('reports edits to records deleted elsewhere as conflicts', async () => {
    const s = await registerOwner(app);
    const uuid = randomUUID();
    await push(s, [mutation('owners', 'create', uuid, { fullName: 'Gone Owner', mobileNumber: '03001110000' })]);
    await push(s, [mutation('owners', 'delete', uuid)]);
    const edit = await push(s, [mutation('owners', 'update', uuid, { notes: 'x' }, { baseVersion: 1 })]);
    expect(edit.body.data.results[0]).toMatchObject({ status: 'conflict', message: 'This record was deleted by another user' });
  });
});

describe('sync pull & bootstrap (restore on a new phone)', () => {
  it('returns deltas including tombstones, then nothing until something changes', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const first = await request(app).get('/api/sync/pull').set(auth);
    expect(first.status).toBe(200);
    expect(first.body.data.changes.clientCategories).toHaveLength(9);
    expect(first.body.data.changes.clients).toHaveLength(0);

    const uuid = randomUUID();
    await push(s, [mutation('clients', 'create', uuid, { fullName: 'Delta Client', mobileNumber: '03001212121' })]);
    const second = await request(app).get(`/api/sync/pull?cursor=${first.body.data.cursor}`).set(auth);
    expect(second.body.data.changes.clients.map((c: { uuid: string }) => c.uuid)).toEqual([uuid]);
    expect(second.body.data.changes.clientCategories).toHaveLength(0);

    const third = await request(app).get(`/api/sync/pull?cursor=${second.body.data.cursor}`).set(auth);
    expect(third.body.data.changes.clients).toHaveLength(0);

    await push(s, [mutation('clients', 'delete', uuid)]);
    const fourth = await request(app).get(`/api/sync/pull?cursor=${third.body.data.cursor}`).set(auth);
    expect(fourth.body.data.changes.clients[0].deletedAt).toBeTruthy();
  });

  it('pages large deltas with hasMore', async () => {
    const s = await registerOwner(app);
    const res = await request(app).get('/api/sync/pull?limit=5').set(bearer(s.accessToken));
    expect(res.body.data.changes.clientCategories).toHaveLength(5);
    expect(res.body.data.hasMore).toBe(true);
    const next = await request(app).get(`/api/sync/pull?limit=5&cursor=${res.body.data.cursor}`).set(bearer(s.accessToken));
    expect(next.body.data.changes.clientCategories).toHaveLength(4);
    expect(next.body.data.hasMore).toBe(false);
  });

  it('bootstrap restores the whole business after logging in on a new device', async () => {
    const s = await registerOwner(app);
    await createProperty(app, s);
    await push(s, [mutation('clients', 'create', randomUUID(), { fullName: 'Kept Client', mobileNumber: '03001313131' })]);

    const { login } = await import('./support/helpers');
    const newPhone = await login(app, s.email, s.password);
    const res = await request(app).get('/api/sync/bootstrap').set(bearer(newPhone.accessToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.business._id).toBe(s.businessId);
    expect(d.members).toHaveLength(1);
    expect(d.settings.matching.weights.type).toBe(25);
    expect(d.changes.clients).toHaveLength(1);
    expect(d.changes.properties[0].propertyId).toBe('RE-000001');
    expect(d.cursor).toEqual(expect.any(String));
  });

  it('rejects malformed cursors', async () => {
    const s = await registerOwner(app);
    expect((await request(app).get('/api/sync/pull?cursor=%%%').set(bearer(s.accessToken))).status).toBe(400);
  });
});
