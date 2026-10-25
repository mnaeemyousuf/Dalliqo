// Builds the role-based PDF user manuals from content.mjs and the captured screenshots.
//
//   node build.mjs            → docs/user-manuals/*.pdf
//
// Pipeline per manual: HTML (cover + body) → Chromium print to PDF (body with header/footer)
// → read the body PDF back with pdf.js to find the page of every heading → re-render with the
// table-of-contents page numbers filled in → merge cover + body with pdf-lib.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { chapters, esc, MANUALS, PRODUCT, REVISION, TAGLINE, VERSION } from './content.mjs';
import { launch } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = join(here, '../../docs/user-manuals');
const SHOTS = join(DOCS, 'screenshots');
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });
const DATE = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const only = process.argv.slice(2);

// Dalliqo branding: logo artwork and typeface come from the generated brand assets (tools/brand).
const REPO = join(here, '../..');
const svg = (name) => readFileSync(join(REPO, 'branding/svg', name), 'utf8').replace(/<\?xml[^>]*>/, '');
const LOGO_COVER = svg('dalliqo-logo-horizontal-dark.svg');
const MARK_DATA = `data:image/png;base64,${readFileSync(join(REPO, 'branding/png/dalliqo-mark-64.png')).toString('base64')}`;
const FONT_DIR = join(REPO, 'mobile/assets/fonts');
const FONT_CSS = [[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold']]
  .map(([w, n]) => `@font-face { font-family: 'Plus Jakarta Sans'; font-weight: ${w}; src: url('${pathToFileURL(join(FONT_DIR, `PlusJakartaSans-${n}.ttf`)).href}') format('truetype'); }`)
  .join('\n');

const CSS = `
  ${FONT_CSS}
  @page { size: A4; margin: 24mm 18mm 20mm 18mm; }
  * { box-sizing: border-box; }
  html { font-family: 'Plus Jakarta Sans', 'Segoe UI', 'Noto Sans', Arial, sans-serif; font-size: 10.5pt; color: #1e293b; line-height: 1.5; }
  body { margin: 0; }
  h1, h2, h3, h4 { color: #0B1B4A; line-height: 1.25; margin: 0; }
  .chapter { break-before: page; }
  .kicker { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: #1D4ED8; font-weight: 700; margin-bottom: 2mm; }
  .chapter > h2 { font-size: 20pt; padding-bottom: 3mm; border-bottom: 2px solid #1D4ED8; margin-bottom: 5mm; }
  h3 { font-size: 13.5pt; margin: 7mm 0 2.5mm; break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; color: #334155; break-after: avoid; }
  p { margin: 0 0 2.5mm; }
  ul, ol { margin: 0 0 3mm 5mm; padding-left: 4mm; }
  li { margin-bottom: 1mm; }
  ol.steps li::marker { font-weight: 700; color: #1D4ED8; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9.5pt; break-inside: auto; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 1.6mm 2.2mm; text-align: left; vertical-align: top; }
  thead th { background: #DCE6FE; color: #0B1B4A; }
  table.kv th { width: 34%; background: #f1f5f9; font-weight: 600; }
  table.fields td:nth-child(2) { white-space: nowrap; }
  .ui { font-weight: 600; color: #0B1B4A; background: #eef2f7; border: 1px solid #d5dde7; border-radius: 3px; padding: 0 1.2mm; white-space: nowrap; }
  .callout { border-left: 4px solid; border-radius: 3px; padding: 2.2mm 3mm; margin: 2mm 0 4mm; font-size: 9.8pt; break-inside: avoid; }
  .note { border-color: #1D4ED8; background: #EEF3FF; }
  .tip { border-color: #16a34a; background: #effaf2; }
  .warn { border-color: #d97706; background: #fff7ea; }
  figure { margin: 3mm 0 5mm; break-inside: avoid; text-align: center; }
  figure img { max-width: 100%; max-height: 112mm; border: 1px solid #cbd5e1; border-radius: 2px; }
  figcaption { font-size: 9pt; color: #475569; margin-top: 1.5mm; font-style: italic; }
  .toc h2 { font-size: 20pt; border-bottom: 2px solid #1D4ED8; padding-bottom: 3mm; margin-bottom: 5mm; }
  .toc .row { display: flex; align-items: baseline; gap: 2mm; margin: 0 0 1.3mm; }
  .toc .row.ch { font-weight: 700; margin-top: 2.6mm; color: #0B1B4A; }
  .toc .row.sec { padding-left: 8mm; font-size: 9.8pt; }
  .toc .dots { flex: 1; border-bottom: 1px dotted #94a3b8; transform: translateY(-1mm); }
  .toc .pg { width: 9mm; text-align: right; font-variant-numeric: tabular-nums; }
  .control table th { width: 34%; background: #f1f5f9; }
  p.q { margin-top: 3mm; margin-bottom: 1mm; }
  .cover { height: 100vh; display: flex; flex-direction: column; justify-content: space-between; padding: 0; }
`;

const COVER_CSS = `
  ${FONT_CSS}
  @page { size: A4; margin: 0; }
  html { font-family: 'Plus Jakarta Sans', 'Segoe UI', 'Noto Sans', Arial, sans-serif; color: #fff; }
  body { margin: 0; }
  .page { width: 210mm; height: 297mm; background: linear-gradient(160deg, #0B1B4A 0%, #1A3FB0 60%, #1D4ED8 100%); position: relative; overflow: hidden; }
  .band { position: absolute; right: -40mm; top: 60mm; width: 160mm; height: 160mm; border-radius: 50%; background: rgba(255,255,255,.06); }
  .inner { position: absolute; inset: 28mm 22mm 24mm 22mm; display: flex; flex-direction: column; }
  .logo svg { height: 16mm; width: auto; display: block; }
  .tagline { margin-top: 3mm; font-size: 11pt; font-weight: 600; color: #B8C6E0; letter-spacing: .01em; }
  .accent { width: 18mm; height: 1.4mm; background: #F59E0B; border-radius: 1mm; margin-top: 30mm; }
  h1 { font-size: 34pt; font-weight: 800; letter-spacing: -0.01em; margin: 6mm 0 4mm; line-height: 1.1; }
  .role { font-size: 15pt; opacity: .92; }
  .meta { margin-top: auto; font-size: 10.5pt; border-top: 1px solid rgba(255,255,255,.35); padding-top: 5mm; display: grid; grid-template-columns: 38mm 1fr; row-gap: 1.5mm; }
  .meta b { opacity: .75; font-weight: 600; }
  .shot { position: absolute; right: 22mm; top: 150mm; width: 118mm; border: 2mm solid rgba(255,255,255,.9); border-radius: 2mm; box-shadow: 0 6mm 14mm rgba(0,0,0,.35); }
`;

function buildHtml(m, pageMap) {
  let figNo = 0;
  const has = (id) => existsSync(join(SHOTS, id.includes('/') ? '' : m.key, `${id}.jpg`));
  const figList = [];
  const fig = (id, caption) => {
    const rel = id.includes('/') ? `${id}.jpg` : `${m.key}/${id}.jpg`;
    const file = join(SHOTS, rel);
    if (!existsSync(file)) return '';
    figNo += 1;
    figList.push({ n: figNo, caption, hash: createHash('md5').update(readFileSync(file)).digest('hex') });
    const src = relative(OUT, file).split('\\').join('/');
    return `<figure><img src="${src}" alt=""><figcaption>Figure ${figNo}: ${esc(caption)}</figcaption></figure>`;
  };
  const chs = chapters(m, fig, has);
  const toc = [];
  const body = chs
    .map((ch, i) => {
      const n = i + 1;
      toc.push({ key: `${n}`, label: `${n}  ${ch.title}`, level: 'ch', find: `Chapter ${n}`, title: ch.title });
      const secs = ch.sections
        .map((s, j) => {
          const label = `${n}.${j + 1}  ${s.title}`;
          toc.push({ key: `${n}.${j + 1}`, label, level: 'sec', find: `${n}.${j + 1} ${s.title}` });
          return `<h3>${esc(label)}</h3>${s.html}`;
        })
        .join('');
      return `<section class="chapter"><div class="kicker">Chapter ${n}</div><h2>${esc(ch.title)}</h2>${secs}</section>`;
    })
    .join('');
  const pg = (k) => (pageMap?.[k] ? String(pageMap[k]) : '00');
  const tocHtml = `<section class="toc"><h2>Contents</h2>${toc.map((t) => `<div class="row ${t.level}"><span>${esc(t.label)}</span><span class="dots"></span><span class="pg">${pg(t.key)}</span></div>`).join('')}<div class="row ch"><span>Revision history</span><span class="dots"></span><span class="pg">${pg('rev')}</span></div></section>`;
  const control = `<section class="chapter control"><div class="kicker">Document control</div><h2>About this manual</h2>
    <table><tr><th>Product</th><td>${PRODUCT}</td></tr><tr><th>Manual</th><td>${esc(m.title)}</td></tr><tr><th>Intended reader</th><td>${esc(m.role)}</td></tr>
    <tr><th>Access level documented</th><td>${esc(m.access)}</td></tr><tr><th>Version / revision</th><td>${VERSION} · ${REVISION}</td></tr><tr><th>Date of preparation</th><td>${DATE}</td></tr>
    <tr><th>Screenshots</th><td>Captured from the running web application signed in as the demo user <b>${esc(m.demoUser)}</b> (synthetic Karachi demo data). Figure numbering: ${figNo} figures.</td></tr></table>
    <p>Words in <span class="ui">this style</span> are labels exactly as they appear on screen. Notes, tips and important warnings are shown in coloured boxes.</p>
    <p>This manual describes what your access level can do as enforced by the system. Your business owner may give you a different set of permissions; if a button described here is missing, your access does not include it.</p></section>`;
  const rev = `<section class="chapter"><div class="kicker">Appendix</div><h2>Revision history</h2><table><thead><tr><th>Version</th><th>Revision</th><th>Date</th><th>Changes</th></tr></thead><tbody><tr><td>${VERSION}</td><td>Rev. A</td><td>—</td><td>First issue for the MVP release, with screenshots of the current application.</td></tr><tr><td>${VERSION}</td><td>${REVISION}</td><td>${DATE}</td><td>Rebranded as ${PRODUCT}: new logo, colours and typeface; all screenshots recaptured from the rebranded application. No change to features or procedures.</td></tr></tbody></table></section>`;
  toc.push({ key: 'rev', find: 'Revision history', level: 'appendix', appendix: true });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>${CSS}</style></head><body>${tocHtml}${control}${body}${rev}</body></html>`;
  return { html, toc, figures: figList };
}

function coverHtml(m) {
  const shot = [join(SHOTS, m.key, 'dashboard.jpg')].find(existsSync);
  const src = shot ? relative(OUT, shot).split('\\').join('/') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${COVER_CSS}</style></head><body><div class="page"><div class="band"></div>
    ${src ? `<img class="shot" src="${src}" alt="">` : ''}
    <div class="inner"><div class="logo">${LOGO_COVER}</div><div class="tagline">${esc(TAGLINE)}</div>
    <div class="accent"></div><h1>${esc(m.title)}</h1><div class="role">For: ${esc(m.role)}</div>
    <div class="meta"><b>Version</b><span>${VERSION}</span><b>Revision</b><span>${REVISION}</span><b>Prepared</b><span>${DATE}</span><b>Access level</b><span>${esc(m.access)}</span><b>Product</b><span>${PRODUCT} — Real Estate CRM &amp; Business Management Platform</span><b>Classification</b><span>For customer staff — internal use</span></div></div></div></body></html>`;
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
async function pageTexts(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    texts.push(tc.items.map((x) => x.str).join(' '));
  }
  return texts;
}
const norm = (s) => s.replace(/\s+/g, '').toLowerCase();

function locate(toc, texts) {
  const pages = texts.map(norm);
  const firstChapter = pages.findIndex((t) => t.includes(norm('Chapter 1')) && !t.includes(norm('Contents')));
  const map = {};
  for (const t of toc) {
    const needle = norm(t.find);
    const idx = pages.findIndex((txt, i) => i >= Math.max(firstChapter, 0) && txt.includes(needle));
    map[t.key] = idx >= 0 ? idx + 1 : null;
  }
  return map;
}

const headerTemplate = (m) => `<div style="width:100%;font-family:Segoe UI,Arial;font-size:7.5pt;color:#56657B;padding:0 18mm;display:flex;justify-content:space-between;align-items:center;border-bottom:0.6pt solid #1D4ED8;margin-bottom:2mm;padding-bottom:1.5mm"><span style="display:flex;align-items:center;gap:1.5mm;color:#0B1B4A;font-weight:700"><img src="${MARK_DATA}" style="width:4mm;height:4mm">${PRODUCT}</span><span>${esc(m.title)}</span></div>`;
const footerTemplate = `<div style="width:100%;font-family:Segoe UI,Arial;font-size:7.5pt;color:#56657B;padding:0 18mm;display:flex;justify-content:space-between"><span>${PRODUCT} · ${esc(TAGLINE)} · Version ${VERSION} · ${REVISION} · ${DATE}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

async function printBody(browser, m, html) {
  const file = join(OUT, `${m.key}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))); });
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
  if (broken.length) throw new Error(`${m.key}: broken images ${broken.join(', ')}`);
  const buf = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: headerTemplate(m), footerTemplate, margin: { top: '24mm', bottom: '20mm', left: '18mm', right: '18mm' } });
  await page.close();
  return buf;
}

