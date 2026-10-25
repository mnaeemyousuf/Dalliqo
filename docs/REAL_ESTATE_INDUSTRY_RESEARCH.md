# Real Estate Industry Research

Prepared: 18 October 2026 · Scope: property brokerages/dealers in Pakistan (Karachi first), with
reference to international real estate CRM practice.

## How to read this document

* **Evidence levels.** Every finding is labelled:
  * **Validated (source)** — supported by an identifiable publication, official page or product
    documentation linked below.
  * **Weak evidence** — supported only by vendor marketing, a blog or a forum post; useful as a
    signal, not as proof.
  * **Hypothesis** — a reasoned expectation from the product brief or professional judgement that
    must be confirmed in customer interviews.
* **No fabricated data.** Where research could not find a figure (for example the number of
  WhatsApp users in Pakistan, or how many listings on Pakistani portals are fake), this document
  says so instead of estimating.
* **Not legal advice.** Regulatory items (AML registration, tenant registration, data protection)
  are flagged for review by a Pakistani lawyer before any compliance claim is made to customers.
* Research was done with web search on 18 October 2026; vendor feature descriptions can change.

## 1. Sources consulted

| # | Source | Type | Date | URL |
|---|---|---|---|---|
| S1 | NAR 2024 Technology Survey (PDF) | Industry survey (US) | Aug 2024 | https://cdn.nar.realtor/sites/default/files/documents/2024-technology-survey-report-08-08-2024.pdf |
| S2 | NAR 2023 Technology Survey (PDF) | Industry survey (US) | Jan 2024 | https://nar.realtor/sites/default/files/documents/2023-technology-survey-01-03-2024.pdf |
| S3 | "Speed to Lead in Real Estate" (Luxury Presence) — cites the 2007 MIT/InsideSales lead-response study | Vendor article | n/d | https://www.luxurypresence.com/?p=53210 |
| S4 | "Speed-to-Lead: The Mission-Critical Step Where Most Agents Fall Short" (BoomTown via RISMedia) | Vendor article | n/d | https://newsletter.rismedia.com/tracking/view/29539/null/{SubscriberID}/108053 |
| S5 | Follow Up Boss Help Center — duplicate handling and merging | Product documentation | n/d | https://help.followupboss.com/hc/en-us/articles/11460704008855 |
| S6 | Follow Up Boss Help Center — lead flow / smart lists | Product documentation | n/d | https://help.followupboss.com/hc/en-us/articles/4402121268631 |
| S7 | BoldTrail (formerly kvCORE) — Smart AI-powered lead scoring | Vendor blog | n/d | https://boldtrail.com/blog/maximize-conversions-with-boldtrails-smart-ai-powered-lead-scoring/ |
| S8 | Propertybase (Lone Wolf) product page | Vendor page | n/d | https://propertybase.lwolf.com/ |
| S9 | Zameen.com — "Most common property frauds you need to avoid" | Portal blog | n/d | https://www.zameen.com/blog/most-common-property-frauds-need-avoid.html |
| S10 | IIPS — "Common Real Estate Scams in the Pakistani Market" | Think-tank article | n/d | https://iips.com.pk/common-real-estate-scams-in-the-pakistani-market/ |
| S11 | Rest of World — "How Zameen dominated Pakistan's real estate market" | Journalism | 2021 | https://restofworld.org/2021/how-zameen-dominated-pakistans-real-estate-market/ |
| S12 | DataReportal — Digital 2025: Pakistan | Statistics | 2025 | https://datareportal.com/reports/digital-2025-pakistan |
| S13 | Profit (Pakistan Today) — "Pakistan among top countries imposing internet shutdowns in 2024" (Access Now / Top10VPN data) | Journalism | 3 Mar 2025 | https://profit.pakistantoday.com.pk/2025/03/03/pakistan-among-top-countries-imposing-internet-shutdowns-in-2024-report/ |
| S14 | Zameen.com — "How much does a real estate agent get in commission" | Portal blog | n/d | https://www.zameen.com/blog/how-much-does-a-real-estate-agent-get-in-commission.html |
| S15 | Graana — "The only guide you'll ever need to selling and transferring property in Pakistan" | Portal blog | n/d | https://www.graana.com/blog/the-only-guide-youll-ever-to-selling-and-transferring-property-in-pakistan/ |
| S16 | Zameen.com — "Plot size conversions in Pakistan" | Portal blog | n/d | https://www.zameen.com/blog/plot-size-conversions-pakistan.html |
| S17 | ProPakistani — "FBR mandates DNFBP requirement for real estate sector" | Journalism | 2 Sep 2022 | https://propakistani.pk/2022/09/02/fbr-mandates-dnfbp-requirement-for-real-estate-sector/ |
| S18 | FBR press release — "FBR completes FATF actions on DNFBPs ahead of deadline" | Official | 2021 | https://fbr.gov.pk/pr/fbr-completes-fatf-actions-on-dnfbps-ahead-of/163201/2021 |
| S19 | Karachi Police — "How to apply for Tenant Registration" | Official | n/d | https://karachipolice.gov.pk/services/how-to-apply-for-tenant-registration-process/ |
| S20 | Sindh Information of Temporary Residents Act 2015 (PDF via SHRC) | Statute | 2015 | https://www.shrc.org.pk/downloads/laws/Sindh/The-Sindh-Information-of-Temporary-Residents-Act-2015.pdf |
| S21 | Commoner Law — "Data privacy in Pakistan without a PDP Act (2026)" | Legal guide | 2026 | https://commoner-law.com/pakistan/data-privacy-digital-rights/data-privacy-without-pdp-act |
| S22 | Digital Rights Monitor — reporting on leaked mobile-subscriber CNIC data | Journalism | n/d | https://digitalrightsmonitor.pk/a-privacy-nightmare-rouge-website-publicises-mobile-subscribers-cnic-data-in-pakistan/ |
| S23 | Click-to-chat link format (`wa.me/<number>?text=`), third-party guide summarising WhatsApp's help centre | Developer guide | n/d | https://marketing.help.dotdigital.com/en/articles/11331301-click-to-chat-for-whatsapp |
| S24 | Software directories listing Pakistani real estate CRMs (Ladder CRM, Broker92, RealtyCRM, HysabOne) | Directories / vendor pages | n/d | https://www.softwaresuggest.com/real-estate-software/pakistan · https://hysabone.com/industries/real-estate/ |

