import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AGREEMENT_BLANK, BUILT_IN_AGREEMENT_TEMPLATES, ROLE_PRESETS, amountInWords, renderAgreement } from '@recrm/shared';
import { createApp } from '../src/app';
import { runMigrations } from '../src/migrations';
import { AgreementTemplate } from '../src/models/AgreementTemplate';
import { FollowUp } from '../src/models/FollowUp';
import { createClient, createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner, type Session } from './support/helpers';

const app = createApp();
const member = (owner: Session, template: keyof typeof ROLE_PRESETS) => addActiveMember(app, owner, { permissions: [...ROLE_PRESETS[template]] });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function draft(s: Session, body: Record<string, unknown>) {
  const res = await request(app).post('/api/agreements').set(bearer(s.accessToken)).send(body);
  if (res.status !== 201) throw new Error(`create agreement failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Collects a binary response body (PDF) as a Buffer. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('agreement templates (shared)', () => {
  it('fills placeholders, leaves blanks for missing values and spells amounts the Pakistani way', () => {
    expect(renderAgreement('Between {{ownerName}} and {{clientName}} for {{amount}}', { clientName: 'Muhammad Ali', amount: 'Rs 5,000,000' })).toBe(`Between ${AGREEMENT_BLANK} and Muhammad Ali for Rs 5,000,000`);
    expect(amountInWords(2_550_000)).toBe('twenty-five lakh fifty thousand rupees only');
    expect(amountInWords(123_456_789)).toBe('twelve crore thirty-four lakh fifty-six thousand seven hundred eighty-nine rupees only');
    expect(amountInWords(0)).toBe('zero rupees only');
  });
});

describe('agreements', () => {
  it('seeds EN + UR templates for sale, rent and token at registration; migration 003 back-fills and is idempotent', async () => {
    const owner = await registerOwner(app);
    const list = (await request(app).get('/api/agreement-templates').set(bearer(owner.accessToken))).body.data;
    expect(list).toHaveLength(BUILT_IN_AGREEMENT_TEMPLATES.length);
    expect(list.map((t: { kind: string; language: string }) => `${t.kind}/${t.language}`).sort()).toEqual(['RENT/en', 'RENT/ur', 'SALE/en', 'SALE/ur', 'TOKEN_RECEIPT/en', 'TOKEN_RECEIPT/ur']);
    await AgreementTemplate.deleteMany({ businessId: owner.businessId });
    expect(((await runMigrations())['003-agreement-templates'] as { templatesCreated: number }).templatesCreated).toBeGreaterThanOrEqual(6);
    expect(((await runMigrations())['003-agreement-templates'] as { templatesCreated: number }).templatesCreated).toBe(0);
  });

  it('drafts from the template with the linked details, versions renders and hand edits, prints a PDF in both languages', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const client = await createClient(app, owner, { fullName: 'Kamran Akmal' });
    const property = await createProperty(app, owner);
    const a = await draft(owner, { kind: 'SALE', clientId: client._id, propertyId: property._id, amount: 2_550_000, tokenAmount: 250_000, clientCnic: '42101-1234567-1' });
    expect(a).toMatchObject({ agreementNo: 'AG-000001', status: 'DRAFT', language: 'en', branchId: client.branchId });
    expect(a.versions).toHaveLength(1);
    const v1 = a.versions[0].body as string;
    expect(v1).toContain('AGREEMENT TO SELL');
    expect(v1).toContain('Kamran Akmal');
    expect(v1).toContain('42101-1234567-1');
    expect(v1).toContain('Rs 2,550,000 (twenty-five lakh fifty thousand rupees only)');
    expect(v1).toContain('balance of Rs 2,300,000');
    expect(v1).toContain(property.propertyId);
    expect(v1).not.toContain('{{');

    // New details → render again = version 2; hand edit = version 3.
    await request(app).patch(`/api/agreements/${a._id}`).set(auth).send({ witness1: 'Bilal Ahmed' }).expect(200);
    const v2 = await request(app).post(`/api/agreements/${a._id}/render`).set(auth).send({});
    expect(v2.status).toBe(201);
    expect(v2.body.data.versions.map((v: { no: number }) => v.no)).toEqual([1, 2]);
    expect(v2.body.data.versions[1].body).toContain('Witness 1: Bilal Ahmed');
    const edited = await request(app).post(`/api/agreements/${a._id}/versions`).set(auth).send({ body: `${v2.body.data.versions[1].body}\n\n8. Extra clause requested by the lawyer.` });
    expect(edited.body.data.versions.at(-1)).toMatchObject({ no: 3, source: 'EDIT' });

    const pdf = await request(app).get(`/api/agreements/${a._id}/pdf?version=2`).set(auth).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('AG-000001-v2.pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await request(app).get(`/api/agreements/${a._id}/pdf?version=9`).set(auth)).status).toBe(404);

    const ur = await draft(owner, { kind: 'TOKEN_RECEIPT', language: 'ur', clientId: client._id, propertyId: property._id, amount: 2_550_000, tokenAmount: 250_000 });
    expect(ur.versions[0].body).toContain('رسید بیعانہ');
    expect(ur.versions[0].body).toContain('250,000 روپے');
    const urPdf = await request(app).get(`/api/agreements/${ur._id}/pdf`).set(auth).buffer(true).parse(binary);
    expect(urPdf.status).toBe(200);
    expect((urPdf.body as Buffer).length).toBeGreaterThan(5000);

    const timeline = await request(app).get(`/api/activities?entityId=${a._id}`).set(auth);
    expect(timeline.body.data.map((x: { type: string }) => x.type)).toEqual(expect.arrayContaining(['AGREEMENT_CREATED', 'AGREEMENT_UPDATED', 'AGREEMENT_RENDERED']));
  });

  it('moves through statuses, attaches the signed copy, and locks signed agreements', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const client = await createClient(app, owner);
    const a = await draft(owner, { kind: 'SALE', clientId: client._id, amount: 1_000_000 });
    expect((await request(app).post(`/api/agreements/${a._id}/status`).set(auth).send({ status: 'EXPIRED' })).status).toBe(400);
    await request(app).post(`/api/agreements/${a._id}/status`).set(auth).send({ status: 'SENT' }).expect(200);

    const upload = await request(app)
      .post('/api/documents')
      .set(auth)
      .field('entityType', 'agreement')
      .field('entityId', a._id)
      .field('category', 'AGREEMENT')
      .attach('file', Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'), { filename: 'signed.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    // A document of another record cannot be used as the signed copy.
    const other = await draft(owner, { kind: 'SALE', clientId: client._id });
    expect((await request(app).post(`/api/agreements/${other._id}/status`).set(auth).send({ status: 'SIGNED', signedDocumentId: upload.body.data._id })).status).toBe(400);

    const signed = await request(app).post(`/api/agreements/${a._id}/status`).set(auth).send({ status: 'SIGNED', signedDocumentId: upload.body.data._id, note: 'Signed at the office' });
    expect(signed.status).toBe(200);
    expect(signed.body.data).toMatchObject({ status: 'SIGNED', signedDocumentId: upload.body.data._id });
    expect(signed.body.data.signedAt).toBeTruthy();
    expect(signed.body.data.statusHistory.map((h: { status: string }) => h.status)).toEqual(['DRAFT', 'SENT', 'SIGNED']);

    expect((await request(app).patch(`/api/agreements/${a._id}`).set(auth).send({ amount: 5 })).status).toBe(409);
    expect((await request(app).post(`/api/agreements/${a._id}/render`).set(auth).send({})).status).toBe(409);
    expect((await request(app).delete(`/api/agreements/${a._id}`).set(auth)).status).toBe(409);
    expect((await request(app).post(`/api/agreements/${a._id}/status`).set(auth).send({ status: 'EXPIRED' })).status).toBe(200);
  });

  it('plans renewal follow-ups 30 and 7 days before a rent agreement ends, re-plans on date change, cancels on cancel', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const client = await createClient(app, owner);
    const a = await draft(owner, { kind: 'RENT', clientId: client._id, monthlyRent: 85_000, securityDeposit: 170_000, startDate: inDays(-300), endDate: inDays(60) });
    expect(a.renewalFollowUpIds).toHaveLength(2);
    expect(a.versions[0].body).toContain('Rs 85,000');
    const pending = async () => FollowUp.find({ businessId: owner.businessId, _id: { $in: (await request(app).get(`/api/agreements/${a._id}`).set(auth)).body.data.renewalFollowUpIds }, status: 'PENDING' }).sort({ dueAt: 1 }).lean();
    const first = await pending();
    const days = first.map((f) => Math.round((+new Date(f.dueAt) - Date.now()) / 86_400_000));
    expect(days).toEqual([30, 53]);
    expect(first[1].notes).toContain('(7 days)');
    expect(first[1].priority).toBe('HIGH');

    // Only 10 days left after the change: the 30-day one is in the past, so just the 7-day one.
    await request(app).patch(`/api/agreements/${a._id}`).set(auth).send({ endDate: inDays(10) }).expect(200);
    expect(await pending()).toHaveLength(1);
    expect(await FollowUp.countDocuments({ businessId: owner.businessId, _id: { $in: first.map((f) => f._id) }, status: 'CANCELLED' })).toBe(2);

    await request(app).post(`/api/agreements/${a._id}/status`).set(auth).send({ status: 'CANCELLED', note: 'Tenant left' }).expect(200);
    expect(await pending()).toHaveLength(0);
    // Sale agreements get none.
    expect((await draft(owner, { kind: 'SALE', clientId: client._id, endDate: inDays(60) })).renewalFollowUpIds).toHaveLength(0);
    expect((await request(app).post('/api/agreements').set(auth).send({ kind: 'RENT', clientId: client._id, startDate: inDays(5), endDate: inDays(1) })).status).toBe(400);
  });

  it('permission templates: agents draft and edit, accountants and viewers read only; templates need templates:manage', async () => {
    const owner = await registerOwner(app);
    const [agent, accountant, viewer] = await Promise.all([member(owner, 'AGENT'), member(owner, 'ACCOUNTANT'), member(owner, 'VIEWER')]);
    const client = await createClient(app, owner);
    const a = await draft(agent, { kind: 'SALE', clientId: client._id });
    expect((await request(app).patch(`/api/agreements/${a._id}`).set(bearer(agent.accessToken)).send({ title: 'Sale' })).status).toBe(200);
    expect((await request(app).delete(`/api/agreements/${a._id}`).set(bearer(agent.accessToken))).status).toBe(403);
    expect((await request(app).post('/api/agreement-templates').set(bearer(agent.accessToken)).send({ name: 'Mine', kind: 'OTHER', language: 'en', body: 'Custom agreement for {{clientName}} dated {{date}}.' })).status).toBe(403);
    for (const s of [accountant, viewer]) {
      expect((await request(app).get(`/api/agreements/${a._id}`).set(bearer(s.accessToken))).status).toBe(200);
      expect((await request(app).post('/api/agreements').set(bearer(s.accessToken)).send({ kind: 'SALE', clientId: client._id })).status).toBe(403);
      expect((await request(app).post(`/api/agreements/${a._id}/status`).set(bearer(s.accessToken)).send({ status: 'SENT' })).status).toBe(403);
    }
    // Owner: custom template (built-ins can't be edited, only copied / archived).
    const auth = bearer(owner.accessToken);
    const custom = await request(app).post('/api/agreement-templates').set(auth).send({ name: 'Parking space', kind: 'OTHER', language: 'en', body: 'PARKING AGREEMENT\nFor {{clientName}} at {{propertyAddress}} for {{monthlyRent}}.' });
    expect(custom.status).toBe(201);
    const builtIn = (await request(app).get('/api/agreement-templates?kind=SALE&language=en').set(auth)).body.data[0];
    expect((await request(app).patch(`/api/agreement-templates/${builtIn._id}`).set(auth).send({ body: 'changed text that is long enough' })).status).toBe(400);
    const parking = await draft(owner, { kind: 'OTHER', templateId: custom.body.data._id, clientId: client._id, monthlyRent: 5_000 });
    expect(parking.versions[0].body).toBe(`PARKING AGREEMENT\nFor ${client.fullName} at ${AGREEMENT_BLANK} for Rs 5,000.`);
    expect((await request(app).get('/api/exports/agreements?format=xlsx').set(bearer(accountant.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/dashboard').set(auth)).body.data.agreements).toMatchObject({ drafts: 2 });
  });

  it('keeps agreements inside their business and branch; syncs offline drafts once (rendered on arrival)', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const client = await createClient(app, a);
    const ag = await draft(a, { kind: 'SALE', clientId: client._id });
    expect((await request(app).get(`/api/agreements/${ag._id}`).set(bearer(b.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/agreements/${ag._id}/pdf`).set(bearer(b.accessToken))).status).toBe(404);
    expect((await request(app).post('/api/agreements').set(bearer(b.accessToken)).send({ kind: 'SALE', clientId: client._id })).status).toBe(400);
    const clifton = (await request(app).post('/api/branches').set(bearer(a.accessToken)).send({ name: 'Clifton' })).body.data;
    const restricted = await addActiveMember(app, a, { permissions: [...ROLE_PRESETS.MANAGER], branchAccess: 'SELECTED', branchIds: [clifton._id] });
    expect((await request(app).get(`/api/agreements/${ag._id}`).set(bearer(restricted.accessToken))).status).toBe(404);

    const uuid = randomUUID();
    const m = { mutationId: randomUUID(), entity: 'agreements', op: 'create', uuid, data: { kind: 'RENT', clientId: client.uuid, monthlyRent: 60_000, startDate: inDays(0), endDate: inDays(365) } };
    const push = await request(app).post('/api/sync/push').set(bearer(a.accessToken)).send({ mutations: [m] });
    expect(push.body.data.results[0].status).toBe('applied');
    await request(app).post('/api/sync/push').set(bearer(a.accessToken)).send({ mutations: [{ ...m, mutationId: randomUUID() }] });
    // Status change from a phone (protected field: sent with its base version).
    const record = push.body.data.results[0].record;
    const sent = await request(app).post('/api/sync/push').set(bearer(a.accessToken)).send({ mutations: [{ mutationId: randomUUID(), entity: 'agreements', op: 'update', uuid, baseVersion: record.version, data: { status: 'SENT' } }] });
    expect(sent.body.data.results[0].status).toBe('applied');
    const pulled = (await request(app).get('/api/sync/pull').set(bearer(a.accessToken))).body.data.changes;
    const mine = pulled.agreements.filter((x: { uuid: string }) => x.uuid === uuid);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'SENT', agreementNo: 'AG-000002' });
    expect(mine[0].versions[0].body).toContain('TENANCY AGREEMENT');
    expect(pulled.agreementTemplates.length).toBeGreaterThanOrEqual(6);
  });
});
