import type { Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { AGREEMENT_LABELS, BRAND, ERROR_CODES } from '@recrm/shared';
import { logger } from '../config/logger';
import { Business } from '../models/Business';
import { PropertyMedia } from '../models/FileAsset';
import type { PropertyDoc } from '../models/Property';
import { User } from '../models/User';
import { propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext } from '../types/context';
import { badRequest } from '../utils/AppError';
import { auditService } from './auditService';
import { pdfParagraph, pdfText, registerUrduFonts } from './pdf/pdfText';
import { svgFontsAvailable, svgText } from './pdf/svgText';
import { storage, LocalStorage } from './storage/storage';

export type BrochureFormat = 'pdf' | 'png' | 'text';
export type BrochureLanguage = 'en' | 'ur';
export interface BrochureOptions {
  format: BrochureFormat;
  lang: BrochureLanguage;
  /** Leave the asking price off (owner's request, negotiation). */
  hidePrice?: boolean;
  /** Member whose contact (and WhatsApp QR) is printed; defaults to the requester. */
  agentId?: string;
}

const L = {
  en: {
    SALE: 'for sale', RENT: 'for rent', price: 'Price', rent: 'Rent / month', priceOnRequest: 'Price on request', size: 'Size', location: 'Location',
    beds: 'Bedrooms', baths: 'Bathrooms', floors: 'Floors', ref: 'Ref', contact: 'Contact', scan: 'Scan to chat on WhatsApp', type: 'Type', details: 'Details',
  },
  ur: {
    SALE: 'برائے فروخت', RENT: 'برائے کرایہ', price: 'قیمت', rent: 'کرایہ ماہانہ', priceOnRequest: 'قیمت رابطہ پر', size: 'رقبہ', location: 'مقام',
    beds: 'بیڈروم', baths: 'باتھ روم', floors: 'منزلیں', ref: 'حوالہ', contact: 'رابطہ', scan: 'واٹس ایپ پر بات کرنے کے لیے اسکین کریں', type: 'قسم', details: 'تفصیلات',
  },
} as const;

/** "PKR 2.55 Crore" / "2.55 کروڑ روپے". */
export function brochurePrice(n: number, lang: BrochureLanguage): string {
  const fmt = (v: number) => String(+v.toFixed(2));
  if (lang === 'ur') {
    if (n >= 10_000_000) return `${fmt(n / 10_000_000)} کروڑ روپے`;
    if (n >= 100_000) return `${fmt(n / 100_000)} لاکھ روپے`;
    return `${Math.round(n).toLocaleString('en-PK')} روپے`;
  }
  if (n >= 10_000_000) return `PKR ${fmt(n / 10_000_000)} Crore`;
  if (n >= 100_000) return `PKR ${fmt(n / 100_000)} Lakh`;
  return `PKR ${Math.round(n).toLocaleString('en-PK')}`;
}

/** Pakistani mobile → wa.me digits (03xx… and +92… both work). */
export function whatsappDigits(mobile?: string | null): string | null {
  const d = (mobile ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('92')) return d;
  if (d.startsWith('0')) return `92${d.slice(1)}`;
  return d.length === 10 ? `92${d}` : d;
}

const BRAND_LOGO = [join(__dirname, '../../assets/brand/dalliqo-logo-horizontal.png'), join(process.cwd(), 'assets/brand/dalliqo-logo-horizontal.png')].find((p) => existsSync(p));

interface BrochureData {
  property: PropertyDoc;
  businessName: string;
  agent: { name: string; mobile?: string };
  lang: BrochureLanguage;
  title: string;
  location: string;
  /** null when hidden: minimum and expected prices are never printed. */
  price: string | null;
  facts: [string, string][];
  description?: string;
  waUrl: string | null;
  cover: Buffer | null;
}

async function coverImage(property: PropertyDoc): Promise<Buffer | null> {
  const m = await PropertyMedia.findOne({ businessId: property.businessId, entityId: property._id, kind: 'image', deletedAt: null }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  if (!m) return null;
  try {
    const s = storage();
    if (s instanceof LocalStorage) return await s.read(m.storageKey, false);
    if (m.fileUrl?.startsWith('https://')) {
      const r = await fetch(m.fileUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    }
  } catch (err) {
    logger.warn({ err, propertyId: property._id }, 'Brochure cover image unavailable');
  }
  return null;
}

async function collect(auth: AuthContext, id: string, o: BrochureOptions): Promise<BrochureData> {
  const property = await propertyRepository.getById(auth, id, 'Property not found');
  const agentId = o.agentId ?? auth.userId;
  if (o.agentId && !(await memberRepository.isActiveMemberUser(auth, o.agentId))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Agent is not an active member of this business');
  const [business, agent, cover] = await Promise.all([
    Business.findById(auth.businessId).select('name phone').lean(),
    User.findById(agentId).select('fullName mobileNumber').lean(),
    o.format === 'text' ? Promise.resolve(null) : coverImage(property),
  ]);
  const t = L[o.lang];
  const type = (AGREEMENT_LABELS.propertyType[o.lang] as Record<string, string>)[property.propertyType] ?? property.propertyType;
  const unit = (AGREEMENT_LABELS.sizeUnit[o.lang] as Record<string, string>)[property.sizeUnit] ?? property.sizeUnit;
  const purpose = t[property.listingPurpose as 'SALE' | 'RENT'] ?? '';
  const typeLabel = o.lang === 'en' ? type.charAt(0).toUpperCase() + type.slice(1) : type;
  const location = [property.block, property.society ?? property.area, property.city].filter(Boolean).join(', ');
  const facts: [string, string][] = [
    [t.type, typeLabel],
    [t.size, `${property.size} ${unit}`],
    ...(property.bedrooms ? [[t.beds, String(property.bedrooms)] as [string, string]] : []),
    ...(property.bathrooms ? [[t.baths, String(property.bathrooms)] as [string, string]] : []),
    ...(property.floors ? [[t.floors, String(property.floors)] as [string, string]] : []),
    [t.ref, property.propertyId],
  ];
  const digits = whatsappDigits(agent?.mobileNumber ?? business?.phone);
  const hello = o.lang === 'ur' ? `السلام علیکم، مجھے ${property.propertyId} میں دلچسپی ہے۔` : `Hi, I'm interested in ${property.propertyId}.`;
  return {
    property,
    businessName: business?.name ?? BRAND.name,
    agent: { name: agent?.fullName ?? '', mobile: agent?.mobileNumber ?? business?.phone },
    lang: o.lang,
    title: o.lang === 'ur' ? `${type} ${purpose}` : `${typeLabel} ${purpose}`,
    location,
    // Only the asking price is ever printed; minimum / expected final prices are confidential.
    price: o.hidePrice || !property.askingPrice ? null : `${property.listingPurpose === 'RENT' ? t.rent : t.price}: ${brochurePrice(property.askingPrice, o.lang)}`,
    facts,
    description: property.description?.trim() || undefined,
    waUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(hello)}` : null,
    cover,
  };
}

function shareText(d: BrochureData): string {
  const t = L[d.lang];
  const lines = [
    `🏠 ${d.title}${d.location ? ` — ${d.location}` : ''}`,
    d.facts.filter(([k]) => k !== t.type && k !== t.ref).map(([k, v]) => `${k}: ${v}`).join(' · '),
    d.price ?? t.priceOnRequest,
    `${t.ref}: ${d.property.propertyId}`,
    d.agent.name ? `${t.contact}: ${d.agent.name}${d.agent.mobile ? ` ${d.agent.mobile}` : ''}` : '',
    d.waUrl ?? '',
  ];
  return lines.filter(Boolean).join('\n');
}

async function writePdf(d: BrochureData, out: Writable): Promise<void> {
  const qr = d.waUrl ? await QRCode.toBuffer(d.waUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) : null;
  const cover = d.cover ? await sharp(d.cover).rotate().resize(1200, 760, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer().catch(() => null) : null;
  const rtl = d.lang === 'ur';
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${d.property.propertyId} — ${d.title}`, Author: d.businessName, Creator: BRAND.name } });
    doc.on('error', reject);
    out.on('finish', () => resolve());
    out.on('error', reject);
    registerUrduFonts(doc);
    doc.pipe(out);
    const left = 40;
    const width = doc.page.width - 80;
    doc.rect(0, 0, doc.page.width, 64).fill(BRAND.color.primary['700']);
    doc.fillColor('#FFFFFF').fontSize(16);
    pdfText(doc, d.businessName, left, 22, { width: width - 120 }, true);
    if (BRAND_LOGO) doc.image(BRAND_LOGO, left + width - 100, 22, { height: 20 });
    let y = 80;
    if (cover) {
      doc.image(cover, left, y, { width, height: (width * 760) / 1200 });
      y += (width * 760) / 1200 + 14;
    } else {
      doc.rect(left, y, width, 120).fill(BRAND.color.primary['50']);
      y += 134;
    }
    doc.fillColor(BRAND.color.light.ink);
    doc.y = y;
    pdfParagraph(doc, d.title, left, width, { bold: true, size: 20, rtl })
    if (d.location) {
      doc.fillColor(BRAND.color.light.muted);
      pdfParagraph(doc, d.location, left, width, { size: 12, rtl })
    }
    doc.y += 4;
    doc.fillColor(BRAND.color.primary['700']);
    pdfParagraph(doc, d.price ?? L[d.lang].priceOnRequest, left, width, { bold: true, size: 16, rtl })
    doc.y += 8;
    // Details table (label | value), mirrored for Urdu.
    const rowH = 22;
    const colW = width / 2;
    d.facts.forEach(([k, v], i) => {
      const ry = doc.y;
      if (i % 2 === 0) doc.rect(left, ry, width, rowH).fill(BRAND.color.primary['50']);
      doc.fillColor(BRAND.color.light.muted).fontSize(10.5);
      const [lx, vx] = rtl ? [left + colW, left] : [left, left + colW];
      doc.y = ry + 4;
      pdfParagraph(doc, k, lx + 8, colW - 16, { size: 10.5, lineGap: 0, rtl })
      doc.fillColor(BRAND.color.light.ink);
      doc.y = ry + 4;
      pdfParagraph(doc, v, vx + 8, colW - 16, { size: 10.5, lineGap: 0, bold: true, rtl })
      doc.y = ry + rowH;
    });
    if (d.description) {
      doc.y += 12;
      doc.fillColor(BRAND.color.light.ink);
      pdfParagraph(doc, d.description.slice(0, 1200), left, width, { size: 10.5, bottom: doc.page.height - 150, rtl })
    }
    // Agent card with the WhatsApp QR, pinned to the bottom of the page.
    const cardY = doc.page.height - 140;
    doc.roundedRect(left, cardY, width, 100, 8).fill('#F4F6F8');
    if (qr) doc.image(qr, rtl ? left + 10 : left + width - 90, cardY + 10, { width: 80, height: 80 });
    const tx = rtl ? left + 100 : left + 14;
    doc.fillColor(BRAND.color.light.muted);
    doc.y = cardY + 14;
    pdfParagraph(doc, L[d.lang].contact, tx, width - 120, { size: 10, rtl })
    doc.fillColor(BRAND.color.light.ink);
    pdfParagraph(doc, d.agent.name, tx, width - 120, { size: 14, bold: true, rtl })
    if (d.agent.mobile) pdfParagraph(doc, d.agent.mobile, tx, width - 120, { size: 12, rtl })
    if (qr) {
      doc.fillColor(BRAND.color.light.muted);
      pdfParagraph(doc, L[d.lang].scan, tx, width - 120, { size: 9, rtl })
    }
    doc.end();
  });
}

