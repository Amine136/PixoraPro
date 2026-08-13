"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, Frame, Redo2, Undo2 } from "lucide-react";
import { ARTBOARD_PRESETS, type ArtboardPreset } from "@/lib/editor/types";

interface TopBarProps {
  canUndo: boolean;
  canRedo: boolean;
  preset: ArtboardPreset;
  onUndo: () => void;
  onRedo: () => void;
  onPreset: (p: ArtboardPreset) => void;
  onCustomSize: (w: number, h: number) => void;
  onExport: () => void;
}

function SizeInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <label className="flex items-center gap-1">
      <span className="text-[10px] font-semibold uppercase text-zinc-600">
        {label}
      </span>
      <input
        type="number"
        min={16}
        max={8192}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(String(value));
        }}
        aria-label={`Artboard ${label === "W" ? "width" : "height"}`}
        className="h-8 w-16 rounded-lg border border-white/[0.08] bg-zinc-950/60 px-2 text-right font-mono text-xs text-zinc-300 outline-none transition-colors hover:border-white/20 focus-visible:border-indigo-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

export function TopBar({
  canUndo,
  canRedo,
  preset,
  onUndo,
  onRedo,
  onPreset,
  onCustomSize,
  onExport,
}: TopBarProps) {
  const isCustom = !ARTBOARD_PRESETS.some((p) => p.label === preset.label);

  return (
    <header className="pointer-events-auto absolute inset-x-4 top-4 z-30 flex h-14 items-center justify-between rounded-2xl border border-white/[0.08] bg-zinc-900/60 px-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950/60">
          <span className="text-sm font-bold text-white">P</span>
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-zinc-100">
            Pixora
          </div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            Vibecraft editor
          </div>
        </div>
      </div>

      {/* Artboard size */}
      <div className="flex items-center gap-2">
        <Frame className="size-4 text-zinc-500" aria-hidden />
        <div className="relative">
          <select
            aria-label="Artboard size preset"
            value={isCustom ? "__custom__" : preset.label}
            onChange={(e) => {
              const p = ARTBOARD_PRESETS.find((x) => x.label === e.target.value);
              if (p) onPreset(p);
            }}
            className="h-8 appearance-none rounded-lg border border-white/[0.08] bg-zinc-950/60 pl-2.5 pr-8 text-xs text-zinc-300 outline-none transition-colors hover:border-white/20 focus-visible:border-indigo-500"
          >
            {isCustom && (
              <option value="__custom__" disabled>
                Custom
              </option>
            )}
            {ARTBOARD_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
        </div>
        <div className="mx-1 h-6 w-px bg-white/[0.08]" aria-hidden />
        <SizeInput
          label="W"
          value={preset.width}
          onCommit={(w) => onCustomSize(w, preset.height)}
        />
        <span className="text-xs text-zinc-600">×</span>
        <SizeInput
          label="H"
          value={preset.height}
          onCommit={(h) => onCustomSize(preset.width, h)}
        />
      </div>

      {/* History + export */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
        >
          <Redo2 className="size-4" />
        </button>
        <div className="mx-2 h-6 w-px bg-white/[0.08]" aria-hidden />
        <button
          type="button"
          onClick={onExport}
          className="flex h-8 items-center gap-2 rounded-lg bg-gradient-to-b from-indigo-500 to-violet-600 px-3.5 text-xs font-semibold text-white shadow-lg shadow-indigo-950/50 transition-all hover:brightness-110 active:scale-[0.98]"
        >
          <Download className="size-3.5" />
          Export PNG
        </button>
      </div>
    </header>
  );
}
