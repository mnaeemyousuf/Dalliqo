import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { ERROR_CODES, BRAND } from '@recrm/shared';
import { Business } from '../models/Business';
import { ClientCategory } from '../models/ClientCategory';
import { User } from '../models/User';
import { memberRepository } from '../repositories/memberRepository';
import type { AuthContext } from '../types/context';
import { AppError } from '../utils/AppError';
import { formatPkr } from '../utils/text';
import { clientService, type ClientQuery } from './clientService';
import { followUpService, type FollowUpQuery } from './followUpService';
import { matchingService } from './matching/matchingService';
import { ownerService } from './ownerService';
import { propertyService, type PropertyQuery } from './propertyService';
import { auditService } from './auditService';
import { MAX_EXPORT_ROWS as MAX_ROWS } from '../constants';

export type ExportResource = 'clients' | 'properties' | 'owners' | 'followups' | 'matches';
export type ExportFormat = 'xlsx' | 'pdf';


interface Column {
  header: string;
  key: string;
  width: number;
  /** Relative width in the PDF table. */
  pdf?: number;
  money?: boolean;
}

type Row = Record<string, string | number | null | undefined>;

const label = (v?: string | null) => (v ? v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '');
const date = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const dateTime = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '');
const range = (a?: number | null, b?: number | null, money = false) => {
  const f = (n?: number | null) => (n === undefined || n === null ? '' : money ? formatPkr(n).replace('PKR ', '') : String(n));
  return a || b ? `${f(a)} – ${f(b)}` : '';
};