/** 1080×1350 share card (Instagram / WhatsApp status size). All text is vector paths (see svgText). */
async function renderPng(d: BrochureData): Promise<Buffer> {
  if (!svgFontsAvailable()) throw new Error('Brochure fonts missing from assets/fonts');
  const W = 1080;
  const H = 1350;
  const coverH = 700;
  const pad = 64;
  const rtl = d.lang === 'ur';
  const inner = W - pad * 2;
  const primary = BRAND.color.primary['700'];
  const parts: string[] = [];
  let y = coverH + 36;
  const title = svgText(d.title, { x: pad, y, width: inner, size: 60, bold: true, color: '#111111', maxLines: 1, rtl });
  parts.push(title.svg);
  y += title.height + 2;
  if (d.location) {
    const loc = svgText(d.location, { x: pad, y, width: inner, size: 36, color: '#5B6470', maxLines: 1, rtl });
    parts.push(loc.svg);
    y += loc.height + 8;
  }
  const price = svgText(d.price ?? L[d.lang].priceOnRequest, { x: pad, y, width: inner, size: 52, bold: true, color: primary, maxLines: 1, rtl });
  parts.push(price.svg);
  y += price.height + 14;
  const facts = d.facts.filter(([k]) => k !== L[d.lang].type && k !== L[d.lang].ref).map(([k, v]) => `${k}: ${v}`).join('   ·   ');
  const f = svgText(facts, { x: pad, y, width: inner, size: 32, color: '#333333', maxLines: 2, rtl });
  parts.push(f.svg);
  y += f.height + 4;
  parts.push(svgText(`${L[d.lang].ref}: ${d.property.propertyId}`, { x: pad, y, width: inner, size: 28, color: '#5B6470', maxLines: 1, rtl }).svg);
  // Bottom band: agent + QR.
  const bandY = H - 230;
  parts.push(`<rect x="0" y="${bandY}" width="${W}" height="230" fill="${primary}"/>`);
  const qrSize = 170;
  const textX = rtl ? pad + qrSize + 30 : pad;
  const textW = inner - qrSize - 30;
  parts.push(svgText(d.agent.name || d.businessName, { x: textX, y: bandY + 36, width: textW, size: 44, bold: true, color: '#FFFFFF', maxLines: 1 }).svg);
  if (d.agent.mobile) parts.push(svgText(d.agent.mobile, { x: textX, y: bandY + 98, width: textW, size: 36, color: '#FFFFFF', maxLines: 1 }).svg);
  parts.push(svgText(d.businessName, { x: textX, y: bandY + 152, width: textW, size: 28, color: '#D7E3FF', maxLines: 1 }).svg);
  // Purpose ribbon on the photo.
  const ribbon = svgText(L[d.lang][d.property.listingPurpose as 'SALE' | 'RENT'] ?? '', { x: rtl ? W - pad - 300 : pad, y: 48, width: 300, size: 34, bold: true, color: '#FFFFFF', align: 'center', maxLines: 1 });
  parts.push(`<rect x="${rtl ? W - pad - 300 : pad}" y="36" width="300" height="70" rx="35" fill="${primary}"/>`, ribbon.svg);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;

  const layers: sharp.OverlayOptions[] = [];
  const cover = d.cover ? await sharp(d.cover).rotate().resize(W, coverH, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer().catch(() => null) : null;
  if (cover) layers.push({ input: cover, top: 0, left: 0 });
  else layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${coverH}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.color.primary['600']}"/><stop offset="1" stop-color="${BRAND.color.primary['800'] ?? primary}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`), top: 0, left: 0 });
  layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  if (d.waUrl) {
    const qr = await QRCode.toBuffer(d.waUrl, { margin: 1, width: qrSize, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
    layers.push({ input: qr, top: bandY + 30, left: rtl ? pad : W - pad - qrSize });
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: '#FFFFFF' } }).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

export const brochureService = {
  /** Returns the share text, or streams a PDF / PNG into `out`. */
  async generate(auth: AuthContext, id: string, o: BrochureOptions, out?: Writable): Promise<{ fileName: string; contentType: string; text?: string; whatsappUrl?: string | null }> {
    const d = await collect(auth, id, o);
    await auditService.record(auth, { action: 'property.brochure_generated', entityType: 'property', entityId: d.property._id, entityLabel: d.property.propertyId, meta: { format: o.format, lang: o.lang, hidePrice: !!o.hidePrice, agentId: o.agentId ?? auth.userId } });
    const base = `${d.property.propertyId}-brochure-${o.lang}`;
    if (o.format === 'text') {
      const text = shareText(d);
      return { fileName: `${base}.txt`, contentType: 'application/json', text, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}` };
    }
    if (o.format === 'png') {
      const png = await renderPng(d);
      out?.end(png);
      return { fileName: `${base}.png`, contentType: 'image/png' };
    }
    if (out) await writePdf(d, out);
    return { fileName: `${base}.pdf`, contentType: 'application/pdf' };
  },
};
