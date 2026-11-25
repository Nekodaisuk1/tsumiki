# Project instructions

## Commands

- Install: `npm ci`
- Development: `npm run dev`
- Build and type check: `npm run build`
- Tests: `npm test`
- Browser tests (local Google Chrome): `npm run test:e2e`
- Lint and format check: `npm run lint`
- Apply formatting: `npm run format`

## Layout

- `src/model.ts`: dimensionless geometric and rope model, independent of rendering.
- `src/main.ts`: 3D structure editor, comparison UI, design import/export.
- `src/structure/design.ts`: versioned design format and strict runtime validation.
- `src/structure/solver.ts`: 3D frame with clearance-contact joints, wound tension-only rope (sliding or locked wraps), convex static equilibrium and Newmark dynamics.
- `src/structure/viewport.ts`: Three.js patterned geometry, picking and transform controls.
- `src/structure/geometry.ts`: true through holes, male tenons, rings and seating helpers.
- `src/structure/holes.ts`: hole coordinates, normal snapping and pierced-board connection validation.
- `src/structure/rope.ts`: supported frame detection, exclusive winders and outer rope attachment points.
- `src/structure/seats.ts`: four assembly slots plus one reserved rope slot.
- `src/structure/editor.ts`: part addition, continuous bays and full-design undo/redo.
- `src/rope-lab.ts`: historical 2D SVG workbench.
- `public/schemas/`, `public/examples/`: dedicated format schema and sample.
- `tests/`: physical invariants and model regression tests.
- `docs/product.md`: requirements, confirmed mechanisms, open questions.
- `docs/experiments/`: experiment specifications and results.

## Modeling conventions

- Keep material dimensions unresolved until explicitly supplied. Use dimensionless side ratios.
- State assumptions and limitations in the UI and experiment records.
- Never report relative force values as newtons or relaxed motion as calibrated real time.
- Do not force a rectangular result to hide disagreement between the model and the physical mechanism.
- Update experiment records after meaningful model changes and verification.
