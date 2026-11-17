// Signs in to the web app as each demo role, opens every page its menu offers (plus the first
// record of each list and every Settings tab) and reports anything a user of that role would see
// as broken: a forbidden / failed API call, a page error, or an error panel.
//
//   WEB_URL=http://localhost:5173 node roles-smoke.mjs
import { BASE, go, launch, signIn } from './lib.mjs';

const ROLES = {
  owner: 'owner@demo.recrm.test',
  manager: 'manager@demo.recrm.test',
  member: 'son@demo.recrm.test',
  agent: 'agent@demo.recrm.test',
  accountant: 'accounts@demo.recrm.test',
  viewer: 'viewer@demo.recrm.test',
};
const DETAIL = ['/clients', '/properties', '/owners', '/deals', '/agreements', '/leases', '/installments'];
const ERROR_TEXT = /Something went wrong|could not be loaded|You do not have permission/i;

const browser = await launch();
const report = {};
let bad = 0;
try {
  // ONLY=viewer,agent limits a run to those roles.
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  for (const [role, email] of Object.entries(ROLES)) {
    if (only && !only.has(role)) continue;
    const { context, page } = await signIn(browser, email);
    const problems = [];
    let where = '/';
    page.on('pageerror', (e) => problems.push(`${where}: page error: ${String(e.message).split('\n')[0]}`));
    page.on('response', (r) => {
      const u = r.url();
      if (!u.includes('/api/')) return;
      // 404s for optional lookups and the plan / AI "not set up" answers are part of normal use.
      if (r.status() === 403 || r.status() >= 500) problems.push(`${where}: ${r.request().method()} ${u.replace(/^.*\/api/, '')} → ${r.status()}`);
    });
    const check = async () => {
      const text = await page.locator('main').innerText().catch(() => '');
      if (ERROR_TEXT.test(text)) problems.push(`${where}: error panel shown`);
    };

    await go(page, '/');
    const links = [...new Set(await page.locator('aside a[href^="/"], nav a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href'))))].filter((h) => h && !h.startsWith('/w/'));
    for (const href of links) {
      where = href;
      await go(page, href);
      await check();
      if (DETAIL.includes(href)) {
        const link = page.locator(`main a[href^="${href}/"]`).first();
        const row = page.locator('main tbody tr').first();
        if (await link.count()) await go(page, await link.getAttribute('href'));
        else if (await row.count()) await row.click().then(() => page.waitForTimeout(1500));
        where = page.url().replace(BASE, '');
        await check();
        // Every tab of the record.
        const tabs = page.getByRole('tab');
        for (let i = 0; i < Math.min(await tabs.count(), 10); i++) {
          await tabs.nth(i).click().catch(() => undefined);
          await page.waitForTimeout(700);
          await check();
        }
      }
    }
    if (links.includes('/settings')) {
      await go(page, '/settings');
      const tabs = page.getByRole('tab');
      for (let i = 0; i < (await tabs.count()); i++) {
        where = `/settings#${await tabs.nth(i).innerText()}`;
        await tabs.nth(i).click();
        await page.waitForTimeout(900);
        await check();
      }
    }
    report[role] = { pages: links.length, problems: [...new Set(problems)] };
    bad += report[role].problems.length;
    console.log(`${role}: ${links.length} menu pages, ${report[role].problems.length} problems`);
    for (const p of report[role].problems) console.log(`   ${p}`);
    await context.close();
  }
} finally {
  await browser.close();
}
process.exitCode = bad ? 1 : 0;
