import type {
  AgentEvent,
  AgentMessage,
  AgentRequest,
  StopReason,
} from "../protocol";

/* Gemini provider, called straight from the user's browser via Google's
 * OpenAI-compatible endpoint.
 *
 * Browser-direct is the whole point of bring-your-own-key: the user's API key
 * never touches a Pixora server, and no server of ours sits in the path of the
 * canvas screenshots. Google returns permissive CORS headers on this endpoint
 * (verified: the preflight allows `authorization, content-type` from any
 * origin), which is what makes it possible.
 *
 * Streaming (`stream: true`) is used so text appears as it is generated. */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/models";

type OaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OaiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Gemini 3.x thought signature — must be echoed back verbatim when the
   *  tool call is replayed in history, or the API returns a 400. */
  extra_content?: { google?: { thought_signature?: string } };
};

type OaiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OaiContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toOaiMessages(
  system: string,
  messages: AgentMessage[],
): OaiMessage[] {
  const out: OaiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      let text = "";
      const toolCalls: OaiToolCall[] = [];
      for (const part of m.parts) {
        if (part.type === "text") text += part.text;
        else if (part.type === "tool_call") {
          toolCalls.push({
            id: part.id,
            type: "function",
            function: { name: part.name, arguments: JSON.stringify(part.args) },
            ...(part.signature
              ? {
                  extra_content: {
                    google: { thought_signature: part.signature },
                  },
                }
              : {}),
          });
        }
      }
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // user message: tool results become role:"tool" messages; images inside
    // tool results ride in a follow-up user message (tool content is string-only)
    const userParts: OaiContentPart[] = [];
    const pendingImages: string[] = [];
    for (const part of m.parts) {
      switch (part.type) {
        case "text":
          userParts.push({ type: "text", text: part.text });
          break;
        case "image":
          userParts.push({ type: "image_url", image_url: { url: part.dataUrl } });
          break;
        case "tool_result":
          out.push({
            role: "tool",
            tool_call_id: part.callId,
            content: part.isError ? `ERROR: ${part.content}` : part.content,
          });
          for (const img of part.images ?? []) pendingImages.push(img);
          break;
        case "tool_call":
          break; // never present on user messages
      }
    }
    if (pendingImages.length > 0) {
      out.push({
        role: "user",
        content: [
          { type: "text", text: "Image(s) attached to the tool result above:" },
          ...pendingImages.map(
            (url): OaiContentPart => ({ type: "image_url", image_url: { url } }),
          ),
        ],
      });
    }
    if (userParts.length > 0) {
      out.push({ role: "user", content: userParts });
    }
  }
  return out;
}

function mapFinishReason(reason: string | undefined): StopReason {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end_turn";
  }
}

/** Human-readable, actionable failure text. The user owns the key, so an auth
 *  failure is something they can fix — say so instead of dumping a status. */
export function describeHttpFailure(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Google rejected your API key. Open the key settings to check or replace it.";
  }
  if (status === 400) {
    // 400 is ambiguous: an invalid key *and* a malformed request both land
    // here, so keep the provider's own detail alongside the hint.
    return `Google rejected the request (400). If you just changed your key or model, check them in the key settings. ${body.slice(0, 300)}`;
  }
  if (status === 429) {
    return "Your Gemini key is over its quota or rate limit. Wait a moment and try again.";
  }
  if (status === 404) {
    return "That model isn't available for your key. Pick a different model in the key settings.";
  }
  return `Gemini error (${status}): ${body.slice(0, 300)}`;
}

/** Network-level failures. From the browser, a blocked request is opaque — an
 *  offline device, a blocking extension and a DNS failure are indistinguishable
 *  — so name the likely causes rather than guessing one. */
export function describeNetworkFailure(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  return "Couldn't reach Google. Check your internet connection, and whether an extension or firewall is blocking generativelanguage.googleapis.com.";
}

/** One cheap authenticated call, used to validate a key the moment the user
 *  pastes it rather than failing on their first real edit. Listing models bills
 *  no tokens. Returns null on success, or a reason on failure. */
export async function verifyGeminiKey(key: string): Promise<string | null> {
  try {
    const res = await fetch(MODELS_URL, {
      headers: { authorization: `Bearer ${key.trim()}` },
      cache: "no-store",
    });
    if (res.ok) return null;
    // The upstream body can echo the key back, so it is never shown for auth
    // failures — describeHttpFailure only forwards detail for a 400.
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      return "Google rejected this key. Check that you copied it fully and that the Generative Language API is enabled for its project.";
    }
    if (res.status === 429) {
      return "This key is over its rate limit right now. It looks valid — try again shortly.";
    }
    return `Google returned ${res.status} while checking the key.`;
  } catch (err) {
    return describeNetworkFailure(err);
  }
}

