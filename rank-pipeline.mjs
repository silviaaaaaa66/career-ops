#!/usr/bin/env node

/**
 * rank-pipeline.mjs — score and sort data/pipeline.md Pending roles.
 *
 * By default this runs the full triage workflow: fill missing locations,
 * evaluate Data Scientist JDs for ML-heavy keywords, rank Pending, and move
 * Fit 0 rejects to Processed. Use --fast for the old local-only sort.
 * It never creates reports, generates PDFs, updates tracker rows, or submits
 * applications.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parseArgs } from 'util';
import { scoreOfferFit } from './scan.mjs';

const PIPELINE_PATH = 'data/pipeline.md';
const JD_FETCH_TIMEOUT_MS = 12000;
const LOCATION_FETCH_TIMEOUT_MS = 12000;
const DATA_SCIENTIST_ML_KEYWORDS = [
  'nlp',
  'ml',
  'llm',
  'algorithm',
  'algorithms',
  'machine learning',
  'machine learning model',
  'machine learning models',
  'large language model',
  'large language models',
  'model development',
  'predictive modeling',
  'deep learning',
  'natural language processing',
];
const LOCAL_US_LOCATION_RE = /\b(chicago|north chicago|waukegan|lake county|lake forest|deerfield|vernon hills|libertyville|gurnee|northbrook|highland park|buffalo grove|mundelein|lincolnshire|glenview|evanston|boston|massachusetts|\bma\b)\b/i;
const ACCEPTED_NON_US_LOCATION_RE = /\b(germany|deutschland|ludwigshafen|europe)\b/i;
const DISALLOWED_NON_US_LOCATION_RE = /\b(india|bengaluru|hyderabad|canada|canadian|quebec|\bqc\b|montr[eé]al|montral|australia|melbourne|sydney|poland|gdansk|france|belgium|netherlands|spain|portugal|ireland|united kingdom|\buk\b|england|singapore)\b/i;

function usage() {
  console.log(`
Usage:
  npm run rank-pipeline
  node rank-pipeline.mjs --dry-run
  npm run rank-pipeline -- --fast
  npm run rank-pipeline -- --no-move-rejects

Options:
  --dry-run      Print the ranked pipeline without writing data/pipeline.md.
  --fast         Old local-only sort: no location fill, no JD fetch, no move.
  --no-move-rejects
                 Keep Fit 0 rejects in Pending after ranking.
  --evaluate-jd  Fetch JDs only for non-Product Data Scientist roles and reject
                 ML/LLM/algorithm-heavy postings. Enabled by default unless --fast.
  --fill-location
                 Fill missing locations from title hints, Workday URLs, or
                 fetched posting details. Enabled by default unless --fast.
`);
}

function sanitizeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeUrl(value) {
  return sanitizeCell(value).replace(/\|/g, '%7C');
}

function stripExistingFit(title) {
  return sanitizeCell(title).replace(/\s+-\s+Fit\s+\d+(?:\.\d+)?\s+\(.+?\)(?:\s+[\u2014-]\s+.*)?$/u, '').trim();
}

function splitPendingSections(lines) {
  const start = lines.findIndex(line => /^##\s+Pending\b/i.test(line.trim()));
  if (start < 0) throw new Error('Could not find "## Pending" in data/pipeline.md');
  const endRel = lines.slice(start + 1).findIndex(line => /^##\s+/i.test(line.trim()));
  const end = endRel < 0 ? lines.length : start + 1 + endRel;
  return {
    before: lines.slice(0, start + 1),
    pending: lines.slice(start + 1, end),
    after: lines.slice(end),
  };
}

function splitPipelineSections(lines) {
  const pendingStart = lines.findIndex(line => /^##\s+Pending\b/i.test(line.trim()));
  if (pendingStart < 0) throw new Error('Could not find "## Pending" in data/pipeline.md');

  const processedStart = lines.findIndex(line => /^##\s+Processed\b/i.test(line.trim()));
  if (processedStart < 0) throw new Error('Could not find "## Processed" in data/pipeline.md');
  if (processedStart <= pendingStart) throw new Error('"## Processed" must appear after "## Pending"');

  const processedEndRel = lines.slice(processedStart + 1).findIndex(line => /^##\s+/i.test(line.trim()));
  const processedEnd = processedEndRel < 0 ? lines.length : processedStart + 1 + processedEndRel;

  return {
    beforePending: lines.slice(0, pendingStart + 1),
    pending: lines.slice(pendingStart + 1, processedStart),
    processedHeader: lines.slice(processedStart, processedStart + 1),
    processed: lines.slice(processedStart + 1, processedEnd),
    afterProcessed: lines.slice(processedEnd),
  };
}

function parsePendingOffer(line, originalIndex) {
  const match = line.match(/^-\s+\[\s\]\s+(.+)$/);
  if (!match) return null;

  const parts = match[1].split('|').map(part => part.trim());
  if (parts.length < 3) return null;

  const url = sanitizeUrl(parts[0]);
  const company = sanitizeCell(parts[1]);
  let title = stripExistingFit(parts[2]);
  let cursor = 3;
  let postedDateUnknown = false;

  if (/^Fit\s+\d+(?:\.\d+)?\s+\(.+?\)/i.test(parts[cursor] || '')) {
    cursor += 1;
  }

  if (/^posted_date_unknown$/i.test(parts[cursor] || '')) {
    postedDateUnknown = true;
    cursor += 1;
  }

  const location = sanitizeCell(parts[cursor] || '');
  const compensation = sanitizeCell(parts[cursor + 1] || '');
  const fit = scoreOfferFit({ title, location });

  return {
    url,
    company,
    title,
    location,
    compensation,
    postedDateUnknown,
    originalIndex,
    ...fit,
  };
}

function formatRankedOffer(offer) {
  const fit = `Fit ${offer.fitScore} (${sanitizeCell(offer.fitBand)})`;
  const rationale = sanitizeCell(offer.fitRationale);
  let line = `- [ ] ${offer.url} | ${offer.company} | ${offer.title} - ${fit} — ${rationale}`;
  if (offer.postedDateUnknown) line += ' | posted_date_unknown';
  if (offer.compensation) {
    line += ` | ${offer.location} | ${offer.compensation}`;
  } else if (offer.location) {
    line += ` | ${offer.location}`;
  }
  return line;
}

function processedUrlSet(lines) {
  const urls = new Set();
  for (const line of lines) {
    const match = line.match(/^-\s+\[x\]\s+([^|\s]+)\s*(?:\||$)/i);
    if (match) urls.add(sanitizeUrl(match[1]));
  }
  return urls;
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatProcessedReject(offer, date = localIsoDate()) {
  const rationale = sanitizeCell(offer.fitRationale);
  let line = `- [x] ${offer.url} | ${offer.company} | ${offer.title} | Rejected ${date} | Fit ${offer.fitScore}: ${rationale}`;
  if (offer.location) line += ` | ${offer.location}`;
  return line;
}

function shouldEvaluateDataScientistJd(title) {
  const lower = String(title || '').toLowerCase();
  return /\bdata scientist\b/.test(lower) && !/\bproduct data scientist\b/.test(lower);
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function findMlHeavyKeyword(text) {
  const lower = String(text || '').toLowerCase();
  return DATA_SCIENTIST_ML_KEYWORDS.find(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(lower);
  }) || null;
}

function hasMissingLocation(location) {
  return sanitizeCell(location) === '';
}

function titleLocationHint(title) {
  const normalizedTitle = sanitizeCell(title);
  const paren = normalizedTitle.match(/\((?:hybrid|onsite|on-site|remote)?\s*[-\u2013\u2014]\s*([^)]+)\)/i);
  if (paren) return normalizeLocationCandidate(paren[1]);

  const trailing = normalizedTitle.match(/\b(?:hybrid|onsite|on-site)\s*[-\u2013\u2014]\s*([A-Z][A-Za-z .]+,\s*[A-Z]{2})\b/);
  return trailing ? normalizeLocationCandidate(trailing[1]) : '';
}

function humanizeWorkdayLocationSegment(segment) {
  const decoded = decodeURIComponent(String(segment || '').replace(/\+/g, ' '));
  return normalizeLocationCandidate(decoded
    .replace(/---+/g, ' - ')
    .replace(/--+/g, ' - ')
    .replace(/-/g, ' '));
}

function locationFromWorkdayUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/\.myworkdayjobs\.com$/i.test(parsed.hostname)) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    const jobIndex = parts.findIndex(part => part.toLowerCase() === 'job');
    if (jobIndex < 0 || !parts[jobIndex + 1]) return '';
    return humanizeWorkdayLocationSegment(parts[jobIndex + 1]);
  } catch {
    return '';
  }
}

function workdayDetailApiUrl(url) {
  try {
    const parsed = new URL(url);
    const hostMatch = parsed.hostname.match(/^([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com$/i);
    if (!hostMatch) return '';
    const tenant = hostMatch[1];
    const parts = parsed.pathname.split('/').filter(Boolean);
    const site = parts[0];
    const jobIndex = parts.findIndex(part => part.toLowerCase() === 'job');
    if (!site || jobIndex < 0) return '';
    const externalPath = `/${parts.slice(jobIndex).join('/')}`;
    return `${parsed.origin}/wday/cxs/${tenant}/${site}${externalPath}`;
  } catch {
    return '';
  }
}

function normalizeLocationCandidate(value) {
  const candidate = sanitizeCell(value)
    .replace(/^location\s*[:|-]\s*/i, '')
    .replace(/\s*>\s*/g, ' > ')
    .trim();
  if (!candidate || candidate.length > 140) return '';
  if (/^(job|apply|posted|full time|part time|regular)$/i.test(candidate)) return '';
  return candidate;
}

