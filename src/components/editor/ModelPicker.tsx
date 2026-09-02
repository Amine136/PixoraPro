"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  PROVIDERS,
  useAiSettings,
  type ProviderId,
} from "@/lib/agent/settings";

/* Two-level model picker for the agent header: a compact trigger shows the
 * current model, and the popover lists providers on the left with the chosen
 * provider's models on the right. Hovering (or tapping) a provider swaps the
 * right-hand list; clicking a model commits both the provider and the model. */
export function ModelPicker() {
  const { provider, model, saveProvider, saveModel } = useAiSettings();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ProviderId>(provider);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const providers = Object.values(PROVIDERS);
  const activeInfo = PROVIDERS[active];
  const currentInfo = PROVIDERS[provider];
  const currentModelLabel =
    currentInfo.models.find((m) => m.id === model)?.label ??
    currentInfo.defaultModel;

  const chooseModel = (modelId: string) => {
    saveProvider(active);
    saveModel(modelId);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative ml-1 shrink-0">
      <button
        type="button"
        onClick={() => {
          setActive(provider);
          setOpen((v) => !v);
        }}
        title="Change model"
        className="flex h-6 max-w-[140px] items-center gap-1 rounded-md border border-white/[0.08] bg-zinc-950/60 pl-1.5 pr-1 text-[10px] text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
      >
        <span className="truncate">{currentModelLabel}</span>
        <ChevronDown className="size-3 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex overflow-hidden rounded-xl border border-white/[0.1] bg-zinc-900/95 shadow-2xl shadow-black/60 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-100">
          {/* Providers */}
          <ul className="flex w-36 flex-col gap-0.5 border-r border-white/[0.06] p-1">
            {providers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(p.id)}
                  onClick={() => setActive(p.id)}
                  className={`flex w-full items-center justify-between gap-1 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                    active === p.id
                      ? "bg-indigo-500/15 text-indigo-200"
                      : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
                  }`}
                >
                  <span className="truncate">{p.label}</span>
                  {provider === p.id && (
                    <Check className="size-3 shrink-0 text-indigo-400" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Models */}
          <ul className="flex w-48 flex-col gap-0.5 p-1">
            {activeInfo.models.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => chooseModel(m.id)}
                  className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    provider === active && model === m.id
                      ? "bg-indigo-500/15"
                      : "hover:bg-zinc-800/80"
                  }`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[11px] text-zinc-200">
                      {m.label}
                    </span>
                    <span className="truncate text-[10px] text-zinc-500">
                      {m.hint}
                    </span>
                  </span>
                  {provider === active && model === m.id && (
                    <Check className="mt-0.5 size-3 shrink-0 text-indigo-400" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
