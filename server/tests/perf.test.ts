/**
 * Volume check: thousands of records in one business, timed through the real API.
 * Skipped in the normal suite; run with `PERF=1 npx jest tests/perf.test.ts`.
 * Results are recorded in docs/FINAL_QA_REPORT.md.
 */
import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { Client } from '../src/models/Client';
import { Property } from '../src/models/Property';
import { formatPropertyId } from '../src/services/propertyService';
import { searchBlob } from '../src/utils/text';
import { bearer, registerOwner } from './support/helpers';

const run = process.env.PERF ? describe : describe.skip;
const app = createApp();
const N = Number(process.env.PERF_N ?? 5000);
const SOCIETIES = ['Gulshan-e-Iqbal', 'DHA Karachi', 'Clifton', 'North Nazimabad', 'PECHS', 'Bahria Town Karachi'];
const TYPES = ['RESIDENTIAL_PLOT', 'HOUSE', 'FLAT', 'APARTMENT', 'PORTION', 'SHOP'] as const;

async function seedBulk(businessId: string, userId: string, n: number, offset = 0) {
  const bid = new Types.ObjectId(businessId);
  const uid = new Types.ObjectId(userId);
  const clients = Array.from({ length: n }, (_, i) => {
    const society = SOCIETIES[i % SOCIETIES.length];
    const name = `Client ${offset + i} ${['Khan', 'Siddiqui', 'Qureshi', 'Malik'][i % 4]}`;
    const mobile = `+92300${String(1_000_000 + offset + i).padStart(7, '0')}`;
    return {
      businessId: bid, createdBy: uid, updatedBy: uid, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
      fullName: name, mobileNumber: mobile, whatsappNumber: mobile, status: 'ACTIVE', priority: 'MEDIUM', purchaseOrRental: 'PURCHASE',
      preferredSociety: society, minBudget: 10_000_000, maxBudget: 20_000_000 + (i % 50) * 1_000_000, matchCount: i % 7,
      requirements: [{ isPrimary: true, active: true, purpose: 'PURCHASE', propertyTypes: [TYPES[i % TYPES.length]], areas: [], societies: [society], blocks: [], minBudget: 10_000_000, maxBudget: 30_000_000 }],
      searchText: searchBlob(name, mobile),
    };
  });
  const properties = Array.from({ length: n }, (_, i) => ({
    businessId: bid, createdBy: uid, updatedBy: uid, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
    propertyId: formatPropertyId(offset + i + 1), propertyType: TYPES[i % TYPES.length], listingPurpose: i % 5 ? 'SALE' : 'RENT',
    status: i % 9 ? 'AVAILABLE' : 'SOLD', society: SOCIETIES[i % SOCIETIES.length], area: SOCIETIES[i % SOCIETIES.length], block: `Block ${i % 20}`,
    size: 100 + (i % 400), sizeUnit: 'SQ_YARD', sizeSqft: (100 + (i % 400)) * 9, askingPrice: 5_000_000 + (i % 200) * 500_000, matchCount: i % 5,
    lastVerifiedAt: new Date(Date.now() - (i % 60) * 86_400_000),
    searchText: searchBlob(formatPropertyId(offset + i + 1), SOCIETIES[i % SOCIETIES.length], `Block ${i % 20}`),
  }));
  await Client.insertMany(clients, { lean: true });
  await Property.insertMany(properties, { lean: true });
}

async function timed(label: string, fn: () => Promise<{ status: number }>, results: Record<string, number>) {
  await fn(); // warm-up (connection pool, query plan cache)
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const res = await fn();
    runs.push(performance.now() - t);
    expect(res.status).toBe(200);
  }
  runs.sort((a, b) => a - b);
  results[label] = Math.round(runs[2]); // median
}

run(`volume: ${N} clients + ${N} properties`, () => {
  it('keeps list, search, filter and dashboard requests fast', async () => {
    const s = await registerOwner(app);
    const other = await registerOwner(app); // a second tenant with its own data, to prove scoping stays cheap
    const t0 = performance.now();
    await seedBulk(s.businessId, s.userId, N);
    await seedBulk(other.businessId, other.userId, 2000, N);
    const seedMs = Math.round(performance.now() - t0);
    const auth = bearer(s.accessToken);
    const results: Record<string, number> = {};

    await timed('GET /clients (page 1, 20 rows)', () => request(app).get('/api/clients?limit=20').set(auth), results);
    await timed('GET /clients?page=200', () => request(app).get('/api/clients?limit=20&page=200').set(auth), results);
    await timed('GET /clients?q=<name>', () => request(app).get('/api/clients?q=client%204321').set(auth), results);
    await timed('GET /clients?q=<mobile digits>', () => request(app).get('/api/clients?q=1004321').set(auth), results);
    await timed('GET /properties (page 1, 24 rows)', () => request(app).get('/api/properties?limit=24').set(auth), results);
    await timed('GET /properties?q=RE-004321', () => request(app).get('/api/properties?q=RE-004321').set(auth), results);
    await timed('GET /properties (type+status+price+society filters)', () => request(app).get('/api/properties?propertyType=HOUSE&status=AVAILABLE&minPrice=10000000&maxPrice=60000000&society=dha&limit=24').set(auth), results);
    await timed('GET /properties?verification=stale', () => request(app).get('/api/properties?verification=stale&limit=24').set(auth), results);
    await timed('GET /search?q=dha', () => request(app).get('/api/search?q=dha').set(auth), results);
    await timed('GET /dashboard (uncached)', async () => {
      const { dashboardService } = await import('../src/services/dashboardService');
      dashboardService.invalidate(s.businessId);
      return request(app).get('/api/dashboard').set(auth);
    }, results);

    const list = await request(app).get('/api/clients?limit=20').set(auth);
    expect(list.body.meta.total).toBe(N);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ n: N, seedMs, medianMs: results }, null, 2));
    for (const [label, ms] of Object.entries(results)) expect({ label, ms: ms < 1500 }).toEqual({ label, ms: true });
  }, 600_000);
});
