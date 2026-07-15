"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { EditorApi } from "@/lib/editor/useEditor";
import type {
  AgentMessage,
  AgentPart,
  ToolResultPart,
} from "./protocol";
import { createTransport } from "./transport";
import { executeTool, SYSTEM_PROMPT, TOOL_DEFS } from "./tools";

const MAX_ROUNDS = 15;
/** Deleting this many layers in one turn triggers a single in-UI confirmation.
 *  Everything the agent does is undoable in one step, so only bulk deletion —
 *  high-impact and easy to miss — is worth gating. */
const DELETE_CONFIRM_THRESHOLD = 3;

export interface ChatItem {
  role: "user" | "assistant";
  text: string;
  /** Activity log of canvas edits applied during this assistant turn. */
  actions: string[];
  error?: string;
}

/** A pending bulk-delete confirmation the UI must resolve before the agent
 *  continues. `decide(true)` allows all deletions for the rest of the turn;
 *  `decide(false)` declines and the model is told to stop deleting. */
export interface PendingConfirm {
  count: number;
  decide: (approved: boolean) => void;
}

type AgentEditorApi = Pick<
  EditorApi,
  | "beginAgentTurn"
  | "endAgentTurn"
  | "agentGetState"
  | "agentScreenshot"
  | "agentSampleColor"
  | "agentApplyToLayer"
  | "agentAdjustImage"
  | "agentDuplicateLayer"
  | "agentAddText"
  | "agentAddShape"
  | "agentDeleteLayer"
  | "agentAlignLayer"
  | "agentMoveLayer"
  | "agentGroupLayers"
  | "agentUngroupLayer"
  | "agentSetArtboard"
>;

/** Screenshots are only useful in the round they were taken — strip them from
 *  older messages so history stays small on every provider. */
function withoutStaleImages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((m, i) => {
    if (i === messages.length - 1) return m;
    const parts: AgentPart[] = m.parts.map((p) =>
      p.type === "tool_result" && p.images?.length
        ? { ...p, images: undefined, content: p.content + " (image omitted)" }
        : p,
    );
    return { ...m, parts };
  });
}

