# Pixora Agent Gateway — Integration Contract

For the parent-system team. This is the one contract Pixora's agent mode needs
from you: a single HTTP endpoint that takes a provider-neutral request and
streams back provider-neutral events. Pixora holds no provider keys and imports
no vendor SDK in production — your gateway is the only thing that talks to an LLM.

The local dev route `src/app/api/agent/route.ts` is a **runnable reference
implementation** of this exact contract (backed by Anthropic; a Gemini variant
lives in `gemini.ts`). If prose here and that code ever disagree, the code wins —
read it.

---

## 1. Endpoint & wiring

- **Method / path:** `POST` to whatever URL you provide. Pixora reads it from the
  build-time env var `NEXT_PUBLIC_AGENT_GATEWAY_URL`. When unset, Pixora falls
  back to the local dev route `/api/agent`.
- **Request content type:** `application/json`
- **Response content type:** `application/x-ndjson` (newline-delimited JSON; see
  §4). Send `cache-control: no-store`.
- **One call = one model turn.** Pixora runs the agent loop itself: it POSTs,
  consumes the stream to `done`, executes any returned tool calls locally against
  the canvas, then POSTs again with the results appended to `messages`. A single
  user request is up to ~15 of these round-trips. Your endpoint is stateless — it
  receives the full conversation every call and keeps nothing between calls.

### Authorization

The transport attaches the session credential as a bearer token:

```
Authorization: Bearer <sessionToken>
```

The header slot is wired in `src/lib/agent/transport.ts` (`createTransport`).
Today the client calls `createTransport()` with no token, so no header is sent —
the parent integration is responsible for sourcing the session credential and
passing it in. Decide with us how the token is minted; the gateway validates it
and maps it to the account/quota. Pixora never sees provider keys.

### CORS (required — the client is a browser)

The agent loop runs **in the browser** and `fetch`es your full gateway URL
directly, so in production this is a cross-origin request. A `POST` with
`content-type: application/json` and an `Authorization` header **always triggers a
CORS preflight**, so a gateway that is otherwise correct will still fail in the
browser without CORS headers — a failure the contract alone can't diagnose.

- Answer the `OPTIONS` preflight (2xx, no body).
- `Access-Control-Allow-Origin`: Pixora's origin (not `*` if you ever use
  cookies).
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: authorization, content-type`
- `Access-Control-Allow-Credentials: true` **only** if the token ever moves to a
  cookie; with a bearer header it is not needed.

### Streaming through proxies

NDJSON only helps if lines arrive incrementally. Disable response buffering on
any intermediary (e.g. nginx `X-Accel-Buffering: no`, and no gzip buffering on
the streamed body) or `text_delta`s will arrive all at once at the end.

---

## 2. Request body — `AgentRequest`

Source of truth: `src/lib/agent/protocol.ts`.

```jsonc
{
  "model": "claude-opus-4-8",   // optional pass-through hint; you pick the model
  "system": "…system prompt…",  // string; stable prefix — good cache key
  "messages": [ /* AgentMessage[] */ ],
  "tools":    [ /* ToolDef[] */ ]
}
```

- `model` is only a **hint**. You own model routing/tiering; honor it or ignore
  it. (The dev route uses it only to pick provider family, else a default.)
- `system` is a large, stable string. Prefix-cache it if your provider supports
  it — the volatile canvas state and screenshots live in `messages`, after it.
- `tools` is sent **every call** (stateless endpoint). Pass them to the provider
  verbatim; do not cache-substitute by name.

### `AgentMessage`

```jsonc
{ "role": "user" | "assistant", "parts": [ /* AgentPart[] */ ] }
```

### `AgentPart` (four shapes)

```jsonc
{ "type": "text",  "text": "…" }

{ "type": "image", "dataUrl": "data:image/png;base64,…" }   // png|jpeg|gif|webp

{ "type": "tool_call",                                       // assistant → model asked to run a tool
  "id": "toolu_…", "name": "add_text",
  "args": { /* object */ },
  "signature": "…" }                                         // optional, see §5

{ "type": "tool_result",                                     // user → result Pixora computed
  "callId": "toolu_…",                                       // MUST equal the tool_call.id it answers
  "content": "…string…",
  "images": ["data:image/png;base64,…"],                     // optional (e.g. screenshot)
  "isError": false }
