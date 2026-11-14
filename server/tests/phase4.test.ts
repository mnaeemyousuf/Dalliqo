import ExcelJS from 'exceljs';
import request from 'supertest';
import { ROLE_PRESETS, formatCnic, maskCnic } from '@recrm/shared';
import { createApp } from '../src/app';
import { createOwner, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function binary(req: request.Test) {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

describe('CNIC helpers (shared)', () => {
  it('formats and masks CNICs', () => {
    expect(formatCnic('3520212345671')).toBe('35202-1234567-1');
    expect(maskCnic('3520212345671')).toBe('35202-*******-1');
  });
});

describe('property verification workflow', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('submits, assigns, works the checklist, sends back and approves with history', async () => {
    const officer = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.VERIFICATION_OFFICER] });
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT, 'verification:submit'] });
    const p = await createProperty(app, owner);

    let v = (await request(app).get(`/api/properties/${p._id}/verification`).set(bearer(agent.accessToken)).expect(200)).body.data;
    expect(v.status).toBe('NOT_SUBMITTED');
    expect(v.missingDocuments).toEqual(expect.arrayContaining(['OWNER_IDENTITY', 'OWNERSHIP_PROOF']));

    await request(app).post(`/api/properties/${p._id}/verification/submit`).set(bearer(agent.accessToken)).send({ note: 'Owner shared registry' }).expect(200);
    const queue = await request(app).get('/api/verifications').set(bearer(officer.accessToken)).expect(200);
    expect(queue.body.data.map((x: { _id: string }) => x._id)).toContain(p._id);
    const notes = await request(app).get('/api/notifications').set(bearer(officer.accessToken));
    expect(notes.body.data.some((n: { title: string }) => n.title === 'Verification requested')).toBe(true);

    // An agent cannot decide.
    await request(app).post(`/api/properties/${p._id}/verification/decide`).set(bearer(agent.accessToken)).send({ decision: 'APPROVED' }).expect(403);

    await request(app).post(`/api/properties/${p._id}/verification/assign`).set(bearer(owner.accessToken)).send({ userId: officer.userId }).expect(200);
    await request(app).post(`/api/properties/${p._id}/verification/checklist`).set(bearer(officer.accessToken)).send({ key: 'SITE_INSPECTED', done: true }).expect(200);
    await request(app).post(`/api/properties/${p._id}/verification/decide`).set(bearer(officer.accessToken)).send({ decision: 'CHANGES_REQUESTED' }).expect(400); // remarks required
    await request(app).post(`/api/properties/${p._id}/verification/decide`).set(bearer(officer.accessToken)).send({ decision: 'CHANGES_REQUESTED', remarks: 'NOC missing' }).expect(200);
    await request(app).post(`/api/properties/${p._id}/verification/submit`).set(bearer(agent.accessToken)).send({}).expect(200);
    const done = (await request(app).post(`/api/properties/${p._id}/verification/decide`).set(bearer(officer.accessToken)).send({ decision: 'APPROVED', remarks: 'Documents checked' }).expect(200)).body.data;
    expect(done.verification.status).toBe('APPROVED');
    expect(done.verification.verifiedBy).toBe(officer.userId);
    expect(new Date(done.verification.nextVerificationAt).getTime()).toBeGreaterThan(Date.now() + 100 * 86_400_000);
    v = (await request(app).get(`/api/properties/${p._id}/verification`).set(bearer(owner.accessToken))).body.data;
    expect(v.history.map((h: { action: string }) => h.action)).toEqual(['submitted', 'assigned', 'changes_requested', 'submitted', 'approved']);
    expect(v.checklist.find((c: { key: string }) => c.key === 'SITE_INSPECTED').done).toBe(true);
  });

  it('does not let a member approve a verification they submitted (four eyes)', async () => {
    const officer = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.VERIFICATION_OFFICER] });
    const p = await createProperty(app, owner);
    await request(app).post(`/api/properties/${p._id}/verification/submit`).set(bearer(officer.accessToken)).send({}).expect(200);
    await request(app).post(`/api/properties/${p._id}/verification/decide`).set(bearer(officer.accessToken)).send({ decision: 'APPROVED' }).expect(403);
  });
});

