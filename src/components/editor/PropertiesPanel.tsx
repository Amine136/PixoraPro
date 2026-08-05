"use client";

import { useEffect, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Ban,
  Crop,
  Eraser,
  Frame,
  Group as GroupIcon,
  Laugh,
  Loader2,
  Paintbrush,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Ungroup,
} from "lucide-react";
import {
  FONT_FAMILIES,
  type BrushSettings,
  type BrushType,
  type ImageAdjustments,
  type SelectionInfo,
  type Tool,
} from "@/lib/editor/types";

interface PropertiesPanelProps {
  tool: Tool;
  selection: SelectionInfo;
  brush: BrushSettings;
  artboardBg: string | null;
  eraserSize: number;
  onEraserSize: (n: number) => void;
  onBrush: (patch: Partial<BrushSettings>) => void;
  onArtboardBg: (color: string | null) => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onAdjust: (patch: Partial<ImageAdjustments>) => void;
  onMemePreset: () => void;
  onRemoveBackground: (mode?: "auto" | "ai") => void;
  cropping: boolean;
  onCropStart: () => void;
  onCropApply: () => void;
  onCropCancel: () => void;
  bgRemoving: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="w-16 shrink-0 text-[11px] font-medium text-zinc-500">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

function Header({
  icon: Icon,
  title,
  badge,
}: {
  icon: typeof Frame;
  title: string;
  badge?: string;
}) {
  return (
    <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
      <Icon className="size-4 text-indigo-400" />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        {title}
      </h2>
      {badge && (
        <span className="ml-auto rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          {badge}
        </span>
      )}
    </header>
  );
}

function AdjustmentSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <Row label={label}>
      <input
        type="range"
        min={-100}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onDoubleClick={() => onChange(0)}
        className="pixora-range w-full"
        aria-label={label}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-zinc-400">
        {pct > 0 ? `+${pct}` : pct}
      </span>
    </Row>
  );
}

const glass =
  "rounded-2xl border border-white/[0.08] bg-zinc-900/60 shadow-2xl shadow-black/40 backdrop-blur-xl";

const BRUSH_TYPES: { id: BrushType; label: string }[] = [
  { id: "pencil", label: "Solid" },
  { id: "circle", label: "Soft" },
  { id: "spray", label: "Spray" },
];