async function fetchAll<T>(fetch: (page: number, limit: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const first = await fetch(1, 500);
  if (first.total > MAX_ROWS) {
    throw new AppError(413, ERROR_CODES.EXPORT_TOO_LARGE, `Too many rows (${first.total}). Narrow the filters to ${MAX_ROWS} or fewer.`);
  }
  const all = [...first.items];
  for (let page = 2; all.length < first.total; page++) {
    const next = await fetch(page, 500);
    if (!next.items.length) break;
    all.push(...next.items);
  }
  return all;
}

async function build(auth: AuthContext, resource: ExportResource, filters: Record<string, unknown>): Promise<{ title: string; columns: Column[]; rows: Row[] }> {
  // Only this business's members, never the global users collection.
  const memberIds = await memberRepository.activeUserIds(auth);
  const userNames = new Map((await User.find({ _id: { $in: memberIds } }).select('fullName').lean()).map((u) => [u._id.toString(), u.fullName]));
  switch (resource) {
    case 'clients': {
      const cats = new Map((await ClientCategory.find({ businessId: auth.businessId }).lean()).map((c) => [c._id.toString(), c.name]));
      const items = await fetchAll((page, limit) => clientService.list(auth, { ...(filters as Partial<ClientQuery>), page, limit }));
      return {
        title: 'Clients',
        columns: [
          { header: 'Name', key: 'name', width: 24, pdf: 3 },
          { header: 'Mobile', key: 'mobile', width: 16, pdf: 2 },
          { header: 'WhatsApp', key: 'whatsapp', width: 16 },
          { header: 'Email', key: 'email', width: 24 },
          { header: 'Category', key: 'category', width: 20, pdf: 2 },
          { header: 'Purpose', key: 'purpose', width: 10, pdf: 1 },
          { header: 'Property types', key: 'types', width: 22, pdf: 2 },
          { header: 'Area / Society', key: 'location', width: 26, pdf: 3 },
          { header: 'Budget (PKR)', key: 'budget', width: 22, pdf: 2 },
          { header: 'Size', key: 'size', width: 16, pdf: 1.5 },
          { header: 'Status', key: 'status', width: 12, pdf: 1.2 },
          { header: 'Priority', key: 'priority', width: 10 },
          { header: 'Assigned to', key: 'assigned', width: 18 },
          { header: 'Matches', key: 'matches', width: 9, pdf: 1 },
          { header: 'Created', key: 'created', width: 12 },
        ],
        rows: items.map((c) => ({
          name: c.fullName,
          mobile: c.mobileNumber,
          whatsapp: c.whatsappNumber,
          email: c.email,
          category: c.categoryId ? cats.get(c.categoryId.toString()) : '',
          purpose: label(c.purchaseOrRental),
          types: (c.propertyTypeRequired ?? []).map(label).join(', '),
          location: [c.preferredArea, c.preferredSociety, c.preferredBlock].filter(Boolean).join(', '),
          budget: range(c.minBudget, c.maxBudget, true),
          size: c.minSize || c.maxSize ? `${range(c.minSize, c.maxSize)} ${label(c.sizeUnit)}` : '',
          status: label(c.status),
          priority: label(c.priority),
          assigned: c.assignedTo ? userNames.get(c.assignedTo.toString()) : '',
          matches: c.matchCount,
          created: date(c.createdAt),
        })),
      };
    }
    case 'properties': {
      const items = await fetchAll((page, limit) => propertyService.list(auth, { ...(filters as Partial<PropertyQuery>), page, limit }));
      return {
        title: 'Properties',
        columns: [
          { header: 'Property ID', key: 'id', width: 13, pdf: 1.4 },
          { header: 'Type', key: 'type', width: 16, pdf: 1.6 },
          { header: 'Purpose', key: 'purpose', width: 9, pdf: 1 },
          { header: 'Status', key: 'status', width: 11, pdf: 1.2 },
          { header: 'Area', key: 'area', width: 20, pdf: 2 },
          { header: 'Society', key: 'society', width: 22, pdf: 2.2 },
          { header: 'Block', key: 'block', width: 9, pdf: 0.8 },
          { header: 'Plot / Unit', key: 'plot', width: 11 },
          { header: 'Size', key: 'size', width: 14, pdf: 1.4 },
          { header: 'Asking price', key: 'asking', width: 16, pdf: 1.6, money: true },
          { header: 'Minimum price', key: 'minimum', width: 16, money: true },
          { header: 'Negotiable', key: 'negotiable', width: 10 },
          { header: 'Owner', key: 'owner', width: 20, pdf: 2 },
          { header: 'Beds', key: 'beds', width: 6 },
          { header: 'Baths', key: 'baths', width: 6 },
          { header: 'Matches', key: 'matches', width: 9, pdf: 0.9 },
          { header: 'Map', key: 'map', width: 30 },
          { header: 'Created', key: 'created', width: 12 },
        ],
        rows: items.map((p) => {
          const owner = p.ownerId as unknown as { fullName?: string } | undefined;
          return {
            id: p.propertyId,
            type: label(p.propertyType),
            purpose: label(p.listingPurpose),
            status: label(p.status),
            area: p.area,
            society: p.society,
            block: p.block,
            plot: p.plotNumber,
            size: `${p.size} ${label(p.sizeUnit)}`,
            asking: p.askingPrice,
            minimum: p.minimumPrice,
            negotiable: p.negotiable ? 'Yes' : 'No',
            owner: owner?.fullName,
            beds: p.bedrooms,
            baths: p.bathrooms,
            matches: p.matchCount,
            map: p.googleMapsUrl,
            created: date(p.createdAt),
          };
        }),
      };
    }
    case 'owners': {
      const items = await fetchAll((page, limit) => ownerService.list(auth, { q: filters.q as string | undefined, page, limit }));
      return {
        title: 'Property owners',
        columns: [
          { header: 'Name', key: 'name', width: 26, pdf: 3 },
          { header: 'Mobile', key: 'mobile', width: 16, pdf: 2 },
          { header: 'WhatsApp', key: 'whatsapp', width: 16, pdf: 2 },
          { header: 'Email', key: 'email', width: 26, pdf: 3 },
          { header: 'Address', key: 'address', width: 34, pdf: 4 },
          { header: 'Properties', key: 'count', width: 11, pdf: 1 },
          { header: 'Created', key: 'created', width: 12, pdf: 1.4 },
        ],
        rows: items.map((o) => ({
          name: o.fullName, mobile: o.mobileNumber, whatsapp: o.whatsappNumber, email: o.email, address: o.address, count: o.propertyCount, created: date(o.createdAt),
        })),
      };
    }
    case 'followups': {
      const items = await fetchAll((page, limit) => followUpService.list(auth, { ...(filters as Partial<FollowUpQuery>), page, limit }));
      return {
        title: 'Follow-ups',
        columns: [
          { header: 'Due', key: 'due', width: 17, pdf: 1.7 },
          { header: 'Type', key: 'type', width: 15, pdf: 1.4 },
          { header: 'Client', key: 'client', width: 22, pdf: 2.2 },
          { header: 'Client mobile', key: 'mobile', width: 16, pdf: 1.7 },
          { header: 'Property', key: 'property', width: 13, pdf: 1.2 },
          { header: 'Priority', key: 'priority', width: 10, pdf: 1 },
          { header: 'Status', key: 'status', width: 11, pdf: 1.1 },
          { header: 'Assigned to', key: 'assigned', width: 18, pdf: 1.7 },
          { header: 'Notes', key: 'notes', width: 40, pdf: 3 },
          { header: 'Outcome', key: 'outcome', width: 30 },
          { header: 'Completed', key: 'completed', width: 17 },
        ],
        rows: items.map((f) => {
          const c = f.clientId as unknown as { fullName?: string; mobileNumber?: string } | undefined;
          const p = f.propertyId as unknown as { propertyId?: string } | undefined;
          const a = f.assignedTo as unknown as { fullName?: string } | undefined;
          return {
            due: dateTime(f.dueAt), type: label(f.type), client: c?.fullName, mobile: c?.mobileNumber, property: p?.propertyId,
            priority: label(f.priority), status: label(f.status), assigned: a?.fullName, notes: f.notes, outcome: f.outcome, completed: dateTime(f.completedAt),
          };
        }),
      };
    }
    case 'matches': {
      const items = await fetchAll((page, limit) => matchingService.list(auth, { ...(filters as object), page, limit }));
      return {
        title: 'Matches',
        columns: [
          { header: 'Score %', key: 'score', width: 9, pdf: 0.9 },
          { header: 'Quality', key: 'band', width: 12, pdf: 1.2 },
          { header: 'Client', key: 'client', width: 22, pdf: 2.2 },
          { header: 'Client mobile', key: 'mobile', width: 16, pdf: 1.7 },
          { header: 'Property ID', key: 'property', width: 13, pdf: 1.3 },
          { header: 'Type', key: 'type', width: 15, pdf: 1.4 },
          { header: 'Location', key: 'location', width: 26, pdf: 2.4 },
          { header: 'Price', key: 'price', width: 16, pdf: 1.6, money: true },
          { header: 'Status', key: 'status', width: 12, pdf: 1.1 },
          { header: 'Matched on', key: 'created', width: 12 },
        ],
        rows: items.map((m) => {
          const c = m.clientId as unknown as { fullName?: string; mobileNumber?: string } | undefined;
          const p = m.propertyId as unknown as { propertyId?: string; propertyType?: string; society?: string; area?: string; askingPrice?: number } | undefined;
          return {
            score: m.matchScore, band: label(m.band), client: c?.fullName, mobile: c?.mobileNumber, property: p?.propertyId, type: label(p?.propertyType),
            location: [p?.society, p?.area].filter(Boolean).join(', '), price: p?.askingPrice, status: label(m.status), created: date(m.createdAt),
          };
        }),
      };
    }
  }
}

function filterSummary(filters: Record<string, unknown>): string {
  const parts = Object.entries(filters)
    .filter(([k, v]) => v !== undefined && v !== '' && k !== 'page' && k !== 'limit')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.length ? `Filters — ${parts.join(' · ')}` : 'All records';
}

// Dalliqo branding for reports (logo generated by tools/brand from shared/brand/dalliqo.tokens.json).
const BRAND_LOGO = [join(__dirname, '../../assets/brand/dalliqo-logo-horizontal.png'), join(process.cwd(), 'assets/brand/dalliqo-logo-horizontal.png')].find((p) => existsSync(p));
const C = { primary: BRAND.color.primary['600'], primaryDark: BRAND.color.primary['700'], zebra: BRAND.color.primary['50'], muted: BRAND.color.light.muted, ink: BRAND.color.light.ink };

// Urdu (Arabic script) in PDFs: Helvetica has no Arabic glyphs, so Arabic-script runs use Noto Naskh Arabic
// (bundled, OFL). That font has no Latin letters or digits, so mixed text is written run by run.
const fontFile = (name: string) => [join(__dirname, '../../assets/fonts', name), join(process.cwd(), 'assets/fonts', name)].find((p) => existsSync(p));
const URDU_FONT = { regular: fontFile('NotoNaskhArabic-Regular.woff'), bold: fontFile('NotoNaskhArabic-Bold.woff') };
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_RUNS = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+(?:s+[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+)*)/;

type Pdf = InstanceType<typeof PDFDocument>;
function pdfFont(doc: Pdf, text: string, bold = false) {
  if (URDU_FONT.regular && ARABIC.test(text)) return doc.font(bold && URDU_FONT.bold ? 'Urdu-Bold' : 'Urdu');
  return doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
}
/**
 * Writes text that may mix Urdu and Latin on one line. Each script run is drawn whole (PDFKit's word
 * wrapper would split an Urdu phrase into left-to-right words; fontkit shapes and orders a whole run
 * correctly). Urdu-first text is right-aligned with its runs in right-to-left order. Text without
 * Arabic script keeps PDFKit's normal wrapping.
 */
function pdfText(doc: Pdf, text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions, bold = false) {
  if (!URDU_FONT.regular || !ARABIC.test(text)) {
    pdfFont(doc, text, bold).text(text, x, y, opts);
    return;
  }
  const rtl = ARABIC.test(text.trim()[0] ?? '');
  const parts = text.split(ARABIC_RUNS).map((p) => p.trim()).filter(Boolean);
  if (rtl) parts.reverse();
  const gap = doc.font('Helvetica').widthOfString(' ');
  const widths = parts.map((p) => pdfFont(doc, p, bold).widthOfString(p));
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (parts.length - 1);
  const width = opts.width ?? doc.page.width - x - doc.page.margins.right;
  let cx = rtl && total < width ? x + width - total : x;
  let lineHeight = 0;
  parts.forEach((p, i) => {
    pdfFont(doc, p, bold).text(p, cx, y, { lineBreak: false });
    lineHeight = Math.max(lineHeight, doc.currentLineHeight(true));
    cx += widths[i] + gap;
  });
  doc.x = x;
  doc.y = y + lineHeight;
}

async function writeXlsx(out: Writable, businessName: string, report: Awaited<ReturnType<typeof build>>, filters: Record<string, unknown>) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  wb.creator = BRAND.name;
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title, { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = report.columns.map((c) => ({ key: c.key, width: c.width }));
  ws.addRow([`${businessName} — ${report.title}`]).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} · ${report.rows.length} records`]).font = { color: { argb: 'FF666666' } };
  ws.addRow([filterSummary(filters)]).font = { italic: true, color: { argb: 'FF666666' } };
  const header = ws.addRow(report.columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${C.primary.slice(1)}` } };
    cell.alignment = { vertical: 'middle' };
  });
  header.commit();
  for (const r of report.rows) {
    const row = ws.addRow(report.columns.map((c) => r[c.key] ?? ''));
    report.columns.forEach((c, i) => {
      if (c.money) row.getCell(i + 1).numFmt = '#,##0';
    });
    row.commit();
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: report.columns.length } };
  ws.commit();
  await wb.commit();
}

