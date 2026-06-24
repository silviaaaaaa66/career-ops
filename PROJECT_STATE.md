# Project State

Last reviewed: 2026-06-24

This file is a fast handoff for future Codex sessions working in this Career-Ops repo. It summarizes the current user-specific setup and the operational rules that matter most before evaluating jobs, scanning portals, or generating resumes.

## Source Files To Read First

- `cv.md` is the canonical resume source.
- `article-digest.md` contains optional proof points and should be read whenever present.
- `config/profile.yml` contains identity, target roles, compensation, location, and output preferences.
- `modes/_profile.md` contains user-specific archetypes, framing, negotiation scripts, and fit thresholds.
- `portals.yml` contains the customized scanner targets, title filters, location filters, and tracked companies.
- `modes/_shared.md`, `modes/pipeline.md`, and `modes/pdf.md` define the current system workflows.
- `DATA_CONTRACT.md` defines user-layer vs system-layer files. Personalization belongs in the user layer, especially `config/profile.yml` and `modes/_profile.md`.

## Target Roles

The current search is tuned for analytics roles, not AI engineering roles.

Primary target roles from `config/profile.yml`:

- Senior Product Analyst
- Product Analyst
- Senior Data Analyst
- Analytics Engineer
- BI Engineer
- Experimentation Analyst
- Growth Analyst
- Customer Insights Analyst
- Ecommerce Analyst

Current archetypes:

- Product Analytics: product metrics, funnel analysis, feature adoption, stakeholder decision support.
- Data Analytics: SQL, dashboarding, KPI definition, executive reporting, data quality.
- Analytics Engineering / BI: dbt or semantic layers, BI models, dashboards, metric governance.
- Experimentation / Growth Analytics: A/B testing, causal thinking, lifecycle funnels, retention, conversion.
- Customer Insights / Ecommerce Analytics: voice of customer, segmentation, merchandising, digital journey analytics.

The cross-cutting positioning in `modes/_profile.md` is: "analytics partner who turns messy product and customer data into decisions."

## Location And Compensation

From `config/profile.yml`:

- Target geography: Remote US, Chicago area, North Chicago, Waukegan, Lake County IL.
- Timezone: America/Chicago.
- Visa: no sponsorship needed.
- Compensation target: USD 150K-200K.
- Minimum: USD 120K.
- Location preference: Remote US preferred; Chicago / North Chicago / Waukegan / Lake County IL acceptable.

Location scoring in `modes/_profile.md`:

- Remote US, Chicago, North Chicago, Waukegan, and Lake County IL score highest.
- Hybrid in the Chicago area is acceptable.
- On-site 4-5 days/week outside target geography is a blocker unless the user overrides.
- Only score 1.0 for location if the JD explicitly requires 4-5 days/week on-site outside target geography with no exceptions.

## Tracked Companies

Enabled tracked companies in `portals.yml`:

- Intercom
- Airtable
- Twilio
- Salesforce
- Zapier
- Hootsuite
- Contentful
- HelloFresh
- eBay
- Yahoo
- Mercury
- BetterUp
- Dropbox
- GitLab
- Shopify
- HubSpot
- Hims & Hers
- Atlassian
- Zillow
- Chewy
- SolidJobs IT

Disabled company groups currently present:

- SolidJobs Engineering, Marketing, Sales, HR, Logistics, Finances, Other
- Jobstreet Indonesia
- Glints Indonesia

Enabled broad search queries cover Ashby, Greenhouse, Lever, Workable, Remote US analytics roles, Chicago analytics roles, and eBay analytics roles. Turkey tech-role queries are present but disabled.

## Scanner Filters

`portals.yml` title positives focus on analytics/product data terms:

- Product Analyst, Senior Product Analyst
- Data Analyst, Senior Data Analyst
- Analytics Engineer, BI Engineer, Business Intelligence
- Experimentation Analyst, Growth Analyst
- Customer Insights Analyst, Ecommerce / E-commerce / eCommerce Analyst
- Digital, Marketing, Lifecycle, Retention, Revenue, Web, BI, Business, Insights Analyst
- Analytics, Tableau, Looker, Power BI, dbt