## 2. Findings from the original requirements (the customer brief)

These come from the owner's written requirements, not from external research. They are the agreed
scope and are treated as validated *for this customer*.

| Pain point / need | Proposed solution | Target role | Status in product |
|---|---|---|---|
| Father and son must see each other's clients and properties instantly | Shared business account, real-time sync | Owner, member | Implemented (Socket.IO + offline sync) |
| Hard to find which property suits which buyer | Automatic two-way weighted matching with reasons | Agent, owner | Implemented |
| Follow-ups are forgotten | Follow-ups, reminders, My Day, overdue tracking | Agent | Implemented |
| Data lost when a phone is lost/stolen | Cloud backup; sign in on a new phone to restore | All | Implemented (server is the system of record) |
| Work continues without internet | Offline-first mobile app with sync queue and conflict handling | Field agent | Implemented, not yet device-tested |
| Urdu-speaking users | English + Urdu with right-to-left layout | All | Implemented (web verified; Urdu text in PDF exports since 25 Oct 2026) |
| Need reports for the business | Dashboard analytics, Excel/PDF exports | Owner, accountant | Implemented |

## 3. Findings supported by external research

| # | Pain point | Evidence | Source | Market relevance | Proposed solution | Target role | Business value | Effort | Dependencies | Priority | Evidence level |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | **Slow lead response loses deals** | A 2007 MIT/InsideSales study of 1.25M+ leads reported a call within 5 minutes was ~21× more likely to *qualify* the lead than one at 30 minutes (often misquoted as "conversion"). BoomTown reported an average online-lead response of ~90 minutes across 40,000+ agents. | S3, S4 | International; mechanism applies to WhatsApp/phone inquiries in Pakistan (unmeasured locally) | Record every inquiry instantly (mobile, offline), assign an owner, surface new and unattended clients in My Day; future: "uncontacted for X hours" alert | Agent, owner | High — every lost inquiry is lost commission | Low–medium | None | P1 (partly done: My Day, assignment, last-contacted) | Weak evidence for exact multipliers (old, vendor-reported); direction of effect is consistent across sources |
| F2 | **Duplicate client records** | Follow Up Boss treats duplicates as a core problem: it auto-merges imports/web leads when the email matches, or phone *and* name match, and provides manual merge. | S5 | Universal; a dealer receives the same buyer via calls, WhatsApp and walk-ins | Detect duplicate phone numbers on create (web: server check with "open existing / save anyway"; mobile: offline check) | Agent, operator | Cleaner data, no two agents chasing one buyer | Low | None | P1 — **implemented in this release** | Validated (product documentation) |
| F3 | **Outdated / fake listings** | Zameen's own blog warns about fake listings and implausible prices; IIPS describes listings for property that doesn't exist or isn't for sale; Rest of World reports that listings had to be manually checked for fakes and price gouging. | S9, S10, S11 | Pakistan-specific and directly relevant to dealer credibility | Track when availability was last confirmed with the owner; flag available listings not verified in 30 days; one-click "Confirm availability" with note and audit trail; dashboard count | Agent, owner | Credibility with buyers; fewer wasted visits | Low | None | P1 — **implemented in this release** | Validated (multiple sources, though no prevalence figure found) |
| F4 | **WhatsApp is the main client channel** | Portal listing data includes a dedicated WhatsApp contact field per broker; dealer channels broadcast daily rates on WhatsApp. No reliable count of WhatsApp users in Pakistan was found (DataReportal reports 116M internet users and 66.9M social-media identities, Jan 2025). | S12, S24 (and portal data via scraper documentation — weak) | Pakistan-specific | One-tap WhatsApp; **send a matched property to the buyer with a pre-filled message** (click-to-chat; the agent presses Send); log the contact on the timeline | Agent | Faster sharing, consistent message, contact history | Low | WhatsApp app on the device; no API account needed | P1 — **implemented in this release** | Weak-to-moderate; usage *dominance* is a hypothesis to confirm in interviews |
| F5 | **Connectivity is unreliable** | Access Now counted 21 internet shutdowns in Pakistan in 2024 (worst on record); Top10VPN estimated USD 1.62bn in losses. | S13 | Pakistan-specific | Offline-first mobile app; local data; queued changes sync automatically | Field agent | Work continues during outages | Done | — | P0 (already core) | Validated |
| F6 | **Commission is custom, not law, and varies** | Zameen: no specific law governs dealer commissions; typically ~1% (sometimes per side), up to 2%; Karachi often 2% under PKR 1 crore. Graana describes 1% per side. | S14, S15 | Pakistan-specific | Future commission tracking per deal with configurable % per side and payment status (not a fake module now) | Owner, accountant | Fewer disputes, clear earnings | Medium | Deal/transaction model | P2 | Weak-to-moderate (portal blogs, consistent with each other) |
| F7 | **Local area units differ (marla 225 vs 272.25 sq ft)** | Modern standard 1 marla = 225 sq ft; older Lahore/legacy standard 272.25 sq ft; 1 kanal = 20 marla. | S16 | Pakistan-specific; Karachi mostly uses sq yd | Store size + unit; convert with **business-configurable** sq-ft-per-unit (already in Settings) | Owner | Correct matching and filters across units | Done | — | Done | Weak (blogs) but matches common practice |
| F8 | **AML registration for agents** | Agents must register with the FBR as DNFBPs (AML Act 2010 s.6A); development authorities may not process transfers for unregistered agents (from 1 Jan 2021). | S17, S18 | Pakistan-specific, compliance | Store the agency's DNFBP registration number in business profile; optional KYC checklist per deal (future) | Owner | Compliance readiness | Low | **Legal review required** | P3 | Validated (official + press), but product claims need legal review |
| F9 | **Tenant registration in Sindh** | Karachi Police: under the Sindh Information of Temporary Residents Act 2015, owner, tenant or property dealer must register tenancy details with police; online TRUST portal exists. | S19, S20 | Karachi rentals | Rental deal checklist: "tenant registered with police" + reference no. + document upload (future rental module) | Agent (rentals) | Helps dealers handle rentals properly | Medium | Rental/tenancy module | P2 | Validated (official), **legal review before advising customers** |
| F10 | **Personal data and CNIC privacy** | Pakistan has no enacted general data-protection law yet (2023/2025 drafts not passed); PECA 2016 covers unauthorised access; large CNIC data leaks have been reported. | S21, S22 | Pakistan-specific | Keep identity documents private (signed expiring links — done); role-based access (done); audit log (done); avoid storing CNIC numbers in free text; future: restricted "Identity" document category permission | Owner | Trust, future compliance | Low–medium | Legal review | P2 (R-09 / R-10) | Validated (legal guide + press) |
| F11 | **Agent CRMs prioritise who to call** | BoldTrail markets AI lead scoring from engagement + demographics feeding automated follow-ups; Follow Up Boss uses smart lists by stage, last contact and source. | S6, S7 | International; scoring needs data volume | Transparent rule-based priority (overdue + priority + last contacted) before any AI scoring | Agent | Better daily focus | Low–medium | Enough activity history | P2 | Vendor claims (weak) |
| F12 | **Lead-source and conversion visibility** | Follow Up Boss routes by lead source; Propertybase markets a pipeline "from first enquiry to commission payout". | S6, S8 | Universal | Lead source on every client (done); **lead sources & conversion chart + team performance table** | Owner | Know which channels pay; hold team accountable | Low | None | P1 — **implemented in this release** | Vendor documentation (moderate) |
| F13 | **Local competitors exist but are thinly documented** | Directories list Pakistani CRMs (Ladder CRM, Broker92, RealtyCRM) and developer ERPs (HysabOne: plot/unit, payment schedules, commission). Few public reviews. | S24 | Pakistan | Position on offline-first mobile + matching + WhatsApp + Urdu for small/medium dealers rather than developer ERP features | Sales | Clear differentiation | — | — | — | Weak (directories/vendor pages) |
| F14 | **CRM is useful but not agents' top tool** | NAR 2024: e-signature (81%), lockbox/showing tech (63%) and transaction management (50%) rated most impactful; CRM was a top-3 lead source in 2023 (36%). | S1, S2 | US market; shows agents value tools that save time on transactions | Keep the product focused on daily workflow (My Day, matching, sharing) and avoid feature bloat | Product | Adoption | — | — | — | Validated (US survey; transferability to Pakistan unknown) |