describe('sensitive data', () => {
  it('hides CNIC numbers and identity documents from members without access', async () => {
    const owner = await registerOwner(app);
    const viewer = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.VIEWER] });
    const o = await createOwner(app, owner, { cnic: '35202-1234567-1' });
    const full = (await request(app).get(`/api/owners/${o._id}`).set(bearer(owner.accessToken))).body.data;
    expect(full.cnic).toBe('3520212345671');
    const masked = (await request(app).get(`/api/owners/${o._id}`).set(bearer(viewer.accessToken))).body.data;
    expect(masked.cnic).toBeUndefined();
    expect(masked.cnicMasked).toBe('35202-*******-1');
    const pull = await request(app).get('/api/sync/pull').set(bearer(viewer.accessToken));
    expect(pull.body.data.changes.owners[0].cnic).toBeUndefined();

    const p = await createProperty(app, owner);
    const up = await request(app)
      .post('/api/documents')
      .set(bearer(owner.accessToken))
      .field('entityType', 'property')
      .field('entityId', p._id)
      .field('category', 'CNIC')
      .attach('file', PDF, 'cnic.pdf');
    expect(up.status).toBe(201);
    await request(app).post('/api/documents').set(bearer(owner.accessToken)).field('entityType', 'property').field('entityId', p._id).field('category', 'SOCIETY_NOC').field('expiresAt', '2030-01-01').attach('file', PDF, 'noc.pdf').expect(201);
    const mine = await request(app).get(`/api/documents?entityType=property&entityId=${p._id}`).set(bearer(owner.accessToken));
    expect(mine.body.data).toHaveLength(2);
    const theirs = await request(app).get(`/api/documents?entityType=property&entityId=${p._id}`).set(bearer(viewer.accessToken));
    expect(theirs.body.data.map((d: { category: string }) => d.category)).toEqual(['SOCIETY_NOC']);
    await request(app).get(`/api/documents/${up.body.data._id}/download`).set(bearer(viewer.accessToken)).expect(404);
    const v = (await request(app).get(`/api/properties/${p._id}/verification`).set(bearer(owner.accessToken))).body.data;
    expect(v.missingDocuments).not.toContain('OWNER_IDENTITY');
    expect(v.missingDocuments).not.toContain('SOCIETY_NOC');
  });
});

describe('deal close approval', () => {
  it('holds an agent’s close-won until a manager approves it, when approvals are on', async () => {
    const owner = await registerOwner(app);
    const agent = await addActiveMember(app, owner, { permissions: [...ROLE_PRESETS.AGENT] });
    const client = (await request(app).post('/api/clients').set(bearer(agent.accessToken)).send({ fullName: 'Rafiq Ahmed', mobileNumber: '03007776655', purchaseOrRental: 'PURCHASE' })).body.data;
    const deal = (await request(app).post('/api/deals').set(bearer(agent.accessToken)).send({ clientId: client._id, agreedPrice: 20_000_000 })).body.data;

    // Approvals off: the agent can close directly.
    const other = (await request(app).post('/api/deals').set(bearer(agent.accessToken)).send({ clientId: client._id })).body.data;
    expect((await request(app).post(`/api/deals/${other._id}/stage`).set(bearer(agent.accessToken)).send({ stage: 'CLOSED_WON' })).body.data.stage).toBe('CLOSED_WON');

    await request(app).patch('/api/settings').set(bearer(owner.accessToken)).send({ commission: { closeApprovalRequired: true } }).expect(200);
    const held = (await request(app).post(`/api/deals/${deal._id}/stage`).set(bearer(agent.accessToken)).send({ stage: 'CLOSED_WON' }).expect(200)).body.data;
    expect(held.stage).toBe('INQUIRY');
    expect(held.approval.status).toBe('PENDING');
    const notes = await request(app).get('/api/notifications?category=DEAL').set(bearer(owner.accessToken));
    expect(notes.body.data[0].title).toBe('Deal waiting for approval');
    await request(app).post(`/api/deals/${deal._id}/approval`).set(bearer(agent.accessToken)).send({ decision: 'APPROVED' }).expect(403);
    const approved = (await request(app).post(`/api/deals/${deal._id}/approval`).set(bearer(owner.accessToken)).send({ decision: 'APPROVED', note: 'Documents complete' }).expect(200)).body.data;
    expect(approved.stage).toBe('CLOSED_WON');
    expect(approved.approval.status).toBe('APPROVED');
    expect(approved.approval.decidedBy).toBe(owner.userId);
  });
});