Title negatives exclude junior/intern roles, non-analytics engineering roles, sales/recruiting, mobile, legacy stack, embedded/firmware/hardware, blockchain/crypto, Salesforce Admin, SAP, Oracle EBS, mainframe, and COBOL.

Location filter:

- Always allow: Chicago, North Chicago, Waukegan, Lake County, Illinois.
- Allow: Remote plus the same Illinois target locations.
- Block: Canada, Mexico, India, UK/London, Europe/EMEA, Germany, France, Spain, Singapore, Japan, Brazil/Sao Paulo, Chile/Santiago, Philippines/Manila, Argentina, Colombia, LATAM, APAC, Australia.

## Current Fit Scoring Rules

Evaluation reports use the 1-5 A-F system from `modes/_shared.md`:

- CV match
- North Star alignment
- Compensation
- Cultural signals
- Red flags
- Global weighted score

Interpretation:

- 4.5+ means strong match; recommend applying immediately.
- 4.0-4.4 means good match; worth applying.
- 3.5-3.9 means decent but not ideal; apply only with a specific reason.
- Below 3.5 means recommend against applying.

Posting legitimacy is Block G and does not affect the 1-5 score. It uses High Confidence, Proceed with Caution, or Suspicious.

Scanner quick-fit uses the 0-100 system from `modes/_profile.md` and `scan.mjs`:

- 90+ Apply immediately.
- 80-89 Apply if interested.
- 70-79 Optional.
- Below 70 Reject and do not add to `data/pipeline.md`.

Current scanner role scores:

- Senior Product Analyst: 94.
- Product Analyst, Analytics Engineer, Experimentation Analyst: 90.
- Growth Analyst, Customer Insights Analyst: 88.
- Senior Data Analyst: 87.
- BI Engineer / Business Intelligence Engineer, Ecommerce Analyst: 86.
- Data Analyst: 82.
- BI Analyst / Business Intelligence Analyst: 81.
- Lifecycle / Retention / Revenue Analyst: 80.
- Marketing / Digital / Web Analyst: 76.
- Generic Analytics: 72.
- Business Analyst and tool-aligned Tableau / Looker / Power BI / dbt roles: 70.

Scanner adjustments:

- Chicago / Waukegan / North Chicago / Lake County / Illinois location: +5.
- Remote location: +3.
- Senior signal when not already in matched rule: +3.
- Principal / Staff / Lead: +2.
- Manager / Director / Head / VP title drift: -10.
- Non-analytics engineering title: -15.
- Sales / Account Executive / Recruiter / Intern family: -25.

## Resume Generation Workflow

Default resume generation is the HTML/PDF flow unless `config/profile.yml` has `cv.canva_resume_design_id`, which is currently commented out.

Workflow from `modes/pdf.md`:

1. Read `cv.md` as source of truth.
2. Read the JD from context or ask for it.
3. Extract 15-20 JD keywords.
4. Detect JD language; English is default.
5. Detect company location for paper format: US/Canada use letter, rest of world uses A4.
6. Detect role archetype and adapt framing from `modes/_profile.md`.
7. Rewrite the Professional Summary using real experience, JD keywords, and the profile narrative.
8. Select the 3-4 most relevant projects.
9. Reorder existing experience bullets by JD relevance.
10. Build a 6-8 item competency grid.
11. Inject keywords only where grounded in actual experience. Never invent skills, metrics, or accomplishments.
12. Generate HTML from `templates/cv-template.html`.
13. Write temporary HTML to `/tmp/cv-{candidate}-{company}.html`.
14. Render PDF with `node generate-pdf.mjs /tmp/cv-{candidate}-{company}.html output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`.
15. Report the output path, page count, and keyword coverage.

