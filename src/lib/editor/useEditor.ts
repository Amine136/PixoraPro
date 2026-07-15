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
  type AgentAlignOptions,
  type AgentCanvasState,
  type AgentLayerPatch,
  type AgentLayerSnapshot,
  type AgentShapeOptions,
  type AgentTextOptions,
  type ArtboardPreset,
  type BrushSettings,
  type ImageAdjustments,
  type LayerItem,
  type LayerKind,
  type SelectionInfo,
  type ShapeKind,
  type Tool,
} from "./types";
import {
  computeDistribute,
  computeFit,
  computeGrid,
  type FitMode,
  type LayoutBox,
} from "./layout";

const ARTBOARD_ID = "__artboard__";
const ARTBOARD_PLACEHOLDER_FILL = "#13131c";
const EXTRA_PROPS = [
  "id",
  "name",
  "selectable",
  "evented",
  "bgTransparent",
  "direction",
];
const MAX_HISTORY = 50;
const GRID_BASE = 24;

/** Right-pointing arrow outline (points), shared by the user + agent creators. */
const ARROW_POINTS = [
  { x: 0, y: 40 },
  { x: 110, y: 40 },
  { x: 110, y: 8 },
  { x: 200, y: 60 },
  { x: 110, y: 112 },
  { x: 110, y: 80 },
  { x: 0, y: 80 },
];

/** `direction` lives on the artboard object as a document-level property. */
type Meta = {
  id?: string;
  name?: string;
  bgTransparent?: boolean;
  direction?: "ltr" | "rtl";
};
const meta = (o: FabricObject) => o as FabricObject & Meta;
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Fit an image into a box using native crop/scale (see computeFit). Reads the
 *  source element's natural size so repeated fits compose instead of shrinking.
 *  Keeps the image centered where it was. */
function applyFit(
  img: FabricImage,
  boxW: number,
  boxH: number,
  mode: FitMode,
) {
  const el = img.getElement() as HTMLImageElement & { width: number };
  const natW = el.naturalWidth || el.width || img.width!;
  const natH = el.naturalHeight || el.height || img.height!;
  const ctr = img.getCenterPoint();
  const f = computeFit(natW, natH, boxW, boxH, mode);
  img.set({
    cropX: f.cropX,
    cropY: f.cropY,
    width: f.width,
    height: f.height,
    scaleX: f.scaleX,
    scaleY: f.scaleY,
  });
  img.setPositionByOrigin(ctr, "center", "center");
  img.setCoords();
}

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
  const adj: ImageAdjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    blur: 0,
    grayscale: false,
    sepia: false,
    hueRotate: 0,
  };
  for (const f of img.filters ?? []) {
    if (f instanceof filters.Brightness) adj.brightness = f.brightness;
    else if (f instanceof filters.Contrast) adj.contrast = f.contrast;
    else if (f instanceof filters.Saturation) adj.saturation = f.saturation;
    else if (f instanceof filters.Blur) adj.blur = f.blur;
    else if (f instanceof filters.Grayscale) adj.grayscale = true;
    else if (f instanceof filters.Sepia) adj.sepia = true;
    else if (f instanceof filters.HueRotation) adj.hueRotate = f.rotation;
  }
  return adj;
}

/** Both adjustment paths (UI sliders and agent tool) rebuild the full filter
 *  list from one merged state so neither wipes the other's filters. */