## 4. Professional recommendations (judgement, not external evidence)

1. **Lead the demo with the daily loop, not the admin screens:** inquiry → match → WhatsApp share →
   follow-up → My Day. This is where traditional dealers feel the benefit fastest.
2. **Keep AI optional and grounded.** Any AI feature (description drafting, inquiry summaries)
   must only use data already in the record and must never invent prices, availability, ownership
   or legal claims. See §6.
3. **Treat price confidentiality as a sales question.** Some owners will not want junior staff to
   see minimum prices; a dedicated permission (roadmap R-09) is cheap to add when a customer asks.
4. **Rentals are a separate product slice.** Tenancy (rent schedules, police registration,
   agreements) is valuable in Karachi but should be built as a module with legal input, not bolted
   on.

## 5. Assumptions requiring validation with real customers

| # | Assumption | How to validate |
|---|---|---|
| A1 | Most dealers' inquiries arrive on WhatsApp/phone rather than portals | Ask 5–10 dealers to estimate their last 20 inquiries by channel; compare with the "Source" field after a pilot |
| A2 | Dealers will enter data on mobile during the day if it takes under a minute | Time a new-client entry in a pilot; watch drop-off |
| A3 | Owners want staff performance visibility (team table) and staff accept it | Interview owner and staff separately |
| A4 | A 30-day "needs verification" window suits Karachi stock turnover | Make it configurable once two pilots give feedback |
| A5 | Customers will pay for Urdu UI | Ask during demo; observe which language staff choose in a pilot |
| A6 | Commission tracking is a buying criterion | Ask "how do you settle commission disputes today?" |
| A7 | Customers accept cloud storage of identity documents | Ask explicitly; offer "don't store CNIC copies" policy |

