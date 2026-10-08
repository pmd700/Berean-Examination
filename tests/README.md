# Tests

Run the full unit/render test suite from the `tests/` directory:

```bash
cd tests && node --import tsx --test
```

(Why `cd tests`? `tsx` resolves the JSX transform from the nearest
`tsconfig.json`. The repo's root `tsconfig.json` excludes `src/`, so the
`tests/tsconfig.json` here pins `jsx: react-jsx` for the test runner.)

## Coverage

### `exportBounds.test.js`
Pure-function regression guard for the Knowledge Web export bounds across:

- cards-only canvases
- points-only canvases (the no-double-counting fix: routing reroute points
  contribute zero-area boxes; point objects contribute 16x16 anchor boxes
  centered on the anchor instead of inflating to the generic 240x160 fallback)
- mixed canvases (cards + sections + points + connections)
- the empty-canvas default

If any of these grow back the trailing-whitespace / inflated-export-bounds bug,
these tests fail.

### `exportMenu.test.js`
Render-level guard for the export menu UI in `src/components/knowledgeweb/ExportMenu.jsx`:

- asserts `button-export-pdf`, `button-export-jpeg`, `button-export-berean`,
  `button-import-berean`, and the three `button-export-region-*` radios are
  present in the markup
- asserts each export button toggles to its `Exporting...` label and
  `disabled` state when its `isExporting*` prop is true
- asserts that "Selected section" region disables PDF/JPEG when no section is
  selected, and re-enables them when one is selected
- asserts the import button toggles correctly while an import is in flight

Rendered via `react-dom/server`'s `renderToStaticMarkup` so no JSDOM /
test-library / new devDeps are required.

## Desktop workflow coverage

The desktop proof commands exercise the local owner, encrypted SQLite records,
local Bible files, protected Media, backup/restore, and renderer routing without
an Internet account. A final packaged-app click-through remains release QA.
