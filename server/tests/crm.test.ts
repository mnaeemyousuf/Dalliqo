import request from 'supertest';
import { PERMISSIONS } from '@recrm/shared';
import { createApp } from '../src/app';
import { AuditLog } from '../src/models/AuditLog';
import { Notification } from '../src/models/Notification';
import { categoryId, createClient, createOwner, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();

describe('client categories', () => {
  it('seeds the nine built-in categories (with Urdu names) for every new business', async () => {
    const owner = await registerOwner(app);
    const res = await request(app).get('/api/client-categories').set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { key: string }) => c.key)).toEqual([
      'PLOT_BUYER', 'HOUSE_BUYER', 'FLAT_BUYER', 'PORTION_BUYER', 'RENTAL_CLIENT', 'COMMERCIAL_CLIENT', 'PROPERTY_SELLER', 'PROPERTY_OWNER', 'INVESTOR',
    ]);
    expect(res.body.data[0].nameUr).toBe('پلاٹ خریدار');
  });

  it('supports custom categories, rejects duplicates, and protects built-ins', async () => {
    const owner = await registerOwner(app);
    const created = await request(app).post('/api/client-categories').set(bearer(owner.accessToken)).send({ name: 'Overseas Pakistani' });
    expect(created.status).toBe(201);
    expect(created.body.data.isSystem).toBe(false);
    expect((await request(app).post('/api/client-categories').set(bearer(owner.accessToken)).send({ name: 'overseas pakistani' })).status).toBe(409);

    const builtIn = await categoryId(app, owner, 'INVESTOR');
    expect((await request(app).patch(`/api/client-categories/${builtIn}`).set(bearer(owner.accessToken)).send({ archived: true })).status).toBe(403);
    const archived = await request(app).patch(`/api/client-categories/${created.body.data._id}`).set(bearer(owner.accessToken)).send({ archived: true });
    expect(archived.status).toBe(200);
    const list = await request(app).get('/api/client-categories').set(bearer(owner.accessToken));
    expect(list.body.data.some((c: { name: string }) => c.name === 'Overseas Pakistani')).toBe(false);
  });
});