async function printCover(browser, m) {
  const file = join(OUT, `${m.key}-cover.html`);
  writeFileSync(file, coverHtml(m));
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  await page.close();
  return buf;
}

const browser = await launch();
const report = [];
try {
  for (const m of MANUALS) {
    if (only.length && !only.includes(m.key)) continue;
    const first = buildHtml(m, null);
    const pass1 = await printBody(browser, m, first.html);
    const map = locate(first.toc, await pageTexts(pass1));
    const second = buildHtml(m, map);
    const body = await printBody(browser, m, second.html);
    const check = locate(second.toc, await pageTexts(body));
    const hashes = second.figures.map((f) => f.hash);
    const duplicateFigures = second.figures.filter((f, i) => hashes.indexOf(f.hash) !== i).map((f) => f.n);
    if (duplicateFigures.length) console.log(`  ! identical images used for figures ${duplicateFigures.join(', ')}`);
    const mismatched = second.toc.filter((t) => check[t.key] !== map[t.key] || !map[t.key]).map((t) => t.key);
    const cover = await printCover(browser, m);

    const out = await PDFDocument.create();
    for (const src of [cover, body]) {
      const doc = await PDFDocument.load(src);
      (await out.copyPages(doc, doc.getPageIndices())).forEach((p) => out.addPage(p));
    }
    out.setTitle(`${PRODUCT} — ${m.title}`);
    out.setAuthor(PRODUCT);
    out.setCreator(`${PRODUCT} — ${TAGLINE}`);
    out.setSubject(`User manual for ${m.role}`);
    out.setKeywords(['user manual', m.key, `version ${VERSION}`]);
    out.setCreationDate(new Date());
    const bytes = await out.save();
    writeFileSync(join(DOCS, m.file), bytes);
    report.push({ manual: m.file, pages: out.getPageCount(), figures: second.figures.length, duplicateFigures, tocEntries: second.toc.length, tocUnresolvedOrShifted: mismatched });
    console.log(`✓ ${m.file}: ${out.getPageCount()} pages, ${second.figures.length} figures${mismatched.length ? `, TOC issues: ${mismatched.join(', ')}` : ''}`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'build-report.json'), JSON.stringify({ builtAt: new Date().toISOString(), report }, null, 2));
