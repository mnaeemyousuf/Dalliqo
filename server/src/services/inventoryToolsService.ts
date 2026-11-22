import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import { Types } from 'mongoose';
import { ERROR_CODES, LISTING_PURPOSES, PROPERTY_TYPES, SIZE_UNITS, type ListingPurpose, type PropertyType, type SizeUnit } from '@recrm/shared';
import { env } from '../config/env';
import { SavedView, type SavedViewDoc, type SavedViewPage } from '../models/SavedView';
import { ownerRepository, propertyRepository } from '../repositories/entityRepositories';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext, TenantContext } from '../types/context';
import { badRequest, notFound } from '../utils/AppError';
import { activityService } from './activityService';
import { auditService } from './auditService';
import { propertyService } from './propertyService';
import { tenantService } from './tenantService';

/** Property Excel import, property QR codes and saved list views. */

export const PROPERTY_IMPORT_COLUMNS = [
  { key: 'propertyType', header: 'Type', required: true },
  { key: 'listingPurpose', header: 'Purpose (SALE/RENT)' },
  { key: 'society', header: 'Society' },
  { key: 'phase', header: 'Phase' },
  { key: 'block', header: 'Block' },
  { key: 'plotNumber', header: 'Plot no.' },
  { key: 'area', header: 'Area' },
  { key: 'city', header: 'City' },
  { key: 'size', header: 'Size', required: true },
  { key: 'sizeUnit', header: 'Unit (MARLA/KANAL/SQ_YARD/SQ_FT/ACRE)', required: true },
  { key: 'askingPrice', header: 'Asking price (PKR)', required: true },
  { key: 'bedrooms', header: 'Bedrooms' },
  { key: 'bathrooms', header: 'Bathrooms' },
  { key: 'ownerName', header: 'Owner name' },
  { key: 'ownerMobile', header: 'Owner mobile' },
  { key: 'description', header: 'Description' },
] as const;

