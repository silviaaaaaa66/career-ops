#!/usr/bin/env node

/**
 * generate-apply-mode.mjs - Review-only apply report for top pending roles.
 *
 * Reads the triage outputs, then writes daily opportunity reports plus legacy aliases:
 *   - reports/opportunities/YYYY-MM-DD-opportunities.html
 *   - reports/opportunities/YYYY-MM-DD-opportunities.md
 *   - reports/apply-mode.html
 *   - reports/apply-mode.md
 *
 * This script is intentionally read-only for pipeline data. It does not submit
 * applications, update statuses, generate resumes, or create interview prep.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { parseArgs } from "util";

const PIPELINE_PATH = "data/pipeline.md";
const SCAN_HISTORY_PATH = "data/scan-history.tsv";
const APPLICATIONS_PATH = "data/applications.md";
const HTML_OUT = "reports/apply-mode.html";
const MD_OUT = "reports/apply-mode.md";
const OPPORTUNITIES_DIR = "reports/opportunities";
const OPPORTUNITY_RETENTION_DAYS = 3;
const APPLY_MODE_FRESHNESS_DAYS = 3;

function readRequired(path) {
  if (!existsSync(path)) throw new Error(`Missing required input: ${path}`);
  return readFileSync(path, "utf-8");
}

function readCliArgs() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage:
  npm run apply-mode
  npm run apply-mode -- --limit 10

Options:
  --limit <n>  Keep only the top n pending roles in the report.
`);
    process.exit(0);
  }

  const limit = values.limit == null ? null : Number(values.limit);
  if (values.limit != null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  return { limit };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMd(value) {
  return String(value ?? "").replace(/\|/g, "\\|").trim();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayNumber(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function calendarDayDiff(todayIso, otherIso) {
  return dayNumber(todayIso) - dayNumber(otherIso);
}

function opportunityReportDate(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-opportunities\.(?:html|md)$/);
  return match ? match[1] : null;
}

function normalizeKeyPart(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function opportunityKey({ company, title, url }) {
  const parts = [normalizeKeyPart(company), normalizeKeyPart(title)];
  const normalizedUrl = normalizeKeyPart(url);
  if (normalizedUrl) parts.push(normalizedUrl);
  return parts.join("\t");
}

function titleCaseCompany(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Company";
  if (/[A-Z]/.test(raw.slice(1))) return raw;
  return raw
    .split(/[\s_-]+/)
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function parsePipeline(text) {
  const jobs = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    const parsed = parsePipelineFitLine(line);
    if (!parsed) continue;
    const { url, companyRaw, title, scoreRaw, band, rationale } = parsed;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({
      url: url.trim(),
      company: titleCaseCompany(companyRaw),
      title: title.trim(),
      fitScore: score,
      band: band.trim(),
      rationale: rationale.trim(),
    });
  }

  return jobs.sort((a, b) => b.fitScore - a.fitScore || a.company.localeCompare(b.company));
}

function parsePipelineFitLine(line) {
  const match = line.match(/^-\s+\[\s\]\s+(.+)$/);
  if (!match) return null;

  const parts = match[1].split("|").map(part => part.trim());
  if (parts.length < 3) return null;

  const [url, companyRaw] = parts;
  const legacyFit = (parts[3] || "").match(/^Fit\s+(\d+(?:\.\d+)?)\s+\((.+?)\)\s+[\u2014-]\s+(.+)$/);
  if (legacyFit) {
    return {
      url,
      companyRaw,
      title: parts[2],
      scoreRaw: legacyFit[1],
      band: legacyFit[2],
      rationale: legacyFit[3],
    };
  }

  const inlineFit = parts[2].match(/^(.*?)\s+-\s+Fit\s+(\d+(?:\.\d+)?)\s+\((.+?)\)\s+[\u2014-]\s+(.+)$/);
  if (!inlineFit) return null;
  return {
    url,
    companyRaw,
    title: inlineFit[1].trim(),
    scoreRaw: inlineFit[2],
    band: inlineFit[3],
    rationale: inlineFit[4],
  };
}

function parseApplicationsTracker(text) {
  const applied = new Set();
  const lines = text.split(/\r?\n/).filter(line => line.trim().startsWith("|"));
  const headerLine = lines.find(line => /\bCompany\b/i.test(line) && /\bRole\b/i.test(line) && /\bStatus\b/i.test(line));
  if (!headerLine) return applied;

  const headers = headerLine
    .split("|")
    .slice(1, -1)
    .map(header => header.trim().toLowerCase());
  const companyIndex = headers.indexOf("company");
  const roleIndex = headers.indexOf("role");
  const statusIndex = headers.indexOf("status");
  if (companyIndex < 0 || roleIndex < 0 || statusIndex < 0) return applied;

  for (const line of lines) {
    if (line === headerLine || /\|\s*-{3,}\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
    if (!/^Applied$/i.test(cells[statusIndex] || "")) continue;
    applied.add(trackerRoleKey(cells[companyIndex], cells[roleIndex]));
  }

  return applied;
}

function readAppliedTrackerKeys(path = APPLICATIONS_PATH) {
  if (!existsSync(path)) return new Set();
  return parseApplicationsTracker(readFileSync(path, "utf-8"));
}

function trackerRoleKey(company, title) {
  return `${normalizeKeyPart(company)}\t${normalizeKeyPart(title)}`;
}

function normalizeDateValue(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return localIsoDate(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    return localIsoDate(new Date(ms));
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? localIsoDate(new Date(parsed)) : null;
}

function knownDateFromJob(job, row = {}) {
  for (const value of [
    job.postedAt,
    job.posted_at,
    job.postedDate,
    job.posted_date,
    row.postedAt,
    row.posted_at,
    row.postedDate,
    row.posted_date,
    row.date_posted,
    row.posted,
    row.first_seen,
  ]) {
    const normalized = normalizeDateValue(value);
    if (normalized) return normalized;
  }
  return null;
}

function relativePostedAgeDays(text) {
  const haystack = String(text || "").toLowerCase();
  if (/\b(posted\s+)?today\b/.test(haystack)) return 0;
  if (/\b(posted\s+)?yesterday\b/.test(haystack)) return 1;

  const dayMatch = haystack.match(/\b(?:posted\s+)?(\d+)\s*(?:\+?\s*)days?\s+ago\b/);
  if (dayMatch) return Number(dayMatch[1]);

  const weekMatch = haystack.match(/\b(?:posted\s+)?(\d+)\s*(?:\+?\s*)weeks?\s+ago\b/);
  if (weekMatch) return Number(weekMatch[1]) * 7;
  if (/\b(?:posted\s+)?a\s+week\s+ago\b|\b(?:posted\s+)?1\s+week\s+ago\b/.test(haystack)) return 7;

  return null;
}

function buildJobSearchText(job, row = {}) {
  return [
    job.title,
    job.company,
    job.rationale,
    row.title,
    row.company,
    row.location,
    row.fit_rationale,
    row.description,
    row.content,
    row.summary,
    row.posted,
    row.posted_on,
  ].filter(Boolean).join(" ");
}

function isFreshForApplyMode(job, row = {}, todayIso = localIsoDate()) {
  const haystack = buildJobSearchText(job, row);
  const knownDate = knownDateFromJob(job, row);

  // Apply Mode is a short-list sprint, not a general backlog. When the scanner
  // gives an exact posted date, keep only roles posted in the last three
  // calendar days. If provider-specific postedAt was not persisted, first_seen
  // is used as a conservative freshness signal: anything first seen more than
  // three days ago is no longer a fresh Apply Mode opportunity.
  if (knownDate) {
    return calendarDayDiff(todayIso, knownDate) <= APPLY_MODE_FRESHNESS_DAYS;
  }

  // Some ATS pages expose only relative labels such as "6 days ago" or
  // "1 week ago". With no exact date to normalize, reject labels older than
  // the three-day apply window while allowing today/yesterday/2-3 days ago.
  const relativeAge = relativePostedAgeDays(haystack);
  if (relativeAge != null) return relativeAge <= APPLY_MODE_FRESHNESS_DAYS;

  return true;
}

function isMlHeavyRole(job, row = {}) {
  const haystack = buildJobSearchText(job, row);
  const patterns = [
    /\bmachine learning\b/i,
    /\bml\b/i,
    /\bnlp\b/i,
    /\bnatural language processing\b/i,
    /\bdeep learning\b/i,
    /\bcomputer vision\b/i,
    /\bllm\b/i,
    /\bgenerative AI\b/i,
    /\bmodel development\b/i,
    /\bpredictive modeling\b/i,
    /\brecommendation algorithm(?:s)?\b/i,
    /\bdata scientist\b/i,
    /\bapplied scientist\b/i,
    /\bresearch scientist\b/i,
    /\bAI scientist\b/i,
  ];

  // These are intentionally strong ML/Data Science signals only. Plain
  // analytics language such as product analytics, experimentation, A/B testing,
  // BI, analytics engineering, SQL, Tableau, Looker, and dbt should continue
  // through to scoring.
  return patterns.some(pattern => pattern.test(haystack));
}

function parseTsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "\t" && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function parseScanHistory(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return new Map();
  const headers = parseTsvLine(lines[0]);
  const byUrl = new Map();

  for (const line of lines.slice(1)) {
    const values = parseTsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    if (row.url) byUrl.set(row.url, row);
  }
  return byUrl;
}

function splitReasons(job) {
  const pieces = job.rationale
    .split(/;\s+|,\s+but\s+|,\s+and\s+/i)
    .map(part => part.trim().replace(/\.$/, ""))
    .filter(part => part.length >= 12);
  const cleaned = [];
  for (const part of pieces) {
    const normalized = part[0] ? part[0].toUpperCase() + part.slice(1) : part;
    if (!cleaned.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
      cleaned.push(normalized);
    }
    if (cleaned.length === 3) break;
  }
  return cleaned.length ? cleaned : [job.rationale];
}

function inferArchetype(job, row = {}) {
  const haystack = [
    job.company,
    job.title,
    job.rationale,
    row.location,
    row.fit_rationale,
  ].join(" ").toLowerCase();

  if (/(insurance|insur|policy|claim|underwriting|pet insurance|kin|bestow|caresource|humana|health plan|american family)/.test(haystack)) {
    return "Insurance";
  }
  if (/(ai|artificial intelligence|machine learning|ml|responsible ai|deepgram|descript|c3\.ai|ptc)/.test(haystack)) {
    return "AI";
  }
  if (/(ecommerce|e-commerce|marketplace|growth|conversion|funnel|revenue|doordash|chewy|pinterest|roo|calm)/.test(haystack)) {
    return "Ecommerce";
  }
  if (/(nonprofit|mission|education|program impact|curriculum|ignite reading)/.test(haystack)) {
    return "Nonprofit";
  }
  if (/(remote|distributed|global|nationwide|work from home|remote-first)/.test(haystack)) {
    return "Remote global";
  }
  if (/(chicago|waukegan|north chicago|lake county|illinois| il\b|midwest)/.test(haystack)) {
    return "Local stable";
  }
  return "Remote global";
}

function buildHtmlReport(jobs, generatedAt, summary) {
  const rows = jobs.map((job, index) => {
    const reasons = job.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("");
    const id = `job-${index + 1}-${slugify(job.company)}`;
    const key = opportunityKey(job);
    return `
      <article class="job-card" id="${id}" data-opportunity-key="${escapeHtml(key)}">
        <div class="job-main">
          <div>
            <h2>${escapeHtml(job.title)}</h2>
            <div class="company">${escapeHtml(job.company)} &middot; ${escapeHtml(job.archetype)}</div>
          </div>
          <div class="score">${escapeHtml(job.fitScore)}<span>/100</span></div>
        </div>
        <div class="meta">
          <span class="band">${escapeHtml(job.band)}</span>
          <a class="button" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">Open Job</a>
        </div>
        <ul class="reasons">${reasons}</ul>
        <p class="pdf-skipped">Cover letter not generated automatically. Use cover mode for a specific role after review.</p>
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Apply Mode Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #5d6775;
      --line: #d9dee7;
      --accent: #0d6b57;
      --accent-dark: #084b3d;
      --score: #243b6b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    header {
      padding: 28px max(24px, calc((100vw - 1120px) / 2)) 18px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0; }
    .subhead { color: var(--muted); margin: 0; }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 20px 24px 44px;
      display: grid;
      gap: 14px;
    }
    .summary {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px 16px;
    }
    .summary h2 {
      margin-bottom: 10px;
      font-size: 17px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 10px;
    }
    .summary-item {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      background: #fbfcfd;
    }
    .summary-label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .summary-value {
      display: block;
      margin-top: 2px;
      font-size: 24px;
      font-weight: 760;
      color: var(--score);
    }
    .job-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }
    .job-main {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
    }
    h2 { margin: 0; font-size: 19px; line-height: 1.25; letter-spacing: 0; }
    .company { color: var(--muted); margin-top: 5px; }
    .score {
      min-width: 92px;
      text-align: right;
      color: var(--score);
      font-size: 34px;
      font-weight: 750;
      line-height: 1;
    }
    .score span { display: block; font-size: 13px; color: var(--muted); font-weight: 600; margin-top: 2px; }
    .meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 14px 0 10px;
      flex-wrap: wrap;
    }
    .band {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 10px;
      font-weight: 650;
      color: var(--accent-dark);
      background: #eef8f4;
    }
    .button {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 7px 12px;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      font-weight: 700;
    }
    .button:hover { background: var(--accent-dark); }
    .reasons { margin: 0 0 12px 18px; padding: 0; color: #273241; }
    .reasons li { margin: 3px 0; }
    .pdf-link { font-weight: 750; color: var(--accent-dark); }
    .pdf-error { color: #9f1d1d; margin: 0; }
    .pdf-skipped { color: var(--muted); margin: 0; }
    @media (max-width: 680px) {
      header { padding-left: 16px; padding-right: 16px; }
      main { padding: 16px; }
      .job-main { grid-template-columns: 1fr; }
      .score { text-align: left; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Apply Mode Report</h1>
    <p class="subhead">Generated ${escapeHtml(generatedAt)}. All eligible pending roles are shown. No cover letters, tailored resumes, or application submissions are generated automatically.</p>
  </header>
  <main>
    <section class="summary" aria-labelledby="filter-summary">
      <h2 id="filter-summary">Filter Summary</h2>
      <div class="summary-grid">
        <div class="summary-item"><span class="summary-label">Jobs considered</span><span class="summary-value">${summary.jobsConsidered}</span></div>
        <div class="summary-item"><span class="summary-label">Old postings flagged</span><span class="summary-value">${summary.flaggedOldPosting}</span></div>
        <div class="summary-item"><span class="summary-label">ML/Data Science flagged</span><span class="summary-value">${summary.flaggedMlDataScience}</span></div>
        <div class="summary-item"><span class="summary-label">Already applied flagged</span><span class="summary-value">${summary.flaggedAlreadyApplied}</span></div>
        <div class="summary-item"><span class="summary-label">Included in report</span><span class="summary-value">${summary.includedFinal}</span></div>
      </div>
    </section>
    ${rows || "<p>No eligible pending roles after Apply Mode filters.</p>"}
  </main>
</body>
</html>
`;
}

function buildMarkdownReport(jobs, generatedAt, summary) {
  const sections = jobs.map((job, index) => {
    const reasons = job.reasons.map(reason => `- ${reason}`).join("\n");
    return `<!-- opportunity-key: ${opportunityKey(job)} -->

## ${index + 1}. ${job.title} - ${job.company}

- **Fit Score:** ${job.fitScore}/100
- **Recommendation:** ${job.band}
- **Archetype:** ${job.archetype}
- **Open Job:** ${job.url}

**Reasons**

${reasons}

**Cover Letter**

Not generated automatically. Use cover mode for a specific role after review.
`;
  }).join("\n---\n\n");

  const summaryRows = jobs.map((job, index) => {
    return `| ${index + 1} | ${escapeMd(job.title)} | ${escapeMd(job.company)} | ${job.fitScore}/100 | ${escapeMd(job.band)} | [Open Job](${job.url}) |`;
  }).join("\n");

  return `# Apply Mode Report

Generated ${generatedAt}.

Review-only report: all eligible pending roles are shown. No cover letters, tailored resumes, interview prep notes, STAR stories, pipeline status changes, or application submission are generated automatically.

## Filter Summary

- Jobs considered: ${summary.jobsConsidered}
- Flagged for old posting: ${summary.flaggedOldPosting}
- Flagged for ML/Data Science: ${summary.flaggedMlDataScience}
- Flagged because already applied: ${summary.flaggedAlreadyApplied}
- Included in final Apply Mode report: ${summary.includedFinal}

| # | Job Title | Company | Fit Score | Recommendation | Link |
|---|-----------|---------|-----------|----------------|------|
${summaryRows || "| - | No eligible pending roles after Apply Mode filters | - | - | - | - |"}

${sections}
`;
}

function unescapeMarkdownCell(value) {
  return String(value ?? "").replace(/\\\|/g, "|").trim();
}

function extractOpportunityKeysFromMarkdown(text) {
  const keys = new Set();
  for (const match of text.matchAll(/<!--\s*opportunity-key:\s*([^]*?)\s*-->/g)) {
    const key = String(match[1] || "").trim();
    if (key) keys.add(key);
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*.*?\s*\|\s*.*?\s*\|\s*\[Open Job\]\((.*?)\)\s*\|$/);
    if (!match) continue;
    const [, , title, company, url] = match;
    const key = opportunityKey({
      company: unescapeMarkdownCell(company),
      title: unescapeMarkdownCell(title),
      url: String(url || "").trim(),
    });
    if (key) keys.add(key);
  }
  return keys;
}

function extractOpportunityKeysFromHtml(text) {
  const keys = new Set();
  for (const match of text.matchAll(/data-opportunity-key="([^"]+)"/g)) {
    const key = String(match[1] || "")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .trim();
    if (key) keys.add(key);
  }

  const cardRe = /<article\b[^>]*class="job-card"[^>]*>([\s\S]*?)<\/article>/g;
  for (const cardMatch of text.matchAll(cardRe)) {
    const card = cardMatch[1];
    const title = card.match(/<h2>([\s\S]*?)<\/h2>/)?.[1]?.replace(/<[^>]*>/g, "");
    const company = card.match(/<div class="company">([\s\S]*?)&middot;/)?.[1]?.replace(/<[^>]*>/g, "");
    const url = card.match(/<a class="button" href="([^"]+)"/)?.[1];
    const key = opportunityKey({
      company: htmlDecode(company),
      title: htmlDecode(title),
      url: htmlDecode(url),
    });
    if (key) keys.add(key);
  }
  return keys;
}

function htmlDecode(value) {
  return String(value ?? "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .trim();
}

function readRecentOpportunityKeys(todayIso) {
  const keys = new Set();
  if (!existsSync(OPPORTUNITIES_DIR)) return keys;

  for (const filename of readdirSync(OPPORTUNITIES_DIR)) {
    const reportDate = opportunityReportDate(filename);
    if (!reportDate) continue;
    const age = calendarDayDiff(todayIso, reportDate);
    if (age < 1 || age > OPPORTUNITY_RETENTION_DAYS) continue;

    const path = `${OPPORTUNITIES_DIR}/${filename}`;
    const text = readFileSync(path, "utf-8");
    const extracted = filename.endsWith(".md")
      ? extractOpportunityKeysFromMarkdown(text)
      : extractOpportunityKeysFromHtml(text);
    for (const key of extracted) keys.add(key);
  }
  return keys;
}

function cleanupOldOpportunityReports(todayIso) {
  if (!existsSync(OPPORTUNITIES_DIR)) return 0;
  let deleted = 0;
  for (const filename of readdirSync(OPPORTUNITIES_DIR)) {
    const reportDate = opportunityReportDate(filename);
    if (!reportDate) continue;
    const age = calendarDayDiff(todayIso, reportDate);
    if (age >= OPPORTUNITY_RETENTION_DAYS) {
      unlinkSync(`${OPPORTUNITIES_DIR}/${filename}`);
      deleted += 1;
    }
  }
  return deleted;
}

async function main() {
  const args = readCliArgs();
  const pipelineText = readRequired(PIPELINE_PATH);
  const scanHistoryText = readRequired(SCAN_HISTORY_PATH);

  const scanHistory = parseScanHistory(scanHistoryText);
  const appliedTrackerKeys = readAppliedTrackerKeys();
  const generatedAt = localIsoDate();
  mkdirSync("reports", { recursive: true });
  mkdirSync(OPPORTUNITIES_DIR, { recursive: true });
  const summary = {
    jobsConsidered: 0,
    flaggedOldPosting: 0,
    flaggedMlDataScience: 0,
    flaggedAlreadyApplied: 0,
    includedFinal: 0,
  };

  let jobs = parsePipeline(pipelineText).map(job => {
    const row = scanHistory.get(job.url) || {};
    summary.jobsConsidered += 1;
    const oldPosting = !isFreshForApplyMode(job, row, generatedAt);
    const mlDataScience = isMlHeavyRole(job, row);
    const trackerKey = trackerRoleKey(row.company || job.company, row.title || job.title);
    const alreadyApplied = appliedTrackerKeys.has(trackerKey);
    if (oldPosting) summary.flaggedOldPosting += 1;
    if (mlDataScience) summary.flaggedMlDataScience += 1;
    if (alreadyApplied) summary.flaggedAlreadyApplied += 1;
    const enriched = {
      ...job,
      company: titleCaseCompany(row.company || job.company),
      title: row.title || job.title,
      fitScore: Number(row.fit_score || job.fitScore),
      band: row.fit_band || job.band,
      rationale: row.fit_rationale || job.rationale,
    };
    enriched.reasons = splitReasons(enriched);
    enriched.archetype = inferArchetype(enriched, row);
    return enriched;
  }).sort((a, b) => b.fitScore - a.fitScore || a.company.localeCompare(b.company));

  if (args.limit) jobs = jobs.slice(0, args.limit);
  summary.includedFinal = jobs.length;

  const htmlOpportunityOut = `${OPPORTUNITIES_DIR}/${generatedAt}-opportunities.html`;
  const mdOpportunityOut = `${OPPORTUNITIES_DIR}/${generatedAt}-opportunities.md`;
  const htmlOpportunityReport = buildHtmlReport(jobs, generatedAt, summary);
  const markdownOpportunityReport = buildMarkdownReport(jobs, generatedAt, summary);
  const htmlReport = buildHtmlReport(jobs, generatedAt, summary);
  const markdownReport = buildMarkdownReport(jobs, generatedAt, summary);
  writeFileSync(htmlOpportunityOut, htmlOpportunityReport, "utf-8");
  writeFileSync(mdOpportunityOut, markdownOpportunityReport, "utf-8");
  writeFileSync(HTML_OUT, htmlReport, "utf-8");
  writeFileSync(MD_OUT, markdownReport, "utf-8");
  const deletedOldReports = cleanupOldOpportunityReports(generatedAt);

  console.log(`Today's Apply Mode opportunity report generated.`);
  console.log(`HTML: ${htmlOpportunityOut}`);
  console.log(`Markdown: ${mdOpportunityOut}`);
  console.log(`Jobs considered: ${summary.jobsConsidered}`);
  console.log(`Flagged for old posting: ${summary.flaggedOldPosting}`);
  console.log(`Flagged for ML/Data Science: ${summary.flaggedMlDataScience}`);
  console.log(`Flagged because already applied: ${summary.flaggedAlreadyApplied}`);
  console.log(`Opportunities included: ${jobs.length}`);
  console.log(`Cover-letter PDFs generated: 0 (disabled for Apply Mode reports)`);
  console.log(`Old opportunity report files deleted: ${deletedOldReports}`);
  console.log(`Legacy HTML alias: ${HTML_OUT}`);
  console.log(`Legacy Markdown alias: ${MD_OUT}`);
}

main().catch(error => {
  console.error("ERROR generating Apply Mode report:");
  console.error(error.message);
  process.exit(1);
});
