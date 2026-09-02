import type {
  AgentEvent,
  AgentRequest,
} from "../protocol";
import {
  mapFinishReason,
  sseEvents,
  toOaiMessages,
  type PartialToolCall,
  type StreamChunk,
} from "./openai-compat";

/* DeepSeek provider, called straight from the user's browser with their own
 * key. DeepSeek speaks the standard OpenAI chat-completions wire format (the
 * same one the shared openai-compat helpers target), so this is a thin sibling
 * of the Gemini provider — only the base URL, error copy and (absence of)
 * Gemini thought signatures differ. */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODELS_URL = "https://api.deepseek.com/models";

/** Human-readable, actionable failure text. The user owns the key, so an auth
 *  failure is something they can fix — say so instead of dumping a status. */
export function describeHttpFailure(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "DeepSeek rejected your API key. Open the settings to check or replace it.";
  }
  if (status === 400) {
    return `DeepSeek rejected the request (400). If you just changed your key or model, check them in the settings. ${body.slice(0, 300)}`;
  }
  if (status === 429) {
    return "Your DeepSeek key is over its quota or rate limit. Wait a moment and try again.";
  }
  if (status === 404) {
    return "That model isn't available for your key. Pick a different model in the settings.";
  }
  return `DeepSeek error (${status}): ${body.slice(0, 300)}`;
}

/** Network-level failures. From the browser, a blocked request is opaque — an
 *  offline device, a blocking extension and a DNS failure are indistinguishable
 *  — so name the likely causes rather than guessing one. */
export function describeNetworkFailure(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  return "Couldn't reach DeepSeek. Check your internet connection, and whether an extension or firewall is blocking api.deepseek.com.";
}

/** One cheap authenticated call, used to validate a key the moment the user
 *  pastes it rather than failing on their first real edit. Listing models bills
 *  no tokens. Returns null on success, or a reason on failure. */
export async function verifyDeepSeekKey(key: string): Promise<string | null> {
  try {
    const res = await fetch(MODELS_URL, {
      headers: { authorization: `Bearer ${key.trim()}` },
      cache: "no-store",
    });
    if (res.ok) return null;
    if (res.status === 401 || res.status === 403) {
      return "DeepSeek rejected this key. Check that you copied it fully and that the account has API access.";
    }
    if (res.status === 429) {
      return "This key is over its rate limit right now. It looks valid — try again shortly.";
    }
    return `DeepSeek returned ${res.status} while checking the key.`;
  } catch (err) {
    return describeNetworkFailure(err);
  }
}

/** Run one model turn against DeepSeek, yielding protocol events as they arrive. */
export async function* streamDeepSeek(
  req: AgentRequest,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
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
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[agent/deepseek] HTTP ${res.status} for model=${model}:`,
        detail.slice(0, 1000),
      );
    }
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
      id: call.id || `call_${index}`,
      name: call.name,
      args,
    };
  }

  if (process.env.NODE_ENV !== "production" && usage) {
    const prompt = usage.prompt_tokens ?? 0;
    console.log(
      `[agent/deepseek] model=${model} in=${prompt} out=${usage.completion_tokens ?? 0} tools=${partials.size}`,
    );
  }

  yield {
    type: "done",
    stopReason: sawToolCall ? "tool_use" : mapFinishReason(finishReason),
  };
}
