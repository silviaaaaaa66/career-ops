#!/usr/bin/env node

/**
 * generate-prep-materials.mjs
 *
 * Renderer for the lightweight /career-ops prep flow.
 *
 * This script does not evaluate roles and does not generate reports. The agent
 * creates a truthful payload from cv.md + config/profile.yml + the JD, then this
 * script renders one tailored resume PDF, one cover letter PDF, and optionally
 * writes/merges a tracker TSV row.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { basename, dirname, join, resolve } from 'path';
import { parseArgs } from 'util';

const OUTPUT_DIR = resolve('output');
const ADDITIONS_DIR = resolve('batch/tracker-additions');
const FONT_DIR = resolve('templates/typst/attractive/assets/fonts');

function usage(exitCode = 0) {
  console.log(`Usage:
  node generate-prep-materials.mjs --payload payload.json [--merge]

Payload shape:
  {
    "date": "YYYY-MM-DD",
    "candidate": {"name": "...", "title": "...", "location": "...", "email": "...", "phone": "..."},
    "job": {"company": "...", "role": "...", "slug": "...", "url": "..."},
    "resume": {
      "summary": "...",
      "experience": [
        {"company": "...", "location": "...", "title": "...", "dates": "...", "bullets": ["..."]}
      ],
      "skills": {"Technical": "...", "Analytics": "...", "Business": "..."},
      "education": [
        {"school": "...", "degree": "...", "dates": "..."}
      ]
    },
    "cover": {
      "greeting": "Dear Hiring Team,",
      "paragraphs": ["...", "..."],
      "closing": "Sincerely,"
    },
    "tracker": {"status": "Evaluated", "score": "N/A", "notes": "..."}
  }`);
  process.exit(exitCode);
}

const { values: args } = parseArgs({
  options: {
    payload: { type: 'string' },
    merge: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (args.help) usage(0);
if (!args.payload) usage(1);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'role';
}

function requireField(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts) cur = cur?.[part];
  if (cur === undefined || cur === null || cur === '') {
    throw new Error(`Missing required payload field: ${path}`);
  }
  return cur;
}

function typText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

function typContent(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/#/g, '\\#')
    .replace(/\$/g, '\\$');
}

function contactTuple(candidate) {
  const parts = [];
  if (candidate.location) parts.push(`contact(text: "${typText(candidate.location)}")`);
  if (candidate.email) parts.push(`contact(text: "${typText(candidate.email)}", link: "mailto:${typText(candidate.email)}")`);
  if (candidate.phone) parts.push(`contact(text: "${typText(candidate.phone)}")`);
  return `(${parts.join(',\n    ')}${parts.length ? ',' : ''})`;
}

function list(items) {
  return `list(\n${items.map((item) => `            [${typContent(item)}],`).join('\n')}\n          )`;
}

function renderResumeTyp(payload, paths) {
  const candidate = payload.candidate;
  const resume = payload.resume;
  const experience = resume.experience || [];
  const education = resume.education || [];
  const skills = resume.skills || {};

  const experienceBlocks = experience.map((job) => `        subSection(
          title: "${typText(job.company)}",
          titleEnd: "${typText(job.location || '')}",
          subTitle: "${typText(job.title)}",
          subTitleEnd: "${typText(job.dates || '')}",
          content: ${list(job.bullets || [])},
        )`).join(',\n');

  const skillBlocks = Object.entries(skills).map(([label, content]) => `        subSection(
          title: "${typText(label)}",
          content: [#v(1em) ${typContent(content)}],
        )`).join(',\n');

  const educationBlocks = education.map((item) => `        subSection(
          title: "${typText(item.school)}",
          subTitle: "${typText(item.degree)}",
          subTitleEnd: "${typText(item.dates || '')}",
        )`).join(',\n');

  return `#import "../templates/typst/attractive-single/template.typ": *

#set page(margin: (left: 10mm, right: 10mm, top: 12mm, bottom: 12mm))
#set text(font: "Mulish", size: 8.95pt, hyphenate: false)
#set par(leading: 0.52em)
#set list(indent: 1.05em, body-indent: 0.38em, spacing: 0.70em)

#show: attractiveSingle.with(
  theme: rgb("#0F83C0"),
  name: "${typText(candidate.name)}",
  title: "${typText(candidate.title)}",
  contact: ${contactTuple(candidate)},
  main: (
    section(
      title: "Summary",
      content: (
        subSection(content: summary([${typContent(resume.summary)}])),
      ),
    ),
    section(
      title: "Work Experience",
      content: (
${experienceBlocks}
      ),
    ),
    section(
      title: "Skills",
      content: (
${skillBlocks}
      ),
    ),
    section(
      title: "Education",
      content: (
${educationBlocks}
      ),
    ),
  ),
)
`;
}

function renderCoverTyp(payload) {
  const candidate = payload.candidate;
  const cover = payload.cover;
  const job = payload.job;
  const paragraphs = (cover.paragraphs || []).map((p) => `[${typContent(p)}]`).join(',\n    ');

  return `#import "../templates/typst/attractive-single/cover-letter.typ": *

#show: coverLetter.with(
  theme: rgb("#0F83C0"),
  name: "${typText(candidate.name)}",
  title: "${typText(candidate.title)}",
  contact: ${contactTuple(candidate)},
  company: "${typText(job.company)}",
  role: "${typText(job.role)}",
  date: "${typText(payload.date)}",
  greeting: "${typText(cover.greeting || 'Dear Hiring Team,')}",
  paragraphs: (
    ${paragraphs}${paragraphs ? ',' : ''}
  ),
  closing: "${typText(cover.closing || 'Sincerely,')}",
)
`;
}

function compileTypst(input, output) {
  const result = spawnSync('typst', [
    'compile',
    '--root',
    process.cwd(),
    '--font-path',
    FONT_DIR,
    input,
    output,
  ], { cwd: process.cwd(), stdio: 'inherit' });

  if (result.error?.code === 'ENOENT') {
    throw new Error('typst is not installed. Install it with: brew install typst');
  }
  if (result.status !== 0) {
    throw new Error(`typst compile failed for ${input}`);
  }
}

function writeTrackerAddition(payload, paths) {
  mkdirSync(ADDITIONS_DIR, { recursive: true });
  const job = payload.job;
  const tracker = payload.tracker || {};
  const num = '000';
  const status = tracker.status || 'Evaluated';
  const score = tracker.score || 'N/A';
  const note = tracker.notes || `Prepared tailored resume and cover letter: ${paths.resumePdfRel}; ${paths.coverPdfRel}`;
  const file = join(ADDITIONS_DIR, `prep-${slugify(job.slug || job.company)}.tsv`);
  const row = [
    num,
    payload.date,
    job.company,
    job.role,
    status,
    score,
    '✅',
    '—',
    note,
  ].join('\t');
  writeFileSync(file, `${row}\n`, 'utf-8');
  return file;
}

const payloadPath = resolve(args.payload);
if (!existsSync(payloadPath)) throw new Error(`Payload not found: ${payloadPath}`);
const payload = JSON.parse(readFileSync(payloadPath, 'utf-8'));

requireField(payload, 'date');
requireField(payload, 'candidate.name');
requireField(payload, 'candidate.title');
requireField(payload, 'job.company');
requireField(payload, 'job.role');
requireField(payload, 'resume.summary');

const candidateSlug = slugify(payload.candidate.name);
const companySlug = slugify(payload.job.slug || payload.job.company);
const base = `${candidateSlug}-${companySlug}`;
const paths = {
  resumeTyp: resolve(OUTPUT_DIR, `resume-${base}.typ`),
  resumePdf: resolve(OUTPUT_DIR, `resume-${base}-${payload.date}.pdf`),
  coverTyp: resolve(OUTPUT_DIR, `cover-${base}.typ`),
  coverPdf: resolve(OUTPUT_DIR, `cover-${base}-${payload.date}.pdf`),
};
paths.resumePdfRel = paths.resumePdf.replace(`${process.cwd()}/`, '');
paths.coverPdfRel = paths.coverPdf.replace(`${process.cwd()}/`, '');

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(paths.resumeTyp, renderResumeTyp(payload, paths), 'utf-8');
writeFileSync(paths.coverTyp, renderCoverTyp(payload), 'utf-8');
compileTypst(paths.resumeTyp, paths.resumePdf);
compileTypst(paths.coverTyp, paths.coverPdf);

let trackerFile = null;
if (payload.tracker !== false) {
  trackerFile = writeTrackerAddition(payload, paths);
  if (args.merge) {
    const merge = spawnSync('node', ['merge-tracker.mjs'], { cwd: process.cwd(), stdio: 'inherit' });
    if (merge.status !== 0) throw new Error('merge-tracker.mjs failed');
  }
}

console.log(JSON.stringify({
  resume_typ: paths.resumeTyp,
  resume_pdf: paths.resumePdf,
  cover_typ: paths.coverTyp,
  cover_pdf: paths.coverPdf,
  tracker_addition: trackerFile,
  merged: Boolean(args.merge),
}, null, 2));
