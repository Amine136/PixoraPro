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

export const FONT_FAMILIES = [
  "Arial",
  "Impact",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Comic Sans MS",
];
