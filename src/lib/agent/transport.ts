import type { AgentEvent, AgentRequest } from "./protocol";
import { streamGemini } from "./providers/gemini";
import { readApiKey, readModel } from "./settings";

/* The only layer that knows how to reach a model.
 *
 * Two modes, same AgentEvent stream, so the agent loop in useAgent.ts is
 * identical in both:
 *
 *  - BYOK (default): the browser calls the provider's API directly with the
 *    user's own key. No Pixora server is in the path — the key, the prompts and
 *    the canvas screenshots never reach us.
 *  - Gateway: when NEXT_PUBLIC_AGENT_GATEWAY_URL is set, POST the neutral
 *    request to a parent system's endpoint which holds the provider keys (see
 *    docs/agent-gateway.md). */

export interface AgentTransport {
  send(req: AgentRequest, signal?: AbortSignal): AsyncGenerator<AgentEvent>;
}

/** BYOK: straight from this browser to Google, using the key and model the user
 *  chose in the UI. Both are read at send time, so changing either takes effect
 *  on the next message without rebuilding anything. */
export class GeminiBrowserTransport implements AgentTransport {
  async *send(
    req: AgentRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const apiKey = readApiKey();
    if (!apiKey) {
      yield {
        type: "error",
        message:
          "No Gemini API key. Open the key settings in the Assistant panel and paste your key.",
        retryable: false,
      };
      return;
    }
    yield* streamGemini(req, apiKey, req.model || readModel(), signal);
  }
}

/** Headers may be a factory so credentials are read at send time — the user can
 *  change their session mid-flight without the transport being rebuilt. */
type HeaderSource = Record<string, string> | (() => Record<string, string>);

/** Gateway mode: POST the request as JSON, receive an NDJSON stream of events. */
export class HttpTransport implements AgentTransport {
  constructor(
    private url: string,
    private headers: HeaderSource = {},
  ) {}

  async *send(
    req: AgentRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const extra =
      typeof this.headers === "function" ? this.headers() : this.headers;
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify(req),
      signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      yield {
        type: "error",
        message: `Agent backend returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        retryable: res.status === 429 || res.status >= 500,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) yield JSON.parse(line) as AgentEvent;
        }
      }
      const rest = buffer.trim();
      if (rest) yield JSON.parse(rest) as AgentEvent;
    } finally {
      reader.releaseLock();
    }
  }
}

/** Gateway when one is configured, otherwise the user's own key from the
 *  browser. `sessionToken` only applies to gateway mode. */
export function createTransport(sessionToken?: string): AgentTransport {
  const gatewayUrl = process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL;
  if (gatewayUrl) {
    return new HttpTransport(
      gatewayUrl,
      sessionToken ? { authorization: `Bearer ${sessionToken}` } : {},
    );
  }
  return new GeminiBrowserTransport();
}
