# Pixora Agent Mode — Development Plan

Agent mode adds a chat panel where an LLM edits the canvas on the user's behalf
("make the title bigger and add a red arrow") by calling tools that execute
against the live Fabric canvas.

**Key constraint:** Pixora will be integrated into a parent system that owns all
provider API keys and routes requests to whichever model it chooses (Claude,
Gemini, GPT, …). Pixora therefore never holds provider keys and never imports a
vendor SDK in production code — it talks to the parent system through a single
provider-agnostic gateway endpoint.

---

## Architecture

```
┌────────────────────────── Pixora (browser) ──────────────────────────┐
│  Chat panel → agent loop → tool executor → Fabric canvas (useEditor) │
│                    │                                                 │
│             AgentTransport (interface)                               │
│              /            \                                          │
│   DevTransport             SystemTransport                           │
│   (local dev only:         (production: POST to parent               │
│    /api/agent route         system's gateway with the user's         │
│    + .env.local key)        session token — no provider keys)        │
└──────────────────────────────────────────────────────────────────────┘
                                        │
                     Parent system: holds all API keys, picks/routes
                     the model, returns a normalized stream
```

- The **agent loop runs in the client**: send conversation → receive streamed
  events → execute tool calls on the canvas → append all tool results in one
  message → repeat until `done`. The user watches edits happen live, and every
  agent action is undoable.
- The **transport** is the only layer that knows how to reach an LLM. Swapping
  providers or pointing at the parent system is a one-file change.

---

## Phase 1 — Editor core (no AI dependency)

Pure Fabric/`useEditor` work, buildable and testable on its own:

1. **By-id operation helpers.** Current mutators (`updateSelected`,
   `updateImageAdjustments`, …) operate on the active selection. The agent must
   address layers by `id` without disturbing the user's selection. Add internal
   helpers like `applyToLayer(id, patch)`, `adjustImageLayer(id, adj)`,
   `deleteLayerById(id)` (reuse the lookup already used by `selectLayer` /
   `deleteLayer`).
2. **Canvas state serializer** (`get_canvas_state`): artboard size/bg + per
   layer: id, name, kind, position, size, rotation, opacity, fill/stroke, text
   content/font, visibility, z-order. Mostly derivable from what
   `refreshLayers`/`refreshSelection` already compute.
3. **Screenshot capture** (`get_screenshot`): `canvas.toDataURL()` of the
   artboard region, downscaled, for vision-grounded verification.
4. **Per-turn undo batching**: wrap each agent turn in the existing
   `restoringRef` pattern + one `saveState()` at the end, so "undo" reverses
   the whole instruction, not 14 micro-steps.

**Coordinate convention (bake into tools + prompt):** tool coordinates are
artboard-relative (0,0 = artboard top-left) and positions refer to the object
center (Fabric v7 defaults origin to center).

---

## Phase 2 — Neutral agent protocol (`src/lib/agent/protocol.ts`)

Pixora's own types — no vendor imports:

- `AgentMessage` — role + content parts: `text`, `image` (data-URL),
  `tool_call {id, name, args}`, `tool_result {call_id, content}`
- `ToolDef` — name, description, JSON Schema input
- Streamed events — `text_delta`, `tool_call`, `done {stop_reason}`,
  `error {message, retryable}`

**Schema discipline:** restrict tool schemas to the subset every provider
handles identically — objects, strings, numbers, booleans, enums, `required`.
No recursive schemas, no numeric/string constraints, no vendor-specific
extensions.

**Wire format (as implemented):** the wire format IS the neutral protocol —
`POST` one `AgentRequest` JSON body, receive an NDJSON stream where each line
is one `AgentEvent`. This is simpler than mimicking a vendor schema and just
as easy for the parent system to implement (its gateway maps these four event
types to whatever provider it calls). The dev route
(`src/app/api/agent/route.ts`) is the reference implementation of the
contract; if the parent system later dictates a different shape, only
`transport.ts` changes.

---

## Phase 3 — Transport layer (`src/lib/agent/transport.ts`)

One interface, two implementations:

| Transport | Use | Auth | Notes |
|---|---|---|---|
| `SystemTransport` | Production | User session token in header | `POST ${AGENT_GATEWAY_URL}/chat`, `model` passed through as a string, streaming response (SSE or JSONL) |
| `DevTransport` | Local development only | `.env.local` key via a local `/api/agent` route | Same wire format as the gateway; doubles as the reference implementation for the parent-system team; flag-gated or deleted at integration |

---

## Phase 4 — Tool surface (~8–10 tools to start)

**Read (perception):**
- `get_canvas_state` — serialized scene, layers by id
- `get_screenshot` — current artboard render as an image part

**Write (by layer id, never by selection):**
- `add_text`, `add_shape`
- `set_properties(layer_id, patch)` — position, size, rotation, opacity, fill,
  stroke, font, text content
- `adjust_image(layer_id, {brightness, contrast, saturation})`
- `delete_layer`, `duplicate_layer`, `reorder_layer`
- `group_layers` / `ungroup_layer`
- `set_artboard({width, height, background})`

**Deliberately excluded:** brush/eraser (freehand strokes are a poor fit for
tool calls), export/download (gated — see guardrails).

---

## Phase 5 — Agent loop + chat UI

- Collapsible chat panel in the editor; streamed text rendered live; activity
  log of applied actions ("Added Rectangle", "Set title size to 96").
- Loop rules: execute **all** tool calls in a round, return all results in one
  message (providers differ — Claude/GPT emit parallel calls, Gemini often
  serializes; handle 1..N per round uniformly).
- Iteration cap (~15 tool rounds per instruction); visible "agent working"
  state + stop button (stopping just ends the loop; applied changes remain,
  undoable).
- Disable (or warn on) canvas input while the agent is mid-turn.
- Screenshots included only in the latest turn; older ones dropped from
  history to control tokens on every provider.
- System prompt is model-agnostic: editor semantics, coordinate convention,
  layer-id addressing, "read state before you write."

---

## Phase 6 — Guardrails & boundaries

- **Can:** everything undoable, on the canvas, via the declared tools.
- **Gated (in-UI confirmation before the tool executes):** export/download,
  destructive artboard resize, bulk delete.
- **Cannot:** touch anything outside the canvas; see or handle API keys;
  choose its own provider.
- Normalize gateway errors into the `error` event with a retryable flag — one
  consistent failure UI regardless of vendor.

---

## Phase 7 — Integration handoff

Write `docs/agent-gateway.md`: a one-page contract for the parent-system team —
endpoint, auth header, request/response JSON with examples, streaming format,
and the tool-schema subset in use. The `DevTransport` route is the runnable
reference implementation of that contract.

Out of Pixora's scope by design: provider keys, model routing, billing/quotas,
model-picker policy (if wanted later, it's a dropdown feeding the pass-through
`model` string).

---

## Build order

1. Phase 1 (by-id helpers, serializer, screenshot, undo batching) — pure
   editor work, testable alone.
2. Phases 2–3 (protocol + transports) with `DevTransport` wired to one
   provider.
3. Phase 5 loop + chat panel with three tools end-to-end
   (`get_canvas_state`, `add_text`, `set_properties`).
4. Phase 4 full tool set + screenshot verification.
5. Phase 6 guardrails.
6. Phase 7 contract doc; integration = change one URL + one auth header.
