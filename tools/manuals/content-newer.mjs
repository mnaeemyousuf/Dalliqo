// Chapters for the features added after the first edition of the manuals: lead management,
// verification, the advanced deal tools, rentals, installments, finance reports, marketing,
// AI, the newer reports and the business settings. Every section is included only for access
// levels that hold the permission the API checks (role templates in shared/src/roles.ts).
import { createRequire } from 'node:module';

const { ROLE_PRESETS, ALL_PERMISSIONS } = createRequire(import.meta.url)('../../shared/dist/index.js');
const PRESET = { owner: ALL_PERMISSIONS, manager: ROLE_PRESETS.MANAGER, agent: ROLE_PRESETS.AGENT, member: ROLE_PRESETS.MEMBER, accountant: ROLE_PRESETS.ACCOUNTANT, viewer: ROLE_PRESETS.VIEWER };

const p = (...xs) => xs.map((x) => `<p>${x}</p>`).join('');
const ul = (items) => `<ul>${items.filter(Boolean).map((i) => `<li>${i}</li>`).join('')}</ul>`;
const ol = (items) => `<ol class="steps">${items.filter(Boolean).map((i) => `<li>${i}</li>`).join('')}</ol>`;
const note = (t) => `<div class="callout note"><b>Note.</b> ${t}</div>`;
const tip = (t) => `<div class="callout tip"><b>Tip.</b> ${t}</div>`;
const warn = (t) => `<div class="callout warn"><b>Important.</b> ${t}</div>`;
const ui = (t) => `<span class="ui">${t}</span>`;