export function useAgent(editor: AgentEditorApi) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<AgentMessage[]>([]);
  const transport = useMemo(() => createTransport(), []);

  const patchLast = useCallback((patch: Partial<ChatItem>) => {
    setItems((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.role === "assistant") {
        next[next.length - 1] = { ...last, ...patch };
      }
      return next;
    });
  }, []);

  const run = useCallback(
    async (instruction: string) => {
      if (busy || !instruction.trim()) return;
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      // Show an in-UI bulk-delete prompt and wait for the user. Rejects if the
      // run is aborted so the Stop button still works while a prompt is open.
      const requestConfirm = (count: number) =>
        new Promise<boolean>((resolve, reject) => {
          if (controller.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          const onAbort = () => {
            setConfirm(null);
            reject(new DOMException("Aborted", "AbortError"));
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          setConfirm({
            count,
            decide: (approved: boolean) => {
              controller.signal.removeEventListener("abort", onAbort);
              setConfirm(null);
              resolve(approved);
            },
          });
        });

      conversationRef.current.push({
        role: "user",
        parts: [{ type: "text", text: instruction }],
      });
      setItems((prev) => [
        ...prev,
        { role: "user", text: instruction, actions: [] },
        { role: "assistant", text: "", actions: [] },
      ]);

      let mutated = false;
      // Guard against fiddling loops: a mutating call with identical
      // arguments is never executed twice in one run.
      const executedSignatures = new Set<string>();
      // Guard against analysis paralysis: consecutive rounds of only
      // read-only calls get an escalating push to act or answer.
      let readOnlyRounds = 0;
      // Bulk-delete gate: count deletions this turn; once the user answers the
      // one confirmation, that decision holds for the rest of the turn.
      let deletesThisTurn = 0;
      let bulkDeleteChoice: "allow" | "deny" | null = null;
      editor.beginAgentTurn();
      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          let text = "";
          const toolCalls: {
            id: string;
            name: string;
            args: Record<string, unknown>;
            signature?: string;
          }[] = [];
          let failed: string | null = null;

          for await (const event of transport.send(
            {
              system: SYSTEM_PROMPT,
              messages: withoutStaleImages(conversationRef.current),
              tools: TOOL_DEFS,
            },
            controller.signal,
          )) {
            if (event.type === "text_delta") {
              text += event.text;
              patchLast({ text });
            } else if (event.type === "tool_call") {
              toolCalls.push({
                id: event.id,
                name: event.name,
                args: event.args,
                signature: event.signature,
              });
            } else if (event.type === "error") {
              failed = event.message;
            }
          }

          if (failed) {
            patchLast({ error: failed });
            return;
          }

          const assistantParts: AgentPart[] = [];
          if (text) assistantParts.push({ type: "text", text });
          for (const call of toolCalls) {
            assistantParts.push({ type: "tool_call", ...call });
          }
          if (assistantParts.length > 0) {
            conversationRef.current.push({
              role: "assistant",
              parts: assistantParts,
            });
          }

          if (toolCalls.length === 0) return; // turn complete

          const results: ToolResultPart[] = [];
          let roundMutated = false;

          // Bulk-delete gate: if this round's deletions would bring the turn's
          // total to the threshold, ask the user once before executing them.
          if (bulkDeleteChoice === null) {
            const pendingDeletes = toolCalls.filter(
              (c) => c.name === "delete_layer",
            ).length;
            if (deletesThisTurn + pendingDeletes >= DELETE_CONFIRM_THRESHOLD) {
              const approved = await requestConfirm(
                deletesThisTurn + pendingDeletes,
              );
              bulkDeleteChoice = approved ? "allow" : "deny";
            }
          }

          for (const call of toolCalls) {
            const signature = `${call.name}:${JSON.stringify(call.args)}`;
            if (
              call.name !== "get_canvas_state" &&
              call.name !== "get_screenshot" &&
              executedSignatures.has(signature)
            ) {
              results.push({
                type: "tool_result",
                callId: call.id,
                content:
                  "Rejected: you already made this exact call — the canvas already reflects it. Stop fine-tuning; finish now and summarize what you did.",
                isError: true,
              });
              continue;
            }
            if (call.name === "delete_layer" && bulkDeleteChoice === "deny") {
              results.push({
                type: "tool_result",
                callId: call.id,
                content:
                  "BLOCKED — the user declined the deletion. NOTHING was deleted; this layer and all others are still on the canvas. Do NOT retry deleting. When you finish, tell the user plainly that you did NOT delete the layers because they chose to keep them — do not claim the canvas was cleared.",
                isError: true,
              });
              continue;
            }
            executedSignatures.add(signature);
            const res = await executeTool(editor, call.name, call.args);
            if (call.name === "delete_layer" && !res.isError) deletesThisTurn++;
            if (res.mutated) {
              mutated = true;
              roundMutated = true;
            }
            if (res.label) {
              setItems((prev) => {
                const next = prev.slice();
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = {
                    ...last,
                    actions: [...last.actions, res.label!],
                  };
                }
                return next;
              });
            }
            results.push({
              type: "tool_result",
              callId: call.id,
              content: res.content,
              images: res.images,
              isError: res.isError,
            });
          }

          // Vision-grounded self-correction: after a mutating round, attach a
          // fresh screenshot so the model always sees what it actually did —
          // it shouldn't have to remember to ask.
          const tookScreenshot = toolCalls.some(
            (c) => c.name === "get_screenshot",
          );
          if (roundMutated && !tookScreenshot && results.length > 0) {
            const shot = editor.agentScreenshot();
            if (shot) {
              const last = results[results.length - 1];
              last.images = [...(last.images ?? []), shot];
              last.content +=
                "\n\nAttached: automatic screenshot of the canvas after this change. Inspect it — fix alignment, overlap, contrast or sizing problems before finishing.";
            }
          }

          readOnlyRounds = roundMutated ? 0 : readOnlyRounds + 1;
          if (readOnlyRounds >= 3 && results.length > 0) {
            results[results.length - 1].content +=
              "\n\nNOTE: this is your " +
              readOnlyRounds +
              "th consecutive round of only reading. You have enough information — make your edits now, or if nothing needs changing, stop calling tools and give your final answer.";
          }
          conversationRef.current.push({ role: "user", parts: results });
        }
        patchLast({
          error: `Stopped after ${MAX_ROUNDS} tool rounds — send a follow-up to continue.`,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          patchLast({ error: "Stopped." });
        } else {
          patchLast({
            error: err instanceof Error ? err.message : "Agent failed",
          });
        }
      } finally {
        // One undo step for everything this instruction changed
        editor.endAgentTurn(mutated);
        setConfirm(null);
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, editor, transport, patchLast],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    if (busy) return;
    conversationRef.current = [];
    setItems([]);
  }, [busy]);

  return { items, busy, confirm, run, stop, clear };
}