function locationPolicyDecision(location) {
  const normalized = sanitizeCell(location);
  if (!normalized) return { hardReject: false, reason: '' };

  if (ACCEPTED_NON_US_LOCATION_RE.test(normalized)) {
    return { hardReject: false, reason: '' };
  }

  if (DISALLOWED_NON_US_LOCATION_RE.test(normalized)) {
    return { hardReject: true, reason: `outside target geography: ${normalized}` };
  }

  if (/\bremote\b/i.test(normalized)) {
    return { hardReject: false, reason: '' };
  }

  if (LOCAL_US_LOCATION_RE.test(normalized)) {
    return { hardReject: false, reason: '' };
  }

  return { hardReject: true, reason: `outside target geography: ${normalized}` };
}

function locationFromJson(value) {
  if (!value || typeof value !== 'object') return '';
  const direct = [
    value.locationsText,
    value.location,
    value.primaryLocation,
    value.jobLocation,
    value.jobPostingInfo?.locationsText,
    value.jobPostingInfo?.location,
    value.jobPostingInfo?.primaryLocation,
    value.jobPostingInfo?.jobLocation,
  ];
  for (const item of direct) {
    if (typeof item === 'string') {
      const normalized = normalizeLocationCandidate(item);
      if (normalized) return normalized;
    }
    if (item && typeof item === 'object') {
      const normalized = normalizeLocationCandidate([
        item.city,
        item.region,
        item.state,
        item.country,
        item.name,
      ].filter(Boolean).join(', '));
      if (normalized) return normalized;
    }
  }
  return '';
}