/** Returns the extra chapters for one manual. `fig(id, caption)` inserts a screenshot when that role has it. */
export function newerChapters(m, fig) {
  const P = new Set(PRESET[m.key]);
  const can = (...x) => x.every((k) => P.has(k));
  const out = [];

  // ── Leads ──
  const leads = [
    {
      title: 'Lead score and temperature',
      html:
        p(`Every client has a ${ui('lead score')} out of 100 and a temperature: ${ui('Hot')}, ${ui('Warm')} or ${ui('Cold')}. The score is worked out from the budget, preferred location, client category, how serious the client is, how recently you were in contact, the follow-up history and how soon they want to buy or rent.`) +
        p('Open a client to see the score with the reasons behind it — for example “Budget fits 6 listings” or “No contact for 12 days”. The list of clients can be filtered by temperature so you can call the hot leads first.') +
        fig('x-client-lead', 'A client page with the lead score and the reasons behind it') +
        tip('The score changes by itself when you log a call, complete a follow-up or update the requirements. You never type a score.'),
    },
    {
      title: 'Where leads come from and who gets them',
      html:
        p('Each client records its source: Facebook, Instagram, WhatsApp, Zameen, OLX, the website, walk-in, phone call, referral or other. Website and WhatsApp inquiries arrive by themselves and create the client for you.') +
        p(`New leads go to the agent of the listing they asked about. If there is none, the business’s rule decides: left unassigned, shared turn by turn between chosen agents, or by source. Leads nobody owns appear under the ${ui('Unassigned')} filter of the client list.`) +
        (can('clients:update') ? p(`To give a lead to someone else, open the client and use ${ui('Assign')}. The change and the previous owner are kept in the client’s history.`) : ''),
    },
  ];
  if (can('clients:update')) {
    leads.push({
      title: 'Changing many clients or properties at once',
      html:
        p(`In the table view of ${ui('Clients')} or ${ui('Properties')}, tick the box at the start of each row you want (or the box in the header for the whole page). A bar appears above the table.`) +
        ol([`Choose a person under ${ui('Assign to…')} and press ${ui('Apply')} to hand the selected records to them.`, `Choose a status under ${ui('Change status…')} and press ${ui('Apply')}.`, can('clients:delete') && `Press ${ui('Delete')} and confirm to remove them.`, `Press ${ui('Clear')} to untick everything.`]) +
        fig('x-bulk', 'Two clients selected, with the bulk action bar') +
        note('Each record is checked exactly as if you had changed it alone. If some cannot be changed, the message tells you how many and why; the rest are still done.'),
    });
  }
  if (can('clients:create')) {
    leads.push({
      title: 'Importing leads from Excel',
      html: p(`On the ${ui('Clients')} page click ${ui('Import')}, download the template, fill one row per lead and upload the file. Rows whose phone number already exists are skipped and listed, so nothing is duplicated.`) + p(`${ui('Save view')} above the filters keeps the current filter combination under a name, so you can reopen “Hot leads in DHA” with one click.`),
    });
  }
  out.push({ title: 'Lead management', sections: leads });

  // ── Verification and listing tools ──
  const ver = [];
  if (can('verification:submit') || can('verification:decide')) {
    ver.push({
      title: 'Property verification',
      html:
        warn('Verification here is your agency’s own internal check. It is not a government confirmation of ownership and must never be described to a client as one.') +
        p(`Open a property and find the ${ui('Verification')} panel. It shows the status (Not submitted, Pending, In review, Changes requested, Approved or Rejected), the checklist, missing documents and documents about to expire.`) +
        ol([
          can('verification:submit') && `Upload the documents (CNIC, ownership proof, society NOC and so on) on the ${ui('Documents')} tab, then press ${ui('Submit for verification')}.`,
          can('verification:decide') && `A verification officer is assigned and ticks each checklist item as it is confirmed.`,
          can('verification:decide') && `The officer presses ${ui('Decide')} and chooses Approved, Changes requested or Rejected, writes remarks and sets the date of the next check.`,
          'The decision, who made it and when are kept in the verification history.',
        ]) +
        (can('verification:decide') ? p(`${ui('Verifications')} in the left menu is the queue of listings waiting for a decision. Switch on ${ui('Assigned to me')} to see only yours.`) + fig('x-verifications', 'The verification queue') : ''),
    });
  }
  ver.push({
    title: 'Listing quality, descriptions, price guide and QR code',
    html:
      p('On a property page you will also find:') +
      ul([
        `<b>Listing quality</b> — a score with a list of what is missing (photos, price, description, map pin and so on). Fix the red items to make the listing easier to sell.`,
        can('properties:update') && `<b>${ui('Write description')}</b> — writes a headline and description from the listing’s facts, in English or Urdu. Read it before you use it.`,
        `<b>Price guide</b> — an indicative range from similar listings and sold deals. It is an estimate, not a valuation.`,
        `<b>QR code</b> — a code that opens the listing, for signboards and brochures.`,
        can('marketing:manage') && `<b>${ui('Publish')}</b> — puts the listing on your agency website (see Marketing).`,
      ]) +
      note('The owner’s minimum acceptable price, plot number and CNIC are never included in descriptions, brochures or the website.'),
  });
  out.push({ title: 'Verification and listing tools', sections: ver });

  // ── Deals: pipeline and negotiation ──
  if (can('deals:read')) {
    const d = [
      {
        title: 'The deal pipeline',
        html:
          p(`${ui('Deals')} opens as a board with one column per stage. The usual stages are Inquiry, Qualified, Site visit, Negotiation, Offer accepted, Token received, Agreement signed, Payment, Transfer, then Won or Lost. Your business owner can switch off stages you do not use and rename them, so your board may show fewer columns or different names.`) +
          (can('deals:update') ? p('Open a deal and click a stage in the bar at the top to move it. Closing as lost asks for a reason. If your business requires approval, closing as won sends a request to a manager first.') : ''),
      },
      {
        title: 'Offers, counter-offers and the closing checklist',
        html:
          p(`On the deal’s ${ui('Negotiation')} tab record every offer from the buyer and every counter-offer from the seller with its amount and a note. Accepting an offer sets the agreed price and closes the other open offers.`) +
          fig('x-deal-negotiation', 'A deal with its offers and closing checklist') +
          p('The closing checklist lists what must be done before the deal is finished (documents collected, buyer and seller verified, token received, agreement signed, dues checked, transfer papers, payment, commission). Tick each item as it is done; the name of the person and the time are saved.'),
      },
    ];
    if (can('commissions:manage') || can('deals:approve')) {
      d.push({
        title: 'Commission: approvals, adjustments and disputes',
        html: ul([
          can('deals:approve') && `<b>Approvals.</b> When your business requires it, a deal closing as won and each agent payout must be approved before it goes ahead. Pending requests show a banner on the deal with ${ui('Approve')} and ${ui('Reject')}.`,
          can('commissions:manage') && `<b>Adjustments.</b> ${ui('Adjust')} adds or subtracts an amount from the expected commission with a reason, for example a discount agreed with the client. The original figures are not overwritten.`,
          can('commissions:manage') && `<b>Disputes.</b> ${ui('Dispute')} records a disagreement about the commission and, later, how it was resolved.`,
          can('commissions:manage') && `<b>Other dealers and referrals.</b> Shares for an outside dealer or a referral are listed on the deal; record what you pay them with ${ui('Pay')}.`,
          can('commissions:manage') && `<b>Vouchers and receipts.</b> Each commission payment has a receipt and each payout a payment voucher, both as PDF.`,
        ]),
      });
    }
    out.push({ title: 'Deals: pipeline, negotiation and approvals', sections: d });
  }

  // ── Rentals ──
  if (can('rentals:read')) {
    const manage = can('rentals:manage');
    out.push({
      title: 'Rental management',
      sections: [
        {
          title: 'Leases and rent',
          html:
            p(`${ui('Rentals')} lists every lease with its tenant, landlord, monthly rent, next due date and any overdue amount. The cards at the top show the monthly rent roll, what is due and collected this month, overdue rent and deposits held.`) +
            fig('x-leases', 'The list of leases with the rent roll') +
            p('Open a lease to see its rent schedule month by month, payments, late fees, the security deposit, inspections, notices and maintenance expenses.') +
            fig('x-lease', 'A lease with its rent schedule'),
        },
        ...(manage
          ? [
              {
                title: 'Creating a lease and recording rent',
                html:
                  ol([`Click ${ui('New lease')}, choose the property and the tenant, and enter the start and end dates, monthly rent, the day of the month rent is due, the security deposit and any late-fee rule.`, 'Save. The rent schedule for the whole period is created for you.', `When rent is paid, open the lease, click ${ui('Record rent')} and enter the amount, date and method. A part payment is accepted; the rest stays due. The oldest unpaid month is settled first.`, `Download the receipt with the PDF button next to the payment.`]) +
                  p(`Other actions on a lease: ${ui('Waive')} a month’s rent with a reason, ${ui('Renew')} with a new end date and rent, ${ui('End lease')} (with the deposit refund), add an ${ui('Inspection')} (move-in, routine or move-out), send a ${ui('Tenant notice')} with a printable PDF, and book a ${ui('Maintenance expense')}.`) +
                  note('Reminders are sent before rent is due, when it is overdue and before a lease ends. The owner sets how many days ahead.'),
              },
            ]
          : []),
      ],
    });
  }

  // ── Installments and finance reports ──
  if (can('finance:read')) {
    const fin = [
      {
        title: 'Installment plans',
        html:
          p(`${ui('Installments')} holds payment plans for properties sold on installments: booking amount, down payment, then monthly, quarterly or custom installments. Each plan shows what is paid, what is outstanding and what is overdue.`) +
          fig('x-installments', 'Installment plans') +
          fig('x-installment', 'One plan with its schedule') +
          (can('finance:create') ? ol([`Click ${ui('New plan')}, choose the client, enter the total, booking and down payment, how often installments fall due, how many and the first date.`, 'Save. The schedule is created for you.', `To record a payment open the plan and click ${ui('Record payment')}. A part payment is accepted and the oldest installment is settled first.`, 'Download a receipt for any payment as PDF.']) : ''),
      },
    ];
    if (can('reports:read')) {
      fin.push({
        title: 'Finance reports',
        html:
          p(`In ${ui('Income & expense')} and ${ui('Reports')} you will find:`) +
          ul(['<b>Income statement</b> — income and expenses by category for any period, the net result and the margin, with a row per branch.', '<b>Cash flow</b> — money in and out month by month with a running total.', '<b>Receivables and payables</b> — commission, installments and rent still to come in, and what is owed to agents and other dealers, grouped by how old they are.', '<b>Agent commission statement</b> — what each agent earned, was paid and is still owed, as a PDF.']),
      });
    }
    if (can('finance:create')) {
      fin.push({
        title: 'Refunds and payment vouchers',
        html: p(`To give money back, open the income entry and click ${ui('Refund')}. Enter the amount, date, method and reason. The refund is saved as its own entry linked to the original; the original entry is never changed. You cannot refund more than was received.`) + p(`Every expense has a ${ui('Voucher')} button that produces a payment voucher PDF for signature.`),
      });
    }
    out.push({ title: 'Installments and finance reports', sections: fin });
  }

  // ── Marketing ──
  if (can('clients:read')) {
    const mk = [
      {
        title: 'Inquiries',
        html:
          p(`${ui('Marketing → Inquiries')} lists messages sent from your agency website and WhatsApp. Each inquiry has already created (or been linked to) a client, been given to an agent and had a first follow-up scheduled.`) +
          fig('x-inquiries', 'Website and WhatsApp inquiries') +
          (can('clients:update') ? p(`Mark an inquiry ${ui('Contacted')} once you have spoken to the person, or ${ui('Spam')} if it is not genuine.`) : ''),
      },
      {
        title: 'Campaigns',
        html: p(`${ui('Marketing → Campaigns')} records each advert or promotion with its channel, budget and spend. Leads that arrive through a campaign’s link are counted for it, so you can see leads, deals won, cost per lead and return for each one.`) + fig('x-campaigns', 'Campaigns with their results'),
      },
    ];
    if (can('marketing:manage')) {
      mk.push({
        title: 'Agency website, portals and WhatsApp Business',
        html:
          p(`${ui('Marketing → Website')} switches your public agency page on, sets its address, tagline, contact numbers and whether agents are shown. Publish a listing from its property page; each published listing has its own link, photos, details and an inquiry form.`) +
          fig('x-website', 'Website settings') +
          p(`<b>Portals.</b> On a client or owner page, ${ui('Portal')} creates a private link you can send on WhatsApp. Clients see their requirements and matched properties, can save favourites and ask for a visit. Owners see their listings, inquiries and offers. Switches under ${ui('Portal settings')} decide what is shown.`) +
          p(`<b>WhatsApp Business.</b> ${ui('Marketing → WhatsApp')} holds the business number and message templates. Until it is connected, the system prepares each message and opens WhatsApp for you to press Send.`),
      });
    }
    out.push({ title: 'Marketing and lead generation', sections: mk });
  }

  // ── Assistant ──
  out.push({
    title: 'The assistant',
    sections: [
      {
        title: 'Asking questions in plain language',
        html:
          p(`${ui('Assistant')} answers questions about your own business data, in English, Urdu or Roman Urdu — for example “Which leads have not been contacted in seven days?”, “Show properties for a 2 crore budget in DHA” or “What commission do we expect this month?”.`) +
          fig('x-assistant', 'The assistant') +
          ul(['It only sees what you are allowed to see. If you cannot open something yourself, the assistant cannot show it to you.', 'It never changes data. It may suggest a follow-up or a note; nothing is saved until you press Confirm.', 'Forecasts and price ranges are estimates, not guarantees or valuations.']) +
          note('The assistant is part of the Enterprise plan and needs to be switched on by your business owner. Without it, descriptions and client summaries are still produced from built-in templates.'),
      },
    ],
  });

  // ── Reports ──
  if (can('reports:read')) {
    out.push({
      title: 'Management reports',
      sections: [
        {
          title: 'Business overview, agents and branches',
          html:
            p(`${ui('Reports')} also shows, for any date range and branch:`) +
            ul(['<b>Business overview</b> — properties, leads, deals, commission and money in one place.', '<b>Lead report</b> — leads by source and temperature, conversion, response time, how old open leads are and why leads were lost.', '<b>Inventory report</b> — how long listings have been on the market, by status and type, and the oldest listings.', '<b>Agent performance</b> — leads assigned and contacted, follow-ups, site visits, negotiations, deals closed, commission, conversion and response time, with Excel and PDF downloads.', '<b>Branches</b> — the same figures per branch, compared with each branch’s monthly targets.', '<b>Forecast</b> — likely commission, installments and rent for the coming months.']) +
            fig('x-reports', 'Reports — agent performance'),
        },
      ],
    });
  }

  // ── Owner settings ──
  if (m.key === 'owner') {
    out.push({
      title: 'Business settings for the newer features',
      sections: [
        {
          title: 'Automation and lead scoring',
          html:
            p(`${ui('Settings → Automation & scoring')} lists the automatic alerts: hot lead not contacted, lead going quiet, listing due for re-verification, listing about to expire, deal stuck in negotiation, agreement ending, rent due and overdue, installment overdue. Switch each one on or off and set after how many minutes or days it fires.`) +
            fig('x-automation', 'Automation rules') +
            p('On the same tab, set how much each factor counts in the lead score and from which score a lead is hot or warm.'),
        },
        {
          title: 'Deal pipeline and commission rules',
          html:
            p(`${ui('Settings → Matching')} now also holds:`) +
            ul(['<b>Deal pipeline</b> — switch off stages you do not use, rename any stage in English and Urdu, and set each stage’s chance to close (used by the forecast). Inquiry, Won and Lost are always on.', '<b>Commission rules</b> — different default buyer and seller rates for rentals or for a property type. The first rule that fits a new deal is used.', '<b>Approvals</b> — whether closing a deal as won, and paying an agent, need approval first.', '<b>Who gets new leads</b> — set under Marketing → Website.']) +
            fig('x-pipeline', 'Deal pipeline settings'),
        },
        {
          title: 'Security: API access and data retention',
          html:
            p(`${ui('Settings → Security')} has two more cards:`) +
            ul([`<b>API access</b> — create a key so your own website or other software can read and add records. Tick only the permissions it needs. The key is shown once; copy it then. Press ${ui('Revoke')} to stop a key working immediately.`, '<b>Data retention</b> — choose how long the audit log and activity feed are kept (or forever). Clients, properties, deals, payments, agreements and documents are never deleted by this setting.']) +
            fig('x-security', 'API access and data retention') +
            warn('Treat an API key like a password. Anyone who has it can read the records it was given access to.'),
        },
        {
          title: 'Subscription',
          html: p(`${ui('Settings → Subscription')} shows your plan, what it includes, how many users, branches and how much storage you use, and the billing history. Use ${ui('Request')} on another plan to ask for an upgrade or downgrade.`) + fig('x-subscription', 'Subscription and usage') + fig('x-public-site', 'The public agency website'),
        },
      ],
    });
  }
  return out;
}

