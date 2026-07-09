"use client";

import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Eraser,
  Hand,
  ImagePlus,
  MousePointer2,
  MoveRight,
  Paintbrush,
  Shapes,
  Square,
  Type,
} from "lucide-react";
import type { ShapeKind, Tool } from "@/lib/editor/types";

interface ToolRailProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  onAddShape: (kind: ShapeKind) => void;
  onUpload: () => void;
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

export function ToolRail({ tool, onTool, onAddShape, onUpload }: ToolRailProps) {
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
      className="pointer-events-auto absolute left-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-slate-800/60 bg-zinc-900/60 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
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
            aria-pressed={active}
            className={`group relative flex size-10 items-center justify-center rounded-xl transition-all ${
              active
                ? "bg-gradient-to-b from-indigo-500/90 to-violet-600/90 text-white shadow-lg shadow-indigo-950/50"
                : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
            }`}
          >
            <Icon className="size-[18px]" />
            <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-slate-800/60 bg-zinc-900/95 px-2.5 py-1 text-xs text-zinc-200 shadow-xl group-hover:block">
              {label}
              <kbd className="ml-2 rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400">
                {shortcut}
              </kbd>
            </span>
          </button>
        );
      })}

      {/* Shapes flyout */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setShapesOpen((v) => !v)}
          title="Shapes"
          aria-expanded={shapesOpen}
          className={`flex size-10 items-center justify-center rounded-xl transition-all ${
            shapesOpen
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
          }`}
        >
          <Shapes className="size-[18px]" />
        </button>
        {shapesOpen && (
          <div className="absolute left-full top-0 ml-3 flex w-36 flex-col gap-0.5 rounded-xl border border-slate-800/60 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
            {SHAPES.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onAddShape(kind);
                  setShapesOpen(false);
                }}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:bg-indigo-500/15 hover:text-indigo-200"
              >
                <Icon className="size-4 text-zinc-500" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto my-1 h-px w-6 bg-slate-800/70" aria-hidden />

      <button
        type="button"
        onClick={onUpload}
        title="Add images"
        className="group relative flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-all hover:bg-zinc-800/80 hover:text-zinc-100"
      >
        <ImagePlus className="size-[18px]" />
        <span className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-lg border border-slate-800/60 bg-zinc-900/95 px-2.5 py-1 text-xs text-zinc-200 shadow-xl group-hover:block">
          Add images
        </span>
      </button>
    </nav>
  );
}
