import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { Property } from '../src/models/Property';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, MOBILE, registerOwner } from './support/helpers';

const app = createApp();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('duplicate client detection', () => {
  it('stops a second client with the same number and points to the existing record', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const first = await createClient(app, s, { fullName: 'Muhammad Ali', mobileNumber: '0300 1112233' });

    // Same number written differently (local format) is still recognised after normalisation.
    const dup = await request(app).post('/api/clients').set(auth).send({ fullName: 'M. Ali', mobileNumber: '+92 300 1112233' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ success: false, code: 'CLIENT_DUPLICATE' });
    expect(dup.body.details.duplicates[0]).toMatchObject({ _id: first._id, fullName: 'Muhammad Ali' });

    // A clash on the WhatsApp / alternate number counts too.
    const viaAlt = await request(app).post('/api/clients').set(auth).send({ fullName: 'Ali Raza', mobileNumber: '03005556677', alternateNumber: '03001112233' });
    expect(viaAlt.status).toBe(409);

    // The user can still save deliberately (e.g. two family members sharing a phone).
    const forced = await request(app).post('/api/clients').set(auth).send({ fullName: 'Mrs. Ali', mobileNumber: '03001112233', allowDuplicate: true });
    expect(forced.status).toBe(201);
  });

  it('offers a lookup endpoint and never matches another business', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const existing = await createClient(app, a, { mobileNumber: '03334445566' });

    const hit = await request(app).get('/api/clients/duplicates?phone=03334445566').set(bearer(a.accessToken));
    expect(hit.status).toBe(200);
    expect(hit.body.data.map((c: { _id: string }) => c._id)).toEqual([existing._id]);
    const excluded = await request(app).get(`/api/clients/duplicates?phone=03334445566&excludeId=${existing._id}`).set(bearer(a.accessToken));
    expect(excluded.body.data).toHaveLength(0);

    // Business B neither sees A's client nor is blocked by it.
    expect((await request(app).get('/api/clients/duplicates?phone=03334445566').set(bearer(b.accessToken))).body.data).toHaveLength(0);
    await createClient(app, b, { mobileNumber: '03334445566' });
  });

  it('does not reject offline-created clients replayed through sync', async () => {
    const s = await registerOwner(app);
    await createClient(app, s, { mobileNumber: '03009998877' });
    const uuid = randomUUID();
    const res = await request(app)
      .post('/api/sync/push')
      .set({ ...bearer(s.accessToken), ...MOBILE })
      .send({ mutations: [{ mutationId: randomUUID(), entity: 'clients', op: 'create', uuid, data: { fullName: 'Offline Ali', mobileNumber: '03009998877' } }] });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].status).toBe('applied');
  });
});

