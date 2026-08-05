export type Tool = "select" | "pan" | "text" | "brush" | "eraser";

export type LayerKind = "image" | "text" | "shape" | "path" | "group";

export type ShapeKind = "rect" | "ellipse" | "arrow";

export type BrushType = "pencil" | "circle" | "spray";

export interface BrushSettings {
  type: BrushType;
  color: string;
  size: number;
}

export interface LayerItem {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  selected: boolean;
  /** Small data-URL preview, present for image layers */
  thumb?: string;
}

export interface TextSelectionProps {
  fontFamily: string;
  fontSize: number;
  textAlign: "left" | "center" | "right";
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  /** 0 to 1 */
  blur: number;
  grayscale: boolean;
  sepia: boolean;
  /** -1 to 1 (full turn around the hue wheel) */
  hueRotate: number;
}

export interface ShapeSelectionProps {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface SelectionInfo {
  count: number;
  kind: LayerKind | "mixed" | null;
  opacity: number;
  text: TextSelectionProps | null;
  image: ImageAdjustments | null;
  shape: ShapeSelectionProps | null;
  isGroup: boolean;
}

export interface ArtboardPreset {
  label: string;
  width: number;
  height: number;
}

export const ARTBOARD_PRESETS: ArtboardPreset[] = [
  { label: "Square · 1024 × 1024", width: 1024, height: 1024 },
  { label: "Landscape · 1920 × 1080", width: 1920, height: 1080 },
  { label: "Wide collage · 2048 × 1024", width: 2048, height: 1024 },
  { label: "Portrait · 1080 × 1350", width: 1080, height: 1350 },
  { label: "Story · 1080 × 1920", width: 1080, height: 1920 },
];

/* ---------- agent mode ---------- */

/** Extended text styling shared by add_text and set_properties. */
export interface AgentTextStyle {
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  underline?: boolean;
  linethrough?: boolean;
  /** Multiple of the font size (Fabric default 1.16) */
  lineHeight?: number;
  /** Letter spacing in 1/1000 em (e.g. 200 = 0.2em) */
  charSpacing?: number;
  /** Highlight color behind the glyphs; "none" removes it */
  textBackgroundColor?: string;
}

/** Flat drop-shadow fields; shadowColor "none" removes the shadow. */
export interface AgentShadowPatch {
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

/** Serialized layer snapshot the agent reads via get_canvas_state.
 *  Coordinates are artboard-relative; x/y is the object's center. */
export interface AgentLayerSnapshot {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Bounding-box edges — spares the model center↔edge arithmetic. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  angle: number;
  opacity: number;
  /** Present only when flipped / shadowed, to keep snapshots small. */
  flipX?: boolean;
  flipY?: boolean;
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  text?: TextSelectionProps & AgentTextStyle & { content: string };
  image?: ImageAdjustments;
  shape?: ShapeSelectionProps & { cornerRadius?: number };
}

export interface AgentCanvasState {
  artboard: {
    width: number;
    height: number;
    background: string;
    /** Document reading direction; align_layer start/end resolve against it. */
    direction: "ltr" | "rtl";
  };
  /** Topmost layer first (same order as the layers panel). */
  layers: AgentLayerSnapshot[];
}

/** Whitelisted properties the agent may change on a layer. */
export interface AgentLayerPatch extends AgentTextStyle, AgentShadowPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  opacity?: number;
  visible?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  name?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Rectangle shapes only: visual corner radius in px */
  cornerRadius?: number;
  /** Text layers only */
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
}

export interface AgentTextOptions extends AgentTextStyle {
  text: string;
  x?: number;
  y?: number;
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  textAlign?: "left" | "center" | "right";
}

export interface AgentAlignOptions {
  /** `start`/`end` resolve to left/right by the document direction (RTL-aware). */
  horizontal?: "left" | "center" | "right" | "start" | "end";
  vertical?: "top" | "middle" | "bottom";
  /** Distance from the artboard edge in px (default ≈5% of the artboard). */
  margin?: number;
}

export interface AgentShapeOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  angle?: number;
  opacity?: number;
  /** Rectangles only: corner radius in px */
  cornerRadius?: number;
}

/** Web fonts first (loaded via layout.tsx + lib/editor/fonts.ts, grouped by
 *  role: display, condensed, script, serif, sans), then system fallbacks. */
export const FONT_FAMILIES = [
  "Anton",
  "Bebas Neue",
  "Alfa Slab One",
  "Oswald",
  "Pacifico",
  "Caveat",
  "Playfair Display",
  "Montserrat",
  "Poppins",
  "Arial",
  "Impact",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Comic Sans MS",
];
