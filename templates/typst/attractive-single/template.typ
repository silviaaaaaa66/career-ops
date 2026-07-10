#let contact(text: "", link: none) = {
  (text: text, link: link)
}

#let subSection(title: "", titleEnd: none, subTitle: none, subTitleEnd: none, content: []) = {
  (title: title, titleEnd: titleEnd, subTitle: subTitle, subTitleEnd: subTitleEnd, content: content)
}

#let section(title: "", content: subSection()) = {
  (title: title, content: content)
}

#let summary(text-content) = {
  box(
    width: 100%,
    height: 4.55em,
    clip: true,
  )[
    #text-content
  ]
}

#let attractiveSingle(
  theme: rgb("#0F83C0"),
  name: "",
  title: "",
  contact: (),
  main: (),
  body,
) = {
  let backgroundTitle(content) = {
    align(center, box(fill: theme, text(white, size: 1.16em, weight: "bold", upper(content)), width: 1fr, inset: 0.24em))
  }

  let secondaryTitle(content) = {
    text(weight: "bold", size: 1.08em, upper(content))
  }

  let italicColorTitle(content) = {
    text(weight: "bold", style: "italic", size: 1.03em, theme, content)
  }

  let createLeftRight(left: [], right: none) = {
    if right == none {
      align(start, text(left))
    } else {
      grid(
        columns: (1fr, auto),
        column-gutter: 1em,
        align(start, text(left)),
        align(end, right),
      )
    }
  }

  let formatContact(c) = {
    if c.link == none {
      text(gray.darken(45%), c.text)
    } else {
      underline(link(c.link, text(theme, c.text)))
    }
  }

  let parseSubSections(subSections) = {
    subSections.map(s => {
      [
        #if s.title != "" or s.titleEnd != none [
          #createLeftRight(
            left: if s.title != "" { secondaryTitle(s.title) } else { [] },
            right: if s.titleEnd != none { italicColorTitle(s.titleEnd) },
          )
        ]
        #if s.subTitle != none or s.subTitleEnd != none [
          #text(
            top-edge: 0.18em,
            createLeftRight(
              left: italicColorTitle(s.subTitle),
              right: s.subTitleEnd,
            ),
          )
        ]
        #s.content
        #v(0.28em)
      ]
    }).join()
  }

  let parseSection(sections) = {
    sections.map(m => {
      [
        #backgroundTitle(m.title)
        #v(0.30em)
        #parseSubSections(m.content)
        #v(0.24em)
      ]
    }).join()
  }

  align(center)[
    #block(upper(text(2.35em, weight: "bold", theme, name)))
    #v(-0.12em)
    #block(upper(text(1.72em, gray.darken(50%), title)))
    #v(0.16em)
    #text(size: 0.95em, contact.map(c => formatContact(c)).join([  |  ]))
  ]

  v(0.56em)
  set par(justify: false)
  parseSection(main)
}
