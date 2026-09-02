"use client";

import { useEffect, useState } from "react";
import {
  ImagePlus,
  Layers,
  Maximize,
  Minus,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEditor } from "@/lib/editor/useEditor";
import { useAiSettings } from "@/lib/agent/settings";
import { TopBar } from "./TopBar";
import { ToolRail } from "./ToolRail";
import { LayersPanel } from "./LayersPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { AgentPanel } from "./AgentPanel";
import { AiSettingsModal } from "./AiSettingsModal";

export default function Editor() {
  const editor = useEditor();
  const [dropping, setDropping] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"properties" | "layers" | null>(
    null,
  );
  const [agentOpen, setAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { hasKey, loaded: settingsLoaded } = useAiSettings();
  const needsKey = settingsLoaded && !hasKey;

  // Dev-only handle so the agent's canvas tools can be driven from a browser
  // harness (or the console) without spending a model call — see the C2b eval
  // case. The NODE_ENV check strips it from production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as { __pixora?: unknown }).__pixora = editor;
  }, [editor]);

  // When selection changes on mobile/tablet and user selects something, switch tab
  useEffect(() => {
    if (editor.selection.count > 0 && mobilePanel === "layers") {
      // Keep layers open unless user desires
    }
  }, [editor.selection.count, mobilePanel]);

  const toggleMobilePanel = (tab: "properties" | "layers") => {
    setMobilePanel((prev) => (prev === tab ? null : tab));
  };

  const hasSelection = editor.selection.count > 0;

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
        needsKey={needsKey}
        onUndo={() => void editor.undo()}
        onRedo={() => void editor.redo()}
        onPreset={editor.applyPreset}
        onCustomSize={editor.applyCustomSize}
        onExport={editor.exportPNG}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <ToolRail
        tool={editor.tool}
        onTool={editor.setTool}
        onAddShape={editor.addShape}
        onUpload={editor.openImagePicker}
        layersCount={editor.layers.length}
        hasSelection={hasSelection}
        activePanel={mobilePanel}
        onToggleLayers={() => toggleMobilePanel("layers")}
        onToggleProperties={() => toggleMobilePanel("properties")}
        onOpenAgent={() => setAgentOpen(true)}
      />

      {/* Desktop Right column: properties + layers (>=1024px) */}
      <aside className="hidden lg:flex pointer-events-none absolute bottom-4 right-4 top-[88px] z-30 w-72 flex-col gap-3 [&>*]:pointer-events-auto">
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

      {/* Mobile/Tablet Drawer Backdrop */}
      {mobilePanel && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setMobilePanel(null)}
        />
      )}

      {/* Tablet & Mobile Slide-up Bottom Sheet / Slide-over Drawer (<1024px) */}
      {mobilePanel && (
        <div
          className="lg:hidden fixed inset-x-2 bottom-2 md:bottom-4 md:right-4 md:left-auto md:w-80 z-50 flex max-h-[82dvh] flex-col rounded-3xl border border-white/[0.1] bg-zinc-900/95 shadow-2xl shadow-black/70 backdrop-blur-2xl animate-in slide-in-from-bottom-6 duration-200"
          role="dialog"
          aria-modal="true"
        >
          {/* Drawer top bar: Tab Switcher + Close */}
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2.5">
            <div className="flex items-center gap-1 rounded-xl bg-zinc-950/70 p-1 border border-white/[0.06]">
              <button
                type="button"
                onClick={() => setMobilePanel("properties")}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  mobilePanel === "properties"
                    ? "bg-indigo-500/25 text-indigo-200 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <SlidersHorizontal className="size-3.5" />
                Properties
              </button>
              <button
                type="button"
                onClick={() => setMobilePanel("layers")}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  mobilePanel === "layers"
                    ? "bg-indigo-500/25 text-indigo-200 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Layers className="size-3.5" />
                Layers
                {editor.layers.length > 0 && (
                  <span className="rounded-md bg-zinc-800 px-1 py-0.2 font-mono text-[9px] text-zinc-400">
                    {editor.layers.length}
                  </span>
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setMobilePanel(null)}
              title="Close panel"
              className="flex size-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200 transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Drawer content */}
          <div className="min-h-0 flex-1 overflow-y-auto pixora-scroll p-1">
            {mobilePanel === "properties" ? (
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
                onClose={() => setMobilePanel(null)}
              />
            ) : (
              <LayersPanel
                layers={editor.layers}
                onSelect={(id) => {
                  editor.selectLayer(id);
                }}
                onToggleVisibility={editor.toggleLayerVisibility}
                onDuplicate={editor.duplicateSelected}
                onDelete={editor.deleteLayer}
                onReorder={editor.reorderLayer}
                onClose={() => setMobilePanel(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* Pixora Pro Agent chat */}
      <AgentPanel
        editor={editor}
        isOpen={agentOpen}
        onOpenChange={setAgentOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* AI settings modal */}
      <AiSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Zoom pill (responsive position: top-right on mobile/tablet, bottom-center on desktop) */}
      <div className="pointer-events-auto absolute top-16 sm:top-20 right-2 sm:right-4 lg:top-auto lg:right-auto lg:bottom-4 lg:left-1/2 lg:-translate-x-1/2 z-20 flex items-center gap-0.5 rounded-xl border border-white/[0.08] bg-zinc-900/70 p-1 shadow-xl shadow-black/40 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => editor.zoomBy(1 / 1.2)}
          title="Zoom out"
          aria-label="Zoom out"
          className="flex size-6 sm:size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 active:scale-95"
        >
          <Minus className="size-3 sm:size-3.5" />
        </button>
        <span className="w-10 sm:w-12 text-center font-mono text-[10px] sm:text-[11px] text-zinc-400">
          {editor.zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => editor.zoomBy(1.2)}
          title="Zoom in"
          aria-label="Zoom in"
          className="flex size-6 sm:size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 active:scale-95"
        >
          <Plus className="size-3 sm:size-3.5" />
        </button>
        <div className="mx-0.5 h-3.5 sm:h-4 w-px bg-white/[0.08]" aria-hidden />
        <button
          type="button"
          onClick={editor.fitToArtboard}
          title="Fit artboard"
          aria-label="Fit artboard"
          className="flex size-6 sm:size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 active:scale-95"
        >
          <Maximize className="size-3 sm:size-3.5" />
        </button>
      </div>

      {/* Empty-state hint */}
      {editor.ready && editor.layers.length === 0 && editor.tool !== "brush" && (
        <div className="pointer-events-none absolute inset-4 top-20 bottom-24 lg:left-[88px] lg:right-[320px] lg:top-24 lg:bottom-12 z-10 flex items-center justify-center">
          <div className="flex max-w-xs sm:max-w-sm flex-col items-center gap-3 sm:gap-4 rounded-3xl border border-white/[0.08] bg-zinc-950/85 px-6 sm:px-10 py-6 sm:py-8 text-center shadow-2xl shadow-black/50 backdrop-blur-md">
            <div className="flex size-11 sm:size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/25 to-violet-600/25 text-indigo-300 ring-1 ring-inset ring-indigo-400/20">
              <ImagePlus className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs sm:text-sm font-semibold text-zinc-100">
                Drop or upload images to start
              </p>
              <p className="text-[11px] sm:text-xs text-zinc-400">
                Tap <span className="text-indigo-300 font-medium">Add images</span>, paste, or select the{" "}
                <kbd className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  T
                </kbd>{" "}
                tool
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

