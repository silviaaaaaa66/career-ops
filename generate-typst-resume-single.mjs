#!/usr/bin/env node

/**
 * Independent one-column Typst resume preview generator.
 *
 * This does not touch /career-ops, pipeline, tracker, or reports. It uses a new
 * attractive-single template so the original attractive template remains intact.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';

const outputTyp = resolve('output/typst-resume-single-shiyu-ding-centene.typ');
const outputPdf = resolve('output/typst-resume-single-shiyu-ding-centene-2026-07-09.pdf');
const fontDir = resolve('templates/typst/attractive/assets/fonts');

function typText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

function list(items) {
  return `list(\n${items.map((item) => `            [${item}],`).join('\n')}\n          )`;
}

const content = `#import "../templates/typst/attractive-single/template.typ": *

#set page(
  margin: (
    left: 10mm,
    right: 10mm,
    top: 12mm,
    bottom: 12mm,
  ),
)

#set text(font: "Mulish", size: 8.95pt, hyphenate: false)
#set par(leading: 0.52em)
#set list(indent: 1.05em, body-indent: 0.38em, spacing: 0.70em)

#show: attractiveSingle.with(
  theme: rgb("#0F83C0"),
  name: "${typText('Shiyu Ding')}",
  title: "${typText('Senior Analytics Engineer')}",
  contact: (
    contact(text: "${typText('Waukegan, IL')}"),
    contact(text: "${typText('shiyu.ding66@yahoo.com')}", link: "mailto:shiyu.ding66@yahoo.com"),
    contact(text: "${typText('+1-860-931-9270')}"),
  ),
  main: (
    section(
      title: "Summary",
      content: (
        subSection(
          content: summary([
            Senior analytics professional focused on SQL/Python analysis, ETL pipeline automation, BI reporting, experimentation, and stakeholder decision support. Built self-service analytics workflows at Chewy and American Family Insurance that reduced manual work, accelerated readouts, and improved reporting reliability. Strong fit for Centene through insurance analytics exposure, AWS/Tableau pipeline experience, and cross-functional requirements translation.
          ]),
        ),
      ),
    ),
    section(
      title: "Work Experience",
      content: (
        subSection(
          title: "Chewy",
          titleEnd: "Boston, MA",
          subTitle: "Senior E-Commerce Analyst",
          subTitleEnd: "Mar. 2023 - Apr. 2025",
          content: ${list([
            'Developed self-service app A/B test dashboard and ETL pipeline using Tableau, SQL, and AWS, closing a critical visibility gap in app testing data. Accelerated test readout velocity from two weeks to next day and eliminated about *50 hours* of manual analysis per month.',
            'Led analytics for multi-phase navigation optimization across five iterative A/B tests, supporting experimental design, consultation, deep dives, and dashboard development. Achieved site CVR *+22bps*, page success rate *+16%*, and desktop nav CTR *+12.2%*.',
            'Led company-wide experiment holdout strategy, including design proposal and project management. Established weekly check-ins, clarified project scopes, and implemented a RACI framework, enabling on-time pilot launch.',
            'Conducted regular platform training sessions to upskill stakeholders on new features and improvements, supporting adoption of analytics platform enhancements.',
          ])},
        ),
        subSection(
          title: "American Family Insurance",
          titleEnd: "Madison, WI",
          subTitle: "Business Analytics Analyst III / II",
          subTitleEnd: "Jun. 2020 - Mar. 2023",
          content: ${list([
            'Designed ETL pipelines on AWS EC2 and Lambda for data transformation, reducing manual data preparation time by *90%* and enabling faster insight generation for business priorities.',
            'Built automated Tableau dashboards to streamline reporting for customer engagement metrics, improving ACO reporting efficiency by *100%* and delivering timely insights to stakeholders.',
            'Performed in-depth analysis on call center and customer journey data, generating actionable insights to improve customer satisfaction and operational efficiency.',
            'Led time series forecasting and predictive modeling projects in Python using ARIMA, Prophet, and decision trees to improve customer service response and drive process improvements.',
          ])},
        ),
      ),
    ),
    section(
      title: "Skills",
      content: (
        subSection(
          title: "Technical",
          content: [#v(1em) ${typText('SQL • Python • Tableau • AWS S3 • AWS Athena • AWS EC2 • Airflow • Git • Excel')}],
        ),
        subSection(
          title: "Analytics",
          content: [#v(1em) ${typText('A/B testing • dashboarding • KPI development • funnel analysis • forecasting • statistical testing • data quality monitoring')}],
        ),
        subSection(
          title: "Business",
          content: [#v(1em) ${typText('Requirements gathering • stakeholder communication • data storytelling • project management • JIRA • Confluence')}],
        ),
      ),
    ),
    section(
      title: "Education",
      content: (
        subSection(
          title: "University of Connecticut",
          subTitle: "M.S., Business Analytics and Project Management",
          subTitleEnd: "2018-2020",
        ),
        subSection(
          title: "Shanghai Normal University",
          subTitle: "B.S., Automobile Service Engineering",
          subTitleEnd: "2014-2018",
        ),
      ),
    ),
  ),
)
`;

mkdirSync(dirname(outputTyp), { recursive: true });
writeFileSync(outputTyp, content, 'utf-8');

const typst = spawnSync('typst', [
  'compile',
  '--root',
  process.cwd(),
  '--font-path',
  fontDir,
  outputTyp,
  outputPdf,
], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (typst.error?.code === 'ENOENT') {
  console.error('typst is not installed. Install it with: brew install typst');
  process.exit(127);
}

if (typst.status !== 0) {
  process.exit(typst.status ?? 1);
}

console.log(`Generated ${outputTyp}`);
console.log(`Generated ${outputPdf}`);
