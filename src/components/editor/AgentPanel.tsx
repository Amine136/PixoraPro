"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Send,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { EditorApi } from "@/lib/editor/useEditor";
import { useAgent } from "@/lib/agent/useAgent";
import { ModelPicker } from "./ModelPicker";

interface AgentPanelProps {
  editor: EditorApi;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenSettings?: () => void;
}

export function AgentPanel({
  editor,
  isOpen,
  onOpenChange,
  onOpenSettings,
}: AgentPanelProps) {
  const { items, busy, confirm, needsKey, run, stop, clear } =
    useAgent(editor);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const setOpen = (val: boolean) => {
    setInternalOpen(val);
    onOpenChange?.(val);
  };
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const copyText = (id: number, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id);
        window.setTimeout(
          () => setCopiedId((cur) => (cur === id ? null : cur)),
          1500,
        );
      })
      .catch(() => {});
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || needsKey) return;
    setDraft("");
    void run(text);
  };

  return (
    <>
      {/* Block canvas input while the agent is editing (panel stays above it) */}
      {busy && (
        <div className="absolute inset-0 z-30 cursor-wait" aria-hidden />
      )}

      {/* Desktop trigger button (hidden on mobile since bottom dock has it) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={needsKey ? "Pixora Pro Agent — API key needed" : "Pixora Pro Agent"}
          className="hidden lg:flex absolute bottom-4 left-20 z-40 items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-3.5 py-2.5 text-sm font-medium text-indigo-300 shadow-2xl shadow-black/40 backdrop-blur-xl transition-colors hover:bg-zinc-800/80 hover:text-indigo-200"
        >
          <Sparkles className="size-4" />
          Pixora Pro Agent
          {needsKey && (
            <KeyRound className="size-3.5 text-amber-400" aria-hidden />
          )}
        </button>
      )}

      {/* Mobile Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden animate-in fade-in duration-150"
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <section className="fixed lg:absolute bottom-2 sm:bottom-4 inset-x-2 sm:inset-x-auto sm:left-4 lg:left-20 z-50 flex max-h-[85dvh] lg:max-h-[70dvh] w-auto sm:w-96 flex-col rounded-2xl border border-white/[0.1] lg:border-white/[0.08] bg-zinc-900/95 lg:bg-zinc-900/70 shadow-2xl shadow-black/60 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150">
          <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <Sparkles className="size-4 shrink-0 text-indigo-400" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Pixora Pro Agent
            </h2>
            {!needsKey && <ModelPicker />}
            <button
              type="button"
              onClick={onOpenSettings}
              title={needsKey ? "Add your API key" : "Pixora Pro Agent settings"}
              aria-label={needsKey ? "Add your API key" : "Pixora Pro Agent settings"}
              className={`ml-auto flex size-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                needsKey
                  ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
                  : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-300"
              }`}
            >
              <KeyRound className="size-3.5" />
            </button>
            {items.length > 0 && !busy && (
              <button
                type="button"
                onClick={clear}
                title="Clear conversation"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Close"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300"
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
                {needsKey ? (
                  <>
                    Open Pixora Pro Agent settings to add your API key.
                    <br />
                    It stays in this browser.
                  </>
                ) : (
                  <>
                    Describe an edit and I&apos;ll do it on the canvas —<br />
                    “add a bold title at the top”, “make the image warmer”,
                    “center the logo”.
                  </>
                )}
              </p>
            )}
            {items.map((item, i) =>
              item.role === "user" ? (
                <div
                  key={i}
                  className="ml-8 flex items-start justify-end gap-1.5 self-end"
                >
                  <button
                    type="button"
                    onClick={() => copyText(i, item.text)}
                    title="Copy"
                    aria-label="Copy message"
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
                  >
                    {copiedId === i ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                  <div
                    dir="auto"
                    className="select-text rounded-xl rounded-br-sm bg-indigo-500/20 px-3 py-2 text-xs leading-relaxed text-indigo-100"
                  >
                    {item.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="mr-4 flex flex-col gap-1.5">
                  {item.text && (
                    <div className="flex items-start gap-1.5">
                      <div
                        dir="auto"
                        className="min-w-0 select-text whitespace-pre-wrap rounded-xl rounded-bl-sm bg-zinc-800/70 px-3 py-2 text-xs leading-relaxed text-zinc-200"
                      >
                        {item.text}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(i, item.text)}
                        title="Copy"
                        aria-label="Copy message"
                        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
                      >
                        {copiedId === i ? (
                          <Check className="size-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                  {item.actions.length > 0 && (
                    <ul className="flex flex-col gap-0.5 pl-1">
                      {item.actions.map((a, j) => (
                        <li
                          key={j}
                          dir="auto"
                          className="text-[10px] text-zinc-500 before:mr-1.5 before:text-indigo-400 before:content-['✓']"
                        >
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.error && (
                    <p
                      dir="auto"
                      className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-red-300"
                    >
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

          {confirm && (
            <div className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <div className="flex flex-col gap-2">
                  <p className="text-xs leading-relaxed text-amber-100">
                    The agent wants to delete {confirm.count} layers. This
                    can be undone with a single Ctrl+Z afterwards.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirm.decide(true)}
                      className="rounded-lg bg-amber-500/90 px-3 py-1.5 text-[11px] font-medium text-zinc-950 transition-colors hover:bg-amber-400"
                    >
                      Delete them
                    </button>
                    <button
                      type="button"
                      onClick={() => confirm.decide(false)}
                      className="rounded-lg bg-zinc-800/80 px-3 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700/80"
                    >
                      Keep them
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <footer className="border-t border-white/[0.06] p-3">
            <div className="flex items-end gap-2">
              <textarea
                dir="auto"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  busy
                    ? "Agent is editing…"
                    : needsKey
                      ? "Add your API key to start…"
                      : "Ask for an edit…"
                }
                disabled={busy || needsKey}
                rows={2}
                className="min-h-0 flex-1 resize-none rounded-xl border border-white/[0.08] bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none disabled:opacity-60"
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
                  disabled={!draft.trim() || needsKey}
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
