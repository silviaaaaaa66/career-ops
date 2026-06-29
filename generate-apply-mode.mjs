#!/usr/bin/env node

/**
 * generate-apply-mode.mjs - Review-only apply report for top pending roles.
 *
 * Reads the triage outputs and candidate profile, then writes daily
 * opportunity reports plus legacy aliases:
 *   - reports/opportunities/YYYY-MM-DD-opportunities.html
 *   - reports/opportunities/YYYY-MM-DD-opportunities.md
 *   - reports/apply-mode.html
 *   - reports/apply-mode.md
 *
 * This script is intentionally read-only for pipeline data. It does not submit
 * applications, update statuses, generate resumes, or create interview prep.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import yaml from "js-yaml";
import { parseArgs } from "util";

const PIPELINE_PATH = "data/pipeline.md";
const SCAN_HISTORY_PATH = "data/scan-history.tsv";
const APPLICATIONS_PATH = "data/applications.md";
const CV_PATH = "cv.md";
const PROFILE_PATH = "config/profile.yml";
const PROFILE_NOTES_PATH = "modes/_profile.md";
const HTML_OUT = "reports/apply-mode.html";
const MD_OUT = "reports/apply-mode.md";
const OPPORTUNITIES_DIR = "reports/opportunities";
const OPPORTUNITY_RETENTION_DAYS = 3;
const MIN_FIT_SCORE = 70;
const APPLY_MODE_FRESHNESS_DAYS = 3;
const COVER_LETTER_TARGET_MIN = 200;
const COVER_LETTER_TARGET_MAX = 300;
const COVER_LETTER_HARD_MAX = 320;

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
  --limit <n>  Keep only the top n pending roles after score filtering.
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
  const lineRe = /^-\s+\[\s\]\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|\s+Fit\s+(\d+(?:\.\d+)?)\s+\((.+?)\)\s+[\u2014-]\s+(.+)$/;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(lineRe);
    if (!match) continue;
    const [, url, companyRaw, title, scoreRaw, band, rationale] = match;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score) || score < MIN_FIT_SCORE) continue;
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
  // through to scoring and cover-letter generation.
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

function pickHighlights(archetype) {
  const shared = {
    "Local stable": [
      "commitment to building a long-term analytics career in the Chicago and North Chicago area",
      "SQL, Tableau, and stakeholder-ready reporting experience across traditional business teams",
      "experience turning operational and customer data into decisions leaders can use",
    ],
    Insurance: [
      "American Family Insurance experience across customer journey, operations, dashboards, forecasting, and reporting",
      "ability to translate insurance and customer service data into clear business recommendations",
      "SQL, Tableau, AWS, and Python experience in regulated, stakeholder-heavy environments",
    ],
    AI: [
      "product analytics foundation for understanding usage, activation, retention, and feature impact",
      "experimentation and dashboarding experience that helps product teams make faster decisions",
      "Python and SQL depth for turning messy behavioral data into practical insights",
    ],
    Ecommerce: [
      "Chewy ecommerce analytics experience across A/B testing, funnel behavior, and product decisions",
      "hands-on experimentation work that improved conversion, navigation, and test readout speed",
      "SQL, Python, Tableau, Optimizely, and stakeholder communication across product teams",
    ],
    Nonprofit: [
      "practical dashboarding and reporting experience for non-technical decision makers",
      "ability to connect mission, program, customer, and operational metrics into usable recommendations",
      "clear communication style and repeatable analytics workflows",
    ],
    "Remote global": [
      "independent analytics work with distributed stakeholders and clear written communication",
      "SQL, Python, Tableau, and dashboarding experience that supports repeatable decision workflows",
      "product, ecommerce, customer, and business analytics range across several operating contexts",
    ],
  };
  return shared[archetype] ?? shared["Remote global"];
}

function extractCandidate(profile, cvText) {
  const candidate = profile?.candidate ?? {};
  const narrative = profile?.narrative ?? {};
  const skills = narrative?.skills ?? {};
  const name = candidate.full_name || cvText.split(/\r?\n/).find(Boolean) || "Candidate";
  return {
    name,
    email: candidate.email || "",
    location: String(candidate.location || profile?.location?.city || "").replace(/NorthChicago/gi, "North Chicago"),
    headline: narrative.headline || "Senior analytics professional specializing in product analytics, experimentation, and business decision support.",
    visa: profile?.location?.visa_status || "",
    targetLocations: profile?.location?.target_locations || [],
    coreSkills: [
      ...(skills.core || []),
      ...(skills.analytics || []),
      ...(skills.tools || []),
    ].filter(Boolean),
  };
}

function buildEvidence(profile, cvText) {
  const lower = cvText.toLowerCase();
  const hasChewy = lower.includes("chewy");
  const hasAmericanFamily = lower.includes("american family");
  const skills = profile?.narrative?.skills || {};
  const coreSkills = [
    ...(skills.core || []),
    ...(skills.analytics || []),
    ...(skills.tools || []),
  ].filter(Boolean).slice(0, 10);

  const paragraphs = [];
  const conciseParagraphs = [];
  let summary = "My background is in product analytics, experimentation, business intelligence, and customer analytics.";
  if (hasChewy) {
    paragraphs.push("At Chewy, I worked as a Senior E-Commerce Analyst supporting product and experimentation teams. I built a self-service app A/B test dashboard and ETL pipeline with Tableau, SQL, and AWS that moved test readouts from a two-week cycle to next day and removed about 50 hours of manual analysis each month. I also led analytics for a multi-phase navigation optimization initiative across five A/B tests, using SQL, Python, Tableau, and statistical analysis to support rollout decisions that improved conversion and navigation behavior.");
    conciseParagraphs.push("At Chewy, I supported product and experimentation teams as a Senior E-Commerce Analyst. I built a Tableau, SQL, and AWS app A/B test dashboard that moved readouts from two weeks to next day and removed about 50 hours of manual analysis each month.");
  }
  if (hasAmericanFamily) {
    paragraphs.push("Before Chewy, I spent several years at American Family Insurance as a Business Analytics Analyst. That work gave me a strong operating foundation in customer journey analysis, call center performance, automated Tableau reporting, AWS-based ETL, forecasting, and stakeholder communication. I learned how to make analytics useful for both technical and non-technical partners, especially when the business question is ambiguous and the data needs structure before it can support a decision.");
    conciseParagraphs.push("Earlier at American Family Insurance, I worked on customer journey analytics, call center performance, automated Tableau reporting, AWS-based ETL, forecasting, and stakeholder communication. That experience helps me translate messy business questions into practical metrics and clear recommendations.");
  }
  if (!paragraphs.length) {
    paragraphs.push(`My CV shows a strong analytics foundation across ${coreSkills.join(", ") || "SQL, Python, dashboarding, experimentation, and stakeholder communication"}. I would bring that mix of technical analysis and business communication to the role, with an emphasis on useful metrics, clear reporting, and decision-ready recommendations.`);
    conciseParagraphs.push(`My CV shows a strong analytics foundation across ${coreSkills.join(", ") || "SQL, Python, dashboarding, experimentation, and stakeholder communication"}. I would bring that mix of technical analysis and business communication to the role.`);
  } else if (hasChewy && hasAmericanFamily) {
    summary = "My background is in product analytics, experimentation, business intelligence, and customer analytics, with recent experience at Chewy and prior analytics work at American Family Insurance.";
  } else if (hasChewy) {
    summary = "My background is in product analytics, experimentation, business intelligence, and customer analytics, with recent experience at Chewy.";
  } else if (hasAmericanFamily) {
    summary = "My background is in business analytics, customer analytics, dashboarding, and forecasting, with analytics experience at American Family Insurance.";
  }
  return { summary, paragraphs, conciseParagraphs };
}

function formatVisa(value) {
  return String(value || "")
    .replace(/\bh1b\b/gi, "H-1B")
    .replace(/\bh-?1b\b/gi, "H-1B");
}

function generateCoverLetter(job, candidate, archetype, reasons, evidence) {
  const highlights = pickHighlights(archetype);
  const greeting = "Dear Hiring Team,";
  const company = job.company;
  const title = job.title;
  const locationLine = candidate.location ? `I am based in ${candidate.location}` : "I am based in the United States";
  const visa = formatVisa(candidate.visa);
  const visaLine = visa ? ` I would also want to confirm the role's path for ${visa} early in the process.` : "";
  const roleReason = reasons[0] || "Connection to the kind of analytics work I do best";

  const paragraphs = [
    `${greeting}\n\nI am writing to apply for the ${title} role at ${company}. ${evidence.summary} The role stood out because it is a strong match for ${roleReason.toLowerCase()}.`,
    ...evidence.conciseParagraphs,
    `For this ${archetype.toLowerCase()} opportunity, I would emphasize ${highlights[0]}, ${highlights[1]}, and ${highlights[2]}. I am strongest when a team needs clear metric definitions, reliable dashboards, and analysis that helps product, operations, finance, or leadership partners decide what to do next.`,
    `${locationLine}, and I am focused on roles where I can contribute over the long term while continuing to deepen my analytics craft.${visaLine} I would welcome the chance to discuss how my experience with experimentation, SQL/Python analysis, dashboard automation, and stakeholder decision support could help ${company} move faster with clearer metrics and better decisions.\n\nSincerely,\n${candidate.name}`,
  ];

  return enforceCoverLetterLength(paragraphs);
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function enforceCoverLetterLength(paragraphs) {
  let letter = paragraphs.join("\n\n");
  if (wordCount(letter) <= COVER_LETTER_TARGET_MAX) return letter;

  const middle = paragraphs.slice(1, -2);
  const trimmed = [
    paragraphs[0],
    ...middle.map((paragraph, index) => trimToWords(paragraph, index === 0 ? 72 : 58)),
    trimToWords(paragraphs[paragraphs.length - 2], 62),
    paragraphs[paragraphs.length - 1],
  ];
  letter = trimmed.join("\n\n");
  if (wordCount(letter) <= COVER_LETTER_TARGET_MAX) return letter;

  const compact = [
    paragraphs[0],
    trimToWords(paragraphs[1], 58),
    trimToWords(paragraphs[paragraphs.length - 2], 52),
    paragraphs[paragraphs.length - 1],
  ];
  letter = compact.join("\n\n");
  if (wordCount(letter) <= COVER_LETTER_HARD_MAX) return letter;

  return trimClosingLetter(letter, COVER_LETTER_TARGET_MAX);
}

function trimToWords(text, maxWords) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return String(text || "").trim();
  const clipped = words.slice(0, maxWords).join(" ");
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (sentenceEnd > clipped.length * 0.55) return clipped.slice(0, sentenceEnd + 1);
  return `${clipped.replace(/[,:;.-]+$/, "")}.`;
}

function trimClosingLetter(text, maxWords) {
  const signatureMatch = text.match(/\n\nSincerely,\n.+$/);
  const signature = signatureMatch ? signatureMatch[0] : "";
  const body = signature ? text.slice(0, -signature.length) : text;
  const allowance = maxWords - wordCount(signature);
  return `${trimToWords(body, Math.max(allowance, 1))}${signature}`;
}

function buildHtmlReport(jobs, generatedAt, summary) {
  const rows = jobs.map((job, index) => {
    const reasons = job.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("");
    const letter = escapeHtml(job.coverLetter).replace(/\n/g, "<br>");
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
        <details>
          <summary>Cover Letter</summary>
          <div class="letter">${letter}</div>
        </details>
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
    details {
      border-top: 1px solid var(--line);
      padding-top: 11px;
    }
    summary {
      cursor: pointer;
      font-weight: 750;
      color: var(--accent-dark);
    }
    .letter {
      margin-top: 12px;
      padding: 14px;
      background: #fbfcfd;
      border: 1px solid var(--line);
      border-radius: 6px;
      white-space: normal;
    }
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
    <p class="subhead">Generated ${escapeHtml(generatedAt)}. Review-only: cover letters only, no resume generation, no interview prep, no application submission.</p>
  </header>
  <main>
    <section class="summary" aria-labelledby="filter-summary">
      <h2 id="filter-summary">Filter Summary</h2>
      <div class="summary-grid">
        <div class="summary-item"><span class="summary-label">Jobs considered</span><span class="summary-value">${summary.jobsConsidered}</span></div>
        <div class="summary-item"><span class="summary-label">Old postings excluded</span><span class="summary-value">${summary.excludedOldPosting}</span></div>
        <div class="summary-item"><span class="summary-label">ML/Data Science excluded</span><span class="summary-value">${summary.excludedMlDataScience}</span></div>
        <div class="summary-item"><span class="summary-label">Already applied excluded</span><span class="summary-value">${summary.excludedAlreadyApplied}</span></div>
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

${job.coverLetter}
`;
  }).join("\n---\n\n");

  const summaryRows = jobs.map((job, index) => {
    return `| ${index + 1} | ${escapeMd(job.title)} | ${escapeMd(job.company)} | ${job.fitScore}/100 | ${escapeMd(job.band)} | [Open Job](${job.url}) |`;
  }).join("\n");

  return `# Apply Mode Report

Generated ${generatedAt}.

Review-only report: cover letters only. No tailored resumes, interview prep notes, STAR stories, pipeline status changes, or application submission.

## Filter Summary

- Jobs considered: ${summary.jobsConsidered}
- Excluded for old posting: ${summary.excludedOldPosting}
- Excluded for ML/Data Science: ${summary.excludedMlDataScience}
- Excluded because already applied: ${summary.excludedAlreadyApplied}
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

function main() {
  const args = readCliArgs();
  const pipelineText = readRequired(PIPELINE_PATH);
  const scanHistoryText = readRequired(SCAN_HISTORY_PATH);
  const cvText = readRequired(CV_PATH);
  const profile = yaml.load(readRequired(PROFILE_PATH)) || {};
  readRequired(PROFILE_NOTES_PATH);

  const scanHistory = parseScanHistory(scanHistoryText);
  const appliedTrackerKeys = readAppliedTrackerKeys();
  const candidate = extractCandidate(profile, cvText);
  const evidence = buildEvidence(profile, cvText);
  const generatedAt = localIsoDate();
  mkdirSync("reports", { recursive: true });
  mkdirSync(OPPORTUNITIES_DIR, { recursive: true });
  const recentOpportunityKeys = readRecentOpportunityKeys(generatedAt);
  const summary = {
    jobsConsidered: 0,
    excludedOldPosting: 0,
    excludedMlDataScience: 0,
    excludedAlreadyApplied: 0,
    includedFinal: 0,
  };
  let excludedRecent = 0;

  let jobs = parsePipeline(pipelineText).filter(job => {
    const row = scanHistory.get(job.url) || {};
    summary.jobsConsidered += 1;
    const oldPosting = !isFreshForApplyMode(job, row, generatedAt);
    const mlDataScience = isMlHeavyRole(job, row);
    const trackerKey = trackerRoleKey(row.company || job.company, row.title || job.title);
    const alreadyApplied = appliedTrackerKeys.has(trackerKey);
    if (oldPosting) {
      summary.excludedOldPosting += 1;
    }
    if (mlDataScience) {
      summary.excludedMlDataScience += 1;
    }
    if (alreadyApplied) {
      summary.excludedAlreadyApplied += 1;
    }
    return !oldPosting && !mlDataScience && !alreadyApplied;
  }).map(job => {
    const row = scanHistory.get(job.url) || {};
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
    enriched.coverLetter = generateCoverLetter(enriched, candidate, enriched.archetype, enriched.reasons, evidence);
    return enriched;
  }).sort((a, b) => b.fitScore - a.fitScore || a.company.localeCompare(b.company));

  jobs = jobs.filter(job => {
    if (!recentOpportunityKeys.has(opportunityKey(job))) return true;
    excludedRecent += 1;
    return false;
  });

  if (args.limit) jobs = jobs.slice(0, args.limit);
  summary.includedFinal = jobs.length;

  const htmlOpportunityOut = `${OPPORTUNITIES_DIR}/${generatedAt}-opportunities.html`;
  const mdOpportunityOut = `${OPPORTUNITIES_DIR}/${generatedAt}-opportunities.md`;
  const htmlReport = buildHtmlReport(jobs, generatedAt, summary);
  const markdownReport = buildMarkdownReport(jobs, generatedAt, summary);
  writeFileSync(htmlOpportunityOut, htmlReport, "utf-8");
  writeFileSync(mdOpportunityOut, markdownReport, "utf-8");
  writeFileSync(HTML_OUT, htmlReport, "utf-8");
  writeFileSync(MD_OUT, markdownReport, "utf-8");
  const deletedOldReports = cleanupOldOpportunityReports(generatedAt);

  console.log(`Today's Apply Mode opportunity report generated.`);
  console.log(`HTML: ${htmlOpportunityOut}`);
  console.log(`Markdown: ${mdOpportunityOut}`);
  console.log(`Jobs considered: ${summary.jobsConsidered}`);
  console.log(`Excluded for old posting: ${summary.excludedOldPosting}`);
  console.log(`Excluded for ML/Data Science: ${summary.excludedMlDataScience}`);
  console.log(`Excluded because already applied: ${summary.excludedAlreadyApplied}`);
  console.log(`Opportunities included: ${jobs.length}`);
  console.log(`Excluded from previous ${OPPORTUNITY_RETENTION_DAYS} days: ${excludedRecent}`);
  console.log(`Old opportunity report files deleted: ${deletedOldReports}`);
  console.log(`Legacy HTML alias: ${HTML_OUT}`);
  console.log(`Legacy Markdown alias: ${MD_OUT}`);
}

main();
