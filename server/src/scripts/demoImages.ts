/**
 * Synthetic illustrations for demo listings, rendered locally with sharp.
 *
 * They are clearly labelled "DEMO IMAGE" so nobody mistakes them for real
 * property photos, but they let a demo show cover images, thumbnails and the
 * gallery working through the normal upload pipeline.
 */
import sharp from 'sharp';
import type { PropertyType } from '@recrm/shared';

const SKIES = [['#bfe3ff', '#f5fbff'], ['#ffd9b3', '#fff4e6'], ['#c7d2fe', '#eef2ff'], ['#a7f3d0', '#ecfdf5']] as const;
const WALLS = ['#e7d7c1', '#f1e4d3', '#d9e2ec', '#efe6dd', '#e2d4f0', '#f6efe0'];
const ROOFS = ['#9a3412', '#7c2d12', '#334155', '#78350f', '#1e3a8a'];

function building(type: PropertyType, wall: string, roof: string): string {
  switch (type) {
    case 'RESIDENTIAL_PLOT':
      return `<rect x="240" y="560" width="1120" height="300" fill="#c2a878"/>
        <rect x="240" y="560" width="1120" height="300" fill="none" stroke="#7c5c2e" stroke-width="10" stroke-dasharray="40 24"/>
        <rect x="1180" y="430" width="16" height="150" fill="#57534e"/><rect x="1120" y="400" width="136" height="60" rx="6" fill="#fff" stroke="#57534e" stroke-width="4"/>`;
    case 'FLAT':
    case 'APARTMENT': {
      let windows = '';
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) windows += `<rect x="${590 + c * 90}" y="${200 + r * 80}" width="50" height="46" rx="4" fill="#93c5fd"/>`;
      return `<rect x="560" y="170" width="480" height="690" fill="${wall}"/><rect x="560" y="150" width="480" height="30" fill="${roof}"/>${windows}<rect x="760" y="770" width="80" height="90" fill="#78350f"/>`;
    }
    case 'SHOP':
    case 'OFFICE':
    case 'COMMERCIAL': {
      let windows = '';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) windows += `<rect x="${410 + c * 100}" y="${300 + r * 90}" width="70" height="56" fill="#bae6fd"/>`;
      return `<rect x="380" y="270" width="840" height="590" fill="${wall}"/><rect x="380" y="690" width="840" height="170" fill="#0f172a"/><rect x="420" y="720" width="760" height="110" fill="#38bdf8" opacity="0.6"/>${windows}`;
    }
    default:
      return `<polygon points="420,520 800,300 1180,520" fill="${roof}"/><rect x="470" y="520" width="660" height="340" fill="${wall}"/>
        <rect x="560" y="600" width="120" height="100" rx="6" fill="#93c5fd"/><rect x="920" y="600" width="120" height="100" rx="6" fill="#93c5fd"/>
        <rect x="750" y="700" width="100" height="160" fill="#78350f"/><rect x="380" y="840" width="840" height="20" fill="#a8a29e"/>`;
  }
}

/** A 1600×1000 JPEG illustration labelled with the property ID. */
export async function demoPropertyImage(type: PropertyType, label: string, seed: number): Promise<Buffer> {
  const [skyTop, skyBottom] = SKIES[seed % SKIES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#sky)"/>
    <circle cx="${1300 - (seed % 5) * 120}" cy="160" r="70" fill="#fde68a" opacity="0.9"/>
    <rect y="840" width="1600" height="160" fill="#86b46b"/>
    <rect x="0" y="900" width="1600" height="60" fill="#9ca3af"/>
    ${building(type, WALLS[seed % WALLS.length], ROOFS[seed % ROOFS.length])}
    <rect x="1130" y="886" rx="14" width="430" height="74" fill="#0f172a" opacity="0.78"/>
    <text x="1158" y="936" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="#ffffff">DEMO IMAGE · ${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/** A one-page PDF clearly marked as a demo document (never a real deed or ID). */
export function demoDocumentPdf(title: string, subject: string): Promise<Buffer> {
  // Imported lazily so the image helpers don't pull pdfkit into every caller.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as typeof import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `DEMO — ${title}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(40).fillColor('#e2e8f0').text('DEMO DOCUMENT', 56, 360, { align: 'center' });
    doc.fillColor('#0f172a').fontSize(20).text(title, 56, 80);
    doc.moveDown().fontSize(12).fillColor('#334155').text(subject);
    doc.moveDown().text('This is sample data generated for a product demonstration. It is not a real property, ownership or identity record.');
    doc.end();
  });
}
