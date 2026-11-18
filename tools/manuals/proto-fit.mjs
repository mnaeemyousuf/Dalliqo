// Measures whether each prototype phone screen's content fits its fixed 844 px frame.
// Usage: node proto-fit.mjs <dir> [File.dc.html ...]
// sc-for blocks are repeated by their hint-placeholder-count and sc-if blocks follow their
// hint-placeholder-val, which approximates what the canvas renders.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './lib.mjs';

const dir = process.argv[2];
const only = process.argv.slice(3);
const files = only.length ? only : readdirSync(dir).filter((f) => f.endsWith('.dc.html'));

function expand(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/g, '');
  s = s.replace(/<sc-if [^>]*hint-placeholder-val="\{\{false\}\}"[^>]*>[\s\S]*?<\/sc-if>/g, '');
  s = s.replace(/<sc-for [^>]*hint-placeholder-count="(\d+)"[^>]*>([\s\S]*?)<\/sc-for>/g, (_, n, body) => body.repeat(Number(n)));
  return s.replace(/<\/?(x-dc|helmet|sc-if|sc-for)[^>]*>/g, '');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const rows = [];
for (const f of files) {
  await page.setContent(expand(readFileSync(join(dir, f), 'utf8')), { waitUntil: 'domcontentloaded' });
  const r = await page.evaluate(() => {
    const m = document.querySelector('main');
    if (!m) return null;
    // Collapse spacers so "free" is the room actually left for new content.
    for (const c of m.children) {
      if (getComputedStyle(c).flexGrow !== '0') c.style.flex = 'none';
      if (c.style.marginTop === 'auto') c.style.marginTop = '0';
    }
    // A flex spacer (flex: 1) can hide overflow; measure the children's real extent instead.
    const last = [...m.children].filter((c) => c.getBoundingClientRect().height > 0).pop();
    const bottom = last ? last.getBoundingClientRect().bottom : 0;
    const inner = m.getBoundingClientRect().bottom - parseFloat(getComputedStyle(m).paddingBottom);
    return { over: Math.round(Math.max(m.scrollHeight - m.clientHeight, bottom - inner)), free: Math.round(inner - bottom) };
  });
  if (r) rows.push([f, r.over, r.free]);
  // SHOTS=<dir> also saves a screenshot of each screen (spacers collapsed) for a visual check.
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, f.replace('.dc.html', '.png')) });
}
await browser.close();
for (const [f, over, free] of rows) console.log(`${over > 0 ? 'OVERFLOW' : 'ok      '} ${f.padEnd(28)} over ${over}px · free ${free}px`);
