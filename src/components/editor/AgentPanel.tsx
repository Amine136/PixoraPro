"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import type { EditorApi } from "@/lib/editor/useEditor";
import { useAgent } from "@/lib/agent/useAgent";

interface AgentPanelProps {
  editor: EditorApi;
}

export function AgentPanel({ editor }: AgentPanelProps) {
  const { items, busy, run, stop, clear } = useAgent(editor);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void run(text);
  };

  return (
    <>
      {/* Block canvas input while the agent is editing (panel stays above it) */}
      {busy && (
        <div className="absolute inset-0 z-30 cursor-wait" aria-hidden />
      )}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="AI assistant"
          className="absolute bottom-4 left-20 z-40 flex items-center gap-2 rounded-xl border border-slate-800/60 bg-zinc-900/60 px-3.5 py-2.5 text-sm font-medium text-indigo-300 shadow-2xl shadow-black/40 backdrop-blur-xl transition-colors hover:bg-zinc-800/80 hover:text-indigo-200"
        >
          <Sparkles className="size-4" />
          Assistant
        </button>
      )}

      {open && (
        <section className="absolute bottom-4 left-20 z-40 flex max-h-[70dvh] w-96 flex-col rounded-2xl border border-slate-800/60 bg-zinc-900/70 shadow-2xl shadow-black/40 backdrop-blur-xl">
          <header className="flex items-center gap-2 border-b border-slate-800/50 px-4 py-3">
            <Sparkles className="size-4 text-indigo-400" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Assistant
            </h2>
            {items.length > 0 && !busy && (
              <button
                type="button"
                onClick={clear}
                title="Clear conversation"
                className="ml-auto flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Close"
              className={`flex size-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300 ${items.length > 0 && !busy ? "" : "ml-auto"}`}
            >
              <X className="size-3.5" />
            </button>
          </header>

          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
          >
            {items.length === 0 && (
              <p className="py-6 text-center text-xs leading-relaxed text-zinc-500">
                Describe an edit and I&apos;ll do it on the canvas —<br />
                “add a bold title at the top”, “make the image warmer”,
                “center the logo”.
              </p>
            )}
            {items.map((item, i) =>
              item.role === "user" ? (
                <div
                  key={i}
                  className="ml-8 self-end rounded-xl rounded-br-sm bg-indigo-500/20 px-3 py-2 text-xs leading-relaxed text-indigo-100"
                >
                  {item.text}
                </div>
              ) : (
                <div key={i} className="mr-4 flex flex-col gap-1.5">
                  {item.text && (
                    <div className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-zinc-800/70 px-3 py-2 text-xs leading-relaxed text-zinc-200">
                      {item.text}
                    </div>
                  )}
                  {item.actions.length > 0 && (
                    <ul className="flex flex-col gap-0.5 pl-1">
                      {item.actions.map((a, j) => (
                        <li
                          key={j}
                          className="text-[10px] text-zinc-500 before:mr-1.5 before:text-indigo-400 before:content-['✓']"
                        >
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.error && (
                    <p className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-red-300">
                      {item.error}
                    </p>
                  )}
                  {busy && i === items.length - 1 && !item.text && (
                    <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-500">
                      <Loader2 className="size-3 animate-spin" />
                      Working…
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          <footer className="border-t border-slate-800/50 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={busy ? "Agent is editing…" : "Ask for an edit…"}
                disabled={busy}
                rows={2}
                className="min-h-0 flex-1 resize-none rounded-xl border border-slate-800/60 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none disabled:opacity-60"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  title="Stop"
                  className="flex size-9 items-center justify-center rounded-xl bg-red-500/20 text-red-300 transition-colors hover:bg-red-500/30"
                >
                  <Square className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!draft.trim()}
                  title="Send"
                  className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/80 text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                >
                  <Send className="size-3.5" />
                </button>
              )}
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
