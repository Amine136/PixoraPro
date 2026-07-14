import type { AgentEvent, AgentRequest } from "./protocol";

/* The only layer that knows how to reach an LLM backend. Both endpoints —
 * the local dev route (/api/agent) and the parent system's gateway — speak
 * the same wire format: POST AgentRequest as JSON, receive an NDJSON stream
 * of AgentEvent. Swapping backends is a URL + headers change. */

export interface AgentTransport {
  send(req: AgentRequest, signal?: AbortSignal): AsyncGenerator<AgentEvent>;
}

export class HttpTransport implements AgentTransport {
  constructor(
    private url: string,
    private headers: Record<string, string> = {},
  ) {}

  async *send(
    req: AgentRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers },
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

/** Production: the parent system's gateway (holds all provider keys); the
 *  session credential goes in the Authorization header. Development: the
 *  local /api/agent route backed by a key in .env.local. */
export function createTransport(sessionToken?: string): AgentTransport {
  const gatewayUrl = process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL;
  if (gatewayUrl) {
    return new HttpTransport(
      gatewayUrl,
      sessionToken ? { authorization: `Bearer ${sessionToken}` } : {},
    );
  }
  return new HttpTransport("/api/agent");
}
