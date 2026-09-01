# Pixora Agent Mode — Development Plan

A chat panel where an LLM edits the live Fabric canvas by calling tools
("make the title bigger and add a red arrow").

**Key constraint:** the app never ships a provider key of its own. Default mode
is bring-your-own-key — the user supplies a Gemini key in the UI and the browser
calls Google directly, so no server of ours sees the key, the prompts or the
canvas. Optionally it can instead point at a parent system's gateway that owns
the keys (`NEXT_PUBLIC_AGENT_GATEWAY_URL`). The agent loop runs in the browser;
every agent turn is a single undo step.

```
Chat panel → client agent loop → tool executor → Fabric canvas (useEditor)
                     │
       AgentTransport ── GeminiBrowserTransport: browser → Google (BYOK, default)
                     └── HttpTransport: parent gateway, when its URL is set
```

Swapping providers or pointing at a gateway is a one-file change
(`transport.ts`); adding a model is a registry entry (`settings.ts`).

---

## Built (done + live-verified on Anthropic and Gemini)

- **Editor seam** — by-id mutators, `get_canvas_state` serializer, screenshot,
  one-undo-per-turn batching. Coordinates are artboard-relative, object-center.
- **Protocol + transport** — neutral `AgentMessage` / `ToolDef` / streamed
  events, incl. `done{stopReason}` and `error{retryable}`. BYOK streams SSE from
  Google straight to the browser (`providers/gemini.ts`); gateway mode consumes
  NDJSON over `HttpTransport`.
- **BYOK settings** — provider, API key and model chosen in the Assistant panel,
  persisted per-browser in `localStorage`, key validated against the provider on
  save (`settings.ts`, `AiSettingsPanel.tsx`).
- **21 tools** — perceive: `get_canvas_state`, `get_screenshot`, `sample_color`;
  create: `add_text`, `add_shape`; modify: `set_properties`, `adjust_image`,
  `remove_background`, `align_layer`, `distribute_layers`, `arrange_grid`,
  `set_image_fit`, `crop_image`, `place_in_card`, `set_gradient`,
  `move_layer` (z-order), `duplicate_layer`; structure:
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
- **Gradients** — `set_gradient` fills a layer or the artboard bg with a 2–3
  stop linear/radial fabric Gradient (percentage units; CSS-style endpoint math
  is pure `computeGradientCoords` in `layout.ts`). A human-readable descriptor
  is stored in object meta (`gradient` in `EXTRA_PROPS`) so `get_canvas_state`
  can report gradient fills; solid-fill writes clear it. Rejected for images
  and groups with actionable errors.
- **Stale-history defense** — the canvas can change between turns (manual
  edits, user undo). `useAgent` snapshots the canvas at end of turn; if it
  differs at the next instruction, a `[Pixora]` note is attached telling the
  model to re-read state, backed by a prompt rule (never claim canvas content
  from memory). Prompt also carries a design-ambition rule (complete
  compositions from a bigger one-batch plan, not extra correction rounds).
- **History compaction** — the model payload is capped per turn, not per raw
  message (`compactHistory` in `src/lib/agent/history.ts`, pure + unit-tested):
  current turn intact; the 5 turns before it keep tool-call structure (and
  provider signatures) but long tool-result bodies are truncated; older turns
  are reduced to text only (instruction + final answer), dropping call/result
  pairs together so pairing never breaks. Images survive only on the latest
  message (absorbed the old `withoutStaleImages`). The UI transcript stays
  complete — only what's sent to the model shrinks.

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
   checklist. Now marked optional, since BYOK is the default; it names
   `providers/gemini.ts`/`protocol.ts`/`transport.ts` as the worked example.

> Note: 1–3 move Pixora from edit primitives toward a small layout system. Good
> for an agent (it works in intent, not coordinates), but a conscious expansion
> of the tool surface beyond the original plan.

---

## Out of Pixora's scope by design

Billing and per-account quotas. In BYOK mode the user's own provider key is the
billing relationship, and the model picker feeds the `model` field of
`AgentRequest`. In gateway mode, keys and routing are the parent system's job.
The one cost the deployment does carry is background removal, capped at the
Cloud Run service behind `/api/remove-bg`.

Brush/eraser and export-as-a-tool are intentionally excluded.