describe('listing verification', () => {
  it('marks new listings verified, flags stale ones and records re-confirmation', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const fresh = await createProperty(app, s);
    const old = await createProperty(app, s, { society: 'DHA Karachi', block: 'Phase 6' });
    expect(fresh.lastVerifiedAt).toBeTruthy();

    // Simulate a listing nobody has confirmed for 45 days.
    await Property.updateOne({ businessId: s.businessId, _id: old._id }, { $set: { lastVerifiedAt: new Date(Date.now() - 45 * 86_400_000) } });

    const stale = await request(app).get('/api/properties?verification=stale').set(auth);
    expect(stale.body.data.map((p: { _id: string }) => p._id)).toEqual([old._id]);
    expect((await request(app).get('/api/dashboard').set(auth)).body.data.properties.needsVerification).toBe(1);

    const v = await request(app).post(`/api/properties/${old._id}/verify`).set(auth).send({ note: 'Owner confirmed on call' });
    expect(v.status).toBe(200);
    expect(new Date(v.body.data.lastVerifiedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(v.body.data.lastVerifiedBy).toBe(s.userId);
    expect((await request(app).get('/api/properties?verification=stale').set(auth)).body.data).toHaveLength(0);

    const acts = await request(app).get(`/api/activities?entityId=${old._id}`).set(auth);
    expect(acts.body.data[0]).toMatchObject({ type: 'PROPERTY_VERIFIED', summary: 'RE-000002 availability confirmed (Owner confirmed on call)' });
  });

  it('requires the property update permission', async () => {
    const owner = await registerOwner(app);
    const p = await createProperty(app, owner);
    const viewer = await addActiveMember(app, owner, { permissions: ['properties:read'] });
    expect((await request(app).post(`/api/properties/${p._id}/verify`).set(bearer(viewer.accessToken)).send({})).status).toBe(403);
  });
});

describe('follow-up rescheduling', () => {
  it('moves an overdue follow-up back to pending and records it on the timeline', async () => {
    const s = await registerOwner(app);
    const auth = bearer(s.accessToken);
    const c = await createClient(app, s);
    const f = await request(app).post('/api/followups').set(auth).send({ clientId: c._id, type: 'CALL', dueAt: inMinutes(-60) });
    expect(f.status).toBe(201);

    const moved = await request(app).patch(`/api/followups/${f.body.data._id}`).set(auth).send({ dueAt: inMinutes(24 * 60) });
    expect(moved.status).toBe(200);
    expect(moved.body.data.status).toBe('PENDING');
    expect(new Date(moved.body.data.reminderAt).getTime()).toBe(new Date(moved.body.data.dueAt).getTime() - 30 * 60_000);

    const acts = await request(app).get(`/api/activities?entityId=${c._id}`).set(auth);
    expect(acts.body.data[0]).toMatchObject({ type: 'FOLLOWUP_RESCHEDULED', summary: 'Follow-up rescheduled: Call Muhammad Ali' });
  });
});

describe('sales analytics', () => {
  it('reports lead sources with outcomes and per-member follow-up performance', async () => {
    const owner = await registerOwner(app);
    const son = await addActiveMember(app, owner);
    const auth = bearer(owner.accessToken);
    const won = await createClient(app, owner, { mobileNumber: '03001000001', source: 'WHATSAPP', assignedTo: son.userId });
    await createClient(app, owner, { mobileNumber: '03001000002', source: 'WHATSAPP' });
    await createClient(app, owner, { mobileNumber: '03001000003', source: 'REFERRAL' });
    await request(app).patch(`/api/clients/${won._id}`).set(auth).send({ status: 'CLOSED_WON' }).expect(200);

    const f = await request(app).post('/api/followups').set(auth).send({ clientId: won._id, type: 'CALL', dueAt: inMinutes(30), assignedTo: son.userId });
    await request(app).post(`/api/followups/${f.body.data._id}/complete`).set(bearer(son.accessToken)).send({ outcome: 'Token paid' }).expect(200);
    await request(app).post('/api/followups').set(auth).send({ clientId: won._id, type: 'MEETING', dueAt: inMinutes(-30), assignedTo: son.userId }).expect(201);

    const res = await request(app).get('/api/dashboard/analytics?range=30d').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.leadSources[0]).toEqual({ source: 'WHATSAPP', total: 2, won: 1, lost: 0, active: 1 });
    expect(res.body.data.leadSources[1]).toMatchObject({ source: 'REFERRAL', total: 1 });
    const sonRow = res.body.data.teamPerformance.find((r: { userId: string }) => r.userId === son.userId);
    expect(sonRow).toMatchObject({ name: 'Ahmed Yousuf', followUpsCompleted: 1, followUpsOverdue: 1 });
  });
});

describe('activity timeline permissions', () => {
  it('hides entries about record types the member may not read', async () => {
    const owner = await registerOwner(app);
    await createClient(app, owner, { fullName: 'Secret Buyer' });
    await createProperty(app, owner);
    const propsOnly = await addActiveMember(app, owner, { permissions: ['properties:read'] });

    const all = await request(app).get('/api/activities').set(bearer(owner.accessToken));
    expect(all.body.data.map((a: { summary: string }) => a.summary).join(' ')).toContain('Secret Buyer');

    const limited = await request(app).get('/api/activities').set(bearer(propsOnly.accessToken));
    expect(limited.status).toBe(200);
    const text = limited.body.data.map((a: { summary: string }) => a.summary).join(' ');
    expect(text).toContain('RE-000001');
    expect(text).not.toContain('Secret Buyer');
  });
});
