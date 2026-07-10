#!/usr/bin/env node

/**
 * Independent Typst resume preview generator.
 *
 * This is intentionally not wired into /career-ops, pipeline, tracker, or reports.
 * It generates a Centene-specific preview using the attractive-typst-resume
 * template under templates/typst/attractive/.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';

const outputTyp = resolve('output/typst-resume-shiyu-ding-centene.typ');
const outputPdf = resolve('output/typst-resume-shiyu-ding-centene-2026-07-09.pdf');
const templateDir = resolve('templates/typst/attractive');
const fontDir = resolve(templateDir, 'assets/fonts');

function typText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

function list(items) {
  return `list(\n${items.map((item) => `            [${item}],`).join('\n')}\n          )`;
}

const content = `#import "../templates/typst/attractive/template.typ": *

#set page(
  margin: (
    left: 10mm,
    right: 10mm,
    top: 13mm,
    bottom: 13mm,
  ),
)

#set text(font: "Mulish", size: 9.2pt, hyphenate: false)
#set par(leading: 0.56em)

#show: project.with(
  theme: rgb("#0F83C0"),
  name: "${typText('Shiyu Ding')}",
  title: "${typText('Senior Analytics Engineer')}",
  contact: (
    contact(text: "${typText('Waukegan, IL')}"),
    contact(text: "${typText('shiyu.ding66@yahoo.com')}", link: "mailto:shiyu.ding66@yahoo.com"),
    contact(text: "${typText('+1-860-931-9270')}"),
    contact(text: "${typText('linkedin.com/in/shiyu66ding')}", link: "https://www.linkedin.com/in/shiyu66ding/"),
    contact(text: "${typText('github.com/silviaaaaaa66')}", link: "https://github.com/silviaaaaaa66"),
  ),
  main: (
    section(
      title: "Summary",
      content: (
        subSection(
          content: [
            Senior analytics professional focused on SQL/Python analysis, ETL pipeline automation, BI reporting, experimentation, and stakeholder decision support. Built self-service analytics workflows at Chewy and American Family Insurance that reduced manual work, accelerated readouts, and improved reporting reliability. Strong fit for Centene's Senior Analytics Engineer role through insurance analytics exposure, AWS/Tableau pipeline experience, data modeling fundamentals, and cross-functional requirements translation.
          ],
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
          subTitleEnd: "(Mar. 2023 - Apr. 2025)",
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
          subTitleEnd: "(Jun. 2020 - Mar. 2023)",
          content: ${list([
            'Designed ETL pipelines on AWS EC2 and Lambda for data transformation, reducing manual data preparation time by *90%* and enabling faster insight generation for business priorities.',
            'Built automated Tableau dashboards to streamline reporting for customer engagement metrics, improving ACO reporting efficiency by *100%* and delivering timely insights to stakeholders.',
            'Performed in-depth analysis on call center and customer journey data, generating actionable insights to improve customer satisfaction and operational efficiency.',
            'Led time series forecasting and predictive modeling projects in Python using ARIMA, Prophet, and decision trees to improve customer service response and drive process improvements.',
          ])},
        ),
      ),
    ),
  ),
  sidebar: (
    section(
      title: "Skills",
      content: (
        subSection(
          title: "Technical",
          content: "${typText('SQL • Python • Tableau • AWS S3 • AWS Athena • AWS EC2 • Airflow • Git • Excel')}",
        ),
        subSection(
          title: "Analytics",
          content: "${typText('A/B testing • dashboarding • KPI development • funnel analysis • forecasting • statistical testing • data quality monitoring')}",
        ),
        subSection(
          title: "Business",
          content: "${typText('Requirements gathering • stakeholder communication • data storytelling • project management • JIRA • Confluence')}",
        ),
      ),
    ),
    section(
      title: "Education",
      content: (
        subSection(
          title: "University of Connecticut",
          subTitle: "M.S., Business Analytics and Project Management",
          content: [2018-2020],
        ),
        subSection(
          title: "Shanghai Normal University",
          subTitle: "B.S., Automobile Service Engineering",
          content: [2014-2018],
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
