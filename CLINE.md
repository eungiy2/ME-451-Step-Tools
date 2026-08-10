# Cline Handoff

This is the same active project used by Codex. Read `AGENTS.md` first and treat
it as the authoritative implementation rules. Then read:

- `docs/PROJECT_ARCHITECTURE_AND_ROADMAP.md` for current state and the product
  roadmap.
- `docs/OCCT_NATIVE_TOPOLOGY_PLAN.md` before changing topology, OCCT loading,
  persistent IDs, or PMI-to-topology resolution.
- `docs/COMPACT_PMI_MODE_PLAN.md` before implementing the collapsed, expandable
  viewport-marker presentation for dimensions, FCFs, datums, targets, or DRFs.

## Non-Negotiable Rules

- Make general STEP/AP242 parsing and rendering rules. Never add a filename,
  B-Rep number, or sample-specific patch.
- Keep datum, target, DRF, dimension, and tolerance associations semantic and
  topology-ready. Preserve every target of multi-face datums.
- Use stable OCCT topology references for persistent association work. Runtime
  `BRepFace-*` names are presentation/runtime IDs, not persistent identity.
- Do not regress established viewport behavior: stable leaders, camera-facing
  doglegs, compact overlays, responsive picking, and no duplicate DOM badges.
- Keep the right inspector resizable and bounded. Do not restore removed
  material, spin, or standalone Param controls without an explicit request.
- Run `npm run lint` and `npm run build` after practical parser, viewer, or UI
  changes. Smoke-test more than one NIST sample for parser changes.

## Working Agreement

Inspect the existing implementation before proposing an approach. Explain
cross-layer changes plainly: STEP semantic relationship -> parser record ->
topology resolution -> viewport/UI. Preserve unrelated working-tree changes.
