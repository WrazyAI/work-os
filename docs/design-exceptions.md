# Design exceptions

## Evidence surface is intentionally hidden

`desktop/work-os-companion/src/features.ts` keeps `FEATURES.evidence = false`.
The Evidence rail item and related desktop surface remain unavailable until the
consented capture/readback acceptance gate is satisfied. This is a deliberate
privacy and truth-boundary exception, not an unfinished navigation state.

To restore the surface after that acceptance, change this single flag to
`true`; do not add a second feature gate or a partial empty-state route.
