import request from 'supertest';
import { ROLE_PRESETS, allocatePayment, buildRentSchedule, lateFeeFor, summarizeLease } from '@recrm/shared';
import { createApp } from '../src/app';
import { Lease } from '../src/models/Lease';
import { Property } from '../src/models/Property';
import { Transaction } from '../src/models/Transaction';
import { leaseService } from '../src/services/leaseService';
import { createClient, createOwner, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('rent schedule maths (shared)', () => {
  it('builds one item per month with yearly escalation', () => {
    const s = buildRentSchedule({ startDate: utc(2026, 1, 10), endDate: utc(2027, 12, 31), monthlyRent: 100_000, dueDay: 5, escalationPct: 10 });
    expect(s).toHaveLength(24);
    expect(s[0]).toMatchObject({ period: '2026-01', amount: 100_000 });
    expect(new Date(s[0].dueDate).getUTCDate()).toBe(10); // never due before the lease starts
    expect(new Date(s[1].dueDate).getUTCDate()).toBe(5);
    expect(s[12]).toMatchObject({ period: '2027-01', amount: 110_000 });
  });

  it('allocates payments oldest-first and keeps the excess as credit', () => {
    const items = [
      { _id: 'b', dueDate: utc(2026, 2, 1), amount: 50_000, lateFee: 0, paid: 0, status: 'PENDING' as const },
      { _id: 'a', dueDate: utc(2026, 1, 1), amount: 50_000, lateFee: 2_000, paid: 10_000, status: 'PARTIAL' as const },
    ];
    expect(allocatePayment(items, 100_000)).toEqual({ allocations: [{ itemId: 'a', amount: 42_000 }, { itemId: 'b', amount: 50_000 }], credit: 8_000 });
    expect(lateFeeFor(80_000, 'PERCENT', 5)).toBe(4_000);
    expect(lateFeeFor(80_000, 'FIXED', 1_500)).toBe(1_500);
  });

  it('summarises what is due, paid and overdue', () => {
    const now = utc(2026, 3, 15).getTime();
    const s = summarizeLease(
      [
        { period: '2026-01', dueDate: utc(2026, 1, 5), amount: 50_000, lateFee: 0, paid: 50_000, status: 'PAID' },
        { period: '2026-02', dueDate: utc(2026, 2, 5), amount: 50_000, lateFee: 0, paid: 20_000, status: 'OVERDUE' },
        { period: '2026-03', dueDate: utc(2026, 3, 5), amount: 50_000, lateFee: 0, paid: 0, status: 'OVERDUE' },
        { period: '2026-04', dueDate: utc(2026, 4, 5), amount: 50_000, lateFee: 0, paid: 0, status: 'PENDING' },
      ],
      now,
    );
    expect(s.overdue).toBe(80_000);
    expect(s.overdueItems).toBe(2);
    expect(s.nextDue?.period).toBe('2026-04');
  });
});

describe('leases', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  async function setup() {
    const landlord = await createOwner(app, owner);
    const property = await createProperty(app, owner, { listingPurpose: 'RENT', propertyType: 'FLAT', askingPrice: 85_000, ownerId: landlord._id });
    const tenant = await createClient(app, owner, { mobileNumber: '03001239876', purchaseOrRental: 'RENTAL', propertyTypeRequired: ['FLAT'] });
    return { landlord, property, tenant };
  }

  it('creates a lease with a schedule, marks the property rented, takes rent and charges late fees', async () => {
    const { property, tenant, landlord } = await setup();
    const start = new Date(Date.now() - 70 * DAY);
    const res = await request(app)
      .post('/api/leases')
      .set(bearer(owner.accessToken))
      .send({ propertyId: property._id, tenantId: tenant._id, startDate: start, endDate: new Date(Date.now() + 300 * DAY), monthlyRent: 85_000, dueDay: 5, graceDays: 3, lateFeeType: 'FIXED', lateFeeValue: 2_000, securityDeposit: 170_000, managementFeePct: 10 })
      .expect(201);
    const lease = res.body.data;
    expect(lease.leaseNo).toBe('LS-000001');
    expect(lease.landlordId).toBe(landlord._id);
    expect(lease.schedule.length).toBeGreaterThanOrEqual(12);
    expect(lease.overdueAmount).toBeGreaterThan(0); // the first months are already past due
    // Back-dated months are overdue but carry no late fee (they were past due before the lease was entered).
    expect(lease.schedule.find((i: { status: string }) => i.status === 'OVERDUE').lateFee).toBe(0);
    expect((await Property.collection.findOne({ _id: (await Property.findOne({ businessId: owner.businessId }).lean())!._id }))!.status).toBe('RENTED');

    // A second lease on the same property is refused.
    await request(app).post('/api/leases').set(bearer(owner.accessToken)).send({ propertyId: property._id, tenantId: tenant._id, startDate: new Date(), endDate: new Date(Date.now() + 100 * DAY), monthlyRent: 50_000 }).expect(400);

    const paid = (await request(app).post(`/api/leases/${lease._id}/payments`).set(bearer(owner.accessToken)).send({ date: new Date(), amount: 100_000, method: 'BANK_TRANSFER', reference: 'IBFT-1' }).expect(200)).body.data;
    expect(paid.payments[0].allocations[0].amount).toBe(85_000); // oldest month first
    expect(paid.outstanding).toBeLessThan(lease.outstanding);
    const fee = await Transaction.findOne({ businessId: owner.businessId, sourceKey: { $regex: '^lease:' } }).lean();
    expect(fee?.amount).toBe(10_000);

    const detail = (await request(app).get(`/api/leases/${lease._id}`).set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(detail.tenantId.fullName).toBeTruthy();
    expect(detail.summary.totalPaid).toBe(100_000);

    const roll = (await request(app).get('/api/leases/rent-roll').set(bearer(owner.accessToken)).expect(200)).body.data;
    expect(roll.activeLeases).toBe(1);
    expect(roll.depositsHeld).toBe(170_000);
  });

  it('waives a month, records inspections, renews and ends a lease (property back on the market)', async () => {
    const { property, tenant } = await setup();
    const lease = (await request(app).post('/api/leases').set(bearer(owner.accessToken)).send({ propertyId: property._id, tenantId: tenant._id, startDate: new Date(Date.now() + 5 * DAY), endDate: new Date(Date.now() + 200 * DAY), monthlyRent: 60_000, securityDeposit: 120_000 })).body.data;
    const first = lease.schedule[0]._id;
    const waived = (await request(app).post(`/api/leases/${lease._id}/waive`).set(bearer(owner.accessToken)).send({ itemId: first, reason: 'Rent-free first month' }).expect(200)).body.data;
    expect(waived.schedule[0].status).toBe('WAIVED');
    await request(app).post(`/api/leases/${lease._id}/inspections`).set(bearer(owner.accessToken)).send({ date: new Date(), type: 'MOVE_IN', condition: 'GOOD', notes: 'Fresh paint' }).expect(200);
    const renewed = (await request(app).post(`/api/leases/${lease._id}/renew`).set(bearer(owner.accessToken)).send({ endDate: new Date(Date.now() + 560 * DAY), monthlyRent: 66_000 }).expect(200)).body.data;
    expect(renewed.schedule.length).toBeGreaterThan(lease.schedule.length);
    expect(renewed.schedule[renewed.schedule.length - 1].amount).toBe(66_000);
    const ended = (await request(app).post(`/api/leases/${lease._id}/end`).set(bearer(owner.accessToken)).send({ status: 'TERMINATED', reason: 'Tenant relocated', depositRefund: 120_000 }).expect(200)).body.data;
    expect(ended.status).toBe('TERMINATED');
    expect(ended.depositStatus).toBe('REFUNDED');
    const p = await Property.findOne({ businessId: owner.businessId, _id: property._id }).lean();
    expect(p!.status).toBe('AVAILABLE');
  });

  it('marks overdue months on the scheduled refresh, and respects permissions and plans', async () => {
    const { property, tenant } = await setup();
    const lease = (await request(app).post('/api/leases').set(bearer(owner.accessToken)).send({ propertyId: property._id, tenantId: tenant._id, startDate: new Date(Date.now() + 2 * DAY), endDate: new Date(Date.now() + 100 * DAY), monthlyRent: 40_000, graceDays: 0 })).body.data;
    await leaseService.refreshAll(new Date(Date.now() + 70 * DAY));
    const later = await Lease.findOne({ businessId: owner.businessId, _id: lease._id }).lean();
    expect(later!.schedule.filter((i) => i.status === 'OVERDUE').length).toBeGreaterThan(0);
    expect(new Date(later!.schedule[0].dueDate).getTime()).toBeGreaterThanOrEqual(new Date(lease.startDate).setUTCHours(0, 0, 0, 0));

    const viewer = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.VIEWER] });
    await request(app).get('/api/leases').set(bearer(viewer.accessToken)).expect(200);
    await request(app).post(`/api/leases/${lease._id}/payments`).set(bearer(viewer.accessToken)).send({ date: new Date(), amount: 1000 }).expect(403);
  });
});
