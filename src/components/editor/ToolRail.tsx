"use client";

import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Eraser,
  Hand,
  ImagePlus,
  Layers,
  MousePointer2,
  MoveRight,
  Paintbrush,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Square,
  Type,
} from "lucide-react";
import type { ShapeKind, Tool } from "@/lib/editor/types";

interface ToolRailProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  onAddShape: (kind: ShapeKind) => void;
  onUpload: () => void;
  layersCount?: number;
  hasSelection?: boolean;
  activePanel?: "layers" | "properties" | null;
  onToggleLayers?: () => void;
  onToggleProperties?: () => void;
  onOpenAgent?: () => void;
  agentBusy?: boolean;
}

const TOOLS: { id: Tool; label: string; shortcut: string; icon: typeof Hand }[] =
  [
    { id: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
    { id: "pan", label: "Pan", shortcut: "H", icon: Hand },
    { id: "text", label: "Text", shortcut: "T", icon: Type },
    { id: "brush", label: "Brush", shortcut: "B", icon: Paintbrush },
    { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
  ];

const SHAPES: { kind: ShapeKind; label: string; icon: typeof Square }[] = [
  { kind: "rect", label: "Rectangle", icon: Square },
  { kind: "ellipse", label: "Ellipse", icon: Circle },
  { kind: "arrow", label: "Arrow", icon: MoveRight },
];

export function ToolRail({
  tool,
  onTool,
  onAddShape,
  onUpload,
  layersCount,
  hasSelection,
  activePanel,
  onToggleLayers,
  onToggleProperties,
  onOpenAgent,
  agentBusy,
}: ToolRailProps) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!shapesOpen) return;
    const close = (e: PointerEvent) => {
      if (!railRef.current?.contains(e.target as Node)) setShapesOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [shapesOpen]);

  return (
    <nav
      ref={railRef}
      aria-label="Editor tools"
      className="pointer-events-auto fixed lg:absolute bottom-2.5 sm:bottom-3 lg:bottom-auto left-1/2 lg:left-4 -translate-x-1/2 lg:translate-x-0 lg:top-1/2 lg:-translate-y-1/2 z-30 flex flex-row lg:flex-col items-center gap-0.5 sm:gap-1 rounded-2xl border border-white/[0.08] bg-zinc-900/90 lg:bg-zinc-900/60 p-1 sm:p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl max-w-[calc(100vw-0.75rem)]"
    >
      {TOOLS.map(({ id, label, shortcut, icon: Icon }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setShapesOpen(false);
              onTool(id);
            }}
            title={`${label} (${shortcut})`}
            aria-label={label}
            aria-pressed={active}
            className={`group relative flex size-8 xs:size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl transition-all ${
              active
                ? "bg-gradient-to-b from-indigo-500/90 to-violet-600/90 text-white shadow-lg shadow-indigo-950/50"
                : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 active:bg-zinc-800"
            }`}
          >
            <Icon className="size-4 xs:size-[17px] sm:size-[18px]" />
            <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-white/[0.08] bg-zinc-900/95 px-2.5 py-1 text-xs text-zinc-200 shadow-xl lg:group-hover:block z-50">
              {label}
              <kbd className="ml-2 rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400">
                {shortcut}
              </kbd>
            </span>
          </button>
        );
      })}

      {/* Shapes flyout */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setShapesOpen((v) => !v)}
          title="Shapes"
          aria-label="Shapes"
          aria-expanded={shapesOpen}
          className={`flex size-8 xs:size-9 sm:size-10 items-center justify-center rounded-xl transition-all ${
            shapesOpen
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 active:bg-zinc-800"
          }`}
        >
          <Shapes className="size-4 xs:size-[17px] sm:size-[18px]" />
        </button>
        {shapesOpen && (
          <div className="absolute bottom-full lg:bottom-auto left-1/2 lg:left-full lg:top-0 -translate-x-1/2 lg:translate-x-0 mb-2.5 lg:mb-0 lg:ml-3 flex w-36 flex-col gap-0.5 rounded-xl border border-white/[0.08] bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/70 backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-150">
            {SHAPES.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAddShape(kind);
                  setShapesOpen(false);
                }}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:bg-indigo-500/15 hover:text-indigo-200 active:bg-indigo-500/25"
              >
                <Icon className="size-4 text-zinc-500" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onUpload}
        title="Add images"
        aria-label="Add images"
        className="group relative flex size-8 xs:size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-all hover:bg-zinc-800/80 hover:text-zinc-100 active:bg-zinc-800"
      >
        <ImagePlus className="size-4 xs:size-[17px] sm:size-[18px]" />
        <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-white/[0.08] bg-zinc-900/95 px-2.5 py-1 text-xs text-zinc-200 shadow-xl lg:group-hover:block z-50">
          Add images
        </span>
      </button>

      {/* Mobile/Tablet dock divider & panel toggles */}
      {(onToggleProperties || onToggleLayers || onOpenAgent) && (
        <div className="lg:hidden flex items-center gap-0.5 sm:gap-1">
          <div className="mx-0.5 h-5 sm:h-6 w-px bg-white/[0.08]" aria-hidden />

          {onToggleProperties && (
            <button
              type="button"
              onClick={onToggleProperties}
              title="Properties & Style"
              aria-label="Properties & Style"
              className={`relative flex size-8 xs:size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl transition-all ${
                activePanel === "properties"
                  ? "bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-500/50"
                  : hasSelection
                    ? "text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20"
                    : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
              }`}
            >
              <SlidersHorizontal className="size-4 xs:size-[17px] sm:size-[18px]" />
              {hasSelection && activePanel !== "properties" && (
                <span className="absolute top-1 right-1 sm:top-1.5 sm:right-1.5 size-1.5 rounded-full bg-indigo-400 animate-pulse" />
              )}
            </button>
          )}

          {onToggleLayers && (
            <button
              type="button"
              onClick={onToggleLayers}
              title="Layers"
              aria-label="Layers"
              className={`relative flex size-8 xs:size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl transition-all ${
                activePanel === "layers"
                  ? "bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-500/50"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
              }`}
            >
              <Layers className="size-4 xs:size-[17px] sm:size-[18px]" />
              {typeof layersCount === "number" && layersCount > 0 && (
                <span className="absolute -top-1 -right-1 flex size-3.5 sm:size-4 items-center justify-center rounded-full bg-indigo-500 text-[8px] sm:text-[9px] font-bold text-white shadow-sm">
                  {layersCount}
                </span>
              )}
            </button>
          )}

          {onOpenAgent && (
            <button
              type="button"
              onClick={onOpenAgent}
              title="Pixora Pro Agent"
              aria-label="Pixora Pro Agent"
              className={`flex size-8 xs:size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl transition-all ${
                agentBusy
                  ? "bg-indigo-500/30 text-indigo-200 animate-pulse"
                  : "text-indigo-400 hover:bg-zinc-800/80 hover:text-indigo-300"
              }`}
            >
              <Sparkles className="size-4 xs:size-[17px] sm:size-[18px]" />
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