```

Translate these to your provider's message format. The reference does exactly
this in `toAnthropicMessages` (`route.ts`): `text`→text block, `image`→base64
image block, `tool_call`→`tool_use`, `tool_result`→`tool_result` (its `images`
become image blocks inside the result). Tool-call `id`s are opaque and
provider-defined; the only rule is that a `tool_result.callId` must equal the
`tool_call.id` it answers.

### `ToolDef`

```jsonc
{ "name": "add_text", "description": "…", "inputSchema": { /* JSON Schema */ } }
```

`inputSchema` is plain JSON Schema restricted to a **portable subset**: `object`
/ `string` / `number` / `boolean`, `enum`, and `required`. No recursion, no
numeric/string constraint keywords. Forward it as the tool's input schema.

---

## 3. Response — an NDJSON stream of `AgentEvent`

One JSON object per line, `\n`-terminated. Pixora parses line-by-line as they
arrive (`transport.ts`), so stream incrementally; a single final blob also works
if you can't stream. Every turn ends with exactly one `done` **or** one `error`.

```jsonc
{ "type": "text_delta", "text": "…" }                 // assistant prose, incremental — emit many

{ "type": "tool_call", "id": "toolu_…",               // the model wants a tool run
  "name": "add_text", "args": { /* object */ },
  "signature": "…" }                                   // optional, see §5

{ "type": "done", "stopReason":                        // turn finished cleanly
  "end_turn" | "tool_use" | "max_tokens" | "refusal" }

{ "type": "error", "message": "…", "retryable": true } // turn failed
```

Ordering within a turn: stream `text_delta`s as generated, then one `tool_call`
per requested tool, then a single `done`. `stopReason: "tool_use"` tells Pixora
tool calls are pending and it will call back with results; `"end_turn"` ends the
user's request.

---

## 4. Errors

- **Transport-level failures** (auth rejected, 5xx, gateway down): return a
  normal HTTP error status. Pixora surfaces it and treats `429` and `>=500` as
  retryable (`transport.ts`).
- **In-stream failures** (provider error mid-turn): emit an `error` event and
  close the stream. Set `retryable: true` for transient conditions (rate limits,
  provider 5xx, connection resets) so Pixora can offer a retry; `false` for
  permanent ones (bad request, refusal, no credit). The reference maps provider
  rate-limit / internal / connection errors to `retryable: true`.

---

## 5. `signature` — opaque provider state (must round-trip)

Some providers attach opaque per-tool-call state that **must be echoed back
verbatim** on the next request or the conversation breaks. The concrete case is
Gemini 3.x "thought signatures" (`gemini.ts`).

The contract:

1. When your provider returns such state on a tool call, put it in the
   `tool_call` event's `signature` field.
2. Pixora stores it and sends it back on the matching `tool_call` **part** in the
   next request's `messages`.
3. On that next call, hand it back to the provider unchanged.

If your provider has no such concept (e.g. Anthropic), omit `signature`
everywhere and ignore any you receive. It is a pass-through token — never
inspect, transform, or generate it.

---

## 6. Checklist for a conformant gateway

- [ ] `POST` accepts `AgentRequest` JSON; responds `application/x-ndjson`.
- [ ] Answers the CORS preflight and sends allow-origin/methods/headers for
      Pixora's browser origin.
- [ ] Disables proxy/compression buffering so the NDJSON stream flushes
      incrementally.
- [ ] Validates the `Authorization: Bearer` token → account/quota; holds all
      provider keys.
- [ ] Maps the four `AgentPart` shapes (incl. images and `tool_result.images`)
      to the provider's format.
- [ ] Forwards `tools` verbatim; treats `inputSchema` as-is.
- [ ] Streams `text_delta` → `tool_call`(s) → exactly one `done`, or one `error`.
- [ ] Maps provider stop reasons to `end_turn | tool_use | max_tokens | refusal`.
- [ ] Round-trips `signature` unchanged when the provider uses it.
- [ ] Treats each call as stateless — no server-side conversation memory.

Reference implementation: `src/app/api/agent/route.ts` (Anthropic),
`src/app/api/agent/gemini.ts` (Gemini + `signature`). Types:
`src/lib/agent/protocol.ts`. Transport/headers: `src/lib/agent/transport.ts`.
