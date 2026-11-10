# @capitalist-tree/rendering

**Status:** Stub (P0). P4 will populate this package.

The rendering package is responsible for translating simulation state into
visual output (Canvas / SVG / WebGL / etc.) per TDD §15. The renderer:

- Reads `GameState` (and derived render-data shapes such as `TreeRenderData`
  from TDD §15.1).
- NEVER writes to simulation state (TDD §1.8, §15.1).
- Stays replaceable — the choice of Canvas vs SVG vs WebGL is an
  implementation detail of this package.

P0 leaves this package intentionally empty so that downstream agents (P4) can
scaffold it from scratch without unwinding half-built code.
