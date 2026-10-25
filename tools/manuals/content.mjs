// Content of the role-based user manuals. Every statement about access reflects what the API
// enforces (docs/ROLE_PERMISSION_MATRIX.md); figures use screenshots captured as that role.

export const PRODUCT = 'Dalliqo';
export const TAGLINE = 'Every Property. Every Lead. One Platform.';
export const VERSION = '1.0';
export const REVISION = 'Rev. B';

// What each documented access level may do (mirrors shared/src/roles.ts templates).
const ALL = { reports: true, exports: true, createClients: true, editClients: true, deleteClients: true, createProperties: true, editProperties: true, deleteProperties: true, createOwners: true, deleteOwners: true, manageMatches: true, createFollowUps: true, deleteFollowUps: true, notes: true, manageAllNotes: true, uploadDocuments: true, deleteDocuments: true, members: true, manageMembers: true, settings: true, audit: true };
const NONE = Object.fromEntries(Object.keys(ALL).map((k) => [k, false]));

export const MANUALS = [
  {
    key: 'owner', file: 'Business_Owner_User_Manual.pdf', title: 'Business Owner User Manual', role: 'Business Owner / Organization Administrator',
    access: 'Owner (full access)', demoUser: 'owner@demo.recrm.test', can: { ...ALL },
    summary: 'You own the business account. You set up the business, add your team, decide what each person may do, and you can see and change everything.',
    duties: ['Set up the business profile, client categories and matching rules', 'Add team members and give each the right access', 'Keep client and property records accurate', 'Watch follow-ups, matches and team performance', 'Export reports and review the audit log'],
  },
  {
    key: 'manager', file: 'Office_Manager_User_Manual.pdf', title: 'Office Manager User Manual', role: 'Office Manager (Manager template)',
    access: 'Member — Manager template', demoUser: 'manager@demo.recrm.test', can: { ...ALL, members: true, manageMembers: false, settings: false },
    summary: 'You run the day-to-day office. You can do everything an agent can, plus delete records, manage everyone’s notes, see reports and the audit log. Adding users and changing business settings stays with the owner.',
    duties: ['Keep the client and property database clean (including removing duplicates)', 'Supervise follow-ups and team performance', 'Check listings that need availability verification', 'Prepare reports and exports for the owner', 'Review the audit log when something looks wrong'],
  },
  {
    key: 'agent', file: 'Real_Estate_Agent_User_Manual.pdf', title: 'Real Estate Agent User Manual', role: 'Real Estate Agent / Salesperson (Agent template)',
    access: 'Member — Agent template', demoUser: 'agent@demo.recrm.test',
    can: { ...NONE, createClients: true, editClients: true, createProperties: true, editProperties: true, createOwners: true, manageMatches: true, createFollowUps: true, deleteFollowUps: true, notes: true, uploadDocuments: true },
    summary: 'You work with buyers, tenants and owners every day: you record inquiries, find matching properties, contact clients, schedule visits and follow-ups, and keep listings up to date.',
    duties: ['Record every inquiry as a client with clear requirements', 'Use matches to propose suitable properties and share them on WhatsApp', 'Schedule, reschedule and complete follow-ups and visits', 'Keep property status, price and availability up to date', 'Write notes after every important conversation'],
    salesperson: true,
  },
  {
    key: 'member', file: 'CRM_Operator_User_Manual.pdf', title: 'CRM Operator User Manual', role: 'CRM Operator / General Staff (Standard member template)',
    access: 'Member — Standard member template', demoUser: 'son@demo.recrm.test',
    can: { ...ALL, deleteClients: false, deleteProperties: false, deleteOwners: false, manageAllNotes: false, deleteDocuments: false, manageMembers: false, settings: false, audit: false },
    summary: 'You keep the office running: you enter and update clients, properties, owners and documents, schedule follow-ups for the team, and prepare reports. This is also the default access for a family member who helps run the business.',
    duties: ['Enter new clients, properties and owners accurately and without duplicates', 'Upload and organise documents and photos', 'Schedule follow-ups and make sure nothing is overdue', 'Confirm listing availability with owners', 'Download reports when the owner asks'],
  },
  {
    key: 'accountant', file: 'Accountant_User_Manual.pdf', title: 'Accountant User Manual', role: 'Accountant / Reports (Accountant template)',
    access: 'Member — Accountant (reports) template', demoUser: 'accounts@demo.recrm.test', can: { ...NONE, reports: true, exports: true },
    summary: 'You review the business’s figures. You can see all records and the dashboard analytics and download Excel and PDF reports, but you cannot change data.',
    duties: ['Review dashboard figures and analytics', 'Download Excel and PDF reports for accounts and management', 'Check deal status (sold, rented, reserved) on properties', 'Report data problems to the owner or manager'],
  },
  {
    key: 'viewer', file: 'Read_Only_User_Manual.pdf', title: 'Read-only User Manual', role: 'Read-only User / Viewer (Read-only viewer template)',
    access: 'Member — Read-only viewer template', demoUser: 'viewer@demo.recrm.test', can: { ...NONE },
    summary: 'You can look up clients, properties, owners, matches, follow-ups and documents, for example to answer a caller’s question, but you cannot add, change, delete or export anything.',
    duties: ['Look up clients and properties when asked', 'Check what is available and at what price', 'Read notes and history before speaking to a client', 'Tell a colleague with edit access when something needs to change'],
  },
];

