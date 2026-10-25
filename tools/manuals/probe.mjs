import { launch, signIn, go } from './lib.mjs';
const b = await launch();
const { page } = await signIn(b, 'owner@demo.recrm.test');
await page.screenshot({ path: 'C:/Users/HSLAPT~1/AppData/Local/Temp/claude/C--Users-HS-LAPTOP-Documents-Real-Estate-CRM/a8b70284-f72b-4627-a8e8-ba4536d56369/scratchpad/p_dash.jpg', type: 'jpeg', quality: 70 });
await go(page, '/properties');
await page.screenshot({ path: 'C:/Users/HSLAPT~1/AppData/Local/Temp/claude/C--Users-HS-LAPTOP-Documents-Real-Estate-CRM/a8b70284-f72b-4627-a8e8-ba4536d56369/scratchpad/p_props.jpg', type: 'jpeg', quality: 70 });
await go(page, '/users');
await page.screenshot({ path: 'C:/Users/HSLAPT~1/AppData/Local/Temp/claude/C--Users-HS-LAPTOP-Documents-Real-Estate-CRM/a8b70284-f72b-4627-a8e8-ba4536d56369/scratchpad/p_users.jpg', type: 'jpeg', quality: 70 });
await b.close();
