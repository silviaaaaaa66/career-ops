#!/usr/bin/env node

/**
 * Independent baseline generator for Shiyu's Word-inspired Typst resume.
 *
 * This does not touch career-ops flow, tracker, pipeline, or reports.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';

const outputTyp = resolve('output/shiyu-resume-baseline.typ');
const outputPdf = resolve('output/shiyu-resume-baseline.pdf');

function typText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

const content = `#import "../templates/typst/shiyu-resume.typ": *

#show: resume.with(
  name: "Shiyu (Silvia) Ding",
  contact: contact-line((
    link-text("shiyu.ding66@yahoo.com", "mailto:shiyu.ding66@yahoo.com"),
    [Waukegan, IL],
    [860-9319270],
    link-text("linkedin.com/in/shiyu66ding/", "https://www.linkedin.com/in/shiyu66ding/"),
  )),
)

#section-title("Work Experience")

#employer("Chewy", "Boston, MA")
#role-line("Senior E-Commerce Analyst", "Mar. 2023 - Apr. 2025")
#bullet-list((
  [Developed self-service app A/B test dashboard & ETL pipeline using #strong[Tableau, SQL, and AWS], closing a critical visibility gap in app testing data. Accelerated test readout velocity from two weeks to next day and eliminated ~50 hours of manual analysis per month.],
  [Led analytics for multi-phase navigation optimization initiative, supporting experimental design, consultation, deep dives, and dashboard development across five iterative A/B tests. Achieved site CVR +22bps, page success rate +16%, desktop nav CTR +12.2%, all stats sig. Utilized #strong[Python and statistical analysis] to validate results, influencing strategic rollout decisions.],
  [Led Chewy's company-wide experiment holdout strategy, including design proposal, project management. Proactively addressing ambiguity in timelines and deliverables. Established weekly check-ins, clarified project scopes, and implemented a RACI framework, improving stakeholder alignment. Enabled the on-time launch of the Holdout pilot.],
  [Conducted regular platform training sessions to upskill stakeholders on new features and improvements, ensuring seamless adoption of platform enhancements.],
))

#employer("American Family Insurance", "Madison, WI")
#role-line("Business Analytics Analyst III", "Jan.2022 - Mar.2023")
#role-line("Business Analytics Analyst II", "Jun. 2020 - Jan.2022")
#role-line("Data Analyst Intern", "May. 2019 - Aug. 2019 & Jan. 2020 - May 2020")
#bullet-list((
  [Performed in-depth analysis on call center and customer journey data, generating actionable insights to maximize customer satisfaction and operational efficiency.],
  [Built automated #strong[Tableau] dashboards to streamline reporting for customer engagement metrics, enhancing the reporting efficiency of the ACO department by 100% and delivering timely insights to stakeholders.],
  [Designed #strong[ETL] pipelines on AWS (EC2, Lambda) for efficient data transformation, reducing manual data preparation time by 90%, enabling faster insights generation for ongoing business priorities.],
  [Led #strong[time series forecasting and predictive modeling projects in Python] using ARIMA, Prophet, and decision trees to improve customer service response and drive process improvements.],
))

#section-title("Skills")
#skill-row("Technical:", [#strong[SQL, Python, Tableau, AWS (S3, Athena, EC2), Airflow, A/B Testing, Optimizely]])
#skill-row("Soft Skill:", [Experimentation Design & Execution, Project Management (JIRA, Confluence), Cross-functional Collaboration, Data Storytelling & Visualization])

#section-title("Education")
#block[#strong[M.S.,] Business Analytics and Project Management, University of Connecticut (2018-2020)]
#v(0.12em)
#block[#strong[B.S.,] Automobile Service Engineering, Shanghai Normal University (2014-2018)]
`;

mkdirSync(dirname(outputTyp), { recursive: true });
writeFileSync(outputTyp, content, 'utf-8');

const typst = spawnSync('typst', [
  'compile',
  '--root',
  process.cwd(),
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
