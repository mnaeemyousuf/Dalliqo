// Renders a thumbnail grid of every captured screenshot per role, for visual QA.
//   node contact-sheet.mjs [outDir]
import { readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(here, '../../docs/user-manuals/screenshots');
const out = process.argv[2] ?? join(here, 'contact-sheets');
mkdirSync(out, { recursive: true });

const browser = await launch();
for (const role of readdirSync(SHOTS).filter((d) => !d.endsWith('.json'))) {
  const files = readdirSync(join(SHOTS, role)).filter((f) => f.endsWith('.jpg')).sort();
  const html = `<html><body style="margin:0;font:12px Arial;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:6px;background:#ddd">${files
    .map((f) => `<figure style="margin:0;background:#fff"><img src="${role}/${f}" style="width:100%;display:block"><figcaption style="padding:2px 4px">${role}/${f}</figcaption></figure>`)
    .join('')}</body></html>`;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const tmp = join(SHOTS, `_sheet_${role}.html`);
  writeFileSync(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  rmSync(tmp);
  const file = join(out, `${role}.jpg`);
  await page.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 70 });
  await page.close();
  console.log(file, files.length);
}
await browser.close();