// ───────── small HTML helpers ─────────
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (...xs) => xs.map((x) => `<p>${x}</p>`).join('');
const ul = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const ol = (items) => `<ol class="steps">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
const note = (t) => `<div class="callout note"><b>Note.</b> ${t}</div>`;
const tip = (t) => `<div class="callout tip"><b>Tip.</b> ${t}</div>`;
const warn = (t) => `<div class="callout warn"><b>Important.</b> ${t}</div>`;
const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const ui = (t) => `<span class="ui">${t}</span>`;
// A feature block with the 12 points the brief asks for.
function feature({ purpose, where, prereq, steps, required, optional, enter, after, verify, mistakes, trouble, limits }) {
  const rows = [
    ['Purpose', purpose], ['Where to find it', where], ['Before you start', prereq],
  ].filter(([, v]) => v);
  let html = `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  if (steps) html += `<h4>Step by step</h4>${ol(steps)}`;
  if (required || optional) {
    html += `<h4>Fields</h4>${table(['Field', 'Required?', 'What to enter'], [...(required ?? []).map(([f, w]) => [f, '<b>Required</b>', w]), ...(optional ?? []).map(([f, w]) => [f, 'Optional', w])], 'fields')}`;
  }
  if (enter) html += p(enter);
  const tail = [['What happens after saving', after], ['How to check it worked', verify], ['Common mistakes', mistakes], ['If something goes wrong', trouble], ['Permissions and limits', limits]].filter(([, v]) => v);
  if (tail.length) html += `<table class="kv">${tail.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  return html;
}

// ───────── chapters ─────────
// Each chapter returns { title, sections: [{ title, html }] }. fig(id, caption) inserts a numbered
// figure if that role has the screenshot; it returns '' (and the text still stands) otherwise.

export function chapters(m, fig, has) {
  const c = m.can;
  const out = [];
  const isOwner = m.key === 'owner';
  const readOnly = !c.createClients && !c.createProperties;

  // 1. Introduction
  const canDo = [
    'See the dashboard, My Day and use the global search',
    'View clients, properties, owners, matches, follow-ups, notes, documents and activity history',
    c.createClients && 'Add and edit clients and their requirements',
    c.deleteClients && 'Delete (archive) clients, properties, owners and documents',
    c.createProperties && 'Add and edit properties, change status, confirm availability and upload photos',
    c.createOwners && 'Add and edit property owners',
    c.manageMatches && 'Change match status (viewed, shortlisted, contacted, rejected)',
    c.createFollowUps && 'Create, reschedule and complete follow-ups and property visits',
    c.notes && 'Write notes on clients, properties, owners and follow-ups',
    c.uploadDocuments && 'Upload, rename and share documents',
    c.reports && 'See dashboard analytics (charts, lead sources, team performance)',
    c.exports && 'Download Excel and PDF reports',
    c.members && !c.manageMembers && 'See the list of team members',
    c.manageMembers && 'Add team members, set their permissions, suspend or remove them',
    c.settings && 'Change business settings, client categories and matching rules',
    c.audit && 'Read the audit log',
  ].filter(Boolean);
  const cannot = [
    !c.createClients && ['Add or edit clients', 'Your access is read-only for clients.'],
    !c.createProperties && ['Add or edit properties, change status or confirm availability', 'These change the business’s stock and need edit access.'],
    !c.deleteClients && ['Delete clients, properties, owners or documents', 'Deleting is reserved for the owner and managers to protect the business’s data.'],
    !c.manageMatches && ['Change the status of a match', 'Needs match-management access.'],
    !c.createFollowUps && ['Create or change follow-ups', 'Follow-ups are managed by staff with edit access.'],
    !c.notes && ['Write notes', 'Notes are written by staff who work with clients.'],
    !c.uploadDocuments && ['Upload documents or photos', 'Uploading needs document access.'],
    !c.reports && ['See analytics charts', 'Analytics are for the owner, managers and accounts.'],
    !c.exports && ['Download Excel/PDF reports', 'Exports contain business data and are limited to authorised staff.'],
    !c.manageMembers && ['Add or manage users', 'Only the business owner manages the team.'],
    !c.settings && ['Change business settings or matching rules', 'Only the business owner changes settings.'],
    !c.audit && ['Read the audit log', 'The audit log is for the owner and managers.'],
  ].filter(Boolean);
  out.push({
    title: 'Introduction',
    sections: [
      { title: 'What the system does', html: p(`${PRODUCT} keeps a property business’s clients, properties, owners, follow-ups and documents in one place. It automatically matches buyers and tenants with suitable properties, reminds the team about calls and visits, and shows the business’s performance on a live dashboard. Everyone in the business works on the same data, from the web on a computer or the mobile app, and changes appear for colleagues straight away.`, 'All figures in this manual are real screenshots of the application signed in as a demo user with your access level. The data shown is synthetic demo data (Karachi examples) — the names, phone numbers and properties are not real.') },
      { title: 'Your role', html: p(`<b>${esc(m.role)}.</b> ${m.summary}`) + `<h4>Your main responsibilities</h4>${ul(m.duties)}` },
      { title: 'What you can do', html: ul(canDo) + (cannot.length ? `<h4>What you cannot do, and why</h4>${table(['Action', 'Why'], cannot)}` : '') + note('Your access is checked by the server every time you act, not just hidden on screen. If your manager changes your permissions, the change applies the next time a page loads. If you need extra access, ask the business owner.') + (m.salesperson ? note('Some businesses give salespeople a narrower <b>Salesperson</b> template: the same as this manual, except they cannot add or edit properties or owners, change match status, delete follow-ups or upload documents.') : '') },
    ],
  });

  // 2. Sign in and first-time setup
  out.push({
    title: 'Signing in and first-time setup',
    sections: [
      ...(isOwner ? [{ title: 'Creating your business account', html: feature({
        purpose: 'Create the business account and your owner login (done once, by the owner).',
        where: `The sign-in page → ${ui('Create account')}.`,
        steps: ['Open the web address your provider gave you.', `Click ${ui('Create account')}.`, 'Enter your full name, business name, e-mail, mobile number and a password.', `Click ${ui('Create account')}. You are signed in and your business is ready with the standard client categories and matching rules.`],
        required: [['Full name', 'Your name as staff will see it'], ['Business name', 'e.g. “Yousuf Estate & Builders”'], ['Email', 'Your sign-in address'], ['Password', 'At least 8 characters with letters and numbers']],
        optional: [['Mobile number', 'Pakistani format, e.g. 0300 1234567']],
        mistakes: 'Using a shared office e-mail — use your own address; each person needs their own login.',
      }) + fig('common/register', 'Creating a new business account') }] : []),
      { title: 'Signing in', html: feature({
        purpose: 'Open your account securely.',
        where: 'The web address provided by your business owner or system provider.',
        prereq: isOwner ? 'Your account (created above).' : 'The business owner has added you and given you a temporary password.',
        steps: ['Open the web address in Chrome, Edge or Safari.', 'Type your e-mail address and password.', `Click ${ui('Sign in')}. The dashboard opens.`],
        verify: 'Your name’s initial appears in the round button at the top right, and the business name appears at the top left.',
        trouble: 'See “Unable to sign in” in the Troubleshooting chapter.',
      }) + fig('common/login', 'The sign-in page') + fig('common/login-filled', 'Signing in with e-mail and password') },
      ...(!isOwner ? [{ title: 'First sign-in: choose your own password', html: p('The first time you sign in with the temporary password the owner gave you, the system asks you to choose a new password before you can continue. Enter the temporary password, then your new password twice (at least 8 characters, with letters and numbers). From then on, only you know your password.') + warn('Never share your password, and never use a colleague’s login. Every change you make is recorded under your name.') }] : []),
      { title: 'Forgot your password', html: feature({
        purpose: 'Set a new password if you have forgotten it.',
        where: `Sign-in page → ${ui('Forgot password?')}`,
        steps: ['Enter your e-mail address and submit.', 'Open the e-mail you receive and click the reset link (it works once and expires).', 'Choose a new password. All your other sessions are signed out for safety.'],
        trouble: isOwner ? 'If no e-mail arrives, the e-mail (SMTP) settings may not be configured on your server yet — ask your system provider. You can still reset a staff member’s password yourself from Users → Set temporary password.' : 'If no e-mail arrives, ask the business owner to set a temporary password for you from the Users screen.',
      }) + fig('common/forgot-password', 'Requesting a password reset link') },
      { title: 'Your profile, language and theme', html: p(`Open ${ui('Settings')} from the left menu. On the ${ui('Profile')} tab you can update your name and mobile number. The language button at the top of every page switches between English and اردو (Urdu); the sun/moon button switches between light, dark and system theme. Your choice is remembered on your account.`) + fig('settings', 'Settings — your profile') + p(`On ${ui('Settings → Security')} you can change your password and see the devices where you are signed in. Use ${ui('Sign out')} on a device you no longer use (for example a lost phone).`) },
    ],
  });

  // 3. Dashboard
  const tiles = [
    ['Total properties', 'All properties in the business (not deleted).'], ['Available', 'Properties you can still offer.'], ['Sold / Rented', 'Closed deals.'],
    ['Listings to re-verify', 'Available properties whose availability nobody has confirmed with the owner in the last 30 days. Click to open the list and confirm them.'],
    ['Total clients · Buyers · Rental clients', 'Clients by purpose.'], ['Owners', 'Clients in the “Property Owner” category.'],
    ['Today’s follow-ups · Overdue follow-ups', 'Calls, meetings and visits due today, and those whose time has passed without being done.'],
    ['New clients / properties / matches today', 'What was added today (Karachi time).'],
  ];
  out.push({
    title: 'Your dashboard and daily workspace',
    sections: [
      { title: 'Dashboard', html: p('The dashboard opens after you sign in. Every number is calculated live from the business’s records; click a card to open the matching list.') + fig('dashboard', 'The dashboard') + table(['Card', 'What it means'], tiles) },
      ...(c.reports ? [{ title: 'Analytics', html: p('Below the cards are charts for the last 7 days, 30 days or 12 months (choose with the tabs above the charts): property types, property status, client categories, follow-up performance, new records and match quality.') + fig('dashboard-analytics', 'Dashboard analytics') + p(`${ui('Lead sources & conversion')} shows where clients came from (WhatsApp, phone, referral, walk-in, portal, social media) and how many became deals (won), are still active, or were lost. ${ui('Team performance')} lists each team member’s completed follow-ups in the period, follow-ups overdue right now (in red) and active clients assigned to them.`) + fig('dashboard-sales', 'Lead sources & conversion, and team performance') + tip('Use Lead sources to decide where to spend on advertising, and Team performance in the weekly team meeting — look first at the red “overdue” numbers.') }] : [{ title: 'Analytics', html: p('Charts and team performance are not shown to your access level; the cards above are.') }]),
      { title: 'My Day', html: p(`${ui('My Day')} is your daily to-do list: today’s follow-ups, overdue follow-ups, today’s meetings, property visits, and the newest clients, properties and matches. Start every morning here.`) + fig('my-day', 'My Day — the daily workspace') + (c.createFollowUps ? p(`Click ${ui('Mark done')} on a follow-up once it is finished.`) : '') },
      { title: 'Global search', html: p('The search box at the top of every page looks through clients (name, mobile, WhatsApp), properties (ID such as RE-000012, society, block) and owners as you type. Click a result to open it.') + fig('global-search', 'Searching across clients, properties and owners') },
    ],
  });

  // 4. Clients
  const clientSections = [
    { title: 'Client list', html: p(`Open ${ui('Clients')}. Search by name or mobile number, filter by category, status, purpose, property type, assigned person, area and budget, and sort the list. Click a client to open their page.`) + fig('clients', 'The client list with filters') },
  ];
  if (c.createClients) {
    clientSections.push({ title: 'Adding a client', html: feature({
      purpose: 'Record a new buyer, tenant, seller or investor with what they are looking for, so the system can match them.',
      where: `${ui('Clients')} → ${ui('Add client')}.`,
      prereq: 'Search first by mobile number to make sure the client is not already in the system.',
      steps: [`Click ${ui('Add client')}. A form opens on the right.`, 'Fill in the client’s name and mobile number.', 'Choose the category, source (how they reached you), priority and the team member responsible.', `Under ${ui('Requirements')}, choose Purchase or Rental, click the property types they want, and enter preferred societies/areas/blocks, size range and budget range.`, `Click ${ui('Save')}.`],
      required: [['Full name', 'At least 2 characters'], ['Mobile number', 'Pakistani number in any common format (0300 1234567, +92 300 1234567); it is saved as +923001234567']],
      optional: [['WhatsApp / alternate number', 'Leave WhatsApp empty if it is the same as mobile'], ['Email, address', ''], ['Category', 'Plot buyer, house buyer, rental client, investor, etc.'], ['Status, priority', 'Defaults: Active, Medium'], ['Source', 'WhatsApp, phone, walk-in, referral, portal, social media — needed for the lead-source report'], ['Assigned to', 'Who follows this client up'], ['Requirements', 'Purpose, property types, societies (comma-separated), size and budget ranges. More than one requirement can be added'], ['Notes', 'Anything else worth remembering']],
      after: 'The client page opens. Matching properties are calculated immediately and colleagues see the new client straight away.',
      verify: 'The client appears at the top of the client list; the Matching properties tab shows suitable properties (if any fit).',
      mistakes: 'Typing the budget in lakh or crore words — enter the full amount in rupees, e.g. 15000000 for 1.5 crore. Leaving property types empty means “any type”.',
      limits: c.deleteClients ? '' : 'You can add and edit clients but not delete them.',
    }) + fig('client-form', 'Adding a client — contact details') + fig('client-form-requirements', 'Adding a client — requirements (purpose, type, location, size, budget)') + fig('client-saved', 'The new client’s page right after saving') });
    clientSections.push({ title: 'Duplicate warning', html: p(`If another client already uses the same mobile, WhatsApp or alternate number, the form stops and shows ${ui('Possible duplicate client')} with a link to the existing record. Usually you should open the existing client and update it instead. If it really is a different person (for example two family members sharing one phone), click ${ui('Save anyway')}.`) + fig('client-duplicate', 'The duplicate-client warning') + note('On the mobile app the same check is done on the phone, even without internet.') });
  }
  clientSections.push({ title: 'The client page', html: p('The client page has tabs: Overview, Requirements, Matching properties, Follow-ups, Notes, Documents, Activity and Communication. The buttons at the top call the client, open WhatsApp, send an SMS or e-mail, and create a follow-up. Calls and WhatsApp messages started from here are recorded on the client’s timeline.') + fig('client-detail', 'A client’s overview') + fig('client-requirements', 'The Requirements tab') + fig('client-matches', 'Matching properties for the client, with score and reasons') + fig('client-activity', 'The client’s activity timeline') + (c.notes ? fig('client-notes', 'Notes on a client') + p(`To add a note, open the ${ui('Notes')} tab, type the note and click ${ui('Add note')}. You can edit or delete your own notes${c.manageAllNotes ? ' and anyone else’s' : ''}.`) : '') });
  if (c.editClients) clientSections.push({ title: 'Updating and archiving a client', html: p(`Open the client and click ${ui('Edit')} to change details or requirements; matches are recalculated as soon as you save. When a client is no longer active, change their ${ui('Status')} to On hold, Closed (won), Closed (lost) or Inactive rather than deleting them — this keeps the history and feeds the conversion report.`) + (c.deleteClients ? p(`To remove a client completely (for example a duplicate), click the red delete button and confirm. The record disappears from lists and matches but stays in the audit log.`) : p('Deleting clients is reserved for the owner and managers.')) });
  out.push({ title: 'Working with clients', sections: clientSections });

  // 5. Properties
  const propSections = [
    { title: 'Property list', html: p(`Open ${ui('Properties')}. Switch between the photo grid and the table with the buttons at the top right. Filter by type, status, listing purpose, area, society, block, price, size, verification and owner. Each card shows the property ID, size and type, location, asking price, status and how many clients match.`) + fig('properties', 'The property list (grid view)') },
  ];
  if (c.createProperties) propSections.push({ title: 'Adding a property', html: feature({
    purpose: 'Add a listing so it can be matched with clients and shared.',
    where: `${ui('Properties')} → ${ui('Add property')}.`,
    prereq: 'Add the owner first (Owners chapter) if you want to link them.',
    steps: [`Click ${ui('Add property')}.`, 'Choose the property type and whether it is for sale or rent.', 'Enter the location (area, society, block, street, plot number) and size with its unit.', 'Enter the asking price and, if known, the minimum and expected final price.', 'Choose the owner, add bedrooms/bathrooms/floors and a description.', `Optionally set the location on the map, then click ${ui('Save')}.`],
    required: [['Property type', 'Residential plot, house, flat, apartment, portion, shop, office, commercial, other'], ['Size and unit', 'Sq. yard, sq. ft, sq. metre, marla or kanal'], ['Asking price', 'Full amount in rupees (monthly rent for rentals)']],
    optional: [['Listing for', 'Sale (default) or Rent'], ['Area, society, block, street, plot/unit no.', 'Fill these in — they drive matching and search'], ['Minimum price, expected final price, negotiable', 'Kept for your negotiation; visible to staff who can view properties'], ['Owner', 'Pick from the owners list'], ['Bedrooms, bathrooms, floors, description', ''], ['Latitude / longitude', 'Set from the map picker']],
    after: 'A unique ID such as RE-000031 is given automatically. Matching clients are found immediately and their owners/agents may be notified about strong matches.',
    verify: 'Open the property: the ID appears at the top and the Matching clients tab lists suitable buyers or tenants.',
    mistakes: 'Writing the society in different spellings (e.g. “DHA” and “D.H.A”) — use the same spelling every time so matching works.',
  }) + fig('property-form', 'Adding a property') });
  propSections.push({ title: 'The property page', html: p(`The top shows the ID, status and when availability was last confirmed. Tabs show the overview with a map, ${ui('Photos & videos')}, ${ui('Matching clients')}, follow-ups, documents, notes and activity. ${ui('WhatsApp')} opens WhatsApp with the property summary ready to send; ${ui('Share')} uses your device’s share menu or copies the details.`) + fig('property-detail', 'A property page') + fig('property-media', 'Photos and videos of a property') + fig('property-matches', 'Clients matching a property') + note('The pictures in the demo are clearly labelled illustrations (“DEMO IMAGE”), not real photographs.') });
  if (c.editProperties) {
    propSections.push({ title: 'Changing the status', html: p(`Click ${ui('Change status')}, choose the new status and optionally a reason (for example “Token received”). Every change is recorded on the property’s timeline and in the audit log. When a property stops being available, its matches are marked “No longer available”; they come back if it becomes available again.`) + table(['From', 'Can change to'], [['Available', 'Reserved, Sold, Rented, Withdrawn, Inactive'], ['Reserved', 'Available, Sold, Rented, Withdrawn, Inactive'], ['Sold / Rented / Withdrawn', 'Available, Inactive'], ['Inactive', 'Available']]) + fig('property-status', 'Changing a property’s status') });
    propSections.push({ title: 'Confirming availability', html: p(`Listings go out of date when owners sell elsewhere or change their price. Every property records when its availability was last confirmed. If nobody has confirmed an available property for 30 days it shows ${ui('Needs verification')}, and the dashboard counts it under “Listings to re-verify”.`) + ol(['Call the owner and confirm the property is still on offer at the listed price.', `Open the property and click ${ui('Confirm availability')}.`, 'Add a short note (e.g. “Owner confirmed on phone, price unchanged”) and confirm.', 'If the price changed, click Edit and update it; if it is no longer available, change the status.']) + fig('property-verify', 'Confirming a listing’s availability with a note') + fig('properties-stale', 'Listings that need verification (Verification filter)') });
  }
  if (c.uploadDocuments) propSections.push({ title: 'Photos and documents', html: p(`On the ${ui('Photos & videos')} tab click ${ui('Upload photos or videos')} to add JPEG, PNG or WebP photos or MP4/MOV/WebM videos; large photos are compressed automatically and the first photo becomes the cover. On the ${ui('Documents')} tab choose a category (Registration, Ownership, Agreement, Identity, Property document, Other) and upload PDF, image, Word or Excel files.`) + fig('property-documents', 'Documents attached to a property') + warn('Documents are private: they open through a short-lived secure link, so a link copied today will not work tomorrow. Only upload identity documents (CNIC copies) when you really need them.') });
  if (c.deleteProperties) propSections.push({ title: 'Deleting a property', html: p('Prefer changing the status to Withdrawn or Inactive. Delete only mistakes or duplicates: click the red delete button and confirm. The property leaves all lists and matches; the audit log keeps the record of who deleted it.') });
  out.push({ title: 'Working with properties', sections: propSections });

  // 6. Owners
  out.push({ title: 'Property owners', sections: [{ title: 'Owners', html: p(`${ui('Owners')} lists everyone whose property you sell or rent out, with their number of properties. Open an owner to see their properties, documents, notes and history.`) + fig('owners', 'The owners list') + (c.createOwners ? p(`To add an owner click ${ui('Add owner')} and enter the full name and mobile number (required) plus WhatsApp, alternate number, e-mail, address and notes if known. Link properties to the owner from the property form.`) : '') + (c.deleteOwners ? note('An owner who still has properties cannot be deleted — move or delete the properties first.') : '') }] });

  // 7. Matching
  out.push({ title: 'Smart matching', sections: [
    { title: 'How matches are calculated', html: p('Whenever a client or property is added or changed, the system compares every client requirement with every available property and gives a score out of 100:') + table(['Criterion', 'Weight', 'Counts as a match when…'], [['Property type', '25', 'the type is one the client wants (similar types get partial credit)'], ['Area / society', '25', 'the society or area is one the client prefers'], ['Budget', '25', 'the price is within the budget (slightly over still gets some credit)'], ['Size', '15', 'the size is within the client’s range (converted between units)'], ['Purpose', '10', 'sale for buyers, rent for tenants — a mismatch never matches']]) + table(['Score', 'Label'], [['90–100', 'Excellent'], ['80–89', 'Very good'], ['70–79', 'Good'], ['60–69', 'Possible']]) + p('Only scores of 60 and above are kept as matches; team members are notified for 80 and above. The owner can change these weights and thresholds in Settings. Each match lists its reasons with ticks, such as ✓ Budget ✓ Area / society.') },
    { title: 'The Matches page', html: p(`Open ${ui('Matches')}. Switch between ${ui('Client → Properties')} and ${ui('Property → Clients')}, filter by minimum score and status.`) + fig('matches', 'The Matches page') + p(`On each match: the green paper-plane button ${ui('Send property on WhatsApp')} opens WhatsApp for that client with a ready message containing the property ID, type, location and price — you check it and press Send. The call and WhatsApp buttons contact the client directly. Each contact is recorded on the client’s timeline.`) + (c.manageMatches ? p(`Use ${ui('Mark as')} to record progress: Viewed, Shortlisted, Contacted or Rejected.`) : '') + note('Matches are never invented: if no property fits a client, the list is simply empty. When a property is sold or withdrawn its matches are hidden as “No longer available”.') },
  ] });

  // 8. Follow-ups
  const fuSections = [{ title: 'Follow-up list', html: p(`Open ${ui('Follow-ups')}. Tabs show Today, Upcoming, Overdue and Done; filter by assigned person and type (call, meeting, WhatsApp, SMS, property visit, general).`) + fig('followups', 'The follow-up list') }];
  if (c.createFollowUps) {
    fuSections.push({ title: 'Scheduling a follow-up or visit', html: feature({
      purpose: 'Make sure every promised call, meeting or visit happens.',
      where: `A client or property page → ${ui('Follow-up')}, or ${ui('Follow-ups')} → ${ui('Add follow-up')}.`,
      steps: ['Choose the client (pre-filled when you start from their page) and, if relevant, the property.', 'Choose the type and the date and time.', 'Set the priority, when to be reminded and who should do it.', `Add a note and click ${ui('Save')}.`],
      required: [['Client', 'Search by name or number'], ['Type', 'Call, meeting, WhatsApp, SMS, property visit, general'], ['Date & time', 'When it should happen']],
      optional: [['Property', 'For visits and property-specific calls'], ['Priority', 'Low, medium, high'], ['Remind me', 'Minutes before (default 30)'], ['Assigned to', 'Defaults to you; the assignee is notified'], ['Notes', 'What to discuss or bring']],
      after: 'It appears in Follow-ups, on My Day for the assignee, on the client’s Follow-ups tab and timeline. A reminder notification is sent at the reminder time.',
    }) + fig('followup-form', 'Scheduling a property visit') + fig('followup-saved', 'The new follow-up on the client’s Follow-ups tab') });
    fuSections.push({ title: 'Rescheduling', html: p(`If the client asks for another time, click ${ui('Reschedule')}, pick the new date and time and save. An overdue follow-up becomes pending again, the reminder moves with it, and the change is recorded on the timeline. On the mobile app this works offline.`) + fig('followup-reschedule', 'Rescheduling a follow-up') });
    fuSections.push({ title: 'Completing', html: p(`After the call or visit, click ${ui('Mark done')}, write the outcome (for example “Liked it, second visit with family”) and save. Completed items move to the Done tab and count in team performance.`) + fig('followup-complete', 'Completing a follow-up with its outcome') });
  }
  if (c.notes) fuSections.push({ title: 'Follow-up notes', html: p(`Click the note icon on a follow-up to open its notes and add details during or after the conversation.`) + fig('followup-notes', 'Notes on a follow-up') });
  out.push({ title: 'Follow-ups and reminders', sections: fuSections });

  // 9. Notifications & communication
  out.push({ title: 'Notifications and communication', sections: [
    { title: 'Notification centre', html: p(`The bell at the top right shows unread notifications. ${ui('Notifications')} lists them by tab (All, Follow-ups, Matches, Properties, System). Click one to open the related record; use ${ui('Mark all as read')} to clear them.`) + fig('notifications', 'The notification centre') + p('You are notified about follow-ups assigned to you, follow-up reminders, strong new matches and important property changes made by colleagues.') },
    { title: 'Calling, WhatsApp, SMS and e-mail', html: p('On client and match cards, the phone button starts a call (on a phone or a computer with a calling app), the WhatsApp button opens a chat with the client, and on the client page SMS and e-mail buttons open your messaging apps. These are one-tap shortcuts: the message is sent from your own phone or WhatsApp, and Dalliqo records that you made contact.') + note('The CRM does not send WhatsApp messages by itself — you always press Send in WhatsApp. Automatic WhatsApp messaging would need a WhatsApp Business API account, which is not part of this version.') },
    { title: 'Live updates and push notifications', html: p('The green “Live” label at the top means you are connected: when a colleague adds or changes a client, property or follow-up, your screen updates by itself.') + note('Push notifications to a closed mobile app require the business’s Firebase account to be configured by your system provider. If it is not configured, notifications still appear inside the app and on the web.') },
  ] });

  // 10. Documents & exports
  const docSections = [{ title: 'Documents library', html: p(`${ui('Documents')} lists every document in the business; filter by record type (client, property, owner) and category. Click ${ui('Preview')} to open a document in a new tab, from where you can download it.`) + fig('documents', 'The documents library') + (c.uploadDocuments ? p(`To upload, open the client, property or owner and use their ${ui('Documents')} tab. You can rename a document with the pencil button and share a secure link with ${ui('Share')}.`) : '') + (c.deleteDocuments ? p('Delete a document with the red bin button; this cannot be undone.') : '') + warn('Treat documents as confidential. Share links only with the client concerned; they expire automatically.') }];
  if (c.exports) docSections.push({ title: 'Reports and exports', html: feature({
    purpose: 'Download business data for accounts, management or a partner.',
    where: `${ui('Reports')} in the left menu.`,
    steps: ['Choose the data: clients, properties, owners, follow-ups or matches.', 'Choose Excel (.xlsx) or PDF report.', 'Optionally set filters (for example type, status, society, price range).', `Click ${ui('Download')}.`],
    after: 'The file downloads to your computer. Exports are limited to 10,000 rows — use filters for larger data.',
    limits: 'Urdu text appears correctly in Excel files; in PDF reports Urdu characters are not yet rendered, so use Excel for Urdu data.',
  }) + fig('reports', 'Reports and exports') + warn('Exported files contain client phone numbers and prices. Store them securely and delete copies you no longer need.') });
  out.push({ title: 'Documents and data export', sections: docSections });

  // 11. Administration (owner) / audit (manager)
  if (c.manageMembers || c.audit) {
    const adm = [];
    if (c.manageMembers) {
      adm.push({ title: 'Adding team members', html: feature({
        purpose: 'Give each person their own login with the right access.',
        where: `${ui('Users')} → ${ui('Add user')}.`,
        steps: ['Enter the person’s full name, e-mail and (optionally) mobile number.', 'Set a temporary password (at least 8 characters with letters and numbers) and give it to them in person.', `Under ${ui('Permissions')}, click a template — Standard member, Manager, Agent, Salesperson, Accountant (reports) or Read-only viewer — then adjust individual boxes if needed.`, `Click ${ui('Save')}. They must choose their own password at first sign-in.`],
        required: [['Full name', ''], ['Email', 'Their sign-in address (unique)'], ['Temporary password', '8+ characters, letters and numbers']],
        optional: [['Mobile number', '']],
      }) + fig('users', 'The Users page') + fig('user-add', 'Adding a user with the Agent template') });
      adm.push({ title: 'Changing permissions, suspending and removing', html: p(`On a user’s card: ${ui('Permissions')} opens the permission editor (the card shows the template name, or “Custom” if you changed boxes); ${ui('Set temporary password')} resets their password; ${ui('Suspend')} blocks sign-in immediately and closes their live connections; ${ui('Remove')} takes them out of the business. Their past work stays in the records and audit log.`) + fig('user-permissions', 'Editing a member’s permissions') + table(['Template', 'Typical person'], [['Standard member', 'Family member or senior staff who runs daily operations'], ['Manager', 'Office manager: can also delete records and read the audit log'], ['Agent', 'Field agent: works on clients, properties, follow-ups; no reports'], ['Salesperson', 'Handles clients and follow-ups only'], ['Accountant (reports)', 'Reads everything, downloads reports, changes nothing'], ['Read-only viewer', 'Receptionist or trainee who only looks things up']]) + warn('Give the least access a person needs. Remove access the same day someone leaves.') });
      adm.push({ title: 'Business settings', html: p(`${ui('Settings')} also has tabs for the ${ui('Business')} (name, phone, address, city, time zone, currency, default size unit), ${ui('Client categories')} (add your own, archive custom ones), and ${ui('Matching')} (weights that must add up to 100, the minimum score to keep a match, and the score that triggers a notification), plus (on the Matching tab) the square feet per marla used to convert sizes (a kanal is 20 marla) and the default reminder time.`) + fig('settings-business', 'Business settings') + fig('settings-categories', 'Client categories — built-in and your own') + fig('settings-matching', 'Matching weights and thresholds') });
    }
    if (c.audit) adm.push({ title: 'Audit log', html: p(`${ui('Audit log')} records important changes with who, when and what changed — for example an asking price going from 16,000,000 to 15,500,000, status changes, deletions, sign-ins and permission changes. Filter by action to investigate.`) + fig('audit-log', 'The audit log') });
    out.push({ title: c.manageMembers ? 'Managing your team and business' : 'Oversight', sections: adm });
  }

  // 12. Mobile app
  out.push({ title: 'The mobile app', sections: [{ title: 'Using Dalliqo on your phone', html: p('The Android/iOS app has the same clients, properties, owners, matches, follow-ups, notes and documents, with the same permissions. It is designed for field work:') + ul(['<b>Works offline.</b> Add or edit clients, properties, owners, follow-ups and notes without internet. Changes wait in a queue and send automatically when you are back online. The sync chip shows “All data synced” or how many changes are waiting.', '<b>Conflicts.</b> If a colleague changed the same price or status while you were offline, the app shows both versions and lets you choose “Keep mine” or “Keep latest”.', '<b>PIN and fingerprint/face lock.</b> Set a 4-digit PIN (and biometrics, if your phone supports it) in Settings → Security so nobody can open the app on your unlocked phone.', '<b>Backup and new phone.</b> Everything is stored in the business’s cloud account. On a new phone, install the app and sign in — your business data is restored automatically. Settings → Backup & restore shows whether all changes are uploaded.', '<b>One-tap + button.</b> Add a client, property, follow-up, note or document in one or two taps.']) + note('This manual’s screenshots are from the web application. The mobile app had not yet been installed on a test phone when this manual was prepared, so mobile screenshots are not included; screens follow the same layout and wording.') }] });

  // 13. Language & appearance
  out.push({ title: 'Language, Urdu and appearance', sections: [{ title: 'English and Urdu', html: p('Click the language button (اردو / English) at the top of any page. In Urdu the whole layout switches to right-to-left: the menu moves to the right and text aligns right. Phone numbers and property IDs stay left-to-right so they remain readable. Your choice is saved on your account and used on the mobile app too.') + (has('urdu-dashboard') ? fig('urdu-dashboard', 'The dashboard in Urdu (right-to-left)') + fig('urdu-clients', 'The client list in Urdu') : '') + p('The sun/moon button switches between light and dark theme; the layout also adapts to tablets.') + (has('dark-mode') ? fig('dark-mode', 'Dark theme') + fig('tablet', 'Tablet layout (My Day)') : '') }] });

  // 14. Workflows
  out.push({ title: 'End-to-end workflows', sections: workflows(m) });

  // 15–18
  out.push({ title: 'Troubleshooting', sections: [{ title: 'Common problems', html: table(['Problem', 'What to do'], troubleshooting(m)) }] });
  out.push({ title: 'Best practices', sections: [{ title: 'Working habits that keep the data useful', html: ul(bestPractices(m)) }] });
  out.push({ title: 'Frequently asked questions', sections: [{ title: 'FAQ', html: faq(m) }] });
  out.push({ title: 'Support and escalation', sections: [{ title: 'Getting help', html: p('For questions about how your business uses Dalliqo, ask your business owner or office manager first.') + table(['Support item', 'Details'], [['Support contact name', '[to be provided by your system provider]'], ['Support e-mail', '[to be provided]'], ['Support phone / WhatsApp', '[to be provided]'], ['Support hours', '[to be provided]'], ['Service level (response times)', '[as agreed in your service contract]']]) + p('When reporting a problem, include: your name and e-mail, what you were doing, the time it happened, the record (e.g. client name or property ID) and a screenshot if possible. Never send your password.') }] });
  return out;
}

function workflows(m) {
  const c = m.can;
  const W = [];
  if (m.key === 'owner') W.push({ title: 'Setting up the business and team', html: ol(['Register the business (Signing in chapter) and complete Settings → Business.', 'Review Settings → Client categories and add any your business needs.', 'Check Settings → Matching (the defaults suit most dealers).', 'Add each team member from Users with the right template; hand over temporary passwords in person.', 'Add your owners, then your properties with photos; then your active clients with requirements.', 'Each morning check the dashboard cards and Overdue follow-ups; each week review Team performance and Lead sources.', 'At month end download Excel reports of properties and clients from Reports.']) });
  if (c.createClients) W.push({ title: 'From inquiry to visit', html: ol(['A buyer calls or messages on WhatsApp. Search their number — if they exist, open them; otherwise click Add client.', 'Enter name, mobile, source (e.g. WhatsApp) and requirements: purpose, type, society, size and budget. Save.', 'Open the Matching properties tab and pick the best matches (look at the score and the ✓ reasons).', 'Press Send property on WhatsApp on a match, check the message, and press Send in WhatsApp.', 'Click Follow-up, choose Property visit with the property, date and time; save.', 'After the visit, Mark done with the outcome, add a note, and update the client’s status or requirements.', 'Review the Activity tab — every step above is recorded.']) });
  if (c.createProperties) W.push({ title: 'Listing a new property', html: ol(['Add or find the owner.', 'Add property with type, location, size, asking price and owner; save.', 'Upload photos (first photo becomes the cover) and documents.', 'Open Matching clients and contact the best matches.', 'Change the status when a token is received (Reserved) and when the deal closes (Sold/Rented).']) });
  if (c.editProperties) W.push({ title: 'Weekly listing check', html: ol(['Open the dashboard card “Listings to re-verify” (or Properties → Verification: Needs verification).', 'Call each owner; click Confirm availability with a note, update the price, or change the status.', 'The list empties as you go, and buyers only see current stock.']) });
  if (c.reports) W.push({ title: 'Monthly review', html: ol(['Set the dashboard range to 30 days.', 'Check Lead sources & conversion: which sources bring clients who close?', c.audit || m.key === 'owner' ? 'Check Team performance for overdue follow-ups and discuss with the team.' : 'Note follow-up performance and new records.', c.exports ? 'Download Excel reports of properties (sold/rented) and clients for the accounts.' : '']).replace('<li></li>', '') });
  if (!c.createClients && !c.reports) W.push({ title: 'Answering a caller’s question', html: ol(['Type the caller’s name or number in the search box at the top.', 'Open the client and read the Requirements, recent Notes and Activity.', 'To check a property, search its ID (e.g. RE-000012) and read the status, price and when availability was last confirmed.', 'Pass any change request to a colleague with edit access — you cannot change records yourself.']) });
  return W;
}

function troubleshooting(m) {
  const c = m.can;
  return [
    ['Unable to sign in', 'Check the e-mail spelling and Caps Lock. After several wrong attempts the account is locked for a short time — wait 15 minutes. If your account was suspended you will see a message; contact the owner.'],
    ['Forgot password', 'Use “Forgot password?” on the sign-in page, or ask the owner to set a temporary password.'],
    ['“Can’t reach the server”', 'Your internet connection or the server is down. Check your connection and try again in a minute. On the mobile app keep working offline — changes will sync later.'],
    ['I can’t see a client or property', 'Clear the filters and search box; check the status filter (sold/inactive). Deleted records are no longer shown. If a colleague just added it, wait a moment or refresh.'],
    ['No matching properties appear', 'Matches need a requirement with purpose, and properties that are Available. Check the budget is in full rupees, the society spelling matches the property, and the size unit is right. Scores below 60 are not shown.'],
    ...(c.uploadDocuments ? [['A photo or document fails to upload', 'Only JPEG/PNG/WebP photos, MP4/MOV/WebM videos, and PDF/Word/Excel/image documents are accepted, within the size limits. Renamed files (e.g. an .exe renamed to .jpg) are rejected. Try a smaller file or a better connection.']] : []),
    ['A follow-up doesn’t appear', 'The list shows “Assigned to me” by default — switch to Everyone. Check the right tab (Today / Upcoming / Overdue / Done).'],
    ['Notifications are not received', 'In-app notifications appear under the bell. Push notifications on a closed phone app only work if Firebase has been configured for your business; allow notifications for the app in your phone settings.'],
    ['Sync is pending or failed (mobile)', 'Open Settings → Sync. Pending changes send automatically when online. A failed change shows the reason (for example an invalid phone number) — fix and retry, or discard it.'],
    ['A button is missing / “You do not have permission”', 'Your access level does not include that action. Ask the business owner if you need it.'],
    ...(c.exports ? [['Export fails', 'Narrow the filters if you have more than 10,000 rows. Use Excel for Urdu text.']] : []),
  ];
}

function bestPractices(m) {
  const c = m.can;
  return [
    'Search by mobile number before adding a client; update the existing record instead of creating a new one.',
    'Write phone numbers in full (0300 1234567) and amounts in full rupees (15000000), never “1.5 crore” in a number field.',
    'Use the same spelling for societies and blocks every time (pick one: “DHA Karachi”, “Block 13-D”).',
    c.createClients && 'Always record the client’s source — it powers the lead-source report.',
    c.createFollowUps && 'Never end a conversation without a next step: schedule a follow-up before you hang up.',
    c.createFollowUps && 'Keep the Overdue tab empty: complete, reschedule or cancel — don’t ignore.',
    c.editProperties && 'Confirm listing availability with owners at least every 30 days.',
    c.notes && 'Write a short note after every important call or visit — the next colleague will thank you.',
    'Do not store CNIC numbers or other identity details in notes; upload identity documents only when necessary.',
    'Lock your computer and phone when you step away; never share your login.',
    c.exports && 'Delete exported files you no longer need, and never send them to anyone outside the business.',
  ].filter(Boolean);
}

function faq(m) {
  const c = m.can;
  const q = [
    ['Is my data shared with other businesses?', 'No. Each business’s data is completely separate; another business cannot see or even detect your records.'],
    ['Can I use Dalliqo on my phone?', 'Yes — the mobile app works with the same account and also works offline.'],
    ['What happens if I lose my phone?', 'Your data is stored in the cloud. Ask the owner to sign you out of the lost device (or do it in Settings → Security), then sign in on the new phone.'],
    ['Why does a property say “Needs verification”?', 'It is available but nobody has confirmed with the owner in the last 30 days. Someone with edit access should call the owner and click Confirm availability.'],
    ['Does Dalliqo send WhatsApp messages automatically?', 'No. It prepares the message and opens WhatsApp; you press Send.'],
    ['Why can’t I delete a record?', c.deleteClients ? 'Owners with linked properties cannot be deleted until their properties are moved or deleted.' : 'Deleting is limited to the owner and managers so that records are not lost by mistake.'],
    ['Can I see who changed a price?', c.audit ? 'Yes — open the Audit log.' : 'The property’s Activity tab shows price and status changes; the full audit log is available to the owner and managers.'],
    ['Is the app available in Urdu?', 'Yes, on web and mobile, with right-to-left layout. PDF reports do not yet render Urdu text; use Excel.'],
  ];
  return q.map(([a, b]) => `<p class="q"><b>${a}</b></p><p>${b}</p>`).join('');
}
