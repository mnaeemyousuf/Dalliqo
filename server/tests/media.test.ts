import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../src/app';
import { signLocal } from '../src/services/storage/storage';
import { createClient, createProperty } from './support/crm';
import { bearer, registerOwner } from './support/helpers';

const app = createApp();

const png = (w = 3000, h = 2000) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
// Minimal valid PDF.
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);
/** Turns an absolute file URL from the API into a path supertest can request. */
const path = (url: string) => new URL(url).pathname + new URL(url).search;

describe('property media', () => {
  it('compresses images, generates thumbnails, and sets the first image as cover', async () => {
    const s = await registerOwner(app);
    const p = await createProperty(app, s);
    const res = await request(app)
      .post(`/api/properties/${p._id}/media`)
      .set(bearer(s.accessToken))
      .attach('files', await png(), { filename: 'front.png', contentType: 'image/png' })
      .attach('files', await png(800, 600), { filename: '../../evil<name>.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    const [first, second] = res.body.data;
    expect(first).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', width: 2048, height: 1365, sortOrder: 0, isPrivate: false });
    expect(second.fileName).toBe('evilname.png');
    expect(first.thumbnailUrl).toMatch(/-thumb\.jpg$/);

    const img = await request(app).get(path(first.fileUrl));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    const thumb = await request(app).get(path(first.thumbnailUrl));
    expect((await sharp(thumb.body).metadata()).width).toBe(480);

    const property = await request(app).get(`/api/properties/${p._id}`).set(bearer(s.accessToken));
    expect(property.body.data.coverImageUrl).toBe(first.fileUrl);

    await request(app).patch(`/api/media/${second._id}`).set(bearer(s.accessToken)).send({ setCover: true }).expect(200);
    expect((await request(app).get(`/api/properties/${p._id}`).set(bearer(s.accessToken))).body.data.coverImageUrl).toBe(second.fileUrl);
    await request(app).delete(`/api/media/${second._id}`).set(bearer(s.accessToken)).expect(200);
    expect((await request(app).get(`/api/properties/${p._id}`).set(bearer(s.accessToken))).body.data.coverImageUrl).toBe(first.fileUrl);
    expect((await request(app).get(path(second.fileUrl))).status).toBe(404);
  });

  it('rejects files whose content is not an allowed type, whatever the extension says', async () => {
    const s = await registerOwner(app);
    const p = await createProperty(app, s);
    const res = await request(app)
      .post(`/api/properties/${p._id}/media`)
      .set(bearer(s.accessToken))
      .attach('files', Buffer.from('<script>alert(1)</script>'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FILE');
    const asPdf = await request(app)
      .post(`/api/properties/${p._id}/media`)
      .set(bearer(s.accessToken))
      .attach('files', pdf, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(asPdf.status).toBe(400);
  });

  it('cannot upload to another business’s property', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const p = await createProperty(app, b);
    const res = await request(app).post(`/api/properties/${p._id}/media`).set(bearer(a.accessToken)).attach('files', await png(10, 10), 'x.png');
    expect(res.status).toBe(404);
  });
});

describe('documents', () => {
  it('stores documents privately and serves them only through short-lived signed links', async () => {
    const s = await registerOwner(app);
    const c = await createClient(app, s);
    const up = await request(app)
      .post('/api/documents')
      .set(bearer(s.accessToken))
      .field('entityType', 'client')
      .field('entityId', c._id)
      .field('category', 'IDENTITY')
      .attach('file', pdf, { filename: 'CNIC copy.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ kind: 'pdf', category: 'IDENTITY', isPrivate: true, fileName: 'CNIC copy.pdf' });
    expect(up.body.data.fileUrl).toBeUndefined();

    const link = await request(app).get(`/api/documents/${up.body.data._id}/download`).set(bearer(s.accessToken));
    expect(link.status).toBe(200);
    const file = await request(app).get(path(link.body.data.url));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('private, no-store');

    // Tampered and expired links are refused.
    const key = up.body.data.storageKey;
    expect((await request(app).get(`/api/files/private/${key}?exp=9999999999&sig=forged`)).status).toBe(403);
    const past = Math.floor(Date.now() / 1000) - 10;
    expect((await request(app).get(`/api/files/private/${key}?exp=${past}&sig=${signLocal(key, past)}`)).status).toBe(403);
    // The public route never serves private files.
    expect((await request(app).get(`/api/files/public/${key}`)).status).toBe(404);

    const list = await request(app).get(`/api/documents?entityType=client&entityId=${c._id}`).set(bearer(s.accessToken));
    expect(list.body.data).toHaveLength(1);
    await request(app).patch(`/api/documents/${up.body.data._id}`).set(bearer(s.accessToken)).send({ fileName: 'CNIC.pdf', category: 'OWNERSHIP' }).expect(200);
    await request(app).delete(`/api/documents/${up.body.data._id}`).set(bearer(s.accessToken)).expect(200);
    expect((await request(app).get(path(link.body.data.url))).status).toBe(404);

    const acts = await request(app).get(`/api/activities?entityId=${c._id}`).set(bearer(s.accessToken));
    expect(acts.body.data.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['DOCUMENT_UPLOADED', 'DOCUMENT_DELETED']));
  });

  it('rejects executables and documents for records in other businesses', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const c = await createClient(app, b);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
    const own = await createClient(app, a);
    const bad = await request(app).post('/api/documents').set(bearer(a.accessToken)).field('entityType', 'client').field('entityId', own._id).attach('file', exe, 'setup.pdf');
    expect(bad.status).toBe(400);
    const cross = await request(app).post('/api/documents').set(bearer(a.accessToken)).field('entityType', 'client').field('entityId', c._id).attach('file', pdf, 'x.pdf');
    expect(cross.status).toBe(400);
    expect(cross.body.code).toBe('ENTITY_NOT_FOUND');
  });
});