const MAX_ROWS = 2000;
const UNIT_ALIASES: Record<string, SizeUnit> = { MARLA: 'MARLA', MARLAS: 'MARLA', KANAL: 'KANAL', KANALS: 'KANAL', SQYD: 'SQ_YARD', SQ_YARD: 'SQ_YARD', YARD: 'SQ_YARD', YARDS: 'SQ_YARD', SQFT: 'SQ_FT', SQ_FT: 'SQ_FT', FT: 'SQ_FT', ACRE: 'ACRE', ACRES: 'ACRE', SQ_METER: 'SQ_METER' };

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text).trim();
  if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result).trim();
  return String(v).trim();
};
const num = (v?: string) => {
  if (!v) return undefined;
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const inventoryToolsService = {
  async propertyTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Properties');
    ws.columns = PROPERTY_IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.addRow({ propertyType: 'HOUSE', listingPurpose: 'SALE', society: 'DHA Lahore', phase: 'Phase 6', block: 'C', plotNumber: '123', size: 1, sizeUnit: 'KANAL', askingPrice: 85_000_000, bedrooms: 5, ownerName: 'Haji Rasheed', ownerMobile: '03214445566' });
    const help = wb.addWorksheet('Allowed values');
    help.addRow(['Type', PROPERTY_TYPES.join(', ')]);
    help.addRow(['Purpose', LISTING_PURPOSES.join(', ')]);
    help.addRow(['Unit', SIZE_UNITS.join(', ')]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  },

  /**
   * Imports listings. Each row goes through the normal create path (validation, duplicate-plot check,
   * matching); owners are matched by mobile number or created. Problems are reported per row.
   */
  async importProperties(auth: AuthContext, buffer: Buffer, opts: { agentId?: string } = {}) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as never);
    } catch {
      throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The file is not a valid Excel (.xlsx) workbook');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'The workbook has no sheets');
    if (ws.rowCount - 1 > MAX_ROWS) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `Import at most ${MAX_ROWS} rows at a time`);
    if (opts.agentId && !(await memberRepository.isActiveMemberUser(auth, opts.agentId))) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Agent is not an active member');
    const headers: Record<number, string> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const h = cellText(cell.value).toLowerCase();
      const def = PROPERTY_IMPORT_COLUMNS.find((c) => c.header.toLowerCase() === h || c.key.toLowerCase() === h || c.header.toLowerCase().startsWith(h));
      if (def) headers[col] = def.key;
    });
    for (const req of PROPERTY_IMPORT_COLUMNS.filter((c) => 'required' in c && c.required)) {
      if (!Object.values(headers).includes(req.key)) throw badRequest(ERROR_CODES.VALIDATION_ERROR, `The sheet needs a "${req.header}" column`);
    }
    const { normalizePhone } = await import('../utils/phone');
    const result = { created: 0, duplicates: [] as { row: number; existing: string }[], errors: [] as { row: number; message: string }[] };
    for (let r = 2; r <= ws.rowCount; r++) {
      const v: Record<string, string> = {};
      ws.getRow(r).eachCell((cell, col) => {
        if (headers[col]) v[headers[col]] = cellText(cell.value);
      });
      if (!Object.values(v).some(Boolean)) continue;
      const type = (v.propertyType ?? '').toUpperCase().replace(/[\s/-]+/g, '_') as PropertyType;
      const unit = UNIT_ALIASES[(v.sizeUnit ?? '').toUpperCase().replace(/[\s.]+/g, '_').replace(/^SQ_?/, 'SQ_')] ?? UNIT_ALIASES[(v.sizeUnit ?? '').toUpperCase().replace(/[^A-Z]/g, '')];
      const purpose = ((v.listingPurpose || 'SALE').toUpperCase() as ListingPurpose);
      const size = num(v.size);
      const price = num(v.askingPrice);
      if (!(PROPERTY_TYPES as readonly string[]).includes(type)) {
        result.errors.push({ row: r, message: `Unknown type "${v.propertyType ?? ''}"` });
        continue;
      }
      if (!unit || !size || !price) {
        result.errors.push({ row: r, message: 'Size, unit and asking price are required' });
        continue;
      }
      try {
        let ownerId: string | undefined;
        const ownerMobile = v.ownerMobile ? normalizePhone(v.ownerMobile.replace(/^(\d{10})$/, '0$1')) : null;
        if (ownerMobile) {
          const existing = await ownerRepository.findOne(auth, { mobileNumber: ownerMobile });
          if (existing) ownerId = existing._id.toString();
          else if (v.ownerName && v.ownerName.length >= 2) {
            const { ownerService } = await import('./ownerService');
            ownerId = (await ownerService.create(auth, { fullName: v.ownerName.slice(0, 120), mobileNumber: ownerMobile }))._id.toString();
          }
        }
        await propertyService.create(auth, {
          propertyType: type,
          listingPurpose: (LISTING_PURPOSES as readonly string[]).includes(purpose) ? purpose : 'SALE',
          society: v.society?.slice(0, 120) || undefined,
          phase: v.phase?.slice(0, 60) || undefined,
          block: v.block?.slice(0, 60) || undefined,
          plotNumber: v.plotNumber?.slice(0, 60) || undefined,
          area: v.area?.slice(0, 120) || undefined,
          city: v.city?.slice(0, 80) || undefined,
          size,
          sizeUnit: unit,
          askingPrice: Math.round(price),
          bedrooms: num(v.bedrooms) ? Math.round(num(v.bedrooms)!) : undefined,
          bathrooms: num(v.bathrooms) ? Math.round(num(v.bathrooms)!) : undefined,
          description: v.description?.slice(0, 5000) || undefined,
          ownerId,
          agentIds: opts.agentId ? [opts.agentId] : undefined,
        });
        result.created++;
      } catch (err) {
        const e = err as { code?: string; details?: { duplicates?: { propertyId: string }[] }; message: string };
        if (e.code === ERROR_CODES.PROPERTY_DUPLICATE) result.duplicates.push({ row: r, existing: e.details?.duplicates?.[0]?.propertyId ?? '' });
        else result.errors.push({ row: r, message: e.message });
      }
    }
    await activityService.record(auth, 'PROPERTIES_IMPORTED', `${result.created} properties imported from Excel`, []);
    await auditService.record(auth, { action: 'property.imported', entityType: 'property', entityLabel: `${result.created} imported`, changes: [{ field: 'imported', oldValue: null, newValue: { created: result.created, duplicates: result.duplicates.length, errors: result.errors.length } }] });
    return result;
  },

  /** QR code (PNG) pointing at the property in Stateown — for signboards, files and brochures. */
  async propertyQr(ctx: TenantContext, id: string): Promise<{ png: Buffer; url: string; fileName: string }> {
    const p = await propertyRepository.getById(ctx, id, 'Property not found');
    const url = `${await tenantService.urlForBusiness(ctx.businessId)}/properties/${p._id}`;
    const png = await QRCode.toBuffer(url, { margin: 2, width: 600, errorCorrectionLevel: 'M' });
    return { png, url, fileName: `${p.propertyId}-qr.png` };
  },

  // ── Saved views ──

  listViews(ctx: TenantContext, page: SavedViewPage) {
    return SavedView.find({ businessId: ctx.businessId, page, $or: [{ userId: ctx.userId }, { shared: true }] }).sort({ name: 1 }).lean<SavedViewDoc[]>();
  },

  async createView(ctx: TenantContext, input: { page: SavedViewPage; name: string; params: Record<string, string>; shared?: boolean }) {
    const count = await SavedView.countDocuments({ businessId: ctx.businessId, userId: ctx.userId, page: input.page });
    if (count >= 30) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'You can keep up to 30 views per page');
    const params = Object.fromEntries(Object.entries(input.params).filter(([k, v]) => v !== '' && k !== 'page'));
    const doc = await SavedView.create({ businessId: ctx.businessId, userId: ctx.userId, page: input.page, name: input.name, params, shared: !!input.shared, createdBy: ctx.userId, updatedBy: ctx.userId });
    return doc.toObject();
  },

  async removeView(ctx: TenantContext, id: string) {
    const res = await SavedView.deleteOne({ businessId: ctx.businessId, _id: new Types.ObjectId(id), userId: ctx.userId });
    if (!res.deletedCount) throw notFound(ERROR_CODES.NOT_FOUND, 'View not found');
  },
};
