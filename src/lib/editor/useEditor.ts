"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActiveSelection,
  Canvas,
  CircleBrush,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  IText,
  InteractiveFabricObject,
  Path,
  PencilBrush,
  Point,
  Polygon,
  Rect,
  Shadow,
  SprayBrush,
  filters,
  util,
} from "fabric";
import { toast } from "sonner";
import {
  ARTBOARD_PRESETS,
  type ArtboardPreset,
  type BrushSettings,
  type ImageAdjustments,
  type LayerItem,
  type LayerKind,
  type SelectionInfo,
  type ShapeKind,
  type Tool,
} from "./types";

const ARTBOARD_ID = "__artboard__";
const ARTBOARD_PLACEHOLDER_FILL = "#13131c";
const EXTRA_PROPS = ["id", "name", "selectable", "evented", "bgTransparent"];
const MAX_HISTORY = 50;
const GRID_BASE = 24;

type Meta = { id?: string; name?: string; bgTransparent?: boolean };
const meta = (o: FabricObject) => o as FabricObject & Meta;
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/* Selection chrome: white circular handles with an indigo ring */
InteractiveFabricObject.ownDefaults = {
  ...InteractiveFabricObject.ownDefaults,
  cornerStyle: "circle",
  cornerColor: "#ffffff",
  cornerStrokeColor: "#6366f1",
  cornerSize: 10,
  touchCornerSize: 24,
  transparentCorners: false,
  borderColor: "#818cf8",
  borderScaleFactor: 1.6,
  borderOpacityWhenMoving: 0.5,
  padding: 0,
};

function kindOf(obj: FabricObject): LayerKind {
  if (obj instanceof FabricImage) return "image";
  if (obj instanceof IText) return "text";
  // Spray-brush strokes are Groups; show them as brush paths, not groups
  if (meta(obj).name === "Brush stroke") return "path";
  if (obj instanceof Group) return "group";
  if (obj instanceof Path) return "path";
  return "shape";
}

function defaultNameFor(obj: FabricObject): string {
  if (obj instanceof FabricImage) return "Image";
  if (obj instanceof IText) return "Text";
  if (obj instanceof Group) return "Group";
  if (obj instanceof Path) return "Path";
  if (obj instanceof Ellipse) return "Ellipse";
  if (obj instanceof Polygon) return "Polygon";
  if (obj instanceof Rect) return "Rectangle";
  return "Shape";
}

function layerName(obj: FabricObject): string {
  const m = meta(obj);
  if (obj instanceof IText) {
    const t = (obj.text ?? "").trim().replace(/\s+/g, " ");
    return t.length > 0 ? (t.length > 24 ? t.slice(0, 24) + "…" : t) : "Text";
  }
  return m.name || defaultNameFor(obj);
}

const THUMB_W = 64;
const THUMB_H = 44;