function buildFilterList(next: ImageAdjustments) {
  const list = [];
  if (next.brightness !== 0)
    list.push(new filters.Brightness({ brightness: next.brightness }));
  if (next.contrast !== 0)
    list.push(new filters.Contrast({ contrast: next.contrast }));
  if (next.saturation !== 0)
    list.push(new filters.Saturation({ saturation: next.saturation }));
  if (next.blur !== 0) list.push(new filters.Blur({ blur: next.blur }));
  if (next.grayscale) list.push(new filters.Grayscale());
  if (next.sepia) list.push(new filters.Sepia());
  if (next.hueRotate !== 0)
    list.push(new filters.HueRotation({ rotation: next.hueRotate }));
  return list;
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
        shape = new Polygon(ARROW_POINTS, base);
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
      obj.filters = buildFilterList(next);
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

  /* ---------- agent API ----------
   * Operations the AI agent uses. They address layers by id (never the
   * user's active selection) and use artboard-relative coordinates where
   * x/y is the object's center. The artboard spans (0,0)→(w,h) in scene
   * space, so artboard coordinates equal scene coordinates. */

  const layerById = useCallback(
    (c: Canvas, id: string) => sceneObjects(c).find((o) => meta(o).id === id),
    [sceneObjects],
  );

  /** Resolve ids to their objects + axis-aligned boxes for the layout ops
   *  (distribute/grid). Fails on the first missing id. */
  const collectBoxes = useCallback(
    (
      c: Canvas,
      ids: string[],
    ):
      | { ok: true; objById: Map<string, FabricObject>; boxes: LayoutBox[] }
      | { ok: false; error: string } => {
      const objById = new Map<string, FabricObject>();
      const boxes: LayoutBox[] = [];
      for (const id of ids) {
        const o = layerById(c, id);
        if (!o) return { ok: false, error: `No layer with id "${id}"` };
        objById.set(id, o);
        const r = o.getBoundingRect();
        const ctr = o.getCenterPoint();
        boxes.push({ id, cx: ctr.x, cy: ctr.y, w: r.width, h: r.height });
      }
      return { ok: true, objById, boxes };
    },
    [layerById],
  );

  /** Move each resolved object to its computed center (shared apply step). */
  const applyCenters = useCallback(
    (
      objById: Map<string, FabricObject>,
      placements: { id: string; cx: number; cy: number }[],
    ) => {
      for (const p of placements) {
        const o = objById.get(p.id)!;
        o.setPositionByOrigin(new Point(p.cx, p.cy), "center", "center");
        o.setCoords();
      }
    },
    [],
  );

  /* One agent turn = one undo step: restoringRef suppresses the per-op
   * saveState calls fired by object:added/removed/modified; endAgentTurn
   * takes the single snapshot. Canvas input is blocked in the UI while a
   * turn is running, so user edits can't fall into the suppressed window. */
  const beginAgentTurn = useCallback(() => {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      saveState(); // flush a pending user edit into its own undo step first
    }
    restoringRef.current = true;
  }, [saveState]);

  const endAgentTurn = useCallback(
    (changed: boolean) => {
      // A debounce scheduled by a reused editor op mid-turn must not fire
      // after the turn — it would split the batch into two undo steps.
      if (historyTimerRef.current) {
        clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
      restoringRef.current = false;
      const c = canvasRef.current;
      if (!c) return;
      c.requestRenderAll();
      if (changed) saveState();
      refreshLayers();
      refreshSelection();
    },
    [saveState, refreshLayers, refreshSelection],
  );

  const agentGetState = useCallback((): AgentCanvasState | null => {
    const c = canvasRef.current;
    const ab = artboardRef.current;
    if (!c || !ab) return null;
    const r = (n: number) => Math.round(n * 10) / 10;
    const layers: AgentLayerSnapshot[] = sceneObjects(c)
      .slice()
      .reverse()
      .map((o) => {
        const ctr = o.getCenterPoint();
        const w = o.getScaledWidth();
        const h = o.getScaledHeight();
        const snap: AgentLayerSnapshot = {
          id: meta(o).id ?? "",
          name: layerName(o),
          kind: kindOf(o),
          visible: o.visible !== false,
          x: r(ctr.x),
          y: r(ctr.y),
          width: r(w),
          height: r(h),
          left: r(ctr.x - w / 2),
          top: r(ctr.y - h / 2),
          right: r(ctr.x + w / 2),
          bottom: r(ctr.y + h / 2),
          angle: r(o.angle ?? 0),
          opacity: Number(o.opacity ?? 1),
        };
        // Non-default extras only, to keep snapshots small
        if (o.flipX) snap.flipX = true;
        if (o.flipY) snap.flipY = true;
        if (o.shadow) {
          snap.shadow = {
            color: String(o.shadow.color ?? ""),
            blur: r(o.shadow.blur ?? 0),
            offsetX: r(o.shadow.offsetX ?? 0),
            offsetY: r(o.shadow.offsetY ?? 0),
          };
        }
        if (o instanceof IText) {
          snap.text = {
            content: o.text ?? "",
            fontFamily: String(o.fontFamily ?? "Arial"),
            fontSize: Number(o.fontSize ?? 64),
            textAlign: (o.textAlign as "left" | "center" | "right") ?? "left",
            fill: typeof o.fill === "string" ? o.fill : "#ffffff",
            stroke: typeof o.stroke === "string" ? o.stroke : "",
            strokeWidth: Number(o.strokeWidth ?? 0),
          };
          const weight = o.fontWeight;
          if (weight === "bold" || (typeof weight === "number" && weight >= 600))
            snap.text.fontWeight = "bold";
          if (o.fontStyle === "italic") snap.text.fontStyle = "italic";
          if (o.underline) snap.text.underline = true;
          if (o.linethrough) snap.text.linethrough = true;
          if (o.lineHeight !== undefined && Math.abs(o.lineHeight - 1.16) > 1e-3)
            snap.text.lineHeight = r(o.lineHeight);
          if (o.charSpacing) snap.text.charSpacing = r(o.charSpacing);
          if (o.textBackgroundColor)
            snap.text.textBackgroundColor = String(o.textBackgroundColor);
        } else if (o instanceof FabricImage) {
          snap.image = readAdjustments(o);
        } else if (!(o instanceof Group)) {
          snap.shape = {
            fill: typeof o.fill === "string" ? o.fill : "",
            stroke: typeof o.stroke === "string" ? o.stroke : "",
            strokeWidth: Number(o.strokeWidth ?? 0),
          };
          if (o instanceof Rect && o.rx)
            snap.shape.cornerRadius = r(o.rx * Math.abs(o.scaleX ?? 1));
        }
        return snap;
      });
    return {
      artboard: {
        width: ab.width!,
        height: ab.height!,
        background:
          artboardBgRef.current === null
            ? "transparent"
            : artboardBgRef.current,
        direction: meta(ab).direction ?? "ltr",
      },
      layers,
    };
  }, [sceneObjects]);

  const agentScreenshot = useCallback((maxDim = 768): string | null => {
    const c = canvasRef.current;
    const ab = artboardRef.current;
    if (!c || !ab) return null;
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
    ab.shadow = null;
    ab.stroke = null;
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);
    try {
      return c.toDataURL({
        format: "png",
        left: ab.left,
        top: ab.top,
        width: ab.width,
        height: ab.height,
        multiplier: Math.min(1, maxDim / Math.max(ab.width!, ab.height!)),
        enableRetinaScaling: false,
      });
    } finally {
      ab.shadow = shadow;
      ab.stroke = stroke;
      c.setViewportTransform(vt);
      c.requestRenderAll();
    }
  }, []);

  /** Eyedropper: exact rendered color at an artboard point. Lets the agent
   *  match backgrounds to images (baked-in image backgrounds rarely equal a
   *  guessed flat color) and check text contrast. */
  const agentSampleColor = useCallback(
    (x: number, y: number): { ok: boolean; color?: string; error?: string } => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return { ok: false, error: "Editor not ready" };
      if (x < 0 || y < 0 || x > ab.width! || y > ab.height!)
        return { ok: false, error: "Point is outside the artboard" };
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
      ab.shadow = null;
      ab.stroke = null;
      c.setViewportTransform([1, 0, 0, 1, 0, 0]);
      try {
        const el = c.toCanvasElement(1, {
          left: Math.min(Math.floor(x), ab.width! - 1),
          top: Math.min(Math.floor(y), ab.height! - 1),
          width: 1,
          height: 1,
        });
        const ctx = el.getContext("2d");
        if (!ctx) return { ok: false, error: "Could not sample" };
        const d = ctx.getImageData(0, 0, 1, 1).data;
        const hex = (n: number) => n.toString(16).padStart(2, "0");
        return { ok: true, color: `#${hex(d[0])}${hex(d[1])}${hex(d[2])}` };
      } finally {
        ab.shadow = shadow;
        ab.stroke = stroke;
        c.setViewportTransform(vt);
        c.requestRenderAll();
      }
    },
    [],
  );

  const agentApplyToLayer = useCallback(
    (id: string, patch: AgentLayerPatch): { ok: boolean; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (patch.cornerRadius !== undefined && !(obj instanceof Rect))
        return {
          ok: false,
          error: "cornerRadius only applies to rectangle layers",
        };

      if (patch.name !== undefined) meta(obj).name = patch.name;
      if (patch.angle !== undefined) obj.set({ angle: patch.angle });
      if (patch.opacity !== undefined)
        obj.set({ opacity: Math.min(1, Math.max(0, patch.opacity)) });
      if (patch.visible !== undefined) obj.set({ visible: patch.visible });
      if (patch.flipX !== undefined) obj.set({ flipX: patch.flipX });
      if (patch.flipY !== undefined) obj.set({ flipY: patch.flipY });
      if (patch.fill !== undefined) obj.set({ fill: patch.fill });
      if (patch.stroke !== undefined) obj.set({ stroke: patch.stroke });
      if (patch.strokeWidth !== undefined)
        obj.set({ strokeWidth: patch.strokeWidth });

      if (
        patch.shadowColor !== undefined ||
        patch.shadowBlur !== undefined ||
        patch.shadowOffsetX !== undefined ||
        patch.shadowOffsetY !== undefined
      ) {
        if (patch.shadowColor === "none") {
          obj.set({ shadow: null });
        } else {
          const prev = obj.shadow instanceof Shadow ? obj.shadow : null;
          obj.set({
            shadow: new Shadow({
              color: patch.shadowColor ?? prev?.color ?? "rgba(0,0,0,0.5)",
              blur: patch.shadowBlur ?? prev?.blur ?? 12,
              offsetX: patch.shadowOffsetX ?? prev?.offsetX ?? 0,
              offsetY: patch.shadowOffsetY ?? prev?.offsetY ?? 6,
            }),
          });
        }
      }

      if (obj instanceof IText) {
        if (patch.text !== undefined) obj.set({ text: patch.text });
        if (patch.fontFamily !== undefined)
          obj.set({ fontFamily: patch.fontFamily });
        if (patch.fontSize !== undefined) obj.set({ fontSize: patch.fontSize });
        if (patch.textAlign !== undefined)
          obj.set({ textAlign: patch.textAlign });
        if (patch.fontWeight !== undefined)
          obj.set({ fontWeight: patch.fontWeight });
        if (patch.fontStyle !== undefined)
          obj.set({ fontStyle: patch.fontStyle });
        if (patch.underline !== undefined)
          obj.set({ underline: patch.underline });
        if (patch.linethrough !== undefined)
          obj.set({ linethrough: patch.linethrough });
        if (patch.lineHeight !== undefined)
          obj.set({ lineHeight: patch.lineHeight });
        if (patch.charSpacing !== undefined)
          obj.set({ charSpacing: patch.charSpacing });
        if (patch.textBackgroundColor !== undefined)
          obj.set({
            textBackgroundColor:
              patch.textBackgroundColor === "none"
                ? ""
                : patch.textBackgroundColor,
          });
      }

      // Resize via scale. One dimension → uniform scale (aspect ratio kept,
      // so logos/images never distort); both dimensions → explicit stretch.
      if (patch.width !== undefined && patch.height !== undefined) {
        if (obj.width) obj.set({ scaleX: patch.width / obj.width });
        if (obj.height) obj.set({ scaleY: patch.height / obj.height });
      } else if (patch.width !== undefined) {
        const f = patch.width / Math.max(1, obj.getScaledWidth());
        obj.set({
          scaleX: (obj.scaleX ?? 1) * f,
          scaleY: (obj.scaleY ?? 1) * f,
        });
      } else if (patch.height !== undefined) {
        const f = patch.height / Math.max(1, obj.getScaledHeight());
        obj.set({
          scaleX: (obj.scaleX ?? 1) * f,
          scaleY: (obj.scaleY ?? 1) * f,
        });
      }

      // After resizing so the radius compensates for the final scale and
      // stays visually `cornerRadius` px in artboard space.
      if (patch.cornerRadius !== undefined && obj instanceof Rect) {
        obj.set({
          rx: patch.cornerRadius / Math.max(0.01, Math.abs(obj.scaleX ?? 1)),
          ry: patch.cornerRadius / Math.max(0.01, Math.abs(obj.scaleY ?? 1)),
        });
      }

      if (patch.x !== undefined || patch.y !== undefined) {
        const ctr = obj.getCenterPoint();
        obj.setPositionByOrigin(
          new Point(patch.x ?? ctr.x, patch.y ?? ctr.y),
          "center",
          "center",
        );
      }

      obj.setCoords();
      obj.dirty = true;
      if (obj instanceof FabricImage) thumbCacheRef.current.delete(id);
      c.requestRenderAll();
      refreshLayers();
      return { ok: true };
    },
    [layerById, refreshLayers],
  );

  const agentAdjustImage = useCallback(
    (
      id: string,
      patch: Partial<ImageAdjustments>,
    ): { ok: boolean; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (!(obj instanceof FabricImage))
        return { ok: false, error: `Layer "${id}" is not an image` };
      const next = { ...readAdjustments(obj), ...patch };
      obj.filters = buildFilterList(next);
      obj.applyFilters();
      thumbCacheRef.current.delete(id);
      c.requestRenderAll();
      refreshLayers();
      return { ok: true };
    },
    [layerById, refreshLayers],
  );

  const agentAddText = useCallback(
    (opts: AgentTextOptions): { ok: boolean; id?: string; error?: string } => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return { ok: false, error: "Editor not ready" };
      const text = new IText(opts.text, {
        left: opts.x ?? ab.width! / 2,
        top: opts.y ?? ab.height! / 2,
        originX: "center",
        originY: "center",
        fontFamily: opts.fontFamily ?? "Arial",
        fontSize: opts.fontSize ?? 72,
        fill: opts.fill ?? "#ffffff",
        stroke: opts.stroke ?? "#000000",
        strokeWidth: opts.strokeWidth ?? 0,
        textAlign: opts.textAlign ?? "left",
        fontWeight: opts.fontWeight ?? "normal",
        fontStyle: opts.fontStyle ?? "normal",
        underline: opts.underline ?? false,
        linethrough: opts.linethrough ?? false,
        lineHeight: opts.lineHeight ?? 1.16,
        charSpacing: opts.charSpacing ?? 0,
        textBackgroundColor:
          !opts.textBackgroundColor || opts.textBackgroundColor === "none"
            ? ""
            : opts.textBackgroundColor,
        paintFirst: "stroke",
      });
      const m = meta(text);
      m.id = uid();
      m.name = "Text";
      c.add(text);
      c.requestRenderAll();
      refreshLayers();
      return { ok: true, id: m.id };
    },
    [refreshLayers],
  );

  const agentAddShape = useCallback(
    (
      kind: ShapeKind,
      opts: AgentShapeOptions = {},
    ): { ok: boolean; id?: string; error?: string } => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return { ok: false, error: "Editor not ready" };
      const base = {
        left: opts.x ?? ab.width! / 2,
        top: opts.y ?? ab.height! / 2,
        originX: "center" as const,
        originY: "center" as const,
        fill: opts.fill ?? "#6366f1",
        stroke: opts.stroke ?? "#c7d2fe",
        strokeWidth: opts.strokeWidth ?? 0,
        strokeUniform: true,
        angle: opts.angle ?? 0,
        opacity: opts.opacity ?? 1,
      };
      let shape: FabricObject;
      if (kind === "ellipse") {
        shape = new Ellipse({
          ...base,
          rx: (opts.width ?? 360) / 2,
          ry: (opts.height ?? 260) / 2,
        });
        meta(shape).name = "Ellipse";
      } else if (kind === "arrow") {
        shape = new Polygon(ARROW_POINTS, base);
        meta(shape).name = "Arrow";
        if (opts.width) shape.set({ scaleX: opts.width / shape.width! });
        if (opts.height) shape.set({ scaleY: opts.height / shape.height! });
      } else {
        shape = new Rect({
          ...base,
          width: opts.width ?? 360,
          height: opts.height ?? 260,
          rx: opts.cornerRadius ?? 0,
          ry: opts.cornerRadius ?? 0,
        });
        meta(shape).name = "Rectangle";
      }
      meta(shape).id = uid();
      c.add(shape);
      c.requestRenderAll();
      refreshLayers();
      return { ok: true, id: meta(shape).id };
    },
    [refreshLayers],
  );

  const agentDuplicateLayer = useCallback(
    async (
      id: string,
      at?: { x?: number; y?: number },
    ): Promise<{ ok: boolean; id?: string; error?: string }> => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      const clone = await obj.clone(EXTRA_PROPS);
      meta(clone).id = uid();
      if (at?.x !== undefined || at?.y !== undefined) {
        const ctr = obj.getCenterPoint();
        clone.setPositionByOrigin(
          new Point(at.x ?? ctr.x, at.y ?? ctr.y),
          "center",
          "center",
        );
      } else {
        clone.set({
          left: (clone.left ?? 0) + 20,
          top: (clone.top ?? 0) + 20,
        });
      }
      clone.setCoords();
      c.add(clone);
      c.requestRenderAll();
      refreshLayers();
      return { ok: true, id: meta(clone).id };
    },
    [layerById, refreshLayers],
  );

  const agentDeleteLayer = useCallback(
    (id: string): { ok: boolean; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (c.getActiveObjects().includes(obj)) c.discardActiveObject();
      c.remove(obj);
      c.requestRenderAll();
      refreshLayers();
      refreshSelection();
      return { ok: true };
    },
    [layerById, refreshLayers, refreshSelection],
  );

  /** Position a layer relative to the artboard without coordinate math —
   *  the reliable way for the agent to handle "top", "bottom center", etc. */
  const agentAlignLayer = useCallback(
    (
      id: string,
      opts: AgentAlignOptions,
    ): { ok: boolean; x?: number; y?: number; error?: string } => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (!opts.horizontal && !opts.vertical)
        return { ok: false, error: "Provide horizontal and/or vertical" };
      const abW = ab.width!;
      const abH = ab.height!;
      const margin = opts.margin ?? Math.round(Math.min(abW, abH) * 0.05);
      const w = obj.getScaledWidth();
      const h = obj.getScaledHeight();
      const ctr = obj.getCenterPoint();
      let x = ctr.x;
      let y = ctr.y;
      // Resolve RTL-aware start/end to the concrete left/right below.
      const dir = meta(ab).direction ?? "ltr";
      let horizontal = opts.horizontal;
      if (horizontal === "start") horizontal = dir === "rtl" ? "right" : "left";
      else if (horizontal === "end") horizontal = dir === "rtl" ? "left" : "right";
      if (horizontal === "left") x = margin + w / 2;
      else if (horizontal === "center") x = abW / 2;
      else if (horizontal === "right") x = abW - margin - w / 2;
      if (opts.vertical === "top") y = margin + h / 2;
      else if (opts.vertical === "middle") y = abH / 2;
      else if (opts.vertical === "bottom") y = abH - margin - h / 2;
      obj.setPositionByOrigin(new Point(x, y), "center", "center");
      obj.setCoords();
      c.requestRenderAll();
      refreshLayers();
      return { ok: true, x: Math.round(x), y: Math.round(y) };
    },
    [layerById, refreshLayers],
  );

  // Space several layers evenly along an axis — the layout math lives in
  // ./layout so it stays testable; here we just read extents and apply centers.
  const agentDistributeLayers = useCallback(
    (
      ids: string[],
      axis: "horizontal" | "vertical",
      gap?: number,
    ): {
      ok: boolean;
      positions?: { id: string; x: number; y: number }[];
      error?: string;
    } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      if (!Array.isArray(ids) || ids.length < 2)
        return { ok: false, error: "Provide at least 2 layer ids" };
      const collected = collectBoxes(c, ids);
      if (!collected.ok) return { ok: false, error: collected.error };
      const placements = computeDistribute(collected.boxes, axis, gap);
      applyCenters(collected.objById, placements);
      c.requestRenderAll();
      refreshLayers();
      return {
        ok: true,
        positions: placements.map((p) => ({
          id: p.id,
          x: Math.round(p.cx),
          y: Math.round(p.cy),
        })),
      };
    },
    [collectBoxes, applyCenters, refreshLayers],
  );

  // Lay several layers out on a tidy grid (position only; sizes unchanged).
  const agentArrangeGrid = useCallback(
    (
      ids: string[],
      columns: number,
      gap?: number,
      x?: number,
      y?: number,
    ): {
      ok: boolean;
      box?: { x: number; y: number; width: number; height: number };
      error?: string;
    } => {
      const c = canvasRef.current;
      const ab = artboardRef.current;
      if (!c || !ab) return { ok: false, error: "Editor not ready" };
      if (!Array.isArray(ids) || ids.length < 1)
        return { ok: false, error: "Provide at least 1 layer id" };
      const collected = collectBoxes(c, ids);
      if (!collected.ok) return { ok: false, error: collected.error };
      const g = gap ?? Math.round(Math.min(ab.width!, ab.height!) * 0.03);
      const origin =
        x != null && y != null ? { x, y } : null;
      const { placements, box } = computeGrid(collected.boxes, columns, g, origin, {
        width: ab.width!,
        height: ab.height!,
      });
      applyCenters(collected.objById, placements);
      c.requestRenderAll();
      refreshLayers();
      return {
        ok: true,
        box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
      };
    },
    [collectBoxes, applyCenters, refreshLayers],
  );

  // Normalize an image into a target box: contain / cover (crop) / fill.
  const agentSetImageFit = useCallback(
    (
      id: string,
      width: number,
      height: number,
      mode: FitMode,
    ): { ok: boolean; width?: number; height?: number; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (!(obj instanceof FabricImage))
        return { ok: false, error: `Layer "${id}" is not an image` };
      if (!(width > 0) || !(height > 0))
        return { ok: false, error: "width and height must be positive" };
      applyFit(obj, width, height, mode);
      c.requestRenderAll();
      refreshLayers();
      const br = obj.getBoundingRect();
      return {
        ok: true,
        width: Math.round(br.width),
        height: Math.round(br.height),
      };
    },
    [layerById, refreshLayers],
  );

  // Wrap an image in a uniform card: a rounded background rect + the image
  // cover-fit into the padded interior, grouped into one tile so the agent can
  // align/distribute cards as boxes instead of raw mismatched images.
  const agentPlaceInCard = useCallback(
    (
      id: string,
      opts: {
        width: number;
        height: number;
        radius?: number;
        padding?: number;
        background?: string;
        shadow?: boolean;
      },
    ): { ok: boolean; id?: string; width?: number; height?: number; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const img = layerById(c, id);
      if (!img) return { ok: false, error: `No layer with id "${id}"` };
      if (!(img instanceof FabricImage))
        return { ok: false, error: `Layer "${id}" is not an image` };
      const { width, height } = opts;
      if (!(width > 0) || !(height > 0))
        return { ok: false, error: "width and height must be positive" };
      const padding = Math.max(0, opts.padding ?? 0);
      const innerW = width - 2 * padding;
      const innerH = height - 2 * padding;
      if (innerW <= 0 || innerH <= 0)
        return { ok: false, error: "padding too large for the card size" };

      const ctr = img.getCenterPoint();
      applyFit(img, innerW, innerH, "cover");
      img.setPositionByOrigin(ctr, "center", "center");
      img.setCoords();

      const rect = new Rect({
        left: ctr.x,
        top: ctr.y,
        originX: "center",
        originY: "center",
        width,
        height,
        rx: opts.radius ?? 0,
        ry: opts.radius ?? 0,
        fill: opts.background ?? "#ffffff",
        strokeWidth: 0,
        shadow: opts.shadow
          ? new Shadow({
              color: "rgba(0,0,0,0.28)",
              blur: 22,
              offsetX: 0,
              offsetY: 10,
            })
          : undefined,
      });

      c.discardActiveObject();
      c.remove(img);
      const group = new Group([rect, img]); // rect first = behind the image
      meta(group).id = uid();
      meta(group).name = "Card";
      c.add(group);
      c.requestRenderAll();
      refreshLayers();
      refreshSelection();
      return { ok: true, id: meta(group).id, width, height };
    },
    [layerById, refreshLayers, refreshSelection],
  );

  const agentMoveLayer = useCallback(
    (
      id: string,
      position: "front" | "back" | "up" | "down",
    ): { ok: boolean; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (position === "front") c.bringObjectToFront(obj);
      else if (position === "back") c.sendObjectToBack(obj);
      else if (position === "up") c.bringObjectForward(obj);
      else c.sendObjectBackwards(obj);
      const ab = artboardRef.current;
      if (ab) c.sendObjectToBack(ab); // artboard stays pinned at the bottom
      c.requestRenderAll();
      refreshLayers();
      return { ok: true };
    },
    [layerById, refreshLayers],
  );

  const agentGroupLayers = useCallback(
    (ids: string[]): { ok: boolean; id?: string; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const objs = ids.map((id) => layerById(c, id));
      const missing = ids.filter((_, i) => !objs[i]);
      if (missing.length > 0)
        return { ok: false, error: `No layer(s): ${missing.join(", ")}` };
      if (objs.length < 2)
        return { ok: false, error: "Need at least 2 layers to group" };
      c.discardActiveObject();
      const members = objs as FabricObject[];
      members.forEach((o) => c.remove(o));
      const group = new Group(members);
      meta(group).id = uid();
      meta(group).name = "Group";
      c.add(group);
      c.requestRenderAll();
      refreshLayers();
      refreshSelection();
      return { ok: true, id: meta(group).id };
    },
    [layerById, refreshLayers, refreshSelection],
  );

  const agentUngroupLayer = useCallback(
    (id: string): { ok: boolean; ids?: string[]; error?: string } => {
      const c = canvasRef.current;
      if (!c) return { ok: false, error: "Editor not ready" };
      const obj = layerById(c, id);
      if (!obj) return { ok: false, error: `No layer with id "${id}"` };
      if (!(obj instanceof Group))
        return { ok: false, error: `Layer "${id}" is not a group` };
      if (c.getActiveObjects().includes(obj)) c.discardActiveObject();
      c.remove(obj);
      // removeAll() restores the children's absolute coordinates
      const children = obj.removeAll();
      const ids: string[] = [];
      children.forEach((o) => {
        if (!meta(o).id) meta(o).id = uid();
        ids.push(meta(o).id!);
        c.add(o);
      });
      c.requestRenderAll();
      refreshLayers();
      refreshSelection();
      return { ok: true, ids };
    },
    [layerById, refreshLayers, refreshSelection],
  );

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

  /** Agent op: change artboard size and/or background (background accepts a
   *  CSS color or "transparent"). Reuses the user-facing ops; their history
   *  writes are suppressed inside an agent turn. */
  const agentSetArtboard = useCallback(
    (opts: {
      width?: number;
      height?: number;
      background?: string;
      direction?: "ltr" | "rtl";
    }): { ok: boolean; error?: string } => {
      const ab = artboardRef.current;
      if (!canvasRef.current || !ab)
        return { ok: false, error: "Editor not ready" };
      if (opts.width !== undefined || opts.height !== undefined) {
        applyCustomSize(opts.width ?? ab.width!, opts.height ?? ab.height!);
      }
      if (opts.background !== undefined) {
        setArtboardBg(
          opts.background === "transparent" ? null : opts.background,
        );
      }
      if (opts.direction !== undefined) {
        // Document-level property on the artboard object (see EXTRA_PROPS);
        // start/end alignment resolves against it, RTL-aware.
        meta(ab).direction = opts.direction;
        saveState();
      }
      refreshLayers();
      return { ok: true };
    },
    [applyCustomSize, setArtboardBg, saveState, refreshLayers],
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
    /* agent API */
    beginAgentTurn,
    endAgentTurn,
    agentGetState,
    agentScreenshot,
    agentSampleColor,
    agentApplyToLayer,
    agentAdjustImage,
    agentAddText,
    agentAddShape,
    agentDuplicateLayer,
    agentDeleteLayer,
    agentAlignLayer,
    agentDistributeLayers,
    agentArrangeGrid,
    agentSetImageFit,
    agentPlaceInCard,
    agentMoveLayer,
    agentGroupLayers,
    agentUngroupLayer,
    agentSetArtboard,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;
