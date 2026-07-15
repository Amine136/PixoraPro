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
- **18 tools** — perceive: `get_canvas_state`, `get_screenshot`, `sample_color`;
  create: `add_text`, `add_shape`; modify: `set_properties`, `adjust_image`,
  `align_layer`, `distribute_layers`, `arrange_grid`, `set_image_fit`,
  `place_in_card`, `move_layer` (z-order), `duplicate_layer`; structure:
  `group_layers`, `ungroup_layer`; remove: `delete_layer`; canvas: `set_artboard`.
  Layout + image-fit math is pure and unit-tested in `src/lib/editor/layout.ts`;
  `set_image_fit` cover uses native crop (not clipPath) so bounds stay honest.
  `align_layer` also takes RTL-aware `start`/`end`; document `direction` is a
  `set_artboard` field surfaced in `get_canvas_state`.
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

2. ~~Framed image unit (`set_image_fit` + `place_in_card`)~~ — **DONE** (see
   Built). Cover uses native crop, not clipPath (keeps `getBoundingRect` honest
   for the arrange tools + survives undo). Rounded *image* corners deferred as
   later polish; cards use rect `rx` + padding.

3. ~~RTL-aware alignment~~ — **DONE.** RTL confirmed a first-class Vibecraft
   target, so we built it. `direction` ("ltr"/"rtl") is a document-level property
   stored on the artboard object (in `EXTRA_PROPS`, so it survives undo + JSON
   round-trips); set via `set_artboard`, surfaced in `get_canvas_state`.
   `align_layer` horizontal gains `start`/`end` that resolve to left/right by
   direction (start→left, end→right in LTR; mirrored in RTL). No UI toggle and no
   React state — the three consumers read `meta(ab).direction ?? "ltr"` directly.
   Grid/distribute fill order and text `textAlign` deliberately left untouched.

4. ~~`docs/agent-gateway.md`~~ — **DONE.** One-page integration contract for the
   parent-system team: endpoint + `NEXT_PUBLIC_AGENT_GATEWAY_URL`, `Authorization`
   bearer, `AgentRequest` JSON, NDJSON `AgentEvent` stream, portable tool-schema
   subset, `signature` round-trip, error/retryable semantics, conformance
   checklist. Derived from `route.ts`/`gemini.ts`/`protocol.ts`/`transport.ts`,
   which it names as the runnable reference.

> Note: 1–3 move Pixora from edit primitives toward a small layout system. Good
> for an agent (it works in intent, not coordinates), but a conscious expansion
> of the tool surface beyond the original plan.

---

## Out of Pixora's scope by design

Provider keys, model routing/tiering, billing/quotas — the parent system's job.
A model picker, if wanted, is just a dropdown feeding the pass-through `model`
string. Brush/eraser and export-as-a-tool are intentionally excluded.
