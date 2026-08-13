import type {
  AgentEvent,
  AgentMessage,
  AgentRequest,
  StopReason,
} from "@/lib/agent/protocol";

/* Gemini backend for the dev route, via Google's OpenAI-compatible endpoint.
 * Exists to prove the neutral protocol is provider-agnostic: same wire
 * contract as the Anthropic path, different mapping. Non-streaming — the
 * whole reply is mapped to events once the response arrives. */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

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

function toOaiMessages(system: string, messages: AgentMessage[]): OaiMessage[] {
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

export async function runGemini(
  req: AgentRequest,
  apiKey: string,
): Promise<AgentEvent[]> {
  const model =
    req.model && req.model.startsWith("gemini") ? req.model : DEFAULT_MODEL;

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return [
      {
        type: "error",
        message: `Gemini error (${res.status}): ${detail.slice(0, 400)}`,
        retryable: res.status === 429 || res.status >= 500,
      },
    ];
  }

  const body = (await res.json()) as {
    choices?: {
      message?: { content?: string | null; tool_calls?: OaiToolCall[] };
      finish_reason?: string;
    }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  // Cost visibility: cached prompt tokens are billed at a steep discount, so
  // the cache-hit rate — not raw prompt_tokens — is what decides real cost.
  const choice = body.choices?.[0];
  if (body.usage) {
    const u = body.usage;
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    const prompt = u.prompt_tokens ?? 0;
    const pct = prompt > 0 ? Math.round((cached / prompt) * 100) : 0;
    const calls = (choice?.message?.tool_calls ?? [])
      .map((c) => c.function.name)
      .join(",");
    console.log(
      `[agent/gemini] in=${prompt} (cached=${cached}, ${pct}% hit) out=${u.completion_tokens ?? 0} tools=[${calls}]`,
    );
  } else {
    console.log("[agent/gemini] no usage block in response");
  }
  if (!choice?.message) {
    return [{ type: "error", message: "Gemini returned no choices" }];
  }

  const events: AgentEvent[] = [];
  if (choice.message.content) {
    events.push({ type: "text_delta", text: choice.message.content });
  }
  for (const call of choice.message.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      // leave args empty; the tool will report the problem back to the model
    }
    events.push({
      type: "tool_call",
      id: call.id,
      name: call.function.name,
      args,
      signature: call.extra_content?.google?.thought_signature,
    });
  }
  const hasToolCalls = (choice.message.tool_calls ?? []).length > 0;
  events.push({
    type: "done",
    stopReason: hasToolCalls ? "tool_use" : mapFinishReason(choice.finish_reason),
  });
  return events;
}