After generating a CV PDF, offer a cover letter. Do not generate a cover letter PDF until the user explicitly approves the draft.

## PDF Template Workflow

The active ATS template is `templates/cv-template.html`, rendered by `generate-pdf.mjs` through headless Chromium.

Template requirements:

- Single-column ATS-friendly layout.
- Selectable UTF-8 text, not rasterized.
- Standard sections: Professional Summary, Core Competencies, Work Experience, Projects, Education, Certifications, Skills.
- No nested tables and no critical content in headers/footers.
- Fonts are self-hosted in `fonts/`: Space Grotesk for headings and DM Sans for body.
- White background, 0.6in margins, gradient header rule, compact recruiter-scan ordering.

Important placeholders include:

- `{{LANG}}`, `{{PAGE_WIDTH}}`
- Candidate contact placeholders from `config/profile.yml`
- `{{SECTION_SUMMARY}}`, `{{SUMMARY_TEXT}}`
- `{{COMPETENCIES}}`
- `{{EXPERIENCE}}`
- `{{PROJECTS}}`
- `{{EDUCATION}}`, `{{CERTIFICATIONS}}`, `{{SKILLS}}`

`generate-pdf.mjs` normalizes problematic punctuation and symbols for ATS compatibility. Prefer ASCII in generated resume text unless the target language requires otherwise.

## Pipeline And Tracker Workflow

For URL processing:

- Use `data/pipeline.md` as the pending URL inbox.
- Run the liveness sweep before processing pending URLs.
- Prefer Playwright for JD extraction and offer verification.
- WebFetch and WebSearch are fallbacks.
- Claim report numbers with `node reserve-report-num.mjs`; release the sentinel after report creation.
- Reports live in `reports/` with zero-padded numeric prefixes.
- Every report header must include `**URL:**` and `**Legitimacy:**`.
- Auto-generate a PDF only when score is at or above `auto_pdf_score_threshold`; if unset, default is 3.0.
- New tracker rows must be written as TSV files in `batch/tracker-additions/`, then merged with `node merge-tracker.mjs`.
- Do not directly add new rows to `data/applications.md`; only update existing rows there.
- After each batch of evaluations, run `node merge-tracker.mjs`.

## Important Customizations Made

User-layer customizations currently visible:

- `config/profile.yml` targets analytics roles and Chicago / Remote US geography.
- `modes/_profile.md` overrides the default AI-oriented archetypes with analytics/product/BI/growth/customer-insights archetypes.
- `modes/_profile.md` defines a fit-threshold system for scans and quick apply decisions.
- `portals.yml` title filters have been customized for analytics and BI roles.
- `portals.yml` location filters prioritize Remote US and the Chicago / Lake County area and block many international regions.
- `portals.yml` tracked companies are focused on SaaS, ecommerce, customer platforms, data/product-heavy businesses, and SolidJobs IT.
- `scan.mjs` includes analytics-specific quick-fit scoring rules matching the customized target roles.
- `config/profile.yml` has no active Canva resume design ID, so the HTML/PDF flow is currently the default.

System-layer note:

- Do not put future personal targeting changes in `modes/_shared.md`. Put them in `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, or `portals.yml` as appropriate.

## Current Branch Strategy

Current branch: `shiyu-analytics`.

Current working tree when this file was created: clean before adding `PROJECT_STATE.md`.

Practical strategy:

- Keep user-specific search/profile work on `shiyu-analytics`.
- Preserve the Career-Ops data contract: user-layer files are never overwritten by system updates.
- Use `node update-system.mjs check` at session start. If an update is applied, `update-system.mjs` creates backup branches named like `backup-pre-update-*` before replacing system-layer files.
- Use `node update-system.mjs rollback` only when intentionally restoring system-layer files from the latest backup branch.
- Avoid direct edits to `main` unless the maintainer explicitly asks.
- Keep generated reports/PDFs in `reports/` and `output/`; keep pipeline/tracker state in `data/`.
