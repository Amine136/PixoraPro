import type { AgentMessage, StopReason } from "../protocol";

/* Shared OpenAI wire-format (chat completions) helpers.
 *
 * Both the Gemini provider (via Google's OpenAI-compatible endpoint) and the
 * OpenAI provider speak this dialect, so the message conversion and SSE parsing
 * live here once. The differences — base URL, model lists, Gemini's thought
 * signatures, and provider-specific error copy — stay in each provider file. */

export type OaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OaiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Gemini 3.x thought signature — must be echoed back verbatim when the
   *  tool call is replayed in history, or the API returns a 400. OpenAI never
   *  sets this, so it is a no-op there. */
  extra_content?: { google?: { thought_signature?: string } };
};

export type OaiMessage =
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

export function mapFinishReason(reason: string | undefined): StopReason {
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

/* ---------- streaming ---------- */

export type StreamDelta = {
  content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
    extra_content?: { google?: { thought_signature?: string } };
  }[];
};

export type StreamChunk = {
  choices?: { delta?: StreamDelta; finish_reason?: string; index?: number }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

/** Tool calls under assembly. The OpenAI wire format allows `arguments` to be
 *  split across deltas addressed by `index`, so accumulate and parse only at
 *  the end. Order is preserved by index, since that is the order the model
 *  chose. */
export type PartialToolCall = {
  id: string;
  name: string;
  args: string;
  signature?: string;
};

/** Concatenate the `data:` lines of one SSE record into its payload. A record
 *  may legally span several `data:` lines, and non-`data:` lines (`event:`,
 *  `:` comments used as keep-alives) are ignored. */
export function recordPayload(record: string): string {
  if (!record || typeof record !== "string") return "";
  return record
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
}

/** Index of the next record separator, and its length. SSE separates records
 *  with a blank line, which is `\n\n` or `\r\n\r\n` depending on the sender. */
export function findSeparator(buffer: string): { at: number; len: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { at: crlf, len: 4 };
  return { at: lf, len: 2 };
}

/** Split an SSE byte stream into record payloads. */
export async function* sseEvents(
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
