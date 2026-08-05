"use client";

import { useState } from "react";
import {
  Eye,
  EyeOff,
  GripVertical,
  Group as GroupIcon,
  Image as ImageIcon,
  Layers,
  Paintbrush,
  Shapes,
  Trash2,
  Type,
} from "lucide-react";
import type { LayerItem, LayerKind } from "@/lib/editor/types";

interface LayersPanelProps {
  layers: LayerItem[];
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}

const KIND_ICON: Record<LayerKind, typeof ImageIcon> = {
  image: ImageIcon,
  text: Type,
  shape: Shapes,
  path: Paintbrush,
  group: GroupIcon,
};

export function LayersPanel({
  layers,
  onSelect,
  onToggleVisibility,
  onDelete,
  onReorder,
}: LayersPanelProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/[0.08] bg-zinc-900/60 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <Layers className="size-4 text-indigo-400" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Layers
        </h2>
        <span className="ml-auto rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          {layers.length}
        </span>
      </header>

      {layers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Layers className="size-6 text-zinc-700" />
          <p className="text-xs leading-relaxed text-zinc-500">
            No layers yet. Drop an image on the canvas or press{" "}
            <kbd className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400">
              T
            </kbd>{" "}
            to add text.
          </p>
        </div>
      ) : (
        <ul className="pixora-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {layers.map((layer, i) => (
            <li
              key={layer.id}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverIdx(i);
              }}
              onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null) onReorder(dragIdx, i);
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              onClick={() => onSelect(layer.id)}
              className={`group flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 transition-colors ${
                layer.selected
                  ? "bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/40"
                  : "hover:bg-zinc-800/60"
              } ${overIdx === i && dragIdx !== null && dragIdx !== i ? "outline outline-1 outline-dashed outline-indigo-400/70" : ""} ${
                dragIdx === i ? "opacity-40" : ""
              }`}
            >
              <GripVertical className="size-3.5 shrink-0 cursor-grab text-zinc-600 group-hover:text-zinc-500" />
              {layer.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={layer.thumb}
                  alt=""
                  draggable={false}
                  className={`h-7 w-10 shrink-0 rounded-md object-cover ring-1 ring-inset ${
                    layer.selected ? "ring-indigo-500/60" : "ring-white/10"
                  }`}
                />
              ) : (
                (() => {
                  const Icon = KIND_ICON[layer.kind];
                  return (
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                        layer.selected
                          ? "bg-indigo-500/20 text-indigo-300"
                          : "bg-zinc-800/80 text-zinc-400"
                      }`}
                    >
                      <Icon className="size-3.5" />
                    </span>
                  );
                })()
              )}
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  layer.visible ? "text-zinc-200" : "text-zinc-600 line-through"
                }`}
              >
                {layer.name}
              </span>
              <button
                type="button"
                title={layer.visible ? "Hide layer" : "Show layer"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                className={`flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-zinc-700/70 ${
                  layer.visible
                    ? "text-zinc-500 opacity-0 group-hover:opacity-100"
                    : "text-zinc-500"
                } hover:text-zinc-200`}
              >
                {layer.visible ? (
                  <Eye className="size-3.5" />
                ) : (
                  <EyeOff className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                title="Delete layer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(layer.id);
                }}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-500 opacity-0 transition-colors hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
