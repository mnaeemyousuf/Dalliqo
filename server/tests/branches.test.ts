import { Types } from 'mongoose';
import request from 'supertest';
import { PERMISSIONS, ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { migrateBranches } from '../src/migrations/001-branches';
import { Branch } from '../src/models/Branch';
import { BusinessMember } from '../src/models/BusinessMember';
import { Client } from '../src/models/Client';
import { forgetDefaultBranch } from '../src/services/branchScope';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();

async function mainBranch(s: Session) {
  const res = await request(app).get('/api/branches').set(bearer(s.accessToken));
  expect(res.status).toBe(200);
  return res.body.data.find((b: { isDefault: boolean }) => b.isDefault) as { _id: string; name: string };
}

async function addBranch(s: Session, name: string) {
  const res = await request(app).post('/api/branches').set(bearer(s.accessToken)).send({ name });
  expect(res.status).toBe(201);
  return res.body.data as { _id: string; name: string };
}

/** Owner with Main + Clifton branches and one client in each. */
async function twoBranchBusiness() {
  const owner = await registerOwner(app);
  const main = await mainBranch(owner);
  const clifton = await addBranch(owner, 'Clifton Office');
  const inMain = await createClient(app, owner, { fullName: 'Main Client', mobileNumber: '03001112233' });
  const inClifton = await createClient(app, owner, { fullName: 'Clifton Client', mobileNumber: '03334445566', branchId: clifton._id });
  return { owner, main, clifton, inMain, inClifton };
}

const names = (res: request.Response) => res.body.data.map((c: { fullName: string }) => c.fullName).sort();

describe('branches', () => {
  it('every new business gets a default "Main Branch" and new records land in it', async () => {
    const owner = await registerOwner(app);
    const main = await mainBranch(owner);
    expect(main.name).toBe('Main Branch');
    const c = await createClient(app, owner);
    expect(c.branchId).toBe(main._id);
    const p = await createProperty(app, owner);
    expect(p.branchId).toBe(main._id);
  });

  it('only branches:manage may create or edit branches; the main branch cannot be archived; names are unique', async () => {
    const owner = await registerOwner(app);
    const member = await addActiveMember(app, owner); // family member preset: no branches:manage
    expect(ROLE_PRESETS.MEMBER).not.toContain(PERMISSIONS.BRANCHES_MANAGE);
    expect((await request(app).post('/api/branches').set(bearer(member.accessToken)).send({ name: 'DHA Office' })).status).toBe(403);
    expect((await request(app).get('/api/branches').set(bearer(member.accessToken))).status).toBe(200);

    const dha = await addBranch(owner, 'DHA Office');
    expect((await request(app).post('/api/branches').set(bearer(owner.accessToken)).send({ name: 'dha office' })).status).toBe(409);
    const renamed = await request(app).patch(`/api/branches/${dha._id}`).set(bearer(owner.accessToken)).send({ name: 'DHA Phase 6', nameUr: 'ڈی ایچ اے فیز 6' });
    expect(renamed.body.data).toMatchObject({ name: 'DHA Phase 6', nameUr: 'ڈی ایچ اے فیز 6' });
    const main = await mainBranch(owner);
    const archiveMain = await request(app).patch(`/api/branches/${main._id}`).set(bearer(owner.accessToken)).send({ archived: true });
    expect(archiveMain.status).toBe(409);
    expect(archiveMain.body.code).toBe('BRANCH_IS_DEFAULT');
    await request(app).patch(`/api/branches/${dha._id}`).set(bearer(owner.accessToken)).send({ archived: true }).expect(200);
    const list = await request(app).get('/api/branches').set(bearer(owner.accessToken));
    expect(list.body.data.map((b: { name: string }) => b.name)).toEqual(['Main Branch']);
    // Archived branches take no new records.
    const create = await request(app).post('/api/clients').set(bearer(owner.accessToken)).send({ fullName: 'X Y', mobileNumber: '03007778899', branchId: dha._id });
    expect(create.body.code).toBe('BRANCH_NOT_FOUND');
  });

  it('a member restricted to one branch only reads and writes that branch (enforced by the API)', async () => {
    const { owner, main, clifton, inMain, inClifton } = await twoBranchBusiness();
    const agent = await addActiveMember(app, owner, { branchAccess: 'SELECTED', branchIds: [clifton._id] });
    const auth = bearer(agent.accessToken);

    expect(names(await request(app).get('/api/clients').set(auth))).toEqual(['Clifton Client']);
    expect((await request(app).get(`/api/clients/${inMain._id}`).set(auth)).status).toBe(404);
    expect((await request(app).get(`/api/clients/${inClifton._id}`).set(auth)).status).toBe(200);
    // Cannot change, delete or move records of another branch.
    expect((await request(app).patch(`/api/clients/${inMain._id}`).set(auth).send({ priority: 'HIGH' })).status).toBe(404);
    const move = await request(app).patch(`/api/clients/${inClifton._id}`).set(auth).send({ branchId: main._id });
    expect(move.status).toBe(403);
    expect(move.body.code).toBe('BRANCH_FORBIDDEN');
    // New records default to the member's branch; another branch is refused.
    const created = await createClient(app, agent, { fullName: 'Walk In', mobileNumber: '03451239876' });
    expect(created.branchId).toBe(clifton._id);
    const wrong = await request(app).post('/api/clients').set(auth).send({ fullName: 'Nope Nope', mobileNumber: '03211231234', branchId: main._id });
    expect(wrong.status).toBe(403);
    // Child records follow the parent's branch; notes on another branch's client are refused.
    const fu = await request(app).post('/api/followups').set(auth).send({ clientId: inClifton._id, type: 'CALL', dueAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(fu.status).toBe(201);
    expect(fu.body.data.branchId).toBe(clifton._id);
    expect((await request(app).post('/api/notes').set(auth).send({ entityType: 'client', entityId: inMain._id, content: 'hi' })).status).toBe(400);
    expect((await request(app).get('/api/branches').set(auth)).body.data.map((b: { name: string }) => b.name)).toEqual(['Clifton Office']);
    // Dashboard counts only the member's branch.
    const dash = await request(app).get('/api/dashboard').set(auth);
    expect(dash.body.data.clients.total).toBe(2);
  });

  it('existing members keep exactly their access: branch access ALL sees every branch', async () => {
    const { owner } = await twoBranchBusiness();
    const son = await addActiveMember(app, owner);
    const me = await request(app).get('/api/auth/me').set(bearer(son.accessToken));
    expect(me.body.data.membership).toMatchObject({ branchAccess: 'ALL', branchIds: [] });
    expect(names(await request(app).get('/api/clients').set(bearer(son.accessToken)))).toEqual(['Clifton Client', 'Main Client']);
  });

  it('the branch switcher header narrows lists, dashboard and defaults; a branch outside the member\'s is refused', async () => {
    const { owner, main, clifton } = await twoBranchBusiness();
    const o = bearer(owner.accessToken);
    expect(names(await request(app).get('/api/clients').set(o).set('X-Branch-Id', clifton._id))).toEqual(['Clifton Client']);
    expect(names(await request(app).get('/api/clients').set(o).set('X-Branch-Id', 'all'))).toEqual(['Clifton Client', 'Main Client']);
    expect((await request(app).get('/api/dashboard').set(o).set('X-Branch-Id', main._id)).body.data.clients.total).toBe(1);
    expect((await request(app).get('/api/dashboard').set(o)).body.data.clients.total).toBe(2);
    const viaHeader = await request(app).post('/api/owners').set(o).set('X-Branch-Id', clifton._id).send({ fullName: 'Owner In Clifton', mobileNumber: '03214445566' });
    expect(viaHeader.body.data.branchId).toBe(clifton._id);

    const agent = await addActiveMember(app, owner, { branchAccess: 'SELECTED', branchIds: [clifton._id] });
    const refused = await request(app).get('/api/clients').set(bearer(agent.accessToken)).set('X-Branch-Id', main._id);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('BRANCH_FORBIDDEN');
    expect((await request(app).get('/api/clients').set(o).set('X-Branch-Id', 'nonsense')).status).toBe(400);
  });

  it('matches clients with properties of the same branch, or across branches when enabled', async () => {
    const { owner, clifton } = await twoBranchBusiness();
    const o = bearer(owner.accessToken);
    // Both test clients want a 100–133 sq yd plot in Gulshan-e-Iqbal; this one is in Clifton only.
    const p = await createProperty(app, owner, { branchId: clifton._id });
    const sameBranch = await request(app).get(`/api/properties/${p._id}/matches`).set(o);
    expect(sameBranch.body.data.map((m: { clientId: { fullName: string } }) => m.clientId.fullName)).toEqual(['Clifton Client']);

    await request(app).patch('/api/settings').set(o).send({ matching: { crossBranch: true } }).expect(200);
    await request(app).post('/api/matches/recalculate').set(o).send({ propertyId: p._id }).expect(200);
    const cross = await request(app).get(`/api/properties/${p._id}/matches`).set(o);
    expect(cross.body.data.map((m: { clientId: { fullName: string } }) => m.clientId.fullName).sort()).toEqual(['Clifton Client', 'Main Client']);
  });

  it('sync pull gives a restricted member only their branch (records and branch list)', async () => {
    const { owner, clifton } = await twoBranchBusiness();
    const agent = await addActiveMember(app, owner, { branchAccess: 'SELECTED', branchIds: [clifton._id] });
    const pull = await request(app).get('/api/sync/pull').set(bearer(agent.accessToken));
    expect(pull.body.data.changes.clients.map((c: { fullName: string }) => c.fullName)).toEqual(['Clifton Client']);
    expect(pull.body.data.changes.branches.map((b: { name: string }) => b.name)).toEqual(['Clifton Office']);
    const ownerPull = await request(app).get('/api/sync/pull').set(bearer(owner.accessToken));
    expect(ownerPull.body.data.changes.branches).toHaveLength(2);
  });

  it('member branch access is validated and can be changed by the owner', async () => {
    const { owner, clifton } = await twoBranchBusiness();
    const other = await registerOwner(app);
    const otherBranch = await mainBranch(other);
    const o = bearer(owner.accessToken);
    const bad = await request(app).post('/api/members').set(o).send({ fullName: 'Agent A', email: `a${Date.now()}@example.com`, temporaryPassword: 'TempPass1', branchAccess: 'SELECTED', branchIds: [otherBranch._id] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BRANCH_NOT_FOUND'); // another business's branch
    const empty = await request(app).post('/api/members').set(o).send({ fullName: 'Agent A', email: `b${Date.now()}@example.com`, temporaryPassword: 'TempPass1', branchAccess: 'SELECTED', branchIds: [] });
    expect(empty.status).toBe(400);

    const agent = await addActiveMember(app, owner, { branchAccess: 'SELECTED', branchIds: [clifton._id] });
    const member = (await request(app).get('/api/members').set(o)).body.data.find((m: { user: { email: string } }) => m.user.email === agent.email);
    expect(member).toMatchObject({ branchAccess: 'SELECTED', branchIds: [clifton._id] });
    await request(app).patch(`/api/members/${member._id}`).set(o).send({ branchAccess: 'ALL' }).expect(200);
    // Takes effect on the very next request (permissions are read live).
    expect(names(await request(app).get('/api/clients').set(bearer(agent.accessToken)))).toEqual(['Clifton Client', 'Main Client']);
  });
});

describe('branch migration', () => {
  it('creates the main branch, backfills existing records and members, keeps updatedAt, and is idempotent', async () => {
    const owner = await registerOwner(app);
    // Simulate a business from before branches: no branch, records and member without branch fields.
    await Branch.deleteMany({ businessId: owner.businessId });
    forgetDefaultBranch(owner.businessId);
    const updatedAt = new Date('2026-01-15T10:00:00Z');
    const legacyId = new Types.ObjectId();
    await Client.collection.insertOne({
      _id: legacyId, businessId: new Types.ObjectId(owner.businessId), uuid: new Types.UUID().toString(), version: 3, deletedAt: null,
      fullName: 'Legacy Client', mobileNumber: '+923001234567', status: 'ACTIVE', priority: 'MEDIUM', requirements: [], propertyTypeRequired: [],
      matchCount: 0, searchText: 'legacy client', createdBy: new Types.ObjectId(owner.userId), updatedBy: new Types.ObjectId(owner.userId),
      createdAt: updatedAt, updatedAt,
    });
    await BusinessMember.collection.updateMany({ businessId: new Types.ObjectId(owner.businessId) }, { $unset: { branchAccess: '', branchIds: '' } });

    const first = await migrateBranches();
    expect(first.branchesCreated).toBeGreaterThanOrEqual(1);
    const main = await Branch.findOne({ businessId: owner.businessId, isDefault: true }).lean();
    expect(main?.name).toBe('Main Branch');
    const legacy = await Client.findOne({ businessId: owner.businessId, _id: legacyId }).lean();
    expect(String(legacy?.branchId)).toBe(String(main?._id));
    expect(legacy?.updatedAt.toISOString()).toBe(updatedAt.toISOString()); // not marked as edited
    expect(legacy?.version).toBe(3);
    const members = await BusinessMember.find({ businessId: owner.businessId }).lean();
    expect(members.every((m) => m.branchAccess === 'ALL')).toBe(true);

    // Second run: nothing left to do, nothing duplicated.
    const second = await migrateBranches();
    expect(second.branchesCreated).toBe(0);
    expect(Object.values(second.backfilled).every((n) => n === 0)).toBe(true);
    expect(second.membersUpdated).toBe(0);
    expect(await Branch.countDocuments({ businessId: owner.businessId, isDefault: true })).toBe(1);
    // The legacy client is visible through the API as before.
    expect(names(await request(app).get('/api/clients').set(bearer(owner.accessToken)))).toEqual(['Legacy Client']);
  });
});