## 6. AI opportunities — assessment

| Idea | Customer value | Complexity | Cost | Privacy | Reliability risk | Recommendation |
|---|---|---|---|---|---|---|
| Natural-language property search ("3 bed DHA under 7 crore") | Medium–high for web/desk staff | Medium (parse to existing filters) | Low per query | Query text only | Mis-parsing — show the parsed filters for confirmation | **P2** — parse to the existing structured filters; never free-form answers |
| Match explanations | Already delivered by the rule engine (transparent reasons) | — | — | — | — | **Not needed** — rules are clearer than AI here |
| Follow-up message drafting (Urdu/English) | Medium | Low | Low | Sends client name/requirement to the model provider | Tone errors | P3 — optional, editable draft, opt-in per business |
| Property description generation | Medium for portals/brochures | Low | Low | Property facts only | Hallucinated features | P3 — strictly from stored fields; user must review |
| Duplicate detection | High | — | — | — | — | **Done with deterministic phone matching**; AI not needed |
| Inquiry / note summarisation | Medium for busy owners | Low–medium | Low–medium | Notes may contain personal data | Omissions | P3 — opt-in, with link to source notes |
| Lead prioritisation / scoring | Medium | Medium | Low | Internal data | Opaque scores reduce trust | P2 — start with transparent rules (overdue, priority, recency) |
| Suggested next action | Medium | Medium | Low | Internal | Wrong advice | P3 |

Guardrails for any AI feature: opt-in per business; never invent property details, prices,
ownership, availability or legal statements; show sources; keep the human as the sender; document
which data leaves the system and to which provider.
