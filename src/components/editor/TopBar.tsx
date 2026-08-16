"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Frame,
  Layers,
  Redo2,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
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
        className="h-8 w-14 sm:w-16 rounded-lg border border-white/[0.08] bg-zinc-950/60 px-1.5 sm:px-2 text-right font-mono text-xs text-zinc-300 outline-none transition-colors hover:border-white/20 focus-visible:border-indigo-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
  const [mobilePresetOpen, setMobilePresetOpen] = useState(false);
  const [customW, setCustomW] = useState(String(preset.width));
  const [customH, setCustomH] = useState(String(preset.height));
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCustomW(String(preset.width));
    setCustomH(String(preset.height));
  }, [preset.width, preset.height]);

  useEffect(() => {
    if (!mobilePresetOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMobilePresetOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("touchstart", handleClickOutside);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("touchstart", handleClickOutside);
    };
  }, [mobilePresetOpen]);

  const applyCustomSizeLocal = () => {
    const w = Number(customW);
    const h = Number(customH);
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      onCustomSize(w, h);
      setMobilePresetOpen(false);
    }
  };

  return (
    <>
      <header className="pointer-events-auto absolute inset-x-2 top-2 sm:inset-x-4 sm:top-4 z-30 flex h-12 sm:h-14 items-center justify-between gap-1.5 sm:gap-3 rounded-xl sm:rounded-2xl border border-white/[0.08] bg-zinc-900/70 px-2.5 sm:px-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
        {/* Brand */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex size-7 sm:size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-950/60">
            <span className="text-xs sm:text-sm font-bold text-white">P</span>
          </div>
          <div className="leading-tight">
            <div className="text-xs sm:text-sm font-semibold tracking-tight text-zinc-100">
              Pixora
            </div>
            <div className="hidden sm:block text-[9px] sm:text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              Vibecraft editor
            </div>
          </div>
        </div>

        {/* Artboard size - Desktop (lg+) */}
        <div className="hidden lg:flex items-center gap-2">
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

        {/* Artboard size - Tablet & Mobile (<lg) trigger button */}
        <div className="flex lg:hidden items-center">
          <button
            type="button"
            onClick={() => setMobilePresetOpen(!mobilePresetOpen)}
            className="flex h-7 sm:h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-950/60 px-2 sm:px-2.5 text-[11px] sm:text-xs text-zinc-300 transition-colors hover:border-white/20 active:bg-zinc-800/80"
          >
            <Frame className="size-3.5 text-zinc-400" />
            <span className="max-w-[80px] xs:max-w-[120px] sm:max-w-[160px] truncate font-medium">
              {preset.width}×{preset.height}
            </span>
            <ChevronDown className="size-3 text-zinc-500" />
          </button>
        </div>

        {/* History + Export */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="flex size-7 sm:size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30 active:scale-95"
          >
            <Undo2 className="size-3.5 sm:size-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            className="flex size-7 sm:size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30 active:scale-95"
          >
            <Redo2 className="size-3.5 sm:size-4" />
          </button>

          <div className="mx-0.5 sm:mx-1 h-5 sm:h-6 w-px bg-white/[0.08]" aria-hidden />

          <button
            type="button"
            onClick={onExport}
            className="flex h-7 sm:h-8 items-center gap-1.5 rounded-lg bg-gradient-to-b from-indigo-500 to-violet-600 px-2 sm:px-3 text-xs font-semibold text-white shadow-md shadow-indigo-950/50 transition-all hover:brightness-110 active:scale-[0.97]"
          >
            <Download className="size-3.5" />
            <span className="hidden xs:inline">Export</span>
            <span className="hidden sm:inline"> PNG</span>
          </button>
        </div>
      </header>

      {/* Artboard Size Modal / Sheet for Mobile & Tablet */}
      {mobilePresetOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 pt-16 sm:pt-20 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            ref={popoverRef}
            className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-900/95 p-4 shadow-2xl shadow-black/80 backdrop-blur-2xl animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Frame className="size-4 text-indigo-400" />
                <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-300">
                  Artboard Size
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMobilePresetOpen(false)}
                className="flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Presets List */}
            <div className="space-y-1 max-h-56 overflow-y-auto pixora-scroll pr-1">
              {ARTBOARD_PRESETS.map((p) => {
                const active = preset.width === p.width && preset.height === p.height;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      onPreset(p);
                      setMobilePresetOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs transition-colors ${
                      active
                        ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
                        : "text-zinc-300 hover:bg-zinc-800/70 border border-transparent"
                    }`}
                  >
                    <span className="font-medium truncate">{p.label}</span>
                    <span className="font-mono text-[11px] text-zinc-500 shrink-0 ml-2">
                      {p.width} × {p.height}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Custom dimensions */}
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Custom Size
              </div>
              <div className="flex items-center gap-2">
                <label className="flex-1 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-950/70 px-2.5 py-1.5">
                  <span className="text-[10px] font-semibold text-zinc-500">W</span>
                  <input
                    type="number"
                    min={16}
                    max={8192}
                    value={customW}
                    onChange={(e) => setCustomW(e.target.value)}
                    className="w-full bg-transparent font-mono text-xs text-zinc-200 outline-none"
                    placeholder="Width"
                  />
                </label>
                <span className="text-zinc-600 font-mono text-xs">×</span>
                <label className="flex-1 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-zinc-950/70 px-2.5 py-1.5">
                  <span className="text-[10px] font-semibold text-zinc-500">H</span>
                  <input
                    type="number"
                    min={16}
                    max={8192}
                    value={customH}
                    onChange={(e) => setCustomH(e.target.value)}
                    className="w-full bg-transparent font-mono text-xs text-zinc-200 outline-none"
                    placeholder="Height"
                  />
                </label>
                <button
                  type="button"
                  onClick={applyCustomSizeLocal}
                  className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 transition-colors"
                >
                  Set
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
