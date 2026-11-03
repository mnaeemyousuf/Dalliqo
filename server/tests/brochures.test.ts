import request from 'supertest';
import sharp from 'sharp';
import { ROLE_PRESETS } from '@recrm/shared';
import { createApp } from '../src/app';
import { brochurePrice, whatsappDigits } from '../src/services/brochureService';
import { AuditLog } from '../src/models/AuditLog';
import { createProperty } from './support/crm';
import { addActiveMember, bearer, registerOwner } from './support/helpers';

const app = createApp();

/** Collects a binary response body as a Buffer. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('brochures', () => {
  it('formats prices the Pakistani way and builds WhatsApp numbers', () => {
    expect(brochurePrice(25_500_000, 'en')).toBe('PKR 2.55 Crore');
    expect(brochurePrice(4_500_000, 'ur')).toBe('45 لاکھ روپے');
    expect(brochurePrice(85_000, 'en')).toBe('PKR 85,000');
    expect(whatsappDigits('0300-1234567')).toBe('923001234567');
    expect(whatsappDigits('+92 321 7654321')).toBe('923217654321');
    expect(whatsappDigits('')).toBeNull();
  });

  it('share text: asking price only (never minimum / expected), hidden on request, agent WhatsApp link, Urdu', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const p = await createProperty(app, owner, { askingPrice: 25_500_000, minimumPrice: 23_000_000, expectedFinalPrice: 24_000_000, bedrooms: 4, bathrooms: 5 });
    const en = (await request(app).get(`/api/properties/${p._id}/brochure?format=text`).set(auth)).body.data;
    expect(en.text).toContain('PKR 2.55 Crore');
    expect(en.text).toContain(p.propertyId);
    expect(en.text).toContain('Bedrooms: 4');
    expect(en.text).not.toMatch(/2\.3 Crore|2\.4 Crore|23,000,000|24,000,000/);
    expect(en.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);

    const hidden = (await request(app).get(`/api/properties/${p._id}/brochure?format=text&hidePrice=true`).set(auth)).body.data;
    expect(hidden.text).toContain('Price on request');
    expect(hidden.text).not.toContain('Crore');

    const ur = (await request(app).get(`/api/properties/${p._id}/brochure?format=text&lang=ur`).set(auth)).body.data;
    expect(ur.text).toContain('2.55 کروڑ روپے');
    expect(ur.text).toContain('برائے');
  });

  it('PDF in both languages and a 1080×1350 PNG; audited', async () => {
    const owner = await registerOwner(app);
    const auth = bearer(owner.accessToken);
    const p = await createProperty(app, owner, { askingPrice: 9_000_000, description: 'Corner house, park facing.' });
    for (const lang of ['en', 'ur']) {
      const pdf = await request(app).get(`/api/properties/${p._id}/brochure?format=pdf&lang=${lang}`).set(auth).buffer(true).parse(binary);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    const png = await request(app).get(`/api/properties/${p._id}/brochure?format=png&lang=ur`).set(auth).buffer(true).parse(binary);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toContain(`${p.propertyId}-brochure-ur.png`);
    const meta = await sharp(png.body as Buffer).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, 'png']);
    expect(await AuditLog.countDocuments({ businessId: owner.businessId, action: 'property.brochure_generated' })).toBe(3);
  });

  it('needs properties:read + exports:create, stays inside the business, and only prints active members as the agent', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const p = await createProperty(app, a);
    const agent = await addActiveMember(app, a, { permissions: [...ROLE_PRESETS.AGENT] });
    const viewer = await addActiveMember(app, a, { permissions: [...ROLE_PRESETS.VIEWER] });
    expect((await request(app).get(`/api/properties/${p._id}/brochure?format=text`).set(bearer(b.accessToken))).status).toBe(404);
    // The Agent template has no exports:create (brochures are an export).
    const agentRes = await request(app).get(`/api/properties/${p._id}/brochure?format=text`).set(bearer(agent.accessToken));
    expect(agentRes.status).toBe(ROLE_PRESETS.AGENT.includes('exports:create') ? 200 : 403);
    expect((await request(app).get(`/api/properties/${p._id}/brochure?format=text`).set(bearer(viewer.accessToken))).status).toBe(403);
    expect((await request(app).get(`/api/properties/${p._id}/brochure?format=text&agentId=${b.userId}`).set(bearer(a.accessToken))).status).toBe(400);
    const withAgent = await request(app).get(`/api/properties/${p._id}/brochure?format=text&agentId=${agent.userId}`).set(bearer(a.accessToken));
    expect(withAgent.status).toBe(200);
    expect(withAgent.body.data.text).toContain('Ahmed Yousuf');
  });
});
