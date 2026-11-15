// Small diagnostic: finds which field of the "Add client" form the capture step cannot fill.
import { go, launch, signIn } from './lib.mjs';

const browser = await launch();
try {
  const { page } = await signIn(browser, 'owner@demo.recrm.test');
  page.setDefaultTimeout(5000);
  await go(page, '/clients');
  await page.getByRole('button', { name: 'Add client' }).click();
  const tries = [
    ['Full name', () => page.getByLabel(/^Full name/).fill('Test')],
    ['Mobile number', () => page.getByLabel(/^Mobile number/).fill('0300 5512345')],
    ['Source', () => page.getByLabel(/^Source/).selectOption('WHATSAPP')],
    ['House', () => page.getByRole('button', { name: 'House', exact: true }).click()],
    ['Preferred societies', () => page.getByLabel(/^Preferred societies/).fill('DHA Karachi')],
    ['Min size', () => page.getByLabel(/^Min size/).first().fill('200')],
    ['Max size', () => page.getByLabel(/^Max size/).first().fill('300')],
    ['Min budget', () => page.getByLabel(/^Min budget/).first().fill('50000000')],
    ['Max budget', () => page.getByLabel(/^Max budget/).first().fill('80000000')],
  ];
  for (const [name, fn] of tries) {
    try {
      await fn();
      console.log('ok  ', name);
    } catch (e) {
      console.log('FAIL', name, String(e.message).split('\n').slice(0, 6).join(' / '));
    }
  }
} finally {
  await browser.close();
}
