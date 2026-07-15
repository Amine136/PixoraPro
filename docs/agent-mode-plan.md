# Pixora Agent Mode — Development Plan

A chat panel where an LLM edits the live Fabric canvas by calling tools
("make the title bigger and add a red arrow").

**Key constraint:** Pixora integrates into a parent system that owns all
provider keys and routes to whichever model it picks. Pixora never holds keys
or imports a vendor SDK in production — it talks to the parent through one
provider-agnostic gateway. The agent loop runs in the browser; every agent turn
is a single undo step.

```
Chat panel → client agent loop → tool executor → Fabric canvas (useEditor)
                     │
              AgentTransport ── HttpTransport: gateway URL (prod) │ /api/agent (dev)
                     │
        Parent system: holds keys, picks the model, returns a normalized stream
```

Swapping providers or pointing at the parent system is a one-file change
(`transport.ts`).

---

## Built (done + live-verified on Anthropic and Gemini)

- **Editor seam** — by-id mutators, `get_canvas_state` serializer, screenshot,
  one-undo-per-turn batching. Coordinates are artboard-relative, object-center.
- **Protocol + transport** — neutral `AgentMessage` / `ToolDef` / streamed
  events as NDJSON, incl. `done{stopReason}` and `error{retryable}`;
  `HttpTransport` switches gateway vs local `/api/agent` by env.
- **16 tools** — perceive: `get_canvas_state`, `get_screenshot`, `sample_color`;
  create: `add_text`, `add_shape`; modify: `set_properties`, `adjust_image`,
  `align_layer`, `distribute_layers`, `arrange_grid`, `move_layer` (z-order),
  `duplicate_layer`; structure: `group_layers`, `ungroup_layer`; remove:
  `delete_layer`; canvas: `set_artboard`. Layout math (distribute/grid) lives in
  the pure, unit-tested `src/lib/editor/layout.ts`.
- **Chat UI + loop** — streamed text, action log, ~15-round cap, stop button,
  canvas-input blocked mid-turn, screenshots kept only for the latest turn.
- **Guardrails** — bulk delete (≥3 layers/turn) requires an in-UI confirmation;
  single delete / artboard resize stay ungated (undoable, low impact);
  export/download not exposed; brush/eraser excluded by design.
- **Reliability** — duplicate-call guard, read-only stall-breaker, auto
  screenshot verification after mutating rounds.

---

## Next steps — layout tools

**Theme:** these remove the agent's pixel arithmetic for multi-element
layouts — its weakest area (models fumble equal gaps, grids, mismatched image
sizes). Priority order:

1. ~~`distribute_layers` / `arrange_grid`~~ — **DONE** (see Built). Pure geometry
   in `layout.ts`, unit-tested; the model reaches for them on layout requests.

2. **Framed image unit (card + fit modes)** — design these two together; a
   "card" is a frame + a fit-box, and both need one shared Fabric `clipPath`.
   - `place_in_card(image_id, { width, height, radius, padding, background,
     shadow? })` — normalize a raw image into a uniform tile the agent can then
     align/distribute as a box, not raw pixels.
   - `set_image_fit(image_id, target_box, mode: contain|cover|fill)` — normalize
     logos of different aspect ratios cleanly (`cover` crops via clipPath).

3. **RTL-aware alignment** — cheap mapping, but needs a new document-direction
   property on the canvas first. `align_layer` gains `start`/`end` that resolve
   to right/left by direction, so "align start" is correct in Arabic layouts.
   **Conditional:** worth it only if RTL is a first-class Vibecraft target — decide before building.

4. **`docs/agent-gateway.md`** (Phase 7) — one-page integration contract for the
   parent-system team: endpoint, auth header, request/response JSON, NDJSON
   format, tool-schema subset. `route.ts` is the runnable reference.

> Note: 1–3 move Pixora from edit primitives toward a small layout system. Good
> for an agent (it works in intent, not coordinates), but a conscious expansion
> of the tool surface beyond the original plan.

---

## Out of Pixora's scope by design

Provider keys, model routing/tiering, billing/quotas — the parent system's job.
A model picker, if wanted, is just a dropdown feeding the pass-through `model`
string. Brush/eraser and export-as-a-tool are intentionally excluded.