function writePdf(out: Writable, businessName: string, report: Awaited<ReturnType<typeof build>>, filters: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: `${businessName} — ${report.title}`, Author: BRAND.name, Creator: `${BRAND.name} — ${BRAND.description}` } });
    doc.on('error', reject);
    out.on('finish', () => resolve());
    if (URDU_FONT.regular) doc.registerFont('Urdu', URDU_FONT.regular);
    if (URDU_FONT.bold) doc.registerFont('Urdu-Bold', URDU_FONT.bold);
    doc.pipe(out);

    const cols = report.columns.filter((c) => c.pdf);
    const totalWeight = cols.reduce((a, c) => a + (c.pdf ?? 1), 0);
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const widths = cols.map((c) => ((c.pdf ?? 1) / totalWeight) * tableWidth);
    const left = doc.page.margins.left;
    const bottom = doc.page.height - doc.page.margins.bottom - 20;

    const drawHeader = () => {
      let x = left;
      const y = doc.y;
      doc.rect(left, y, tableWidth, 18).fill(C.primary);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      cols.forEach((c, i) => {
        doc.text(c.header, x + 3, y + 5, { width: widths[i] - 6, ellipsis: true, lineBreak: false });
        x += widths[i];
      });
      doc.fillColor(C.ink).font('Helvetica');
      doc.y = y + 18;
    };

    if (BRAND_LOGO) doc.image(BRAND_LOGO, left + tableWidth - 110, doc.page.margins.top - 4, { height: 22 });
    doc.fillColor(C.ink).fontSize(16);
    pdfText(doc, businessName, left, doc.page.margins.top, { width: tableWidth - 130 }, true);
    doc.font('Helvetica').fontSize(12).fillColor(C.primaryDark).text(`${report.title} report`);
    doc.fillColor(C.muted).fontSize(8);
    pdfText(doc, `Generated ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} · ${report.rows.length} records · ${filterSummary(filters)}`, left, doc.y, { width: tableWidth });
    doc.fillColor(C.ink).moveDown(0.8);
    drawHeader();

    report.rows.forEach((r, idx) => {
      const values = cols.map((c) => {
        const v = r[c.key];
        if (v === undefined || v === null) return '';
        return c.money && typeof v === 'number' ? formatPkr(v).replace('PKR ', '') : String(v);
      });
      doc.fontSize(7.5);
      const height = Math.max(14, ...values.map((v, i) => (URDU_FONT.regular && ARABIC.test(v) ? pdfFont(doc, v).currentLineHeight(true) : doc.font('Helvetica').heightOfString(v, { width: widths[i] - 6 })) + 6));
      if (doc.y + height > bottom) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (idx % 2 === 1) doc.rect(left, y, tableWidth, height).fill(C.zebra).fillColor(C.ink);
      let x = left;
      values.forEach((v, i) => {
        pdfText(doc, v, x + 3, y + 3, { width: widths[i] - 6 });
        x += widths[i];
      });
      doc.y = y + height;
    });
    doc.font('Helvetica');
    if (!report.rows.length) doc.fontSize(10).fillColor(C.muted).text('No records match these filters.', left, doc.y + 10);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Write the footer inside the bottom margin; lift the margin meanwhile so PDFKit doesn't add a page.
      const bottom = doc.page.margins.bottom;
      const fy = doc.page.height - bottom + 8;
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor(C.muted).text(`Generated with ${BRAND.name} · ${BRAND.tagline}`, left, fy, { width: tableWidth / 2, lineBreak: false });
      doc.fontSize(7).fillColor(C.muted).text(`Page ${i + 1} of ${range.count}`, left, fy, { width: tableWidth, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

type Prepared = { businessName: string; report: Awaited<ReturnType<typeof build>> };

export const exportService = {
  contentType: (format: ExportFormat) =>
    format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',

  fileName: (resource: ExportResource, format: ExportFormat) => `${resource}-${new Date().toISOString().slice(0, 10)}.${format}`,

  /** Builds the report first (so errors become JSON responses), then streams the file. */
  async prepare(auth: AuthContext, resource: ExportResource, filters: Record<string, unknown>): Promise<Prepared> {
    const [business, report] = await Promise.all([Business.findById(auth.businessId).select('name').lean(), build(auth, resource, filters)]);
    await auditService.record(auth, { action: 'export.created', entityType: resource, meta: { rows: report.rows.length, filters } });
    return { businessName: business?.name ?? BRAND.name, report };
  },

  write(out: Writable, format: ExportFormat, prepared: Prepared, filters: Record<string, unknown>) {
    return format === 'xlsx' ? writeXlsx(out, prepared.businessName, prepared.report, filters) : writePdf(out, prepared.businessName, prepared.report, filters);
  },
};
