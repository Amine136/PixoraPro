import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentEvent,
  AgentMessage,
  AgentRequest,
  StopReason,
} from "@/lib/agent/protocol";
import { runGemini } from "./gemini";

/* Development backend for the agent chat. Speaks the same wire format as the
 * production gateway (POST AgentRequest → NDJSON stream of AgentEvent) so the
 * client code is identical in both environments; in production the parent
 * system's gateway replaces this route entirely (set
 * NEXT_PUBLIC_AGENT_GATEWAY_URL) and no provider key exists in Pixora. */

const DEFAULT_MODEL = "claude-opus-4-8";

function dataUrlToImageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(
    dataUrl,
  );
  if (!match) throw new Error("Unsupported image data URL");
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1] as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
      data: match[2],
    },
  };
}

function toAnthropicMessages(
  messages: AgentMessage[],
): Anthropic.MessageParam[] {
  return messages.map((m) => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const part of m.parts) {
      switch (part.type) {
        case "text":
          content.push({ type: "text", text: part.text });
          break;
        case "image":
          content.push(dataUrlToImageBlock(part.dataUrl));
          break;
        case "tool_call":
          content.push({
            type: "tool_use",
            id: part.id,
            name: part.name,
            input: part.args,
          });
          break;
        case "tool_result": {
          const blocks: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] =
            [{ type: "text", text: part.content }];
          for (const img of part.images ?? []) {
            blocks.push(dataUrlToImageBlock(img));
          }
          content.push({
            type: "tool_result",
            tool_use_id: part.callId,
            content: blocks,
            is_error: part.isError ?? false,
          });
          break;
        }
      }
    }
    return { role: m.role, content };
  });
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end_turn";
  }
}

export async function POST(request: Request) {
  const req = (await request.json()) as AgentRequest;

  const encoder = new TextEncoder();
  const line = (e: AgentEvent) => encoder.encode(JSON.stringify(e) + "\n");

  // Dev-only provider dispatch: Anthropic when its key is present, else
  // Gemini. In production neither key exists here — the parent system's
  // gateway (NEXT_PUBLIC_AGENT_GATEWAY_URL) replaces this route.
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!process.env.ANTHROPIC_API_KEY && geminiKey) {
    const events = await runGemini(req, geminiKey);
    const payload = events.map((e) => JSON.stringify(e) + "\n").join("");
    return new Response(encoder.encode(payload), {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
      },
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      line({
        type: "error",
        message:
          "No provider key set. Add ANTHROPIC_API_KEY or GEMINI_API_KEY to .env.local (dev), or set NEXT_PUBLIC_AGENT_GATEWAY_URL to use the system gateway.",
        retryable: false,
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    );
  }

  const client = new Anthropic();
  const model =
    req.model && req.model.startsWith("claude") ? req.model : DEFAULT_MODEL;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const msgStream = client.messages.stream({
          model,
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          // Stable prefix (tools render before system) is cached; the
          // volatile canvas state/screenshots live in messages after it.
          system: [
            {
              type: "text",
              text: req.system,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
          })),
          messages: toAnthropicMessages(req.messages),
        });

        msgStream.on("text", (delta) => {
          controller.enqueue(line({ type: "text_delta", text: delta }));
        });

        const final = await msgStream.finalMessage();

        for (const block of final.content) {
          if (block.type === "tool_use") {
            controller.enqueue(
              line({
                type: "tool_call",
                id: block.id,
                name: block.name,
                args: (block.input ?? {}) as Record<string, unknown>,
              }),
            );
          }
        }
        controller.enqueue(
          line({ type: "done", stopReason: mapStopReason(final.stop_reason) }),
        );
      } catch (err) {
        const retryable =
          err instanceof Anthropic.RateLimitError ||
          err instanceof Anthropic.InternalServerError ||
          err instanceof Anthropic.APIConnectionError;
        const message =
          err instanceof Anthropic.APIError
            ? `Provider error (${err.status}): ${err.message}`
            : err instanceof Error
              ? err.message
              : "Unknown agent backend error";
        controller.enqueue(line({ type: "error", message, retryable }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
