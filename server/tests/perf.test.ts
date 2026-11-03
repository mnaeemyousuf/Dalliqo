/**
 * Volume check: thousands of records in one business, timed through the real API.
 * Skipped in the normal suite; run with `PERF=1 npx jest tests/perf.test.ts`.
 * Results are recorded in docs/FINAL_QA_REPORT.md.
 */
import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { Agreement } from '../src/models/Agreement';
import { Client } from '../src/models/Client';
import { Deal } from '../src/models/Deal';
import { Transaction } from '../src/models/Transaction';
import { TransactionCategory } from '../src/models/TransactionCategory';
import { Property } from '../src/models/Property';
import { defaultBranchId } from '../src/services/branchScope';
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
  // insertMany(lean) skips timestamps; real records always have them (sync cursors use updatedAt).
  const now = new Date();
  const branchId = new Types.ObjectId(await defaultBranchId({ businessId, userId }));
  const clients = Array.from({ length: n }, (_, i) => {
    const society = SOCIETIES[i % SOCIETIES.length];
    const name = `Client ${offset + i} ${['Khan', 'Siddiqui', 'Qureshi', 'Malik'][i % 4]}`;
    const mobile = `+92300${String(1_000_000 + offset + i).padStart(7, '0')}`;
    return {
      businessId: bid, branchId, createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
      fullName: name, mobileNumber: mobile, whatsappNumber: mobile, status: 'ACTIVE', priority: 'MEDIUM', purchaseOrRental: 'PURCHASE',
      preferredSociety: society, minBudget: 10_000_000, maxBudget: 20_000_000 + (i % 50) * 1_000_000, matchCount: i % 7,
      preferredBlock: `Block ${i % 20}`,
      requirements: [{ isPrimary: true, active: true, purpose: 'PURCHASE', propertyTypes: [TYPES[i % TYPES.length]], areas: [], societies: [society], blocks: [`Block ${i % 20}`], minSize: 100 + (i % 300), maxSize: 150 + (i % 300), sizeUnit: 'SQ_YARD', minSizeSqft: (100 + (i % 300)) * 9, maxSizeSqft: (150 + (i % 300)) * 9, minBudget: 10_000_000, maxBudget: 30_000_000 }],
      searchText: searchBlob(name, mobile),
    };
  });
  const properties = Array.from({ length: n }, (_, i) => ({
    businessId: bid, branchId, createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
    propertyId: formatPropertyId(offset + i + 1), propertyType: TYPES[i % TYPES.length], listingPurpose: i % 5 ? 'SALE' : 'RENT',
    status: i % 9 ? 'AVAILABLE' : 'SOLD', society: SOCIETIES[i % SOCIETIES.length], area: SOCIETIES[i % SOCIETIES.length], block: `Block ${i % 20}`,
    size: 100 + (i % 400), sizeUnit: 'SQ_YARD', sizeSqft: (100 + (i % 400)) * 9, askingPrice: 5_000_000 + (i % 200) * 500_000, matchCount: i % 5,
    lastVerifiedAt: new Date(Date.now() - (i % 60) * 86_400_000),
    searchText: searchBlob(formatPropertyId(offset + i + 1), SOCIETIES[i % SOCIETIES.length], `Block ${i % 20}`),
  }));
  const insertedClients = await Client.insertMany(clients, { lean: true });
  const insertedProps = await Property.insertMany(properties, { lean: true });

  // Phase 2 collections: deals (with payments), income / expense entries and agreements.
  const stages = ['INQUIRY', 'SITE_VISIT', 'OFFER', 'TOKEN', 'AGREEMENT', 'TRANSFER', 'CLOSED_WON', 'CLOSED_LOST'] as const;
  const deals = Array.from({ length: n }, (_, i) => {
    const price = 10_000_000 + (i % 100) * 250_000;
    const received = i % 3 ? Math.round(price * 0.01) : 0;
    return {
      businessId: bid, branchId, createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
      dealNo: `DL-${String(offset + i + 1).padStart(6, '0')}`, title: `Deal ${offset + i}`, clientId: insertedClients[i]._id, propertyId: insertedProps[i]._id,
      stage: stages[i % stages.length], agreedPrice: price, finalPrice: i % 8 === 6 ? price : null, agents: [{ userId: uid, sharePct: 100 }],
      commission: { buyer: { mode: 'PERCENT', value: 1 }, seller: { mode: 'PERCENT', value: 1 } },
      payments: received ? [{ _id: new Types.UUID().toString(), side: 'BUYER', amount: received, date: new Date(Date.now() - (i % 365) * 86_400_000), method: 'CASH' }] : [],
      payouts: [], stageHistory: [], expectedTotal: Math.round(price * 0.02), receivedTotal: received, outstanding: Math.round(price * 0.02) - received,
      commissionStatus: received ? 'PARTIALLY_RECEIVED' : 'PENDING', searchText: searchBlob(`Deal ${offset + i}`),
    };
  });
  await Deal.insertMany(deals, { lean: true });
  const cats = await TransactionCategory.find({ businessId: bid }).select('_id type').lean();
  const income = cats.filter((c) => c.type === 'INCOME');
  const expense = cats.filter((c) => c.type === 'EXPENSE');
  const transactions = Array.from({ length: n }, (_, i) => {
    const isIncome = i % 3 === 0;
    const cat = (isIncome ? income : expense)[i % (isIncome ? income.length : expense.length)];
    return {
      businessId: bid, branchId, createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
      type: isIncome ? 'INCOME' : 'EXPENSE', categoryId: cat._id, amount: 5_000 + (i % 200) * 1_000, date: new Date(Date.now() - (i % 730) * 86_400_000),
      method: 'CASH', source: 'MANUAL', sourceKey: null, description: `Entry ${offset + i}`, searchText: searchBlob(`Entry ${offset + i}`),
    };
  });
  await Transaction.insertMany(transactions, { lean: true });
  const statuses = ['DRAFT', 'SENT', 'SIGNED', 'EXPIRED', 'CANCELLED'] as const;
  const agreements = Array.from({ length: n }, (_, i) => ({
    businessId: bid, branchId, createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, uuid: new Types.UUID().toString(), version: 1, deletedAt: null,
    agreementNo: `AG-${String(offset + i + 1).padStart(6, '0')}`, kind: i % 2 ? 'RENT' : 'SALE', language: i % 4 ? 'en' : 'ur', status: statuses[i % statuses.length],
    clientId: insertedClients[i]._id, propertyId: insertedProps[i]._id, monthlyRent: i % 2 ? 80_000 : null, amount: i % 2 ? null : 15_000_000,
    startDate: new Date(Date.now() - 200 * 86_400_000), endDate: new Date(Date.now() + ((i % 90) - 10) * 86_400_000),
    versions: [{ no: 1, body: 'AGREEMENT\n'.repeat(40), source: 'RENDER', createdAt: new Date(), createdBy: uid }],
    renewalFollowUpIds: [], statusHistory: [], searchText: searchBlob(`AG-${String(offset + i + 1).padStart(6, '0')}`),
  }));
  await Agreement.insertMany(agreements, { lean: true });
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

