/* History compaction for the agent loop.
 *
 * The full session transcript is replayed to the model on every round, so an
 * unbounded history means unbounded cost. Compaction works in turns — one
 * user instruction plus all its tool rounds — because providers reject
 * histories where a tool_result's paired tool_call was trimmed away. Old tool
 * traffic is disposable (the model re-reads the canvas via get_canvas_state);
 * the conversational text is what's worth keeping.
 *
 * Pure module (no React/Fabric) so it can be unit-tested without a model,
 * like lib/editor/layout.ts.
 */

import type { AgentMessage, AgentPart } from "./protocol";

/** Turns before the current one that keep their full tool-call structure.
 *  Anything older is reduced to plain text. */
export const RECENT_FULL_TURNS = 5;
/** In recent (non-current) turns, tool-result bodies longer than this are
 *  truncated — big canvas-state dumps dominate history size. */
export const TOOL_RESULT_KEEP_CHARS = 300;

const TRUNCATION_MARKER =
  " … [stale result truncated — call get_canvas_state for the current canvas]";

/** An instruction-bearing user message starts a new turn; user messages made
 *  only of tool_results are round traffic inside the current turn. */
function isInstruction(m: AgentMessage): boolean {
  return m.role === "user" && m.parts.some((p) => p.type === "text");
}

export function splitTurns(messages: AgentMessage[]): AgentMessage[][] {
  const turns: AgentMessage[][] = [];
  for (const m of messages) {
    if (isInstruction(m) || turns.length === 0) turns.push([m]);
    else turns[turns.length - 1].push(m);
  }
  return turns;
}

function truncateStaleResult(p: AgentPart): AgentPart {
  if (p.type === "tool_result" && p.content.length > TOOL_RESULT_KEEP_CHARS) {
    return {
      ...p,
      content: p.content.slice(0, TOOL_RESULT_KEEP_CHARS) + TRUNCATION_MARKER,
    };
  }
  return p;
}

function stripImages(p: AgentPart): AgentPart {
  return p.type === "tool_result" && p.images?.length
    ? { ...p, images: undefined, content: p.content + " (image omitted)" }
    : p;
}

/** Shrink the history sent to the model. Three tiers:
 *  - current turn: kept intact (its tool pairing and round results are live);
 *  - the RECENT_FULL_TURNS before it: structure kept (tool_calls with their
 *    provider signatures stay paired), bulky tool-result bodies truncated;
 *  - older turns: text parts only — tool_calls and tool_results dropped
 *    together, so pairing never breaks.
 *  Screenshots are only useful in the round they were taken, so images
 *  survive only on the very last message. The UI transcript is unaffected. */
export function compactHistory(messages: AgentMessage[]): AgentMessage[] {
  const turns = splitTurns(messages);
  const out: AgentMessage[] = [];
  turns.forEach((turn, t) => {
    if (t === turns.length - 1) {
      out.push(...turn);
    } else if (t >= turns.length - 1 - RECENT_FULL_TURNS) {
      for (const m of turn) {
        out.push({ ...m, parts: m.parts.map(truncateStaleResult) });
      }
    } else {
      for (const m of turn) {
        const parts = m.parts.filter((p) => p.type === "text");
        if (parts.length > 0) out.push({ ...m, parts });
      }
    }
  });
  return out.map((m, i) =>
    i === out.length - 1 ? m : { ...m, parts: m.parts.map(stripImages) },
  );
}
