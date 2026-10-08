# PDF Editor

A fully client-side PDF editor built with React. Open a PDF, edit it in the
browser, and download the result. Nothing is uploaded: parsing, rendering and
writing all happen on your device, so the app can be deployed as plain static
files and works offline once loaded.

## Features

- Open PDFs via file picker or drag-and-drop (password-protected files supported)
- Accurate page rendering with lazy loading, zoom, fit-to-width, fit-to-page
- Selectable text, full-text search with highlighted matches
- Add text boxes (font family, size, bold/italic/underline, alignment, colour, background)
- Edit existing text in place (double-click a line, or use the Edit Text tool): the
  original font class, weight, slant, size, baseline, text colour and background
  colour are detected automatically and the replacement keeps the line's width
- Images (PNG, JPEG, WebP, GIF…) with move, resize, rotate
- Freehand drawing and signatures (kept in memory only): draw one, or upload a
  photo of a signed sheet of paper and the editor removes the paper, uneven
  lighting and specks, then re-inks the strokes in a solid colour as a
  transparent image
- Highlight, underline and strikethrough text; highlight regions
- Rectangles, ellipses, lines and arrows; cover/redaction boxes; checkboxes
- Move, resize, rotate, duplicate, copy/paste, re-order and delete elements
- Undo/redo for everything
- Page thumbnails; add blank pages, insert pages from another PDF, duplicate,
  rotate, delete and extract pages; reorder by dragging a thumbnail (the list
  opens a gap where it will land and auto-scrolls), with Alt+Arrow keys or the
  page menu as keyboard alternatives
- Keyboard shortcuts for all common operations
- Light theme by default, with a dark theme toggle in the toolbar (remembered locally)
- Rename the document by clicking its name in the toolbar; a renamed document
  is exported under exactly that name (otherwise `-edited` is appended)
- Export the edited PDF with no watermark or limitations

## Honest limits of browser-based PDF editing

PDF pages are drawing instructions, not editable documents. This editor never
pretends otherwise:

- **Existing text is replaced, not re-flowed.** "Edit text" removes the
  original glyphs from the page content stream (the text-showing operators are
  blanked while keeping their advance, so neighbouring text does not shift) and
  places a new text element on top with a transparent background. The
  replacement is drawn through the document's own font dictionary, so the
  embedded font program is reused unchanged; character codes and advances are
  learned from the page's own text. A subset font only contains the glyphs the
  document used, so characters it lacks are drawn with a matching standard
  font (sans/serif/mono, bold, italic from the font descriptor). The text
  colour is read from the content stream. When the
  glyphs cannot be removed safely (encrypted files, text inside form XObjects,
  partial selections of a single operator) the original is covered with a box
  in the sampled background colour instead, and the editor says so.
- **Fonts.** New text uses the 14 standard PDF fonts (Helvetica, Times, Courier)
  so no font files need to be embedded. Characters outside Latin-1 are
  substituted and the toolbar warns when that happens.
- **Encrypted or malformed files** that cannot be rewritten in place are
  exported with their pages rasterised; the editor tells you when that applies.
- Edits are drawn into the page content. Interactive form fields, links and
  bookmarks of the original file are preserved, but new elements are static.

## Development

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check and build to dist/
npm run preview   # serve the production build
```

`npm run dev`/`build` first copy the pdf.js runtime assets (CMaps, standard
fonts, WASM decoders) into `public/pdfjs` so the app is self-contained.

## Architecture

```
src/
  pdf/            PDF engine wrappers
    pdfjs.ts        worker setup and document loading
    sources.ts      registry of loaded PDFs (bytes + pdf.js proxies)
    renderer.ts     page rasterisation (viewer, thumbnails, flatten fallback)
    textContent.ts  positioned text runs for selection, search and edit-text
    textStyle.ts    font/colour detection for in-place text editing
    textOps.ts      locate and blank text-showing operators in content streams
    displayPage.ts  patched single-page documents for on-screen display
    embeddedFonts.ts reuse of document fonts for replacement text
    geometry.ts     visual <-> PDF user space transforms (mirrors pdf.js viewport)
    fonts.ts        standard-font metrics and text layout (shared with export)
    shapes.ts       shape geometry shared by the screen renderer and export
    export.ts       builds the output PDF with pdf-lib
  editor/
    types.ts        document/element model
    store.ts        external store, selectors, undo/redo
    actions.ts      all state transitions (document, tools, elements, pages, export, search)
    factory.ts      element constructors
    textReplace.ts  cover + replacement text logic
    assets.ts       image asset store
    theme.ts        light/dark theme state (light by default, stored locally)
    signatureImage.ts photo-to-signature clean-up (background removal, thresholding, despeckle)
  components/     React UI (toolbar, context bar, sidebar, viewer, layers, dialogs)
  hooks/          keyboard shortcuts, visibility
```

Element coordinates are stored in PDF points in the *visual* page space
(top-left origin, after rotation). `geometry.ts` converts them into PDF user
space at export time so rotated pages and rotated elements export exactly as
displayed.

## Dependencies

Runtime: `react`, `react-dom`, `pdfjs-dist` (parsing/rendering in a Web
Worker), `pdf-lib` (writing the output PDF). Everything else — state, undo,
drag/resize/rotate, drawing, layout, icons, search — is implemented in the app.

## Privacy

No network requests are made after the app loads, no analytics, no storage of
document data. Signatures are kept in memory for the session only.
