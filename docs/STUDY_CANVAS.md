# Chapter Study canvas

Chapter Study keeps its Scripture reader, translation controls, highlighting and inline commentary. Its floating tool palette reuses Knowledge Web's ten tools: Card, Connect, Draw, Section, Image, Timeline, Point, Erase, Web Link and Hand. Keyboard bindings have their own Chapter Study settings.

- Cards edit inline using TEXT_EDITOR_MACHINERY, with debounced saves and the existing save/export barrier.
- Drawings, sections, images, routing points, live timelines and knowledge-web links reuse the existing object renderers. Images go through protected local Media.
- Trackpad pan/pinch continues to control the canvas; Hand also drags empty canvas with a mouse. Text selection and controls remain interactive. Six-dot commentary handles keep their screen size when zoomed out.
- Connect accepts two clicks on verses, commentary cards or canvas objects. The connection inspector edits its label and straight/curved style. Erase removes canvas objects or saved connections; it does not erase Scripture.

## Find shortcuts

Cmd/Ctrl+F toggles search within the active Chapter Study page, including rendered Scripture and commentary. Matches are painted with the CSS Highlight API without changing saved content or editor selections. Enter and Shift+Enter step through results; Escape closes the search. Hidden dropdown content and controls are excluded.

Shift+Cmd/Ctrl+F opens global library search outside text boxes. In a Chapter Study commentary or canvas-card editor it creates a footnote through the shared editor. Footnotes save inside the same content HTML and remain visible after editing ends.

## Permanent identity

The study canvas belongs to the local library and persists across passage searches and refreshes. Verse endpoints store canonical book/chapter/verse references and follow that reference across translations. Commentary endpoints use the existing annotation ID; canvas endpoints use their saved object ID. Translation-specific commentary remains attached to its original edition.

A connection is drawn when both endpoints are rendered. Removing a verse from the current search only hides its line. It never deletes the saved connection. Bringing the verse back restores the connection. Deleting an actual canvas object or annotation removes its associated connections.

## Storage and export

Migration 16 adds encrypted StudyCanvasObject and StudyConnection tables using the existing local entity bridge and vault. No downloaded Scripture is duplicated. The objects and connections are included in the single-file AI export, with explicit source IDs, canonical verse references and commentary IDs. Whole-database backups include the new tables.

The native proof is `tools/run-study-canvas-proof.cjs`: synthetic data only, all ten tools, protected image storage, removing/reloading a verse, reopening SQLite and the renderer, and handle sizing after zooming out. Quote Backspace regressions remain covered separately by `tools/run-quote-boundary-proof.cjs`.
