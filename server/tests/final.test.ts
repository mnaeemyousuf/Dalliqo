import request from 'supertest';
import { defaultCommissionRates, DEFAULT_COMMISSION_SETTINGS } from '@recrm/shared';
import { createApp } from '../src/app';
import { Activity } from '../src/models/Activity';
import { AuditLog } from '../src/models/AuditLog';
import { retentionService } from '../src/services/retentionService';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();

describe('API access keys', () => {
  it('creates a key shown once, limits it to its permissions and record endpoints, and revokes it', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    await createClient(app, owner, { fullName: 'Key Test Client' });

    // Only settings managers can create keys; a key cannot carry admin permissions.
    const agent = await addActiveMember(app, owner, { permissions: ['clients:read'] });
    await request(app).get('/api/api-keys').set(bearer(agent.accessToken)).expect(403);
    await request(app).post('/api/api-keys').set(auth).send({ name: 'Bad', permissions: ['members:manage'] }).expect(400);

    const made = (await request(app).post('/api/api-keys').set(auth).send({ name: 'Website sync', permissions: ['clients:read', 'clients:create'] }).expect(201)).body.data;
    expect(made.secret).toMatch(/^dq_live_[0-9a-f]{48}$/);
    const key = bearer(made.secret);

    // The list never returns the secret or its hash.
    const list = (await request(app).get('/api/api-keys').set(auth).expect(200)).body.data;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(made.secret);
    expect(list[0].hash).toBeUndefined();
    expect(list[0].prefix).toBe(made.secret.slice(0, 14));

    // Works for what it was given…
    const clients = (await request(app).get('/api/clients').set(key).expect(200)).body.data;
    expect(clients.some((c: { fullName: string }) => c.fullName === 'Key Test Client')).toBe(true);
    await request(app).post('/api/clients').set(key).send({ fullName: 'From API', mobileNumber: '03451230000', purchaseOrRental: 'PURCHASE' }).expect(201);
    // …and nothing else: other permissions, admin areas, and its own management are closed.
    await request(app).get('/api/properties').set(key).expect(403);
    await request(app).get('/api/members').set(key).expect(403);
    await request(app).get('/api/settings').set(key).expect(403);
    await request(app).get('/api/api-keys').set(key).expect(403);
    await request(app).get('/api/clients').set(bearer('dq_live_' + '0'.repeat(48))).expect(401);

    // Not on plans without API access.
    const { Business } = await import('../src/models/Business');
    const { subscriptionService } = await import('../src/services/subscriptionService');
    await Business.updateOne({ _id: owner.businessId }, { $set: { 'subscription.plan': 'BUSINESS', 'subscription.status': 'ACTIVE' } });
    subscriptionService.forget(owner.businessId);
    expect((await request(app).get('/api/clients').set(key)).body.code).toBe('MODULE_NOT_IN_PLAN');
    await Business.updateOne({ _id: owner.businessId }, { $set: { 'subscription.plan': 'ENTERPRISE' } });
    subscriptionService.forget(owner.businessId);

    await request(app).delete(`/api/api-keys/${made._id}`).set(auth).expect(200);
    await request(app).get('/api/clients').set(key).expect(401);
    expect(await AuditLog.countDocuments({ businessId: owner.businessId, action: { $in: ['api_key.created', 'api_key.revoked'] } })).toBe(2);
  });
});

describe('bulk actions', () => {
  it('assigns, re-statuses and deletes many records with the usual permission checks', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const agent = await addActiveMember(app, owner, { permissions: ['clients:read', 'clients:update', 'properties:read'] });
    const a = await createClient(app, owner, { fullName: 'Bulk One', mobileNumber: '03001110001' });
    const b = await createClient(app, owner, { fullName: 'Bulk Two', mobileNumber: '03001110002' });
    const ghost = '64b000000000000000000000';

    const r = (await request(app).post('/api/clients/bulk').set(auth).send({ ids: [a._id, b._id, ghost], action: 'ASSIGN', assignedTo: agent.userId }).expect(200)).body.data;
    expect(r.done).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe(ghost);
    const got = (await request(app).get(`/api/clients/${a._id}`).set(auth).expect(200)).body.data;
    expect(String(got.assignedTo?._id ?? got.assignedTo)).toBe(agent.userId);

    await request(app).post('/api/clients/bulk').set(auth).send({ ids: [a._id, b._id], action: 'STATUS', status: 'ON_HOLD' }).expect(200);
    expect((await request(app).get(`/api/clients/${b._id}`).set(auth)).body.data.status).toBe('ON_HOLD');

    // The agent may update but not delete; an unknown action is rejected.
    await request(app).post('/api/clients/bulk').set(bearer(agent.accessToken)).send({ ids: [a._id], action: 'DELETE' }).expect(403);
    await request(app).post('/api/clients/bulk').set(auth).send({ ids: [a._id], action: 'ARCHIVE' }).expect(400);
    await request(app).post('/api/clients/bulk').set(auth).send({ ids: [a._id, b._id], action: 'DELETE' }).expect(200);
    await request(app).get(`/api/clients/${a._id}`).set(auth).expect(404);

    const p1 = await createProperty(app, owner, {});
    const p2 = await createProperty(app, owner, {});
    await request(app).post('/api/properties/bulk').set(bearer(agent.accessToken)).send({ ids: [p1._id], action: 'STATUS', status: 'ON_HOLD' }).expect(403);
    const pr = (await request(app).post('/api/properties/bulk').set(auth).send({ ids: [p1._id, p2._id], action: 'STATUS', status: 'ON_HOLD', reason: 'Owner travelling' }).expect(200)).body.data;
    expect(pr.done).toBe(2);
    expect((await request(app).get(`/api/properties/${p2._id}`).set(auth)).body.data.status).toBe('ON_HOLD');
    await request(app).post('/api/properties/bulk').set(auth).send({ ids: [p1._id, p2._id], action: 'ASSIGN', agentIds: [agent.userId] }).expect(200);
    const assigned = (await request(app).get(`/api/properties/${p1._id}`).set(auth)).body.data.agentIds.map((x: { _id?: string } | string) => String((x as { _id?: string })._id ?? x));
    expect(assigned).toEqual([agent.userId]);
  });
});

