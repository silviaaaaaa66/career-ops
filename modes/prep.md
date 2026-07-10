# Mode: prep — Lightweight Application Materials

Use this mode when the user has already selected a role and wants only:

- one tailored resume PDF
- one tailored cover letter PDF
- one tracker row

Do **not** generate a long A-G evaluation report. Do **not** run `pipeline`, `deep`, or `apply`. Do **not** decide whether the user should apply unless there is an obvious blocker in the JD.

## Inputs

The user provides either:

- a JD URL
- pasted JD text
- an existing local JD file

## Source Of Truth

Use only:

- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- the JD text or URL content
- current conversation statements

Do not invent skills, tools, metrics, sponsorship details, company facts, or authorship claims.

## Workflow

1. Read `cv.md`, `config/profile.yml`, and `modes/_profile.md`.
2. Extract the JD.
   - For a URL, use Playwright/browser when available. If unavailable, use a direct ATS/API extraction only when the posting body is visible and complete.
   - Stop if the posting is clearly closed.
3. Build tailored content internally:
   - Resume title: one role-aligned title, not multiple titles.
   - Summary: maximum 4 rendered lines using the `summary(...)` helper in `templates/typst/attractive-single/template.typ`.
   - Work Experience: reorder or lightly rewrite existing bullets to match JD keywords, but keep all facts backed by `cv.md`.
   - Skills: include only skills backed by `cv.md` or `config/profile.yml`.
   - Education: keep degree names and dates truthful.
   - Cover letter: concise, role-specific, based only on backed proof points and JD language.
4. Create a JSON payload for `generate-prep-materials.mjs`.
5. Run:

```bash
node generate-prep-materials.mjs --payload <payload.json> --merge
```

6. Return only the generated paths and the tracker status.

## Output Files

Expected output:

```text
output/resume-{candidate}-{company}.typ
output/resume-{candidate}-{company}-{date}.pdf
output/cover-{candidate}-{company}.typ
output/cover-{candidate}-{company}-{date}.pdf
```

Tracker:

- Write through `batch/tracker-additions/*.tsv`.
- Merge with `node merge-tracker.mjs`.
- Default status: `Evaluated`.
- Use `Applied` only if the user explicitly says the application was submitted.
- Report field is `—` because prep intentionally does not generate a report.

## Payload Schema

```json
{
  "date": "YYYY-MM-DD",
  "candidate": {
    "name": "Shiyu Ding",
    "title": "Senior Analytics Engineer",
    "location": "Waukegan, IL",
    "email": "shiyu.ding66@yahoo.com",
    "phone": "+1-860-931-9270"
  },
  "job": {
    "company": "Company",
    "role": "Role",
    "slug": "company",
    "url": "https://..."
  },
  "resume": {
    "summary": "Maximum four rendered lines.",
    "experience": [
      {
        "company": "Chewy",
        "location": "Boston, MA",
        "title": "Senior E-Commerce Analyst",
        "dates": "Mar. 2023 - Apr. 2025",
        "bullets": ["Backed bullet from cv.md"]
      }
    ],
    "skills": {
      "Technical": "SQL • Python • Tableau",
      "Analytics": "A/B testing • dashboarding",
      "Business": "Requirements gathering • stakeholder communication"
    },
    "education": [
      {
        "school": "University of Connecticut",
        "degree": "M.S., Business Analytics and Project Management",
        "dates": "2018-2020"
      }
    ]
  },
  "cover": {
    "greeting": "Dear Hiring Team,",
    "paragraphs": ["Concise paragraph."],
    "closing": "Sincerely,"
  },
  "tracker": {
    "status": "Evaluated",
    "score": "N/A",
    "notes": "Tailored resume and cover prepared."
  }
}
```

## Template Rules

Use the latest single-column Typst template:

```text
templates/typst/attractive-single/template.typ
templates/typst/attractive-single/cover-letter.typ
```

Resume constraints:

- one page target
- no sidebar
- no LinkedIn/GitHub unless the user asks
- no Target Fit / Logistics / Selected Project sections
- section order: Summary → Work Experience → Skills → Education
- Work Experience dates have no parentheses
- Skills appear after Work Experience and before Education
