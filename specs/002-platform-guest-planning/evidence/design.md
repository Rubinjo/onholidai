# Visual direction

Retain the existing identity: canvas #f7f8f6, surface #ffffff, forest #12664f,
deep forest #084c3a, ink #19211e and ocean focus #006d77. Danger stays #a12b26.
Georgia remains the display and reading face; controls inherit it. Semantic
shadcn variables bridge these colors without redefining legacy --accent.

The globe is the distinctive first-step element, with immediately available
search and an ordered route list. The desktop builder has a broad left-aligned
working column and a compact summary alongside it. On mobile the summary becomes
an expandable block. Headings and text remain left aligned. Numbering belongs to
actual wizard steps and destination order only.

```
Desktop: [step progress                         ]
         [globe / focused step      ][trip summary]
         [search + ordered route    ][save status ]
         [back              continue]
Mobile:  [step progress]
         [expandable summary]
         [globe / step]
         [search + route]
         [back / continue]
```

Review against the brief: a generic collection of equal cards would obscure the
route and focused task, so cards are reserved for grouped content rather than
every field. Use the existing palette and typography, no decorative gradient or
new imagery. No automatic rotation or navigation delayed by motion. Existing
keyboard search/list behavior has equal priority to geographic interaction.

This records design intent; rendered screenshots and manual verification remain
pending. Motion is deferred: short CSS feedback is sufficient for the brief.