describe('custom commission rules', () => {
  it('picks the first fitting rule, else the defaults', () => {
    const c = { ...DEFAULT_COMMISSION_SETTINGS, rules: [{ listingPurpose: 'RENT' as const, buyerPct: 0, sellerPct: 8 }, { propertyType: 'RESIDENTIAL_PLOT', buyerPct: 2, sellerPct: 2 }] };
    expect(defaultCommissionRates(c, { listingPurpose: 'RENT', propertyType: 'RESIDENTIAL_PLOT' })).toEqual({ buyerPct: 0, sellerPct: 8 });
    expect(defaultCommissionRates(c, { listingPurpose: 'SALE', propertyType: 'RESIDENTIAL_PLOT' })).toEqual({ buyerPct: 2, sellerPct: 2 });
    expect(defaultCommissionRates(c, { listingPurpose: 'SALE', propertyType: 'HOUSE' })).toEqual({ buyerPct: 1, sellerPct: 1 });
    expect(defaultCommissionRates(c, null)).toEqual({ buyerPct: 1, sellerPct: 1 });
  });

  it('applies a rule to new deals on matching listings', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    await request(app).patch('/api/settings').set(auth).send({ commission: { rules: [{ buyerPct: 3, sellerPct: 3 }] } }).expect(400); // needs a condition
    const property = await createProperty(app, owner, {});
    const s = (await request(app).patch('/api/settings').set(auth).send({ commission: { rules: [{ propertyType: property.propertyType, buyerPct: 2.5, sellerPct: 1.5 }] } }).expect(200)).body.data;
    expect(s.commission.rules).toHaveLength(1);
    const client = await createClient(app, owner);
    const withProp = (await request(app).post('/api/deals').set(auth).send({ clientId: client._id, propertyId: property._id }).expect(201)).body.data;
    expect(withProp.commission.buyer).toMatchObject({ mode: 'PERCENT', value: 2.5 });
    expect(withProp.commission.seller).toMatchObject({ mode: 'PERCENT', value: 1.5 });
    const noProp = (await request(app).post('/api/deals').set(auth).send({ clientId: client._id }).expect(201)).body.data;
    expect(noProp.commission.buyer.value).toBe(1);
    // An explicit commission on the deal still wins.
    const explicit = (await request(app).post('/api/deals').set(auth).send({ clientId: client._id, propertyId: property._id, commission: { buyer: { mode: 'FIXED', value: 50_000 } } }).expect(201)).body.data;
    expect(explicit.commission.buyer).toMatchObject({ mode: 'FIXED', value: 50_000 });
  });
});

describe('data retention', () => {
  it('keeps everything by default, enforces minimum periods and purges only old log entries of that business', async () => {
    const owner = await registerOwner(app);
    const other = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    await createClient(app, owner);
    await createClient(app, other);
    const old = new Date(Date.now() - 400 * 86_400_000);
    // Age every existing log entry of both businesses by 400 days.
    await AuditLog.collection.updateMany({}, { $set: { createdAt: old } });
    await Activity.collection.updateMany({}, { $set: { createdAt: old } });
    const before = { audit: await AuditLog.countDocuments({ businessId: owner.businessId }), activity: await Activity.countDocuments({ businessId: owner.businessId }) };
    expect(before.audit).toBeGreaterThan(0);
    expect(before.activity).toBeGreaterThan(0);

    expect(await retentionService.purgeAll()).toBe(0); // default: keep forever
    await request(app).patch('/api/settings').set(auth).send({ retention: { auditLogMonths: 3 } }).expect(400);
    const s = (await request(app).patch('/api/settings').set(auth).send({ retention: { auditLogMonths: 12, activityMonths: 6 } }).expect(200)).body.data;
    expect(s.retention).toEqual({ auditLogMonths: 12, activityMonths: 6 });

    expect(await retentionService.purgeAll()).toBe(before.audit + before.activity);
    // The settings change itself (recent) stays; the other business is untouched.
    expect(await AuditLog.countDocuments({ businessId: owner.businessId, action: 'settings.updated' })).toBe(1);
    expect(await AuditLog.countDocuments({ businessId: other.businessId })).toBeGreaterThan(0);
    expect(await Activity.countDocuments({ businessId: other.businessId })).toBeGreaterThan(0);
    // Records are never removed.
    expect((await request(app).get('/api/clients').set(auth).expect(200)).body.data).toHaveLength(1);
  });
});