describe('inventory tools', () => {
  let owner: Session;
  beforeEach(async () => {
    owner = await registerOwner(app);
  });

  it('imports properties from Excel with owners, reporting duplicates and bad rows', async () => {
    const tpl = await binary(request(app).get('/api/properties/import/template').set(bearer(owner.accessToken)));
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('P');
    ws.addRow(['Type', 'Society', 'Block', 'Plot no.', 'Size', 'Unit', 'Asking price (PKR)', 'Owner name', 'Owner mobile']);
    ws.addRow(['house', 'DHA Lahore', 'C', '123', '1', 'Kanal', '85,000,000', 'Haji Rasheed', '03214445566']);
    ws.addRow(['HOUSE', 'DHA Lahore', 'C', '123', '1', 'KANAL', '84000000', '', '']);
    ws.addRow(['CASTLE', 'X', '', '', '1', 'KANAL', '1000', '', '']);
    ws.addRow(['RESIDENTIAL_PLOT', 'Bahria', '', '', '10', 'marla', '', '', '']);
    const res = await request(app).post('/api/properties/import').set(bearer(owner.accessToken)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'p.xlsx').expect(200);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.duplicates).toHaveLength(1);
    expect(res.body.data.errors).toHaveLength(2);
    const list = await request(app).get('/api/properties').set(bearer(owner.accessToken));
    expect(list.body.data[0].sizeUnit).toBe('KANAL');
    expect(list.body.data[0].ownerId.fullName).toBe('Haji Rasheed');
  });

  it('serves a QR code PNG for a property', async () => {
    const p = await createProperty(app, owner);
    const res = await binary(request(app).get(`/api/properties/${p._id}/qr`).set(bearer(owner.accessToken)));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((res.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
  });

  it('saves private and shared list views', async () => {
    const member = await addActiveMember(app, owner);
    await request(app).post('/api/saved-views').set(bearer(owner.accessToken)).send({ page: 'clients', name: 'Hot DHA buyers', params: { temperature: 'HOT', society: 'DHA', page: '3' } }).expect(201);
    await request(app).post('/api/saved-views').set(bearer(owner.accessToken)).send({ page: 'clients', name: 'Team view', params: { status: 'ACTIVE' }, shared: true }).expect(201);
    const mine = (await request(app).get('/api/saved-views?page=clients').set(bearer(owner.accessToken))).body.data;
    expect(mine.map((v: { name: string }) => v.name)).toEqual(['Hot DHA buyers', 'Team view']);
    expect(mine[0].params).toEqual({ temperature: 'HOT', society: 'DHA' });
    const theirs = (await request(app).get('/api/saved-views?page=clients').set(bearer(member.accessToken))).body.data;
    expect(theirs.map((v: { name: string }) => v.name)).toEqual(['Team view']);
    await request(app).delete(`/api/saved-views/${theirs[0]._id}`).set(bearer(member.accessToken)).expect(404); // not theirs to delete
  });

  it('offers the new permission templates', async () => {
    const meta = await request(app).get('/api/meta/permissions').set(bearer(owner.accessToken)).expect(200);
    expect(Object.keys(meta.body.data.permissionTemplates)).toEqual(expect.arrayContaining(['BRANCH_MANAGER', 'VERIFICATION_OFFICER', 'FINANCE_MANAGER']));
  });
});
