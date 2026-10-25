// Verifies the generated manuals: opens each PDF, extracts text, checks structure and content,
// and renders every page to an image (pdf.js inside the browser) for visual inspection.
//
//   node verify.mjs [--render <dir>]     → prints a report; writes verify-report.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANUALS, PRODUCT, TAGLINE } from './content.mjs';
import { launch } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = join(here, '../../docs/user-manuals');
const args = process.argv.slice(2);
const renderDir = args.includes('--render') ? args[args.indexOf('--render') + 1] : null;
const onlyKeys = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--render');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const results = [];

for (const m of MANUALS) {
  if (onlyKeys.length && !onlyKeys.includes(m.key)) continue;
  const file = join(DOCS, m.file);
  const r = { manual: m.file, exists: existsSync(file), problems: [] };
  results.push(r);
  if (!r.exists) { r.problems.push('missing file'); continue; }
  const data = new Uint8Array(readFileSync(file));
  r.bytes = data.length;
  const doc = await pdfjs.getDocument({ data: data.slice(), verbosity: 0 }).promise;
  r.pages = doc.numPages;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '));
  const all = texts.join('\n');
  const meta = await doc.getMetadata();
  r.title = meta.info?.Title;

  // Structure and content checks.
  if (!texts[0].includes(m.title)) r.problems.push('cover does not show the manual title');
  if (!all.includes(m.role)) r.problems.push('intended role not stated');
  if (!texts.slice(1, 4).some((t) => t.includes('Contents'))) r.problems.push('no table of contents near the start');
  for (const bad of ['undefined', 'NaN', '[object', 'TODO', '{{', 'lorem']) if (all.includes(bad)) r.problems.push(`contains "${bad}"`);
  const blank = texts.map((t, i) => [i + 1, t.replace(/\s+/g, '')]).filter(([, t]) => t.length < 40).map(([n]) => n);
  // Page 1 (cover) is short by design; any other near-empty page is a problem.
  r.nearlyBlankPages = blank.filter((n) => n !== 1);
  if (r.nearlyBlankPages.length) r.problems.push(`nearly blank pages: ${r.nearlyBlankPages.join(', ')}`);
  const figs = [...all.matchAll(/Figure (\d+):/g)].map((x) => Number(x[1]));
  r.figures = figs.length;
  if (figs.some((n, i) => n !== i + 1)) r.problems.push('figure numbers are not sequential');
  // Every TOC page reference must point to a page whose text contains that heading. Rows are
  // rebuilt from positioned text items (same baseline = same row) on the contents pages.
  let checked = 0;
  // Contents pages run from page 2 up to the 'About this manual' page.
  const aboutIdx = texts.findIndex((t) => t.replace(/\s+/g, '').toLowerCase().includes('aboutthismanual'));
  for (let i = 2; i <= Math.max(2, aboutIdx); i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items.filter((x) => x.str.trim());
    const rows = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it);
    }
    for (const parts of rows.values()) {
      const line = parts.sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim();
      const mm = line.match(/^(\d+(?:\.\d+)?) (.+?) (\d{1,3})$/) ?? line.match(/^(Revision history) (\d{1,3})$/);
      if (!mm) continue;
      const [label, page] = mm.length === 4 ? [mm[1].includes('.') ? `${mm[1]} ${mm[2]}` : `Chapter ${mm[1]}`, Number(mm[3])] : ['Revision history', Number(mm[2])];
      const target = texts[page]; // body page N is PDF page N+1 (cover is unnumbered) → index N
      const hit = target?.replace(/\s+/g, '').toLowerCase().includes(label.replace(/\s+/g, '').toLowerCase());
      if (!hit) r.problems.push(`TOC "${label}" → page ${page} does not contain the heading`);
      checked++;
    }
  }
  r.tocReferencesChecked = checked;
  if (checked < 10) r.problems.push('table of contents could not be parsed');
  const footers = texts.slice(1).filter((t) => /Page \d+ of \d+/.test(t)).length;
  if (footers !== texts.length - 1) r.problems.push(`page footer missing on ${texts.length - 1 - footers} pages`);
  // Branding: cover tagline, product name in every running header/footer, no old product name.
  if (!texts[0].includes(TAGLINE)) r.problems.push('cover does not show the brand tagline');
  const unbranded = texts.slice(1).filter((t) => !t.includes(PRODUCT) || !t.includes(TAGLINE)).length;
  if (unbranded) r.problems.push(`brand header/footer missing on ${unbranded} pages`);
  if (/Real Estate CRM(?! &)/.test(all)) r.problems.push('old product name "Real Estate CRM" still present');
  if (!String(r.title ?? '').startsWith(PRODUCT)) r.problems.push('PDF title metadata is not branded');
  r.ok = r.problems.length === 0;
  console.log(`${r.ok ? '✓' : '✗'} ${m.file}: ${r.pages} pages, ${r.figures} figures, ${checked} TOC refs checked, ${(r.bytes / 1e6).toFixed(1)} MB${r.ok ? '' : `\n   ${r.problems.join('\n   ')}`}`);
}

// Render pages to images for visual inspection.
if (renderDir) {
  mkdirSync(renderDir, { recursive: true });
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  const root = join(here, 'node_modules/pdfjs-dist/build');
  await page.route('http://verify.local/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith('/pdfjs/')) return route.fulfill({ path: join(root, p.slice(7)), contentType: 'text/javascript' });
    if (p.startsWith('/pdf/')) return route.fulfill({ path: join(DOCS, decodeURIComponent(p.slice(5))), contentType: 'application/pdf' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="margin:0;background:#888"><canvas id="c"></canvas></body></html>' });
  });
  await page.goto('http://verify.local/');
  for (const r of results.filter((x) => x.exists)) {
    for (let n = 1; n <= r.pages; n++) {
      await page.evaluate(async ({ file, n }) => {
        const lib = await import('http://verify.local/pdfjs/pdf.mjs');
        lib.GlobalWorkerOptions.workerSrc = 'http://verify.local/pdfjs/pdf.worker.mjs';
        window.__docs ??= {};
        window.__docs[file] ??= await lib.getDocument(`http://verify.local/pdf/${encodeURIComponent(file)}`).promise;
        const pg = await window.__docs[file].getPage(n);
        const vp = pg.getViewport({ scale: 1.4 });
        const c = document.getElementById('c');
        c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }, { file: r.manual, n });
      await page.locator('#c').screenshot({ path: join(renderDir, `${r.manual.replace('.pdf', '')}-p${String(n).padStart(2, '0')}.png`) });
    }
  }
  await browser.close();
  console.log(`Rendered pages → ${renderDir}`);
}

writeFileSync(join(here, 'out', 'verify-report.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