/* ---------- streaming ---------- */

type StreamDelta = {
  content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
    extra_content?: { google?: { thought_signature?: string } };
  }[];
};

type StreamChunk = {
  choices?: { delta?: StreamDelta; finish_reason?: string; index?: number }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

/** Tool calls under assembly. Gemini currently sends each call complete in a
 *  single delta, but the OpenAI wire format allows `arguments` to be split
 *  across deltas addressed by `index`, so accumulate and parse only at the end.
 *  Order is preserved by index, since that is the order the model chose. */
type PartialToolCall = {
  id: string;
  name: string;
  args: string;
  signature?: string;
};

/** Concatenate the `data:` lines of one SSE record into its payload. A record
 *  may legally span several `data:` lines, and non-`data:` lines (`event:`,
 *  `:` comments used as keep-alives) are ignored. */
function recordPayload(record: string): string {
  if (!record || typeof record !== "string") return "";
  return record
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
}

/** Index of the next record separator, and its length. SSE separates records
 *  with a blank line, which is `\n\n` or `\r\n\r\n` depending on the sender. */
function findSeparator(buffer: string): { at: number; len: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { at: crlf, len: 4 };
  return { at: lf, len: 2 };
}

/** Split an SSE byte stream into record payloads. */
async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = findSeparator(buffer);
      while (sep) {
        const payload = recordPayload(buffer.slice(0, sep.at));
        buffer = buffer.slice(sep.at + sep.len);
        if (payload) yield payload;
        sep = findSeparator(buffer);
      }
    }
    const tail = recordPayload(buffer);
    if (tail) yield tail;
  } finally {
    // On early exit (abort, or a `break` in the consumer) cancel rather than
    // only releasing the lock, so the connection is actually torn down.
    await reader.cancel().catch(() => {});
  }
}

/** Run one model turn against Gemini, yielding protocol events as they arrive. */
export async function* streamGemini(
  req: AgentRequest,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        stream_options: { include_usage: true },
        messages: toOaiMessages(req.system, req.messages),
        tools: req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    yield { type: "error", message: describeNetworkFailure(err), retryable: true };
    return;
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    yield {
      type: "error",
      message: describeHttpFailure(res.status, detail),
      retryable: res.status === 429 || res.status >= 500,
    };
    return;
  }

  const partials = new Map<number, PartialToolCall>();
  let finishReason: string | undefined;
  let sawToolCall = false;
  let usage: StreamChunk["usage"];

  try {
    for await (const data of sseEvents(res.body)) {
      if (data === "[DONE]") break;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        continue; // a keep-alive or partial line; nothing to act on
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: "text_delta", text: delta.content };
      }

      for (const [i, call] of (delta.tool_calls ?? []).entries()) {
        sawToolCall = true;
        const index = call.index ?? i;
        const existing = partials.get(index) ?? { id: "", name: "", args: "" };
        partials.set(index, {
          id: call.id ?? existing.id,
          name: call.function?.name ?? existing.name,
          args: existing.args + (call.function?.arguments ?? ""),
          signature:
            call.extra_content?.google?.thought_signature ?? existing.signature,
        });
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    yield { type: "error", message: describeNetworkFailure(err), retryable: true };
    return;
  }

  for (const index of [...partials.keys()].sort((a, b) => a - b)) {
    const call = partials.get(index)!;
    let args: Record<string, unknown> = {};
    try {
      args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
    } catch {
      // leave args empty; the tool reports the problem back to the model
    }
    yield {
      type: "tool_call",
      // A call with no id can't be answered with a matching tool_result, so
      // synthesize one rather than sending an empty tool_call_id.
      id: call.id || `call_${index}`,
      name: call.name,
      args,
      signature: call.signature,
    };
  }

  // Cost visibility during development: cached prompt tokens bill at a steep
  // discount, so the cache-hit rate — not raw prompt_tokens — decides real cost.
  if (process.env.NODE_ENV !== "production" && usage) {
    const prompt = usage.prompt_tokens ?? 0;
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const pct = prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
    console.log(
      `[agent/gemini] model=${model} in=${prompt} (cached=${cached}, ${pct}% hit) out=${usage.completion_tokens ?? 0} tools=${partials.size}`,
    );
  }

  yield {
    type: "done",
    stopReason: sawToolCall ? "tool_use" : mapFinishReason(finishReason),
  };
}