run(`volume: ${N} each of clients, properties, deals, transactions, agreements`, () => {
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
    await timed('GET /clients?block=<block>', () => request(app).get('/api/clients?block=block%2013&limit=20').set(auth), results);
    await timed('GET /clients?minSize&maxSize (sq yd)', () => request(app).get('/api/clients?minSize=200&maxSize=240&sizeUnit=SQ_YARD&limit=20').set(auth), results);
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

    await timed('GET /deals (board: open deals, 100)', () => request(app).get('/api/deals?open=true&limit=100').set(auth), results);
    await timed('GET /deals?commissionStatus&page=50', () => request(app).get('/api/deals?commissionStatus=PARTIALLY_RECEIVED&limit=20&page=50').set(auth), results);
    await timed('GET /reports/commissions?groupBy=month', () => request(app).get('/api/reports/commissions?groupBy=month').set(auth), results);
    await timed('GET /transactions (page 1, 20)', () => request(app).get('/api/transactions?limit=20').set(auth), results);
    await timed('GET /transactions?type&from&to', () => request(app).get(`/api/transactions?type=EXPENSE&from=${new Date(Date.now() - 180 * 86_400_000).toISOString()}&limit=20`).set(auth), results);
    await timed('GET /reports/finance?groupBy=month', () => request(app).get('/api/reports/finance?groupBy=month').set(auth), results);
    await timed('GET /reports/finance?groupBy=category', () => request(app).get('/api/reports/finance?groupBy=category').set(auth), results);
    await timed('GET /agreements (page 1, 20)', () => request(app).get('/api/agreements?limit=20').set(auth), results);
    await timed('GET /agreements?expiringWithinDays=30', () => request(app).get('/api/agreements?expiringWithinDays=30&limit=20').set(auth), results);
    await timed('GET /agreements?q=AG-004321', () => request(app).get('/api/agreements?q=AG-004321').set(auth), results);
    await timed('GET /sync/pull (first page, 500)', () => request(app).get('/api/sync/pull?limit=500').set(auth), results);

    expect((await request(app).get('/api/deals?limit=1').set(auth)).body.meta.total).toBe(N);
    expect((await request(app).get('/api/transactions?limit=1').set(auth)).body.meta.total).toBe(N);
    expect((await request(app).get('/api/agreements?limit=1').set(auth)).body.meta.total).toBe(N);
    const list = await request(app).get('/api/clients?limit=20').set(auth);
    expect(list.body.meta.total).toBe(N);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ n: N, seedMs, medianMs: results }, null, 2));
    for (const [label, ms] of Object.entries(results)) expect({ label, ms: ms < 1500 }).toEqual({ label, ms: true });
  }, 600_000);
});
