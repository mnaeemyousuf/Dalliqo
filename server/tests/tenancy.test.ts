import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../src/app';
import { AuditLog } from '../src/models/AuditLog';
import { BusinessMember } from '../src/models/BusinessMember';
import { TenantGuardError } from '../src/models/plugins/tenant';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();

describe('multi-tenant isolation over HTTP', () => {
  it('a user from business A can never read or change business B data', async () => {
    const ownerA = await registerOwner(app, { businessName: 'Agency A' });
    const ownerB = await registerOwner(app, { businessName: 'Agency B' });
    const memberB = await addActiveMember(app, ownerB);

    const asA = bearer(ownerA.accessToken);
    expect((await request(app).get(`/api/members/${memberB.memberId}`).set(asA)).status).toBe(404);
    expect((await request(app).patch(`/api/members/${memberB.memberId}`).set(asA).send({ status: 'SUSPENDED' })).status).toBe(404);
    expect((await request(app).delete(`/api/members/${memberB.memberId}`).set(asA)).status).toBe(404);

    const listA = await request(app).get('/api/members').set(asA);
    expect(listA.body.data).toHaveLength(1);
    expect(listA.body.data[0]._id).toBe(ownerA.memberId);

    const businessA = await request(app).get('/api/business').set(asA);
    expect(businessA.body.data._id).toBe(ownerA.businessId);

    const auditA = await request(app).get('/api/audit-logs').set(asA);
    expect(auditA.body.data.every((l: { businessId: string }) => l.businessId === ownerA.businessId)).toBe(true);

    // B's member is untouched.
    expect((await request(app).get('/api/auth/me').set(bearer(memberB.accessToken))).status).toBe(200);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects malformed ids before they reach the database', async () => {
    const owner = await registerOwner(app);
    const res = await request(app).get('/api/members/not-an-id').set(bearer(owner.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('tenant guard (defence in depth)', () => {
  it('throws on tenant-collection queries without a businessId filter', async () => {
    await expect(BusinessMember.find({}).exec()).rejects.toBeInstanceOf(TenantGuardError);
    await expect(BusinessMember.findOne({ userId: new Types.ObjectId() }).exec()).rejects.toBeInstanceOf(TenantGuardError);
    await expect(BusinessMember.findById(new Types.ObjectId()).exec()).rejects.toBeInstanceOf(TenantGuardError);
    await expect(BusinessMember.countDocuments({}).exec()).rejects.toBeInstanceOf(TenantGuardError);
    await expect(BusinessMember.updateMany({}, { $set: { status: 'REMOVED' } }).exec()).rejects.toBeInstanceOf(TenantGuardError);
    await expect(AuditLog.deleteMany({}).exec()).rejects.toBeInstanceOf(TenantGuardError);
    await expect(AuditLog.aggregate([{ $match: {} }]).exec()).rejects.toBeInstanceOf(TenantGuardError);
  });

  it('allows scoped queries and explicit opt-outs', async () => {
    const businessId = new Types.ObjectId();
    await expect(BusinessMember.find({ businessId }).exec()).resolves.toEqual([]);
    await expect(AuditLog.aggregate([{ $match: { businessId } }]).exec()).resolves.toEqual([]);
    await expect(BusinessMember.find({}).setOptions({ skipTenantGuard: true } as never).exec()).resolves.toEqual([]);
  });
});
