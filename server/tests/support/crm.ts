import type { Express } from 'express';
import request from 'supertest';
import { bearer, type Session } from './helpers';

export async function categoryId(app: Express, s: Session, key: string): Promise<string> {
  const res = await request(app).get('/api/client-categories').set(bearer(s.accessToken));
  const c = res.body.data.find((x: { key: string }) => x.key === key);
  if (!c) throw new Error(`category ${key} not found`);
  return c._id;
}

export async function createClient(app: Express, s: Session, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/clients')
    .set(bearer(s.accessToken))
    .send({
      fullName: 'Muhammad Ali',
      mobileNumber: '03001112233',
      purchaseOrRental: 'PURCHASE',
      propertyTypeRequired: ['RESIDENTIAL_PLOT'],
      preferredSociety: 'Gulshan-e-Iqbal',
      minSize: 100,
      maxSize: 133,
      sizeUnit: 'SQ_YARD',
      minBudget: 12_000_000,
      maxBudget: 16_000_000,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`create client failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function createOwner(app: Express, s: Session, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/owners')
    .set(bearer(s.accessToken))
    .send({ fullName: 'Haji Abdul Rasheed', mobileNumber: '03214445566', ...overrides });
  if (res.status !== 201) throw new Error(`create owner failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function createProperty(app: Express, s: Session, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/properties')
    .set(bearer(s.accessToken))
    .send({
      propertyType: 'RESIDENTIAL_PLOT',
      listingPurpose: 'SALE',
      society: 'Gulshan-e-Iqbal',
      area: 'Gulshan',
      block: '13-D',
      size: 120,
      sizeUnit: 'SQ_YARD',
      askingPrice: 15_500_000,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`create property failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
