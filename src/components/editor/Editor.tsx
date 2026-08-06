"use client";

import { useEffect, useState } from "react";
import { ImagePlus, Maximize, Minus, Plus } from "lucide-react";
import { useEditor } from "@/lib/editor/useEditor";
import { TopBar } from "./TopBar";
import { ToolRail } from "./ToolRail";
import { LayersPanel } from "./LayersPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { AgentPanel } from "./AgentPanel";

export default function Editor() {
  const editor = useEditor();
  const [dropping, setDropping] = useState(false);

  // Dev-only handle so the agent's canvas tools can be driven from a browser
  // harness (or the console) without spending a model call — see the C2b eval
  // case. The NODE_ENV check strips it from production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as { __pixora?: unknown }).__pixora = editor;
  }, [editor]);

  return (
    <div
      className="relative h-dvh w-full select-none overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        editor.handleDrop(e);
      }}
    >
      {/* Infinite workspace — Fabric mounts its canvas inside this element */}
      <div ref={editor.containerRef} className="pixora-workspace absolute inset-0" />

      {/* Depth vignette (separate element: JS drives the grid's background props) */}
      <div className="pixora-vignette pointer-events-none absolute inset-0" aria-hidden />

      {/* Smart-guide lines, positioned imperatively while dragging */}
      <div
        ref={editor.guideVRef}
        data-guide="v"
        className="pointer-events-none absolute inset-y-0 z-20 hidden w-px bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.9)]"
      />
      <div
        ref={editor.guideHRef}
        data-guide="h"
        className="pointer-events-none absolute inset-x-0 z-20 hidden h-px bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.9)]"
      />

      {/* Hidden file input for the upload tool */}
      <input
        ref={editor.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void editor.addImageFiles(files);
          e.target.value = "";
        }}
      />

      <TopBar
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        preset={editor.preset}
        onUndo={() => void editor.undo()}
        onRedo={() => void editor.redo()}
        onPreset={editor.applyPreset}
        onCustomSize={editor.applyCustomSize}
        onExport={editor.exportPNG}
      />

      <ToolRail
        tool={editor.tool}
        onTool={editor.setTool}
        onAddShape={editor.addShape}
        onUpload={editor.openImagePicker}
      />

      {/* Right column: properties (when something is selected) + layers */}
      <aside className="pointer-events-none absolute bottom-4 right-4 top-[88px] z-30 flex w-72 flex-col gap-3 [&>*]:pointer-events-auto">
        <PropertiesPanel
          tool={editor.tool}
          selection={editor.selection}
          brush={editor.brush}
          artboardBg={editor.artboardBg}
          eraserSize={editor.eraserSize}
          onEraserSize={editor.setEraserSize}
          onBrush={editor.setBrush}
          onArtboardBg={editor.setArtboardBg}
          onUpdate={editor.updateSelected}
          onAdjust={editor.updateImageAdjustments}
          onMemePreset={editor.applyMemePreset}
          onRemoveBackground={editor.removeSelectedBackground}
          cropping={editor.cropping}
          onCropStart={editor.startCropMode}
          onCropApply={editor.applyCropMode}
          onCropCancel={editor.cancelCropMode}
          bgRemoving={editor.bgRemoving}
          onGroup={editor.groupSelected}
          onUngroup={editor.ungroupSelected}
          onDuplicate={editor.duplicateSelected}
          onDelete={editor.deleteSelected}
        />
        <LayersPanel
          layers={editor.layers}
          onSelect={editor.selectLayer}
          onToggleVisibility={editor.toggleLayerVisibility}
          onDuplicate={editor.duplicateSelected}
          onDelete={editor.deleteLayer}
          onReorder={editor.reorderLayer}
        />
      </aside>

      {/* AI assistant chat */}
      <AgentPanel editor={editor} />

      {/* Zoom pill */}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-white/[0.08] bg-zinc-900/60 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => editor.zoomBy(1 / 1.2)}
          title="Zoom out"
          className="flex size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-12 text-center font-mono text-[11px] text-zinc-400">
          {editor.zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => editor.zoomBy(1.2)}
          title="Zoom in"
          className="flex size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100"
        >
          <Plus className="size-3.5" />
        </button>
        <div className="mx-0.5 h-4 w-px bg-white/[0.08]" aria-hidden />
        <button
          type="button"
          onClick={editor.fitToArtboard}
          title="Fit artboard"
          className="flex size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100"
        >
          <Maximize className="size-3.5" />
        </button>
      </div>

      {/* Empty-state hint */}
      {editor.ready && editor.layers.length === 0 && editor.tool !== "brush" && (
        <div className="pointer-events-none absolute bottom-12 left-[88px] right-[320px] top-24 z-20 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/[0.08] bg-zinc-950/85 px-12 py-9 text-center shadow-2xl shadow-black/50 backdrop-blur-md">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/25 to-violet-600/25 text-indigo-300 ring-1 ring-inset ring-indigo-400/20">
              <ImagePlus className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-zinc-100">
                Drop images anywhere to start
              </p>
              <p className="text-xs text-zinc-400">
                Paste from clipboard, or press{" "}
                <kbd className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  T
                </kbd>{" "}
                to add text
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Drop-target overlay */}
      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-indigo-500/5">
          <div className="absolute inset-3 rounded-3xl border-2 border-dashed border-indigo-400/70" />
          <p className="rounded-xl bg-zinc-900/90 px-5 py-2.5 text-sm font-medium text-indigo-200 shadow-2xl">
            Release to add images
          </p>
        </div>
      )}
    </div>
  );
}