function locationFromHtml(html) {
  const text = String(html || '');
  const jsonLdLocation = text.match(/"jobLocation"\s*:\s*(?:"([^"]+)"|\{[\s\S]{0,1200}?\})/i);
  if (jsonLdLocation) {
    const normalized = normalizeLocationCandidate(jsonLdLocation[1] || stripHtmlToText(jsonLdLocation[0]));
    if (normalized) return normalized;
  }
  const patterns = [
    /"locationsText"\s*:\s*"([^"]+)"/i,
    /"primaryLocation"\s*:\s*"([^"]+)"/i,
    /"location"\s*:\s*"([^"]+)"/i,
    /<[^>]*(?:class|data-automation-id)=["'][^"']*location[^"']*["'][^>]*>([\s\S]{0,300}?)<\/[^>]+>/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const normalized = normalizeLocationCandidate(stripHtmlToText(match[1]));
    if (normalized) return normalized;
  }
  return '';
}

async function fetchJdText(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this Node runtime');
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'career-ops rank-pipeline JD evaluator',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(JD_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return stripHtmlToText(await response.text());
}

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this Node runtime');
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'career-ops rank-pipeline location evaluator',
      accept: 'application/json,text/plain;q=0.8,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(LOCATION_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchHtml(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this Node runtime');
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'career-ops rank-pipeline location evaluator',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(LOCATION_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchLocation(offer, opts = {}) {
  const titleHint = titleLocationHint(offer.title);
  if (titleHint) return titleHint;

  const workdayUrlLocation = locationFromWorkdayUrl(offer.url);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const apiUrl = workdayDetailApiUrl(offer.url);
  if (apiUrl) {
    try {
      const json = opts.fetchJson
        ? await opts.fetchJson(apiUrl)
        : await fetchJson(apiUrl, fetchImpl);
      const location = locationFromJson(json);
      if (location) return location;
    } catch {
      // Fall through to HTML fetch. Workday detail APIs vary by tenant.
    }
  }

  try {
    const html = opts.fetchHtml
      ? await opts.fetchHtml(offer.url)
      : await fetchHtml(offer.url, fetchImpl);
    const htmlLocation = locationFromHtml(html);
    if (htmlLocation) return htmlLocation;
  } catch {
    // Fall through to URL-derived location.
  }

  if (workdayUrlLocation) return workdayUrlLocation;
  throw new Error('location not found in posting');
}

async function fillOfferLocation(offer, opts = {}) {
  let next = offer;

  try {
    if (hasMissingLocation(offer.location)) {
      const location = await fetchLocation(offer, opts);
      const fit = scoreOfferFit({ title: offer.title, location });
      next = {
        ...offer,
        location,
        ...fit,
        fitRationale: `${fit.fitRationale}; location filled`,
      };
    }
  } catch (err) {
    next = {
      ...offer,
      fitRationale: `${offer.fitRationale}; location fill failed: ${sanitizeCell(err.message)}`,
    };
  }

  const policy = locationPolicyDecision(next.location);
  if (!policy.hardReject) return next;

  return {
    ...next,
    fitScore: 0,
    fitBand: 'Reject',
    fitRationale: `${next.fitRationale}; location hard reject: ${policy.reason}`,
  };
}

async function evaluateDataScientistJd(offer, fetchText = fetchJdText) {
  if (!shouldEvaluateDataScientistJd(offer.title)) return offer;

  try {
    const jdText = await fetchText(offer.url);
    const keyword = findMlHeavyKeyword(jdText);
    if (!keyword) {
      return {
        ...offer,
        fitRationale: `${offer.fitRationale}; data scientist JD checked: no ML/LLM/algorithm-heavy keyword found`,
      };
    }
    return {
      ...offer,
      fitScore: 0,
      fitBand: 'Reject',
      fitRationale: `${offer.fitRationale}; data scientist JD hard reject: mentions "${keyword}"`,
    };
  } catch (err) {
    return {
      ...offer,
      fitRationale: `${offer.fitRationale}; data scientist JD not readable: ${sanitizeCell(err.message)}; needs manual review`,
    };
  }
}

function rankPipelineText(text) {
  const lines = text.split(/\r?\n/);
  const hadFinalNewline = /\r?\n$/.test(text);
  const { before, pending, after } = splitPendingSections(lines);

  const prefix = [];
  const suffix = [];
  const offers = [];
  let seenOffer = false;

  pending.forEach((line, index) => {
    const offer = parsePendingOffer(line, index);
    if (offer) {
      seenOffer = true;
      offers.push(offer);
    } else if (!seenOffer) {
      prefix.push(line);
    } else {
      suffix.push(line);
    }
  });

  offers.sort((a, b) =>
    b.fitScore - a.fitScore ||
    a.company.localeCompare(b.company) ||
    a.title.localeCompare(b.title) ||
    a.originalIndex - b.originalIndex
  );

  const rankedPending = [
    ...prefix,
    ...offers.map(formatRankedOffer),
    ...suffix,
  ];
  const output = [...before, ...rankedPending, ...after].join('\n');
  return hadFinalNewline ? `${output}\n` : output;
}

async function rankPipelineTextWithEnhancements(text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const hadFinalNewline = /\r?\n$/.test(text);
  const {
    beforePending,
    pending,
    processedHeader,
    processed,
    afterProcessed,
  } = splitPipelineSections(lines);

  const prefix = [];
  const suffix = [];
  const offers = [];
  let seenOffer = false;

  pending.forEach((line, index) => {
    const offer = parsePendingOffer(line, index);
    if (offer) {
      seenOffer = true;
      offers.push(offer);
    } else if (!seenOffer) {
      prefix.push(line);
    } else {
      suffix.push(line);
    }
  });

  const evaluated = [];
  for (const offer of offers) {
    // Intentionally sequential: Pending is usually small, and this avoids
    // hammering ATS pages while still keeping the opt-in workflow simple.
    let next = offer;
    if (opts.fillLocation) next = await fillOfferLocation(next, opts);
    if (opts.evaluateJd) next = await evaluateDataScientistJd(next, opts.fetchText);
    evaluated.push(next);
  }

  const moveRejects = opts.moveRejects !== false;
  const processedUrls = processedUrlSet(processed);
  const pendingOffers = [];
  const movedRejects = [];
  const skippedAlreadyProcessed = [];

  for (const offer of evaluated) {
    if (moveRejects && offer.fitScore === 0) {
      if (processedUrls.has(offer.url)) {
        skippedAlreadyProcessed.push(offer);
      } else {
        movedRejects.push(offer);
        processedUrls.add(offer.url);
      }
    } else {
      pendingOffers.push(offer);
    }
  }

  pendingOffers.sort((a, b) =>
    b.fitScore - a.fitScore ||
    a.company.localeCompare(b.company) ||
    a.title.localeCompare(b.title) ||
    a.originalIndex - b.originalIndex
  );

  const rankedPending = [
    ...prefix,
    ...pendingOffers.map(formatRankedOffer),
    ...suffix,
  ];

  const processedAdditions = movedRejects.map(offer => formatProcessedReject(offer, opts.date));
  const processedBlock = [
    ...processed,
    ...(processed.length && processedAdditions.length ? [''] : []),
    ...processedAdditions,
  ];
  const output = [
    ...beforePending,
    ...rankedPending,
    ...processedHeader,
    ...processedBlock,
    ...afterProcessed,
  ].join('\n');

  rankPipelineTextWithEnhancements.lastSummary = {
    pendingCount: pendingOffers.length,
    movedRejects: movedRejects.length,
    skippedAlreadyProcessed: skippedAlreadyProcessed.length,
  };
  return hadFinalNewline ? `${output}\n` : output;
}
rankPipelineTextWithEnhancements.lastSummary = {
  pendingCount: 0,
  movedRejects: 0,
  skippedAlreadyProcessed: 0,
};

async function rankPipelineTextWithJdEvaluation(text, opts = {}) {
  return rankPipelineTextWithEnhancements(text, { ...opts, evaluateJd: true });
}

async function rankPipelineTextWithLocationFill(text, opts = {}) {
  return rankPipelineTextWithEnhancements(text, { ...opts, fillLocation: true });
}

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean' },
      'evaluate-jd': { type: 'boolean' },
      fast: { type: 'boolean' },
      'fill-location': { type: 'boolean' },
      'no-move-rejects': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    usage();
    return;
  }
  if (!existsSync(PIPELINE_PATH)) throw new Error(`Missing ${PIPELINE_PATH}`);

  const input = readFileSync(PIPELINE_PATH, 'utf-8');
  const useEnhancements = !values.fast || values['evaluate-jd'] || values['fill-location'];
  const evaluateJd = !values.fast || values['evaluate-jd'];
  const fillLocation = !values.fast || values['fill-location'];
  const moveRejects = !values.fast && !values['no-move-rejects'];

  const output = useEnhancements
    ? await rankPipelineTextWithEnhancements(input, {
      evaluateJd,
      fillLocation,
      moveRejects,
    })
    : rankPipelineText(input);
  if (values['dry-run']) {
    process.stdout.write(output);
    return;
  }
  writeFileSync(PIPELINE_PATH, output, 'utf-8');
  const count = (output.match(/^-\s+\[\s\]\s+/gm) || []).length;
  const enhancements = [
    evaluateJd ? 'Data Scientist JD evaluation' : '',
    fillLocation ? 'location fill' : '',
    moveRejects ? 'Fit 0 reject move' : '',
  ].filter(Boolean);
  const note = enhancements.length ? ` with ${enhancements.join(' and ')}` : '';
  const summary = rankPipelineTextWithEnhancements.lastSummary;
  const movedNote = moveRejects
    ? ` Moved ${summary.movedRejects} Fit 0 reject${summary.movedRejects === 1 ? '' : 's'} to Processed.`
    : '';
  const skippedNote = moveRejects && summary.skippedAlreadyProcessed
    ? ` Skipped ${summary.skippedAlreadyProcessed} already processed.`
    : '';
  console.log(`Ranked ${count} pending role${count === 1 ? '' : 's'}${note} in ${PIPELINE_PATH}.${movedNote}${skippedNote}`);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

export {
  evaluateDataScientistJd,
  fetchLocation,
  fillOfferLocation,
  findMlHeavyKeyword,
  locationPolicyDecision,
  locationFromWorkdayUrl,
  parsePendingOffer,
  rankPipelineText,
  rankPipelineTextWithEnhancements,
  rankPipelineTextWithJdEvaluation,
  rankPipelineTextWithLocationFill,
  shouldEvaluateDataScientistJd,
  titleLocationHint,
  workdayDetailApiUrl,
};
