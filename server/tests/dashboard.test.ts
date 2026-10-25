import ExcelJS from 'exceljs';
import request from 'supertest';
import { createApp } from '../src/app';
import { dayRange, tzOffsetMinutes } from '../src/utils/time';
import { categoryId, createClient, createOwner, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();

/** Collects a binary response body. */
const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

describe('time zone helpers', () => {
  it('computes Karachi day boundaries in UTC', () => {
    expect(tzOffsetMinutes('Asia/Karachi', new Date('2026-10-11T12:00:00Z'))).toBe(300);
    const { start, end } = dayRange('Asia/Karachi', new Date('2026-10-11T20:30:00Z')); // 01:30 on the 12th in Karachi
    expect(start.toISOString()).toBe('2026-10-11T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-12T19:00:00.000Z');
  });
});

describe('dashboard', () => {
  it('computes every metric from real records', async () => {
    const s = await registerOwner(app);
    const owner = await createOwner(app, s);
    await createClient(app, s, { categoryId: await categoryId(app, s, 'PLOT_BUYER') });
    await createClient(app, s, { fullName: 'Tenant One', mobileNumber: '03002223344', purchaseOrRental: 'RENTAL', propertyTypeRequired: ['FLAT'], categoryId: await categoryId(app, s, 'RENTAL_CLIENT') });
    const p1 = await createProperty(app, s, { ownerId: owner._id });
    await createProperty(app, s, { propertyType: 'HOUSE', society: 'DHA Karachi', size: 500, askingPrice: 90_000_000 });
    const p3 = await createProperty(app, s, { propertyType: 'FLAT', listingPurpose: 'RENT', size: 1200, sizeUnit: 'SQ_FT', askingPrice: 60_000 });
    const auth = bearer(s.accessToken);
    await request(app).post(`/api/properties/${p1._id}/status`).set(auth).send({ status: 'SOLD' }).expect(200);
    await request(app).post(`/api/properties/${p3._id}/status`).set(auth).send({ status: 'RENTED' }).expect(200);

    const res = await request(app).get('/api/dashboard').set(auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.properties).toMatchObject({ total: 3, available: 1, sold: 1, rented: 1 });
    expect(d.clients).toMatchObject({ total: 2, buyers: 1, rental: 1, owners: 1 });
    expect(d.clients.byCategory.map((c: { name: string }) => c.name).sort()).toEqual(['Plot Buyer', 'Rental Client']);
    expect(d.today).toMatchObject({ newClients: 2, newProperties: 3 });
    expect(d.today.newMatches).toBeGreaterThanOrEqual(1);
  });

  it('serves analytics series with a point for every day', async () => {
    const s = await registerOwner(app);
    await createClient(app, s);
    await createProperty(app, s);
    const res = await request(app).get('/api/dashboard/analytics?range=7d').set(bearer(s.accessToken));
    expect(res.status).toBe(200);
    const a = res.body.data;
    expect(a.newRecords).toHaveLength(7);
    expect(a.newRecords[6]).toMatchObject({ clients: 1, properties: 1 });
    expect(a.propertyDistribution).toEqual([{ type: 'RESIDENTIAL_PLOT', count: 1 }]);
    expect(a.matchQuality.find((b: { band: string }) => b.band === 'EXCELLENT').count).toBe(1);
    expect((await request(app).get('/api/dashboard/analytics?range=12m').set(bearer(s.accessToken))).body.data.newRecords).toHaveLength(12);
  });
});

describe('global search', () => {
  it('finds clients, properties, owners and their matches in one call', async () => {
    const s = await registerOwner(app);
    await createClient(app, s, { fullName: 'Gulzar Ahmed' });
    await createProperty(app, s);
    await createOwner(app, s, { fullName: 'Gul Muhammad' });
    const res = await request(app).get('/api/search?q=gul').set(bearer(s.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.clients[0].fullName).toBe('Gulzar Ahmed');
    expect(res.body.data.properties[0].propertyId).toBe('RE-000001');
    expect(res.body.data.owners[0].fullName).toBe('Gul Muhammad');
    expect(res.body.data.matches[0].matchScore).toBe(100);
    const onlyOwners = await request(app).get('/api/search?q=gul&types=owners').set(bearer(s.accessToken));
    expect(onlyOwners.body.data.clients).toHaveLength(0);
  });
});

describe('exports', () => {
  it('exports filtered clients to a real Excel workbook', async () => {
    const s = await registerOwner(app);
    await createClient(app, s);
    await createClient(app, s, { fullName: 'Sana Khan', mobileNumber: '03334445566', purchaseOrRental: 'RENTAL' });
    const res = await binary(request(app).get('/api/exports/clients?format=xlsx&purpose=PURCHASE').set(bearer(s.accessToken)));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="clients-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Clients')!;
    expect(ws.getCell('A1').value).toBe('Yousuf Estate & Builders — Clients');
    expect(ws.getRow(4).getCell(1).value).toBe('Name');
    expect(ws.getRow(5).getCell(1).value).toBe('Muhammad Ali');
    expect(ws.getRow(5).getCell(2).value).toBe('+923001112233');
    expect(ws.getRow(6).getCell(1).value).toBeNull();
  });

  it('exports properties to PDF', async () => {
    const s = await registerOwner(app);
    for (let i = 0; i < 40; i++) await createProperty(app, s, { askingPrice: 10_000_000 + i * 100_000 });
    const res = await binary(request(app).get('/api/exports/properties?format=pdf').set(bearer(s.accessToken)));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    // 40 rows fit on two landscape pages; the branded footer must not spill onto extra blank pages.
    const pages = (res.body.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pages).toBeLessThanOrEqual(3);
    expect(res.body.toString('latin1')).toContain('Dalliqo');
  }, 120_000);

  it('embeds an Urdu font for Urdu text in PDF exports', async () => {
    const s = await registerOwner(app);
    await createClient(app, s, { fullName: 'محمد علی خان' });
    await createClient(app, s, { fullName: 'Ali Raza', mobileNumber: '+923009998877', whatsappNumber: '+923009998877' });
    const res = await binary(request(app).get('/api/exports/clients?format=pdf').set(bearer(s.accessToken)));
    expect(res.status).toBe(200);
    const pdf = res.body.toString('latin1');
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoNaskhArabic/);
    expect(pdf).toContain('/BaseFont /Helvetica');
  }, 120_000);

  it('validates export filters and requires the export permission', async () => {
    const s = await registerOwner(app);
    const son = await addActiveMember(app, s, { permissions: ['clients:read'] });
    expect((await request(app).get('/api/exports/clients?status[$ne]=x').set(bearer(s.accessToken))).status).toBe(400);
    expect((await request(app).get('/api/exports/users').set(bearer(s.accessToken))).status).toBe(400);
    expect((await request(app).get('/api/exports/clients').set(bearer(son.accessToken))).status).toBe(403);
  });
});