export function PropertiesPanel({
  tool,
  selection,
  brush,
  artboardBg,
  eraserSize,
  onEraserSize,
  onBrush,
  onArtboardBg,
  onUpdate,
  onAdjust,
  onMemePreset,
  onRemoveBackground,
  cropping,
  onCropStart,
  onCropApply,
  onCropCancel,
  bgRemoving,
  onGroup,
  onUngroup,
  onDelete,
}: PropertiesPanelProps) {
  const { text, image, shape } = selection;
  const [tab, setTab] = useState<"style" | "adjust">("style");
  useEffect(() => {
    if (!image) setTab("style");
  }, [image]);

  /* --- Interactive crop mode (modal: trumps every other panel) --- */
  if (cropping) {
    return (
      <section className={glass}>
        <Header icon={Crop} title="Crop" />
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Drag the handles to choose what to keep — the dimmed area gets cut
            away. Drag inside the frame to move it.
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onCropCancel}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Cancel
              <kbd className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-500">
                Esc
              </kbd>
            </button>
            <button
              type="button"
              onClick={onCropApply}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-500/80 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              Apply
              <kbd className="rounded bg-indigo-400/30 px-1 font-mono text-[10px] text-indigo-100">
                ↵
              </kbd>
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* --- Eraser settings (eraser tool active; selection stays live) --- */
  if (tool === "eraser") {
    const imageSelected = selection.count === 1 && selection.kind === "image";
    return (
      <section className={glass}>
        <Header icon={Eraser} title="Eraser" />
        <div className="flex flex-col gap-3 p-4">
          <Row label="Size">
            <input
              type="range"
              min={4}
              max={200}
              value={eraserSize}
              onChange={(e) => onEraserSize(Number(e.target.value))}
              className="pixora-range w-full"
              aria-label="Eraser size"
            />
            <span className="w-9 shrink-0 text-right font-mono text-[11px] text-zinc-400">
              {eraserSize}px
            </span>
          </Row>
          <p
            className={`text-[11px] leading-relaxed ${
              imageSelected ? "text-zinc-600" : "text-amber-400/90"
            }`}
          >
            {imageSelected
              ? "Drag over the selected image to erase its pixels to transparent."
              : "Select an image first (press V, click the image, then E) — the eraser works on the selected image."}
          </p>
        </div>
      </section>
    );
  }

  /* --- Brush settings (brush tool active, nothing selected) --- */
  if (selection.count === 0 && tool === "brush") {
    return (
      <section className={glass}>
        <Header icon={Paintbrush} title="Brush" />
        <div className="flex flex-col gap-3 p-4">
          <Row label="Type">
            <div className="flex w-full overflow-hidden rounded-lg border border-white/[0.08]">
              {BRUSH_TYPES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={brush.type === id}
                  onClick={() => onBrush({ type: id })}
                  className={`h-8 flex-1 text-[11px] font-medium transition-colors ${
                    brush.type === id
                      ? "bg-indigo-500/25 text-indigo-300"
                      : "bg-zinc-950/60 text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Color">
            <span className="font-mono text-[11px] text-zinc-500">
              {brush.color}
            </span>
            <input
              type="color"
              value={brush.color}
              onChange={(e) => onBrush({ color: e.target.value })}
              className="pixora-swatch"
              aria-label="Brush color"
            />
          </Row>
          <Row label="Size">
            <input
              type="range"
              min={1}
              max={100}
              value={brush.size}
              onChange={(e) => onBrush({ size: Number(e.target.value) })}
              className="pixora-range w-full"
              aria-label="Brush size"
            />
            <span className="w-9 shrink-0 text-right font-mono text-[11px] text-zinc-400">
              {brush.size}px
            </span>
          </Row>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Draw directly on the canvas. Each stroke becomes its own layer.
          </p>
        </div>
      </section>
    );
  }

  /* --- Canvas settings (nothing selected) --- */
  if (selection.count === 0) {
    return (
      <section className={glass}>
        <Header icon={Frame} title="Canvas" />
        <div className="flex flex-col gap-3 p-4">
          <Row label="Background">
            <span className="font-mono text-[11px] text-zinc-500">
              {artboardBg ?? "transparent"}
            </span>
            <input
              type="color"
              value={artboardBg ?? "#ffffff"}
              onChange={(e) => onArtboardBg(e.target.value)}
              className="pixora-swatch"
              aria-label="Background color"
            />
          </Row>
          <button
            type="button"
            onClick={() => onArtboardBg(artboardBg === null ? "#ffffff" : null)}
            aria-pressed={artboardBg === null}
            className={`flex h-9 items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors ${
              artboardBg === null
                ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
                : "border-white/[0.08] bg-zinc-950/40 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
            }`}
          >
            <Ban className="size-3.5" />
            {artboardBg === null
              ? "Transparent background on"
              : "Use transparent background"}
          </button>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            The background color fills the artboard and is included in the
            exported PNG. Transparent exports keep the alpha channel.
          </p>
        </div>
      </section>
    );
  }

  /* --- Object properties --- */
  const showAdjust = image !== null && tab === "adjust";

  return (
    <section className={glass}>
      <Header
        icon={SlidersHorizontal}
        title="Properties"
        badge={
          selection.count === 1
            ? (selection.kind ?? undefined)
            : `${selection.count} selected`
        }
      />

      {image && (
        <div className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
          {(
            [
              ["style", "Style"],
              ["adjust", "Adjustments"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`h-7 flex-1 rounded-lg text-[11px] font-semibold transition-colors ${
                tab === id
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {showAdjust && image ? (
        <div className="flex flex-col gap-3 p-4">
          <AdjustmentSlider
            label="Brightness"
            value={image.brightness}
            onChange={(v) => onAdjust({ brightness: v })}
          />
          <AdjustmentSlider
            label="Contrast"
            value={image.contrast}
            onChange={(v) => onAdjust({ contrast: v })}
          />
          <AdjustmentSlider
            label="Saturation"
            value={image.saturation}
            onChange={(v) => onAdjust({ saturation: v })}
          />
          <button
            type="button"
            onClick={() =>
              onAdjust({ brightness: 0, contrast: 0, saturation: 0 })
            }
            disabled={
              image.brightness === 0 &&
              image.contrast === 0 &&
              image.saturation === 0
            }
            className="mt-1 flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/40 text-xs font-medium text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" />
            Reset adjustments
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <Row label="Opacity">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(selection.opacity * 100)}
              onChange={(e) =>
                onUpdate({ opacity: Number(e.target.value) / 100 })
              }
              className="pixora-range w-full"
              aria-label="Opacity"
            />
            <span className="w-9 shrink-0 text-right font-mono text-[11px] text-zinc-400">
              {Math.round(selection.opacity * 100)}%
            </span>
          </Row>

          {image && selection.count === 1 && (
            <div className="mt-1 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => onRemoveBackground("auto")}
                disabled={bgRemoving}
                className="flex h-9 items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:pointer-events-none disabled:opacity-60"
              >
                {bgRemoving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Scissors className="size-4" />
                )}
                {bgRemoving ? "Working…" : "Remove background"}
              </button>
              <button
                type="button"
                onClick={() => onRemoveBackground("ai")}
                disabled={bgRemoving}
                title="AI subject detection — removes any background, even complex ones. Slower."
                className="flex h-8 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/40 text-[11px] font-medium text-zinc-400 transition-colors hover:border-indigo-500/40 hover:text-indigo-300 disabled:pointer-events-none disabled:opacity-60"
              >
                <Sparkles className="size-3.5" />
                Cut out subject (AI)
              </button>
              <button
                type="button"
                onClick={onCropStart}
                className="flex h-8 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/40 text-[11px] font-medium text-zinc-400 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
              >
                <Crop className="size-3.5" />
                Crop
              </button>
            </div>
          )}

          {shape && (
            <>
              <div className="my-1 h-px bg-white/[0.06]" aria-hidden />
              <Row label="Fill">
                <span className="font-mono text-[11px] text-zinc-500">
                  {shape.fill || "none"}
                </span>
                <input
                  type="color"
                  value={shape.fill || "#6366f1"}
                  onChange={(e) => onUpdate({ fill: e.target.value })}
                  className="pixora-swatch"
                  aria-label="Fill color"
                />
              </Row>
              <Row label="Stroke">
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={shape.strokeWidth}
                  onChange={(e) =>
                    onUpdate({
                      strokeWidth: Number(e.target.value),
                      ...(shape.stroke ? {} : { stroke: "#c7d2fe" }),
                    })
                  }
                  className="pixora-range w-full"
                  aria-label="Stroke width"
                />
                <input
                  type="color"
                  value={shape.stroke || "#c7d2fe"}
                  onChange={(e) => onUpdate({ stroke: e.target.value })}
                  className="pixora-swatch shrink-0"
                  aria-label="Stroke color"
                />
              </Row>
            </>
          )}

          {text && (
            <>
              <div className="my-1 h-px bg-white/[0.06]" aria-hidden />

              <Row label="Font">
                <select
                  value={text.fontFamily}
                  onChange={(e) => onUpdate({ fontFamily: e.target.value })}
                  className="h-8 w-full rounded-lg border border-white/[0.08] bg-zinc-950/60 px-2 text-xs text-zinc-300 outline-none transition-colors hover:border-white/20 focus-visible:border-indigo-500"
                  aria-label="Font family"
                >
                  {!FONT_FAMILIES.includes(text.fontFamily) && (
                    <option value={text.fontFamily}>{text.fontFamily}</option>
                  )}
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>
                      {f}
                    </option>
                  ))}
                </select>
              </Row>

              <Row label="Size">
                <input
                  type="range"
                  min={8}
                  max={300}
                  value={text.fontSize}
                  onChange={(e) =>
                    onUpdate({ fontSize: Number(e.target.value) })
                  }
                  className="pixora-range w-full"
                  aria-label="Font size"
                />
                <input
                  type="number"
                  min={8}
                  max={999}
                  value={text.fontSize}
                  onChange={(e) =>
                    onUpdate({ fontSize: Math.max(1, Number(e.target.value)) })
                  }
                  className="h-8 w-14 shrink-0 rounded-lg border border-white/[0.08] bg-zinc-950/60 px-2 text-right font-mono text-xs text-zinc-300 outline-none focus-visible:border-indigo-500"
                  aria-label="Font size value"
                />
              </Row>

              <Row label="Align">
                <div className="flex overflow-hidden rounded-lg border border-white/[0.08]">
                  {(
                    [
                      ["left", AlignLeft],
                      ["center", AlignCenter],
                      ["right", AlignRight],
                    ] as const
                  ).map(([align, Icon]) => (
                    <button
                      key={align}
                      type="button"
                      title={`Align ${align}`}
                      aria-pressed={text.textAlign === align}
                      onClick={() => onUpdate({ textAlign: align })}
                      className={`flex h-8 w-9 items-center justify-center transition-colors ${
                        text.textAlign === align
                          ? "bg-indigo-500/25 text-indigo-300"
                          : "bg-zinc-950/60 text-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              </Row>

              <Row label="Fill">
                <span className="font-mono text-[11px] text-zinc-500">
                  {text.fill}
                </span>
                <input
                  type="color"
                  value={text.fill}
                  onChange={(e) => onUpdate({ fill: e.target.value })}
                  className="pixora-swatch"
                  aria-label="Fill color"
                />
              </Row>

              <Row label="Outline">
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={text.strokeWidth}
                  onChange={(e) =>
                    onUpdate({
                      strokeWidth: Number(e.target.value),
                      paintFirst: "stroke",
                    })
                  }
                  className="pixora-range w-full"
                  aria-label="Outline width"
                />
                <input
                  type="color"
                  value={text.stroke || "#000000"}
                  onChange={(e) =>
                    onUpdate({ stroke: e.target.value, paintFirst: "stroke" })
                  }
                  className="pixora-swatch shrink-0"
                  aria-label="Outline color"
                />
              </Row>

              <button
                type="button"
                onClick={onMemePreset}
                className="mt-1 flex h-9 items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20"
              >
                <Laugh className="size-4" />
                Meme preset
              </button>
            </>
          )}

          {selection.count > 1 && (
            <button
              type="button"
              onClick={onGroup}
              className="flex h-9 items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20"
            >
              <GroupIcon className="size-4" />
              Group selection
              <kbd className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-500">
                Ctrl+G
              </kbd>
            </button>
          )}

          {selection.isGroup && (
            <button
              type="button"
              onClick={onUngroup}
              className="flex h-9 items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20"
            >
              <Ungroup className="size-4" />
              Ungroup
              <kbd className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-500">
                Ctrl+Shift+G
              </kbd>
            </button>
          )}

          <button
            type="button"
            onClick={onDelete}
            className="flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/40 text-xs font-medium text-zinc-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="size-3.5" />
            Delete{" "}
            {selection.count > 1 ? `${selection.count} objects` : "object"}
          </button>
        </div>
      )}
    </section>
  );
}
