#let resume(
  name: "",
  contact: (),
  body,
) = {
  set page(
    paper: "us-letter",
    margin: (
      top: 0.5in,
      bottom: 0.55in,
      left: 0.72in,
      right: 0.72in,
    ),
  )

  set text(font: ("Times New Roman", "Times"), size: 10.8pt, hyphenate: false)
  set par(leading: 0.66em, spacing: 0pt)

  align(center)[
    #text(size: 21pt, weight: "bold", name)\
    #v(-0.04em)
    #contact
  ]
  v(0.55em)

  body
}

#let link-text(label, url) = underline(link(url, text(blue, label)))

#let contact-line(items) = {
  text(size: 10.7pt, fill: rgb("#4f4f4f"))[
    #items.join([ • ])
  ]
}

#let section-title(title) = {
  v(0.82em)
  text(size: 12.1pt, weight: "bold", upper(underline(title)))
  v(0.46em)
}

#let employer(name, location) = {
  block[
    #grid(
      columns: (1fr, auto),
      column-gutter: 1em,
      text(style: "italic", weight: "bold", name),
      align(right, text(style: "italic", location)),
    )
  ]
  v(0.16em)
}

#let role-line(role, dates) = {
  block[
    #grid(
      columns: (1fr, auto),
      column-gutter: 1em,
      text(style: "italic", role),
      align(right, text(style: "italic", dates)),
    )
  ]
  v(0.18em)
}

#let bullet-list(items) = {
  v(0.34em)
  for item in items {
    grid(
      columns: (0.28in, 1fr),
      column-gutter: 0.02in,
      align(right)[•],
      item,
    )
    v(0.12em)
  }
  v(0.14em)
}

#let skill-row(label, content) = {
  grid(
    columns: (1.25in, 1fr),
    column-gutter: 0.1in,
    text(weight: "bold", label),
    content,
  )
  v(0.06em)
}
