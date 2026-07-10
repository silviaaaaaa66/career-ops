#let contact(text: "", link: none) = {
  (text: text, link: link)
}

#let coverLetter(
  theme: rgb("#0F83C0"),
  name: "",
  title: "",
  contact: (),
  company: "",
  role: "",
  date: "",
  greeting: "",
  paragraphs: (),
  closing: "Sincerely,",
  body,
) = {
  set page(
    paper: "us-letter",
    margin: (
      left: 18mm,
      right: 18mm,
      top: 18mm,
      bottom: 18mm,
    ),
  )

  set text(font: "Mulish", size: 10.3pt, hyphenate: false)
  set par(leading: 0.62em, justify: false)

  let formatContact(c) = {
    if c.link == none {
      text(gray.darken(45%), c.text)
    } else {
      underline(link(c.link, text(theme, c.text)))
    }
  }

  align(center)[
    #block(upper(text(2.05em, weight: "bold", theme, name)))
    #v(-0.08em)
    #block(upper(text(1.18em, gray.darken(50%), title)))
    #v(0.18em)
    #text(size: 0.92em, contact.map(c => formatContact(c)).join([  |  ]))
  ]

  v(1.4em)
  box(fill: theme, width: 100%, inset: 0.18em)[
    #align(center, text(white, weight: "bold", upper(role)))
  ]
  v(1.0em)

  grid(
    columns: (1fr, auto),
    company,
    align(right, date),
  )
  v(1.0em)

  if greeting != "" [
    #greeting
    #v(0.7em)
  ]

  for paragraph in paragraphs {
    paragraph
    v(0.74em)
  }

  v(0.7em)
  closing
  v(1.1em)
  name
}
