import type {
  AgentEvent,
  AgentMessage,
  AgentRequest,
} from "../protocol";
import { sseEvents } from "./openai-compat";

/* OpenAI provider, called straight from the user's browser with their own key.
 *
 * The gpt-5.x models (gpt-5.5, gpt-5.6-luna/terra/sol) live on the Responses
 * API (/v1/responses), not the older chat-completions endpoint, so this speaks
 * that wire format: a flat `input` item list, `instructions` for the system
 * prompt, and SSE events named response.output_text.delta /
 * response.function_call_arguments.delta. */

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MODELS_URL = "https://api.openai.com/v1/models";

/** Human-readable, actionable failure text. The user owns the key, so an auth
 *  failure is something they can fix — say so instead of dumping a status. */
export function describeHttpFailure(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "OpenAI rejected your API key. Open the settings to check or replace it.";
  }
  if (status === 400) {
    return `OpenAI rejected the request (400). ${body.slice(0, 300)}`;
  }
  if (status === 429) {
    return "Your OpenAI key is over its quota or rate limit. Wait a moment and try again.";
  }
  if (status === 404) {
    return "That model isn't available for your key. Pick a different model in the settings.";
  }
  return `OpenAI error (${status}): ${body.slice(0, 300)}`;
}

/** Network-level failures. From the browser, a blocked request is opaque — an
 *  offline device, a blocking extension and a DNS failure are indistinguishable
 *  — so name the likely causes rather than guessing one. */
export function describeNetworkFailure(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") return "Stopped.";
  return "Couldn't reach OpenAI. Check your internet connection, and whether an extension or firewall is blocking api.openai.com.";
}

/** One cheap authenticated call, used to validate a key the moment the user
 *  pastes it rather than failing on their first real edit. Listing models bills
 *  no tokens. Returns null on success, or a reason on failure. */
export async function verifyOpenAiKey(key: string): Promise<string | null> {
  try {
    const res = await fetch(MODELS_URL, {
      headers: { authorization: `Bearer ${key.trim()}` },
      cache: "no-store",
    });
    if (res.ok) return null;
    // The upstream body can echo the key back, so it is never shown for auth
    // failures — describeHttpFailure only forwards detail for a 400.
    if (res.status === 401 || res.status === 403) {
      return "OpenAI rejected this key. Check that you copied it fully and that the account has API access.";
    }
    if (res.status === 429) {
      return "This key is over its rate limit right now. It looks valid — try again shortly.";
    }
    return `OpenAI returned ${res.status} while checking the key.`;
  } catch (err) {
    return describeNetworkFailure(err);
  }
}

/* ---------- input conversion ---------- */

type InputItem = Record<string, unknown>;

/** Convert the provider-neutral conversation into a Responses `input` list.
 *
 * The system prompt travels in the top-level `instructions` field. Assistant
 * text is replayed as an `output_text` message, its tool calls as
 * `function_call` items, and tool results as `function_call_output` items —
 * images ride inside the output's content array. */
export function toResponsesInput(
  system: string,
  messages: AgentMessage[],
): { instructions: string; input: InputItem[] } {
  const input: InputItem[] = [];

  for (const m of messages) {
    if (m.role === "assistant") {
      let text = "";
      const calls: InputItem[] = [];
      for (const part of m.parts) {
        if (part.type === "text") text += part.text;
        else if (part.type === "tool_call") {
          calls.push({
            type: "function_call",
            call_id: part.id,
            name: part.name,
            arguments: JSON.stringify(part.args),
          });
        }
      }
      if (text) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      input.push(...calls);
      continue;
    }

    // user message: text/images become a user message; tool results become
    // function_call_output items (kept in part order).
    const content: InputItem[] = [];
    const pendingOutputs: InputItem[] = [];
    for (const part of m.parts) {
      switch (part.type) {
        case "text":
          content.push({ type: "input_text", text: part.text });
          break;
        case "image":
          content.push({ type: "input_image", image_url: part.dataUrl });
          break;
        case "tool_result": {
          const out: InputItem[] = [
            {
              type: "input_text",
              text: part.isError ? `ERROR: ${part.content}` : part.content,
            },
          ];
          for (const img of part.images ?? []) {
            out.push({ type: "input_image", image_url: img });
          }
          pendingOutputs.push({
            type: "function_call_output",
            call_id: part.callId,
            output:
              out.length === 1 && out[0].type === "input_text"
                ? (out[0].text as string)
                : out,
          });
          break;
        }
        case "tool_call":
          break; // never present on user messages
      }
    }
    input.push(...pendingOutputs);
    if (content.length > 0) {
      input.push({ role: "user", content });
    }
  }

  return { instructions: system, input };
}

/* ---------- streaming ---------- */

type PartialCall = {
  id: string;
  callId: string;
  name: string;
  args: string;
};

type StreamEvent = {
  type?: string;
  delta?: string;
  output_index?: number;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: { usage?: Record<string, unknown> };
  error?: { message?: string };
  message?: string;
};

/** Run one model turn against the Responses API, yielding protocol events. */
export async function* streamOpenAi(
  req: AgentRequest,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const { instructions, input } = toResponsesInput(req.system, req.messages);

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        tools: req.tools.map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
          strict: false,
        })),
        stream: true,
        store: false,
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
        `[agent/openai] HTTP ${res.status} for model=${model}:`,
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

  const partials = new Map<number, PartialCall>();
  let sawToolCall = false;
  let usage: Record<string, unknown> | undefined;

  try {
    for await (const data of sseEvents(res.body)) {
      if (data === "[DONE]") break;
      let evt: StreamEvent;
      try {
        evt = JSON.parse(data) as StreamEvent;
      } catch {
        continue; // keep-alive or partial line
      }

      switch (evt.type) {
        case "response.output_text.delta":
          if (evt.delta) yield { type: "text_delta", text: evt.delta };
          break;
        case "response.output_item.added":
          if (evt.item?.type === "function_call") {
            sawToolCall = true;
            const index = evt.output_index ?? partials.size;
            partials.set(index, {
              id: evt.item.id ?? "",
              callId: evt.item.call_id ?? "",
              name: evt.item.name ?? "",
              args: evt.item.arguments ?? "",
            });
          }
          break;
        case "response.function_call_arguments.delta": {
          const p = partials.get(evt.output_index ?? -1);
          if (p) p.args += evt.delta ?? "";
          break;
        }
        case "response.output_item.done":
          if (evt.item?.type === "function_call") {
            const p = partials.get(evt.output_index ?? -1);
            if (p) {
              p.id = evt.item.id ?? p.id;
              p.callId = evt.item.call_id ?? p.callId;
              p.name = evt.item.name ?? p.name;
              if (typeof evt.item.arguments === "string") {
                p.args = evt.item.arguments;
              }
            }
          }
          break;
        case "response.completed":
          usage = evt.response?.usage;
          break;
        case "error":
          yield {
            type: "error",
            message:
              evt.error?.message ?? evt.message ?? "OpenAI returned an error.",
            retryable: false,
          };
          return;
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
      id: call.callId || call.id || `call_${index}`,
      name: call.name,
      args,
    };
  }

  if (process.env.NODE_ENV !== "production" && usage) {
    console.log(
      `[agent/openai] model=${model} usage=${JSON.stringify(usage)}`,
    );
  }

  yield {
    type: "done",
    stopReason: sawToolCall ? "tool_use" : "end_turn",
  };
}
