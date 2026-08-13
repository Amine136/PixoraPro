/* Provider-neutral agent protocol.
 *
 * Pixora never talks to an LLM vendor directly — the app builds requests in
 * these types and a transport (see transport.ts) delivers them to whatever
 * backend holds the API keys. The wire format is exactly these types: the
 * request as one JSON body, the response as newline-delimited JSON where each
 * line is one AgentEvent.
 */

export type TextPart = { type: "text"; text: string };

/** Image as a data URL (e.g. "data:image/png;base64,..."). */
export type ImagePart = { type: "image"; dataUrl: string };

/** The model asked to run a tool. */
export type ToolCallPart = {
  type: "tool_call";
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque provider state (e.g. Gemini thought signatures). Clients must
   *  echo it back unchanged when replaying history; backends that don't
   *  need it ignore it. */
  signature?: string;
};

/** Result of a tool the client executed, echoed back to the model. */
export type ToolResultPart = {
  type: "tool_result";
  callId: string;
  content: string;
  /** Optional images attached to the result (e.g. a canvas screenshot). */
  images?: string[];
  isError?: boolean;
};

export type AgentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

export interface AgentMessage {
  role: "user" | "assistant";
  parts: AgentPart[];
}

export interface ToolDef {
  name: string;
  description: string;
  /** Plain JSON Schema. Keep to the portable subset: object/string/number/
   *  boolean/enum + required. No recursion, no numeric/string constraints. */
  inputSchema: Record<string, unknown>;
}

export interface AgentRequest {
  /** Pass-through model hint; the backend decides how to honor it. */
  model?: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolDef[];
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
      /** Opaque provider state — echo back on the matching ToolCallPart. */
      signature?: string;
    }
  | { type: "done"; stopReason: StopReason }
  | { type: "error"; message: string; retryable?: boolean };