function makeThumb(img: FabricImage): string | undefined {
  const el = img.getElement() as HTMLImageElement | HTMLCanvasElement;
  const sw = "naturalWidth" in el ? el.naturalWidth : el.width;
  const sh = "naturalHeight" in el ? el.naturalHeight : el.height;
  if (!sw || !sh) return undefined;
  const c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = THUMB_H;
  const ctx = c.getContext("2d");
  if (!ctx) return undefined;
  // cover-fit crop
  const scale = Math.max(THUMB_W / sw, THUMB_H / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(el, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
  return c.toDataURL("image/png");
}

function readAdjustments(img: FabricImage): ImageAdjustments {
  let brightness = 0;
  let contrast = 0;
  let saturation = 0;
  for (const f of img.filters ?? []) {
    if (f instanceof filters.Brightness) brightness = f.brightness;
    else if (f instanceof filters.Contrast) contrast = f.contrast;
    else if (f instanceof filters.Saturation) saturation = f.saturation;
  }
  return { brightness, contrast, saturation };
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const artboardRef = useRef<Rect | null>(null);

  const toolRef = useRef<Tool>("select");
  const spaceRef = useRef(false);
  const restoringRef = useRef(false);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbCacheRef = useRef<Map<string, string>>(new Map());

  const [ready, setReady] = useState(false);
  const [tool, setToolState] = useState<Tool>("select");
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [selection, setSelection] = useState<SelectionInfo>({
    count: 0,
    kind: null,
    opacity: 1,
    text: null,
    image: null,
    shape: null,
    isGroup: false,
  });
  const [zoomPct, setZoomPct] = useState(100);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [preset, setPreset] = useState<ArtboardPreset>(ARTBOARD_PRESETS[0]);
  const presetRef = useRef(preset);
  presetRef.current = preset;

  const [brush, setBrushState] = useState<BrushSettings>({
    type: "pencil",
    color: "#818cf8",
    size: 14,
  });
  const brushRef = useRef(brush);
  brushRef.current = brush;

  const [artboardBg, setArtboardBgState] = useState<string | null>("#ffffff");
  const artboardBgRef = useRef(artboardBg);
  artboardBgRef.current = artboardBg;

  const [eraserSize, setEraserSizeState] = useState(40);
  const eraserSizeRef = useRef(eraserSize);
  eraserSizeRef.current = eraserSize;
  const setEraserSize = useCallback((n: number) => {
    eraserSizeRef.current = n;
    setEraserSizeState(n);
  }, []);

  // Smart-guide lines (DOM overlays owned by the Editor component)
  const guideVRef = useRef<HTMLDivElement | null>(null);
  const guideHRef = useRef<HTMLDivElement | null>(null);

  /* ---------- helpers that read the live canvas ---------- */

  const sceneObjects = useCallback((c: Canvas) => {
    return c.getObjects().filter((o) => meta(o).id !== ARTBOARD_ID);
  }, []);

  const refreshLayers = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const active = new Set(c.getActiveObjects());
    const cache = thumbCacheRef.current;
    const liveIds = new Set<string>();
    const items: LayerItem[] = sceneObjects(c)
      .slice()
      .reverse()
      .map((o) => {
        const id = meta(o).id ?? "";
        liveIds.add(id);
        let thumb: string | undefined;
        if (o instanceof FabricImage) {
          thumb = cache.get(id);
          if (!thumb) {
            thumb = makeThumb(o);
            if (thumb) cache.set(id, thumb);
          }
        }
        return {
          id,
          name: layerName(o),
          kind: kindOf(o),
          visible: o.visible !== false,
          selected: active.has(o),
          thumb,
        };
      });
    for (const id of cache.keys()) {
      if (!liveIds.has(id)) cache.delete(id);
    }
    setLayers(items);
  }, [sceneObjects]);

  const refreshSelection = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const objs = c.getActiveObjects();
    if (objs.length === 0) {
      setSelection({
        count: 0,
        kind: null,
        opacity: 1,
        text: null,
        image: null,
        shape: null,
        isGroup: false,
      });
      return;
    }
    const kinds = new Set(objs.map(kindOf));
    const kind = kinds.size === 1 ? [...kinds][0] : ("mixed" as const);
    const first = objs[0];
    let text: SelectionInfo["text"] = null;
    if (objs.length === 1 && first instanceof IText) {
      text = {
        fontFamily: String(first.fontFamily ?? "Arial"),
        fontSize: Number(first.fontSize ?? 64),
        textAlign: (first.textAlign as "left" | "center" | "right") ?? "left",
        fill: typeof first.fill === "string" ? first.fill : "#ffffff",
        stroke: typeof first.stroke === "string" ? first.stroke : "#000000",
        strokeWidth: Number(first.strokeWidth ?? 0),
      };
    }
    const image =
      objs.length === 1 && first instanceof FabricImage
        ? readAdjustments(first)
        : null;
    const shape =
      objs.length === 1 &&
      !(first instanceof FabricImage) &&
      !(first instanceof IText) &&
      !(first instanceof Group)
        ? {
            fill: typeof first.fill === "string" ? first.fill : "",
            stroke: typeof first.stroke === "string" ? first.stroke : "",
            strokeWidth: Number(first.strokeWidth ?? 0),
          }
        : null;
    setSelection({
      count: objs.length,
      kind,
      opacity: Number(first.opacity ?? 1),
      text,
      image,
      shape,
      isGroup: objs.length === 1 && first instanceof Group,
    });
  }, []);

  const syncGrid = useCallback(() => {
    const c = canvasRef.current;
    const el = containerRef.current;
    if (!c || !el) return;
    const vt = c.viewportTransform;
    const z = c.getZoom();
    let spacing = GRID_BASE * z;
    while (spacing < 12) spacing *= 2;
    while (spacing > 96) spacing /= 2;
    el.style.backgroundSize = `${spacing}px ${spacing}px`;
    el.style.backgroundPosition = `${vt[4]}px ${vt[5]}px`;
    setZoomPct(Math.round(z * 100));
  }, []);

  /* ---------- history ---------- */

  const snapshot = useCallback((c: Canvas) => {
    return JSON.stringify(c.toObject(EXTRA_PROPS));
  }, []);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 1);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const saveState = useCallback(() => {
    const c = canvasRef.current;
    if (!c || restoringRef.current) return;
    redoStackRef.current = [];
    undoStackRef.current.push(snapshot(c));
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.shift();
    }
    syncHistoryFlags();
  }, [snapshot, syncHistoryFlags]);

  /* Coalesces rapid-fire changes (e.g. dragging a color picker) into one undo step */
  const saveStateDebounced = useCallback(() => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      historyTimerRef.current = null;
      saveState();
    }, 400);
  }, [saveState]);

  const loadState = useCallback(
    async (json: string) => {
      const c = canvasRef.current;
      if (!c) return;
      // A pending debounced save would snapshot mid-load state
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      restoringRef.current = true;
      try {
        await c.loadFromJSON(JSON.parse(json));
        // Restored objects are new instances; cached previews may be stale
        thumbCacheRef.current.clear();
        const ab = c
          .getObjects()
          .find((o) => meta(o).id === ARTBOARD_ID) as Rect | undefined;
        if (ab) {
          ab.set({ selectable: false, evented: false });
          c.sendObjectToBack(ab);
          artboardRef.current = ab;
          const transparent = !!meta(ab).bgTransparent;
          const bg = transparent
            ? null
            : typeof ab.fill === "string"
              ? ab.fill
              : "#ffffff";
          setArtboardBgState(bg);
          artboardBgRef.current = bg;
          const w = ab.width!;
          const h = ab.height!;
          setPreset(
            ARTBOARD_PRESETS.find((p) => p.width === w && p.height === h) ?? {
              label: `Custom · ${w} × ${h}`,
              width: w,
              height: h,
            },
          );
        }
        c.discardActiveObject();
        c.requestRenderAll();
      } finally {
        restoringRef.current = false;
      }
      refreshLayers();
      refreshSelection();
    },
    [refreshLayers, refreshSelection],
  );

  const undo = useCallback(async () => {
    // A load is already in flight — dropping the call avoids concurrent
    // loadFromJSON races that corrupt the stack.
    if (restoringRef.current) return;
    if (undoStackRef.current.length <= 1) return;
    const current = undoStackRef.current.pop()!;
    redoStackRef.current.push(current);
    await loadState(undoStackRef.current[undoStackRef.current.length - 1]);
    syncHistoryFlags();
  }, [loadState, syncHistoryFlags]);

  const redo = useCallback(async () => {
    if (restoringRef.current) return;
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(next);
    await loadState(next);
    syncHistoryFlags();
  }, [loadState, syncHistoryFlags]);

  /* ---------- viewport ---------- */

  const fitToArtboard = useCallback(() => {
    const c = canvasRef.current;
    const ab = artboardRef.current;
    const el = containerRef.current;
    if (!c || !ab || !el) return;
    // Visible region between the floating tool rail / right panel / top bar
    const padL = 88;
    const padR = 320;
    const padT = 96;
    const padB = 48;
    const vw = Math.max(200, el.clientWidth - padL - padR);
    const vh = Math.max(200, el.clientHeight - padT - padB);
    const z = Math.min(vw / ab.width!, vh / ab.height!, 1.5) * 0.92;
    const tx = padL + (vw - ab.width! * z) / 2;
    const ty = padT + (vh - ab.height! * z) / 2;
    c.setViewportTransform([z, 0, 0, z, tx, ty]);
    c.requestRenderAll();
    syncGrid();
  }, [syncGrid]);

  const zoomBy = useCallback(
    (factor: number) => {
      const c = canvasRef.current;
      const el = containerRef.current;
      if (!c || !el) return;
      const z = Math.min(8, Math.max(0.05, c.getZoom() * factor));
      c.zoomToPoint(new Point(el.clientWidth / 2, el.clientHeight / 2), z);
      c.requestRenderAll();
      syncGrid();
    },
    [syncGrid],
  );

  /* ---------- tools ---------- */

  const applyBrush = useCallback((c: Canvas) => {
    const { type, color, size } = brushRef.current;
    const Brush =
      type === "spray" ? SprayBrush : type === "circle" ? CircleBrush : PencilBrush;
    const b = new Brush(c);
    b.color = color;
    b.width = size;
    c.freeDrawingBrush = b;
  }, []);

  const setBrush = useCallback(
    (patch: Partial<BrushSettings>) => {
      const next = { ...brushRef.current, ...patch };
      brushRef.current = next;
      setBrushState(next);
      const c = canvasRef.current;
      if (c && c.isDrawingMode) applyBrush(c);
    },
    [applyBrush],
  );

  const setTool = useCallback(
    (t: Tool) => {
      toolRef.current = t;
      setToolState(t);
      const c = canvasRef.current;
      if (!c) return;
      // The eraser operates on the current selection — keep it
      if (t !== "select" && t !== "eraser") c.discardActiveObject();
      c.skipTargetFind = t !== "select";
      c.selection = t === "select";
      c.isDrawingMode = t === "brush";
      if (t === "brush") applyBrush(c);
      c.defaultCursor =
        t === "pan"
          ? "grab"
          : t === "text" || t === "brush" || t === "eraser"
            ? "crosshair"
            : "default";
      c.setCursor(c.defaultCursor);
      c.requestRenderAll();
    },
    [applyBrush],
  );

  /* ---------- object creation ---------- */

  const addTextAt = useCallback((p: { x: number; y: number }) => {
    const c = canvasRef.current;
    if (!c) return;
    const text = new IText("Your text", {
      left: p.x,
      top: p.y,
      originX: "center",
      originY: "center",
      fontFamily: "Arial",
      fontSize: 72,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: 0,
      paintFirst: "stroke",
    });
    const m = meta(text);
    m.id = uid();
    m.name = "Text";
    c.add(text);
    c.setActiveObject(text);
    c.requestRenderAll();
  }, []);

  const addText = useCallback(() => {
    const ab = artboardRef.current;
    const cx = ab ? ab.left! + ab.width! / 2 : 0;
    const cy = ab ? ab.top! + ab.height! / 2 : 0;
    addTextAt({ x: cx, y: cy });
  }, [addTextAt]);

  const addShape = useCallback(
    (kind: ShapeKind) => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return;
      const base = {
        left: ab.left! + ab.width! / 2,
        top: ab.top! + ab.height! / 2,
        originX: "center" as const,
        originY: "center" as const,
        fill: "#6366f1",
        stroke: "#c7d2fe",
        strokeWidth: 0,
        strokeUniform: true,
      };
      let shape: FabricObject;
      if (kind === "ellipse") {
        shape = new Ellipse({ ...base, rx: 180, ry: 130 });
        meta(shape).name = "Ellipse";
      } else if (kind === "arrow") {
        shape = new Polygon(
          [
            { x: 0, y: 40 },
            { x: 110, y: 40 },
            { x: 110, y: 8 },
            { x: 200, y: 60 },
            { x: 110, y: 112 },
            { x: 110, y: 80 },
            { x: 0, y: 80 },
          ],
          base,
        );
        meta(shape).name = "Arrow";
      } else {
        shape = new Rect({ ...base, width: 360, height: 260 });
        meta(shape).name = "Rectangle";
      }
      meta(shape).id = uid();
      setTool("select");
      c.add(shape);
      c.setActiveObject(shape);
      c.requestRenderAll();
    },
    [setTool],
  );

  const groupSelected = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const objs = c.getActiveObjects();
    if (objs.length < 2) return;
    // Discarding restores absolute coordinates before regrouping
    c.discardActiveObject();
    restoringRef.current = true;
    let group: Group;
    try {
      objs.forEach((o) => c.remove(o));
      group = new Group(objs);
      meta(group).id = uid();
      meta(group).name = "Group";
      c.add(group);
    } finally {
      restoringRef.current = false;
    }
    c.setActiveObject(group);
    c.requestRenderAll();
    saveState();
    refreshLayers();
    refreshSelection();
    toast.success(`Grouped ${objs.length} objects`);
  }, [saveState, refreshLayers, refreshSelection]);

  const ungroupSelected = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const active = c.getActiveObject();
    if (!(active instanceof Group) || active instanceof ActiveSelection) return;
    c.discardActiveObject();
    restoringRef.current = true;
    let children: FabricObject[];
    try {
      c.remove(active);
      // removeAll() restores the children's absolute coordinates
      children = active.removeAll();
      children.forEach((o) => {
        if (!meta(o).id) meta(o).id = uid();
        c.add(o);
      });
    } finally {
      restoringRef.current = false;
    }
    c.setActiveObject(new ActiveSelection(children, { canvas: c }));
    c.requestRenderAll();
    saveState();
    refreshLayers();
    refreshSelection();
    toast.success("Ungrouped");
  }, [saveState, refreshLayers, refreshSelection]);

  const setArtboardBg = useCallback(
    (color: string | null) => {
      setArtboardBgState(color);
      artboardBgRef.current = color;
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return;
      ab.set({ fill: color ?? ARTBOARD_PLACEHOLDER_FILL });
      meta(ab).bgTransparent = color === null;
      c.requestRenderAll();
      // Color-picker drags fire rapidly; the toggle is a single action
      if (color === null) saveState();
      else saveStateDebounced();
    },
    [saveState, saveStateDebounced],
  );

  const addImageFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return;
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;

      const center = at ?? {
        x: ab.left! + ab.width! / 2,
        y: ab.top! + ab.height! / 2,
      };
      let added = 0;
      for (const file of images) {
        try {
          const url = await readFileAsDataURL(file);
          const img = await FabricImage.fromURL(url);
          const maxDim = Math.min(ab.width!, ab.height!) * 0.85;
          const scale = Math.min(
            1,
            maxDim / (img.width ?? 1),
            maxDim / (img.height ?? 1),
          );
          img.set({
            left: center.x + added * 32,
            top: center.y + added * 32,
            originX: "center",
            originY: "center",
            scaleX: scale,
            scaleY: scale,
          });
          const m = meta(img);
          m.id = uid();
          m.name = file.name.replace(/\.[a-z0-9]+$/i, "") || "Image";
          c.add(img);
          c.setActiveObject(img);
          added++;
        } catch {
          toast.error(`Couldn't read ${file.name}`);
        }
      }
      if (added > 0) {
        c.requestRenderAll();
        toast.success(added === 1 ? "Image added" : `${added} images added`);
      }
    },
    [],
  );

  const openImagePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /* ---------- selection / layer operations ---------- */

  const deleteSelected = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const objs = c.getActiveObjects();
    if (objs.length === 0) return;
    c.discardActiveObject();
    // Batch removals into a single undo step
    restoringRef.current = true;
    try {
      objs.forEach((o) => c.remove(o));
    } finally {
      restoringRef.current = false;
    }
    c.requestRenderAll();
    saveState();
    refreshLayers();
    refreshSelection();
  }, [saveState, refreshLayers, refreshSelection]);

  const duplicateSelected = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return;
    const objs = c.getActiveObjects();
    if (objs.length === 0) return;
    // Discarding first restores absolute coordinates on selection members
    c.discardActiveObject();
    const clones = await Promise.all(objs.map((o) => o.clone(EXTRA_PROPS)));
    // Batch adds into a single undo step
    restoringRef.current = true;
    try {
      clones.forEach((clone) => {
        clone.set({
          left: (clone.left ?? 0) + 20,
          top: (clone.top ?? 0) + 20,
        });
        clone.setCoords();
        const m = meta(clone);
        m.id = uid();
        c.add(clone);
      });
    } finally {
      restoringRef.current = false;
    }
    if (clones.length === 1) {
      c.setActiveObject(clones[0]);
    } else {
      c.setActiveObject(new ActiveSelection(clones, { canvas: c }));
    }
    c.requestRenderAll();
    saveState();
    refreshLayers();
    refreshSelection();
    toast.success(
      clones.length === 1 ? "Duplicated" : `Duplicated ${clones.length} objects`,
    );
  }, [saveState, refreshLayers, refreshSelection]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const c = canvasRef.current;
      if (!c) return false;
      const active = c.getActiveObject();
      if (!active) return false;
      active.set({
        left: (active.left ?? 0) + dx,
        top: (active.top ?? 0) + dy,
      });
      active.setCoords();
      c.requestRenderAll();
      saveStateDebounced();
      return true;
    },
    [saveStateDebounced],
  );

  const updateImageAdjustments = useCallback(
    (patch: Partial<ImageAdjustments>) => {
      const c = canvasRef.current;
      if (!c) return;
      const obj = c.getActiveObject();
      if (!(obj instanceof FabricImage)) return;
      const next = { ...readAdjustments(obj), ...patch };
      const list = [];
      if (next.brightness !== 0)
        list.push(new filters.Brightness({ brightness: next.brightness }));
      if (next.contrast !== 0)
        list.push(new filters.Contrast({ contrast: next.contrast }));
      if (next.saturation !== 0)
        list.push(new filters.Saturation({ saturation: next.saturation }));
      obj.filters = list;
      obj.applyFilters();
      c.requestRenderAll();
      const id = meta(obj).id;
      if (id) thumbCacheRef.current.delete(id);
      refreshSelection();
      refreshLayers();
      saveStateDebounced();
    },
    [refreshSelection, refreshLayers, saveStateDebounced],
  );

  const selectLayer = useCallback(
    (id: string, additive = false) => {
      const c = canvasRef.current;
      if (!c) return;
      const obj = sceneObjects(c).find((o) => meta(o).id === id);
      if (!obj) return;
      if (toolRef.current !== "select") setTool("select");
      if (additive) {
        const current = c.getActiveObjects();
        if (current.includes(obj)) return;
      }
      c.setActiveObject(obj);
      c.requestRenderAll();
      refreshLayers();
      refreshSelection();
    },
    [sceneObjects, setTool, refreshLayers, refreshSelection],
  );

  const toggleLayerVisibility = useCallback(
    (id: string) => {
      const c = canvasRef.current;
      if (!c) return;
      const obj = sceneObjects(c).find((o) => meta(o).id === id);
      if (!obj) return;
      obj.visible = obj.visible === false;
      if (!obj.visible && c.getActiveObjects().includes(obj)) {
        c.discardActiveObject();
      }
      c.requestRenderAll();
      saveState();
      refreshLayers();
    },
    [sceneObjects, saveState, refreshLayers],
  );

  const deleteLayer = useCallback(
    (id: string) => {
      const c = canvasRef.current;
      if (!c) return;
      const obj = sceneObjects(c).find((o) => meta(o).id === id);
      if (!obj) return;
      if (c.getActiveObjects().includes(obj)) c.discardActiveObject();
      c.remove(obj);
      c.requestRenderAll();
    },
    [sceneObjects],
  );

  /* Panel index 0 = topmost object. Artboard is pinned at stack index 0. */
  const reorderLayer = useCallback(
    (fromPanelIdx: number, toPanelIdx: number) => {
      const c = canvasRef.current;
      if (!c || fromPanelIdx === toPanelIdx) return;
      const topFirst = sceneObjects(c).slice().reverse();
      if (
        fromPanelIdx < 0 ||
        fromPanelIdx >= topFirst.length ||
        toPanelIdx < 0 ||
        toPanelIdx >= topFirst.length
      )
        return;
      const [moved] = topFirst.splice(fromPanelIdx, 1);
      topFirst.splice(toPanelIdx, 0, moved);
      const bottomFirst = topFirst.reverse();
      bottomFirst.forEach((o, i) => c.moveObjectTo(o, i + 1));
      const ab = artboardRef.current;
      if (ab) c.sendObjectToBack(ab);
      c.requestRenderAll();
      saveState();
      refreshLayers();
    },
    [sceneObjects, saveState, refreshLayers],
  );

  /* ---------- property editing ---------- */

  const updateSelected = useCallback(
    (patch: Record<string, unknown>) => {
      const c = canvasRef.current;
      if (!c) return;
      const objs = c.getActiveObjects();
      if (objs.length === 0) return;
      objs.forEach((o) => o.set(patch));
      c.requestRenderAll();
      refreshSelection();
      refreshLayers();
      saveStateDebounced();
    },
    [refreshSelection, refreshLayers, saveStateDebounced],
  );

  const applyMemePreset = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const obj = c.getActiveObject();
    if (!(obj instanceof IText)) return;
    obj.set({
      fontFamily: "Impact",
      fontWeight: 900,
      fill: "#ffffff",
      stroke: "#000000",
      strokeWidth: Math.max(2, Math.round((obj.fontSize ?? 72) / 12)),
      paintFirst: "stroke",
      textAlign: "center",
    });
    c.requestRenderAll();
    refreshSelection();
    saveState();
    toast.success("Meme style applied");
  }, [refreshSelection, saveState]);

  /* ---------- artboard & export ---------- */

  const applyPreset = useCallback(
    (p: ArtboardPreset) => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return;
      setPreset(p);
      ab.set({ width: p.width, height: p.height });
      ab.setCoords();
      c.requestRenderAll();
      saveState();
      fitToArtboard();
    },
    [saveState, fitToArtboard],
  );

  const applyCustomSize = useCallback(
    (w: number, h: number) => {
      const width = Math.round(Math.min(8192, Math.max(16, w || 0)));
      const height = Math.round(Math.min(8192, Math.max(16, h || 0)));
      const match = ARTBOARD_PRESETS.find(
        (p) => p.width === width && p.height === height,
      );
      applyPreset(
        match ?? { label: `Custom · ${width} × ${height}`, width, height },
      );
    },
    [applyPreset],
  );

  const exportPNG = useCallback(() => {
    const c = canvasRef.current;
    const ab = artboardRef.current;
    if (!c || !ab) return;
    c.discardActiveObject();
    c.requestRenderAll();
    const vt = [...c.viewportTransform] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const shadow = ab.shadow;
    const stroke = ab.stroke;
    const visible = ab.visible;
    ab.shadow = null;
    ab.stroke = null;
    // Transparent background: exclude the artboard entirely from the export
    if (artboardBgRef.current === null) ab.visible = false;
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);
    try {
      const url = c.toDataURL({
        format: "png",
        left: ab.left,
        top: ab.top,
        width: ab.width,
        height: ab.height,
        multiplier: 2,
        enableRetinaScaling: false,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = "pixora-export.png";
      a.click();
      toast.success("Exported pixora-export.png (2× resolution)");
    } finally {
      ab.shadow = shadow;
      ab.stroke = stroke;
      ab.visible = visible;
      c.setViewportTransform(vt);
      c.requestRenderAll();
    }
  }, []);

  /* ---------- init ---------- */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Fabric mutates the element it mounts on; create a fresh one per mount so
    // React StrictMode's double-invoke never re-initializes the same node.
    const el = document.createElement("canvas");
    container.appendChild(el);
    const canvas = new Canvas(el, {
      width: container.clientWidth,
      height: container.clientHeight,
      preserveObjectStacking: true,
      selection: true,
      uniformScaling: true,
      backgroundColor: "",
    });
    canvasRef.current = canvas;

    const p = presetRef.current;
    const artboard = new Rect({
      left: 0,
      top: 0,
      // Fabric v7 defaults origin to center; the artboard must span (0,0)→(w,h)
      originX: "left",
      originY: "top",
      width: p.width,
      height: p.height,
      fill: artboardBgRef.current ?? ARTBOARD_PLACEHOLDER_FILL,
      stroke: "rgba(99, 102, 241, 0.5)",
      strokeWidth: 1,
      strokeUniform: true,
      selectable: false,
      evented: false,
      shadow: new Shadow({
        color: "rgba(99, 102, 241, 0.35)",
        blur: 80,
        offsetX: 0,
        offsetY: 0,
      }),
    });
    meta(artboard).id = ARTBOARD_ID;
    meta(artboard).name = "Artboard";
    canvas.add(artboard);
    artboardRef.current = artboard;

    /* --- smart guides: snap dragged objects to the artboard center --- */
    const hideGuides = () => {
      if (guideVRef.current) guideVRef.current.style.display = "none";
      if (guideHRef.current) guideHRef.current.style.display = "none";
    };

    canvas.on("object:moving", (e) => {
      const obj = e.target;
      const ab = artboardRef.current;
      if (!obj || !ab) return;
      const tol = 5 / canvas.getZoom();
      const abCx = ab.left! + ab.width! / 2;
      const abCy = ab.top! + ab.height! / 2;
      const ctr = obj.getCenterPoint();
      const snapX = Math.abs(ctr.x - abCx) <= tol;
      const snapY = Math.abs(ctr.y - abCy) <= tol;
      if (snapX || snapY) {
        obj.setPositionByOrigin(
          new Point(snapX ? abCx : ctr.x, snapY ? abCy : ctr.y),
          "center",
          "center",
        );
        obj.setCoords();
      }
      const vt = canvas.viewportTransform;
      if (guideVRef.current) {
        guideVRef.current.style.display = snapX ? "block" : "none";
        guideVRef.current.style.left = `${vt[4] + abCx * vt[0]}px`;
      }
      if (guideHRef.current) {
        guideHRef.current.style.display = snapY ? "block" : "none";
        guideHRef.current.style.top = `${vt[5] + abCy * vt[3]}px`;
      }
    });
    canvas.on("object:modified", hideGuides);

    /* --- eraser: destination-out strokes baked into the image source --- */
    let erasing = false;
    let eraseImg: FabricImage | null = null;
    let erasePreview: HTMLCanvasElement | null = null;
    let eraseSource: HTMLCanvasElement | null = null;
    let erasePrev: Point | null = null;

    const copyToCanvas = (el: HTMLImageElement | HTMLCanvasElement) => {
      const w = "naturalWidth" in el ? el.naturalWidth : el.width;
      const h = "naturalHeight" in el ? el.naturalHeight : el.height;
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      cv.getContext("2d")!.drawImage(el, 0, 0);
      return cv;
    };

    const eraseLocalPoint = (scene: Point) => {
      const img = eraseImg!;
      const local = util.transformPoint(
        scene,
        util.invertTransform(img.calcTransformMatrix()),
      );
      return new Point(local.x + img.width! / 2, local.y + img.height! / 2);
    };

    const eraseSegment = (from: Point | null, to: Point) => {
      const img = eraseImg!;
      const scaling = img.getObjectScaling();
      const lw =
        eraserSizeRef.current /
        Math.max(0.01, (Math.abs(scaling.x) + Math.abs(scaling.y)) / 2);
      for (const cv of new Set([erasePreview!, eraseSource!])) {
        const ctx = cv.getContext("2d")!;
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = lw;
        ctx.fillStyle = ctx.strokeStyle = "#000";
        ctx.beginPath();
        if (from && (from.x !== to.x || from.y !== to.y)) {
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        } else {
          ctx.arc(to.x, to.y, lw / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    };

    /* --- pointer interactions: pan / text placement / erasing --- */
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    // Erasing must begin in mouse:down:before — with skipTargetFind on,
    // fabric's own mousedown logic discards the active object before the
    // regular mouse:down event fires.
    canvas.on("mouse:down:before", (opt) => {
      if (toolRef.current !== "eraser") return;
      const active = canvas.getActiveObject();
      if (!(active instanceof FabricImage)) {
        toast.info("Select an image with the Select tool, then erase");
        return;
      }
      erasing = true;
      eraseImg = active;
      // Live preview erases the (possibly filtered) visible pixels; the
      // final result is baked from the unfiltered source so adjustments
      // stay non-destructive.
      const el = active.getElement() as HTMLImageElement | HTMLCanvasElement;
      erasePreview = copyToCanvas(el);
      const orig = (
        active as unknown as {
          _originalElement?: HTMLImageElement | HTMLCanvasElement;
        }
      )._originalElement;
      eraseSource = orig && orig !== el ? copyToCanvas(orig) : erasePreview;
      active.setElement(erasePreview);
      const p = eraseLocalPoint(canvas.getScenePoint(opt.e));
      eraseSegment(null, p);
      erasePrev = p;
      active.dirty = true;
      canvas.requestRenderAll();
    });

    canvas.on("mouse:down", (opt) => {
      const e = opt.e as MouseEvent;
      if (erasing && eraseImg) {
        // Fabric just cleared the selection (no target found); keep the
        // image selected so consecutive strokes work.
        canvas.setActiveObject(eraseImg);
        return;
      }
      const wantsPan =
        toolRef.current === "pan" || spaceRef.current || e.button === 1;
      if (wantsPan) {
        panning = true;
        canvas.selection = false;
        canvas.setCursor("grabbing");
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (toolRef.current === "text" && !opt.target) {
        const scene = canvas.getScenePoint(opt.e);
        addTextAt(scene);
        setTool("select");
      }
    });

    canvas.on("mouse:move", (opt) => {
      if (erasing && eraseImg) {
        const p = eraseLocalPoint(canvas.getScenePoint(opt.e));
        eraseSegment(erasePrev, p);
        erasePrev = p;
        eraseImg.dirty = true;
        canvas.requestRenderAll();
        return;
      }
      if (!panning) return;
      const e = opt.e as MouseEvent;
      canvas.relativePan(new Point(e.clientX - lastX, e.clientY - lastY));
      lastX = e.clientX;
      lastY = e.clientY;
      syncGrid();
    });

    canvas.on("mouse:up", () => {
      hideGuides();
      if (erasing && eraseImg && eraseSource) {
        erasing = false;
        const img = eraseImg;
        const src = eraseSource.toDataURL();
        eraseImg = null;
        erasePreview = null;
        eraseSource = null;
        erasePrev = null;
        void img.setSrc(src).then(() => {
          img.applyFilters();
          img.dirty = true;
          const id = meta(img).id;
          if (id) thumbCacheRef.current.delete(id);
          canvas.requestRenderAll();
          saveState();
          refreshLayers();
          refreshSelection();
        });
        return;
      }
      if (!panning) return;
      panning = false;
      canvas.selection = toolRef.current === "select";
      canvas.setCursor(canvas.defaultCursor);
    });

    /* --- wheel: scroll pans, ctrl/cmd+wheel (and pinch) zooms --- */
    canvas.on("mouse:wheel", (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const z = Math.min(8, Math.max(0.05, canvas.getZoom() * 0.999 ** e.deltaY));
        canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), z);
      } else {
        const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        canvas.relativePan(new Point(-dx, -dy));
      }
      canvas.requestRenderAll();
      syncGrid();
    });

    /* --- state / history events --- */
    const onMutate = () => {
      if (restoringRef.current) return;
      saveState();
      refreshLayers();
      refreshSelection();
    };
    canvas.on("object:added", (e) => {
      const t = e.target;
      if (meta(t).id === ARTBOARD_ID) return;
      // Objects created inside fabric (e.g. brush strokes) arrive without
      // metadata; assign it before the state snapshot is taken.
      if (!meta(t).id) meta(t).id = uid();
      if (!meta(t).name) {
        meta(t).name = canvas.isDrawingMode ? "Brush stroke" : defaultNameFor(t);
      }
      onMutate();
    });
    canvas.on("object:removed", (e) => {
      if (meta(e.target).id === ARTBOARD_ID) return;
      onMutate();
    });
    canvas.on("object:modified", onMutate);
    canvas.on("text:editing:exited", onMutate);
    canvas.on("text:changed", refreshLayers);

    const onSelection = () => {
      refreshLayers();
      refreshSelection();
    };
    canvas.on("selection:created", onSelection);
    canvas.on("selection:updated", onSelection);
    canvas.on("selection:cleared", onSelection);

    /* --- keyboard --- */
    // Text-entry fields swallow every shortcut; other form controls (range
    // sliders, selects, buttons) only swallow the non-modifier keys they use.
    const isTypingTarget = (t: EventTarget | null) => {
      const n = t as HTMLElement | null;
      if (!n) return false;
      // Selects included: they type-ahead on letter keys
      if (
        n.tagName === "TEXTAREA" ||
        n.tagName === "SELECT" ||
        n.isContentEditable
      )
        return true;
      if (n.tagName === "INPUT") {
        const type = (n as HTMLInputElement).type;
        return !["range", "color", "checkbox", "radio", "button"].includes(type);
      }
      return false;
    };
    const isFormControl = (t: EventTarget | null) => {
      const n = t as HTMLElement | null;
      return (
        !!n && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(n.tagName)
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const active = canvas.getActiveObject();
      if (active instanceof IText && active.isEditing) return;

      const mod = e.ctrlKey || e.metaKey;
      // Arrows/space/enter belong to the focused control (slider steps,
      // button activation); letter shortcuts can safely pass through
      if (
        !mod &&
        (e.key.startsWith("Arrow") || e.key === " " || e.key === "Enter") &&
        isFormControl(e.target)
      )
        return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy =
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (nudgeSelected(dx, dy)) e.preventDefault();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === " ") {
        if (!spaceRef.current) {
          spaceRef.current = true;
          canvas.setCursor("grab");
        }
        e.preventDefault();
        return;
      }
      if (!mod) {
        if (e.key.toLowerCase() === "v") setTool("select");
        if (e.key.toLowerCase() === "h") setTool("pan");
        if (e.key.toLowerCase() === "t") setTool("text");
        if (e.key.toLowerCase() === "b") setTool("brush");
        if (e.key.toLowerCase() === "e") setTool("eraser");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        spaceRef.current = false;
        canvas.setCursor(canvas.defaultCursor);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    /* --- paste images from clipboard --- */
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const active = canvas.getActiveObject();
      if (active instanceof IText && active.isEditing) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length > 0) {
        e.preventDefault();
        void addImageFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);

    /* --- keep canvas sized to its container --- */
    const ro = new ResizeObserver(() => {
      canvas.setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
      canvas.requestRenderAll();
    });
    ro.observe(container);

    /* --- initial view & history baseline --- */
    undoStackRef.current = [JSON.stringify(canvas.toObject(EXTRA_PROPS))];
    redoStackRef.current = [];
    syncHistoryFlags();
    // fit after refs are set
    requestAnimationFrame(() => {
      fitToArtboard();
    });
    setReady(true);

    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
      canvasRef.current = null;
      artboardRef.current = null;
      void canvas.dispose().then(() => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- drag & drop from the OS ---------- */

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const c = canvasRef.current;
      const container = containerRef.current;
      if (!c || !container) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const rect = container.getBoundingClientRect();
      const scene = util.transformPoint(
        new Point(e.clientX - rect.left, e.clientY - rect.top),
        util.invertTransform(c.viewportTransform),
      );
      void addImageFiles(files, { x: scene.x, y: scene.y });
    },
    [addImageFiles],
  );

  return {
    containerRef,
    fileInputRef,
    guideVRef,
    guideHRef,
    eraserSize,
    setEraserSize,
    ready,
    tool,
    setTool,
    layers,
    selection,
    zoomPct,
    canUndo,
    canRedo,
    preset,
    applyPreset,
    applyCustomSize,
    undo,
    redo,
    zoomBy,
    fitToArtboard,
    addText,
    addShape,
    addImageFiles,
    openImagePicker,
    brush,
    setBrush,
    artboardBg,
    setArtboardBg,
    groupSelected,
    ungroupSelected,
    deleteSelected,
    duplicateSelected,
    nudgeSelected,
    updateImageAdjustments,
    selectLayer,
    toggleLayerVisibility,
    deleteLayer,
    reorderLayer,
    updateSelected,
    applyMemePreset,
    exportPNG,
    handleDrop,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;