describe('clients', () => {
  it('creates a client from the flat spec fields as a primary requirement', async () => {
    const owner = await registerOwner(app);
    const cat = await categoryId(app, owner, 'PLOT_BUYER');
    const c = await createClient(app, owner, { categoryId: cat, whatsappNumber: '0300 1112233', email: 'ali@example.com' });
    expect(c.mobileNumber).toBe('+923001112233');
    expect(c.requirements).toHaveLength(1);
    expect(c.requirements[0]).toMatchObject({ isPrimary: true, purpose: 'PURCHASE', societies: ['Gulshan-e-Iqbal'], minSizeSqft: 900, maxSizeSqft: 1197 });
    expect(c.preferredSociety).toBe('Gulshan-e-Iqbal');
    expect(c.version).toBe(1);
    expect(c.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('validates budgets, phone numbers and unknown categories', async () => {
    const owner = await registerOwner(app);
    const bad = await request(app).post('/api/clients').set(bearer(owner.accessToken)).send({ fullName: 'X Y', mobileNumber: '12' });
    expect(bad.status).toBe(400);
    const budget = await request(app)
      .post('/api/clients')
      .set(bearer(owner.accessToken))
      .send({ fullName: 'Bad Budget', mobileNumber: '03001234567', minBudget: 20_000_000, maxBudget: 10_000_000 });
    expect(budget.status).toBe(400);
    const cat = await request(app)
      .post('/api/clients')
      .set(bearer(owner.accessToken))
      .send({ fullName: 'Bad Cat', mobileNumber: '03001234567', categoryId: '64b000000000000000000000' });
    expect(cat.status).toBe(400);
    expect(cat.body.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('searches by name and mobile, filters, sorts and paginates', async () => {
    const owner = await registerOwner(app);
    await createClient(app, owner, { fullName: 'Muhammad Ali', mobileNumber: '03001112233' });
    await createClient(app, owner, { fullName: 'Sana Khan', mobileNumber: '03334445566', purchaseOrRental: 'RENTAL', propertyTypeRequired: ['FLAT'], minBudget: 50_000, maxBudget: 80_000 });
    await createClient(app, owner, { fullName: 'Ali Raza', mobileNumber: '03451239876', priority: 'HIGH' });
    const auth = bearer(owner.accessToken);

    const byName = await request(app).get('/api/clients?q=ali').set(auth);
    expect(byName.body.data.map((c: { fullName: string }) => c.fullName).sort()).toEqual(['Ali Raza', 'Muhammad Ali']);
    const byPhone = await request(app).get('/api/clients?q=0333-444').set(auth);
    expect(byPhone.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['Sana Khan']);
    const rental = await request(app).get('/api/clients?purpose=RENTAL').set(auth);
    expect(rental.body.data).toHaveLength(1);
    const budget = await request(app).get('/api/clients?minBudget=10000000&maxBudget=20000000').set(auth);
    expect(budget.body.data).toHaveLength(2);
    const page = await request(app).get('/api/clients?sort=fullName&limit=2&page=2').set(auth);
    expect(page.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['Sana Khan']);
    expect(page.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    const injection = await request(app).get('/api/clients?status[$ne]=ACTIVE').set(auth);
    expect(injection.status).toBe(400);
  });

  it('updates with optimistic concurrency and records audit + activity', async () => {
    const owner = await registerOwner(app);
    const c = await createClient(app, owner);
    const auth = bearer(owner.accessToken);
    const ok = await request(app).patch(`/api/clients/${c._id}`).set(auth).send({ priority: 'URGENT', baseVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.version).toBe(2);
    const stale = await request(app).patch(`/api/clients/${c._id}`).set(auth).send({ priority: 'LOW', baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    expect(stale.body.details.serverVersion).toBe(2);

    const audit = await AuditLog.findOne({ businessId: owner.businessId, action: 'client.updated' }).lean();
    expect(audit!.changes[0]).toMatchObject({ field: 'priority', oldValue: 'MEDIUM', newValue: 'URGENT' });
    const acts = await request(app).get(`/api/activities?entityId=${c._id}`).set(auth);
    expect(acts.body.data.map((a: { type: string }) => a.type)).toEqual(['CLIENT_UPDATED', 'CLIENT_CREATED']);
  });

  it('logs one-tap communication on the timeline', async () => {
    const owner = await registerOwner(app);
    const c = await createClient(app, owner);
    const res = await request(app).post(`/api/clients/${c._id}/communications`).set(bearer(owner.accessToken)).send({ channel: 'WHATSAPP' });
    expect(res.status).toBe(200);
    expect(res.body.data.lastContactedAt).toBeTruthy();
    const acts = await request(app).get(`/api/activities?entityId=${c._id}`).set(bearer(owner.accessToken));
    expect(acts.body.data[0]).toMatchObject({ type: 'CLIENT_CONTACTED', summary: 'WhatsApp message to Muhammad Ali' });
  });

  it('soft-deletes clients and hides them', async () => {
    const owner = await registerOwner(app);
    const c = await createClient(app, owner);
    await request(app).delete(`/api/clients/${c._id}`).set(bearer(owner.accessToken)).expect(200);
    expect((await request(app).get(`/api/clients/${c._id}`).set(bearer(owner.accessToken))).status).toBe(404);
    expect((await request(app).get('/api/clients').set(bearer(owner.accessToken))).body.meta.total).toBe(0);
  });

  it('the default MEMBER role cannot delete clients', async () => {
    const owner = await registerOwner(app);
    const son = await addActiveMember(app, owner);
    const c = await createClient(app, son);
    expect((await request(app).delete(`/api/clients/${c._id}`).set(bearer(son.accessToken))).status).toBe(403);
  });
});

describe('owners and properties', () => {
  it('generates sequential property IDs per business', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const p1 = await createProperty(app, a);
    const p2 = await createProperty(app, a);
    const q1 = await createProperty(app, b);
    expect([p1.propertyId, p2.propertyId, q1.propertyId]).toEqual(['RE-000001', 'RE-000002', 'RE-000001']);
    expect(p1.sizeSqft).toBe(1080);
  });

  it('links owners, keeps their property count, and blocks deleting an owner with properties', async () => {
    const s = await registerOwner(app);
    const owner = await createOwner(app, s);
    const p = await createProperty(app, s, { ownerId: owner._id, latitude: 24.9204, longitude: 67.0932 });
    expect(p.googleMapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=24.9204,67.0932');
    const detail = await request(app).get(`/api/owners/${owner._id}`).set(bearer(s.accessToken));
    expect(detail.body.data.propertyCount).toBe(1);
    expect(detail.body.data.properties[0].propertyId).toBe('RE-000001');
    const del = await request(app).delete(`/api/owners/${owner._id}`).set(bearer(s.accessToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('OWNER_HAS_PROPERTIES');
  });

  it('filters properties by type, status, price, size and location radius', async () => {
    const s = await registerOwner(app);
    await createProperty(app, s, { latitude: 24.92, longitude: 67.09 });
    await createProperty(app, s, { propertyType: 'HOUSE', society: 'DHA Karachi', block: 'Phase 6', size: 500, askingPrice: 120_000_000, latitude: 24.80, longitude: 67.06 });
    await createProperty(app, s, { propertyType: 'FLAT', listingPurpose: 'RENT', society: 'Clifton', size: 1500, sizeUnit: 'SQ_FT', askingPrice: 150_000 });
    const auth = bearer(s.accessToken);
    const count = async (qs: string) => (await request(app).get(`/api/properties?${qs}`).set(auth)).body.meta.total;
    expect(await count('propertyType=HOUSE')).toBe(1);
    expect(await count('listingPurpose=RENT')).toBe(1);
    expect(await count('minPrice=10000000&maxPrice=20000000')).toBe(1);
    expect(await count('minSize=150&sizeUnit=SQ_YARD')).toBe(2);
    expect(await count('society=dha')).toBe(1);
    expect(await count('q=RE-2')).toBe(1);
    expect(await count('lat=24.92&lng=67.09&radiusKm=3')).toBe(1);
  });

  it('enforces status transitions and records "Available → Reserved" activity', async () => {
    const s = await registerOwner(app);
    const son = await addActiveMember(app, s);
    const p = await createProperty(app, s);
    const auth = bearer(s.accessToken);
    const res = await request(app).post(`/api/properties/${p._id}/status`).set(auth).send({ status: 'RESERVED', reason: 'Token received' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RESERVED');
    const acts = await request(app).get(`/api/activities?entityId=${p._id}`).set(auth);
    expect(acts.body.data[0].summary).toBe('RE-000001 Available → Reserved (Token received)');
    expect(acts.body.data[0].actorUserId.fullName).toBe('Muhammad Yousuf');

    await request(app).post(`/api/properties/${p._id}/status`).set(auth).send({ status: 'SOLD' }).expect(200);
    const bad = await request(app).post(`/api/properties/${p._id}/status`).set(auth).send({ status: 'RESERVED' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_STATUS_TRANSITION');
    // The son is told about important property changes.
    expect(await Notification.countDocuments({ businessId: s.businessId, userId: son.userId, category: 'PROPERTY' })).toBe(2);
  });

  it('records price changes in the audit log with old and new values', async () => {
    const s = await registerOwner(app);
    const p = await createProperty(app, s, { askingPrice: 16_000_000 });
    await request(app).patch(`/api/properties/${p._id}`).set(bearer(s.accessToken)).send({ askingPrice: 15_500_000 }).expect(200);
    const audit = await AuditLog.findOne({ businessId: s.businessId, action: 'property.updated' }).lean();
    expect(audit).toMatchObject({ entityLabel: 'RE-000001', changes: [{ field: 'askingPrice', oldValue: 16_000_000, newValue: 15_500_000 }] });
    const acts = await request(app).get(`/api/activities?entityId=${p._id}`).set(bearer(s.accessToken));
    expect(acts.body.data[0]).toMatchObject({ type: 'PRICE_CHANGED', summary: 'RE-000001 asking price PKR 1.6 Crore → PKR 1.55 Crore' });
  });
});

describe('automatic two-way matching', () => {
  it('a new property finds matching clients, and a new client finds matching properties', async () => {
    const s = await registerOwner(app);
    const ali = await createClient(app, s);
    await createClient(app, s, { fullName: 'Renter Person', mobileNumber: '03007778899', purchaseOrRental: 'RENTAL', propertyTypeRequired: ['FLAT'] });
    const p = await createProperty(app, s);
    expect(p.matchCount).toBe(1);

    const matches = await request(app).get(`/api/properties/${p._id}/matches`).set(bearer(s.accessToken));
    expect(matches.body.data).toHaveLength(1);
    expect(matches.body.data[0]).toMatchObject({ matchScore: 100, band: 'EXCELLENT', status: 'NEW', notified: true });
    expect(matches.body.data[0].clientId.fullName).toBe('Muhammad Ali');

    const later = await createClient(app, s, { fullName: 'Late Buyer', mobileNumber: '03119998877', preferredSociety: 'Gulshan', maxBudget: 17_000_000 });
    expect(later.matchCount).toBe(1);
    const clientMatches = await request(app).get(`/api/clients/${ali._id}/matches`).set(bearer(s.accessToken));
    expect(clientMatches.body.data[0].propertyId.propertyId).toBe('RE-000001');

    // High-quality matches notify the business.
    const n = await Notification.findOne({ businessId: s.businessId, category: 'MATCH' }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(n!.title).toBe('New 100% match');
    expect(n!.body).toBe('120 Sq. Yard Plot in Gulshan-e-Iqbal (PKR 1.55 Crore) matches Muhammad Ali');
  });

  it('re-scores when the price changes', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    const p = await createProperty(app, s);
    const auth = bearer(s.accessToken);
    await request(app).patch(`/api/properties/${p._id}`).set(auth).send({ askingPrice: 17_000_000 }).expect(200);
    let m = await request(app).get(`/api/clients/${c._id}/matches`).set(auth);
    expect(m.body.data[0].matchScore).toBe(86); // budget 6.25% over -> 45% of 25

    await request(app).patch(`/api/properties/${p._id}`).set(auth).send({ askingPrice: 30_000_000 }).expect(200);
    m = await request(app).get(`/api/clients/${c._id}/matches`).set(auth);
    expect(m.body.data[0].matchScore).toBe(75); // budget criterion now 0; still above the 60 store threshold
  });

  it('marks matches stale when the property is sold, and reopens them when available again', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    const p = await createProperty(app, s);
    const auth = bearer(s.accessToken);
    await request(app).post(`/api/properties/${p._id}/status`).set(auth).send({ status: 'SOLD' }).expect(200);
    expect((await request(app).get(`/api/clients/${c._id}/matches`).set(auth)).body.data).toHaveLength(0);
    expect((await request(app).get(`/api/clients/${c._id}/matches?includeStale=true`).set(auth)).body.data[0].status).toBe('STALE');
    expect((await request(app).get(`/api/clients/${c._id}`).set(auth)).body.data.matchCount).toBe(0);
    await request(app).post(`/api/properties/${p._id}/status`).set(auth).send({ status: 'AVAILABLE' }).expect(200);
    expect((await request(app).get(`/api/clients/${c._id}/matches`).set(auth)).body.data[0].status).toBe('NEW');
  });

  it('match settings must add up to 100 and trigger a recalculation', async () => {
    const s = await registerOwner(app);
    await createClient(app, s, { preferredSociety: 'Clifton' }); // location 0 → 75
    const p = await createProperty(app, s);
    const auth = bearer(s.accessToken);
    expect((await request(app).get(`/api/properties/${p._id}/matches`).set(auth)).body.data[0].matchScore).toBe(75);
    expect((await request(app).patch('/api/settings').set(auth).send({ matching: { weights: { type: 50 } } })).status).toBe(400);
    await request(app).patch('/api/settings').set(auth).send({ matching: { storeThreshold: 80, notifyThreshold: 90 } }).expect(200);
    expect((await request(app).get(`/api/properties/${p._id}/matches`).set(auth)).body.data).toHaveLength(0);
  });

  it('never matches across businesses', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    await createClient(app, a);
    const p = await createProperty(app, b);
    expect(p.matchCount).toBe(0);
  });
});

describe('notes', () => {
  it('adds notes to a client timeline; only the author (or notes:manage_all) can edit', async () => {
    const owner = await registerOwner(app);
    const son = await addActiveMember(app, owner);
    const c = await createClient(app, owner);
    const note = await request(app).post('/api/notes').set(bearer(son.accessToken)).send({ entityType: 'client', entityId: c._id, content: 'Prefers corner plots' });
    expect(note.status).toBe(201);
    const list = await request(app).get(`/api/notes?entityType=client&entityId=${c._id}`).set(bearer(owner.accessToken));
    expect(list.body.data[0]).toMatchObject({ content: 'Prefers corner plots' });
    expect(list.body.data[0].createdBy.fullName).toBe('Ahmed Yousuf');

    const ownNote = await request(app).post('/api/notes').set(bearer(owner.accessToken)).send({ entityType: 'client', entityId: c._id, content: 'Father note' });
    expect((await request(app).patch(`/api/notes/${ownNote.body.data._id}`).set(bearer(son.accessToken)).send({ content: 'hacked' })).status).toBe(403);
    // Owners hold notes:manage_all.
    expect((await request(app).patch(`/api/notes/${note.body.data._id}`).set(bearer(owner.accessToken)).send({ content: 'Edited' })).status).toBe(200);
    expect(PERMISSIONS.NOTES_MANAGE_ALL).toBe('notes:manage_all');
  });

  it('rejects notes on records from another business', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const c = await createClient(app, b);
    const res = await request(app).post('/api/notes').set(bearer(a.accessToken)).send({ entityType: 'client', entityId: c._id, content: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENTITY_NOT_FOUND');
  });
});

describe('tenant isolation for CRM records', () => {
  it('business A cannot read, change or delete business B clients and properties', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const c = await createClient(app, b);
    const p = await createProperty(app, b);
    const asA = bearer(a.accessToken);
    expect((await request(app).get(`/api/clients/${c._id}`).set(asA)).status).toBe(404);
    expect((await request(app).patch(`/api/clients/${c._id}`).set(asA).send({ priority: 'LOW' })).status).toBe(404);
    expect((await request(app).delete(`/api/properties/${p._id}`).set(asA)).status).toBe(404);
    expect((await request(app).post(`/api/properties/${p._id}/status`).set(asA).send({ status: 'SOLD' })).status).toBe(404);
    expect((await request(app).get('/api/properties').set(asA)).body.meta.total).toBe(0);
  });
});