/** What the mobile app adds in its More menu, for the mobile chapter. */
export function mobileExtras(m) {
  const P = new Set(PRESET[m.key]);
  const can = (...x) => x.every((k) => P.has(k));
  return ul([
    (can('reports:read') || can('rentals:read')) && '<b>Reports.</b> Business overview, leads, inventory, agent performance, branches and targets, team, forecast, income statement, cash flow, receivables and payables, agent statements and the rent roll.',
    can('clients:read') && '<b>Marketing.</b> Inquiries, campaigns and — for those who manage marketing — the website, portal switches, WhatsApp Business and who gets new leads.',
    (can('verification:submit') || can('verification:decide')) && '<b>Verification queue.</b> Listings waiting for a decision.',
    can('clients:update') && '<b>Bulk actions.</b> Tick several clients or properties, then assign, change status or delete them together.',
    '<b>More actions (⋯) on a record.</b> On a property: verification, listing quality, write a description, QR code. On a deal: checklist, approvals, adjustments, dispute, receipts and vouchers. On a lease: renew, end, waive, inspection, notice. On an income entry: refund.',
    can('rentals:manage') && '<b>New lease</b> and, with finance access, <b>new installment plan</b> from the + button on those lists.',
    '<b>Administration.</b> Subscription and, for the owner, business profile, automation, lead scoring, deal pipeline, commission rules, data retention, API keys and Excel import.',
  ]) + note('These newer screens work with live data, so they need an internet connection. Clients, properties, owners, follow-ups, notes, deals, income and expense and agreement drafts still work offline.');
}
