/**
 * Pure layout geometry for the agent's multi-layer arrange tools.
 *
 * These functions take axis-aligned bounding boxes (center + size) and return
 * new center points. They compute *position only* — never size — so callers
 * stay responsible for reading each object's real extent and applying the
 * result. Kept free of Fabric/React so the math can be unit-tested directly.
 */

export interface LayoutBox {
  id: string;
  /** Current center. */
  cx: number;
  cy: number;
  /** Axis-aligned bounding size (already accounts for rotation). */
  w: number;
  h: number;
}

export interface Placement {
  id: string;
  cx: number;
  cy: number;
}

export type Axis = "horizontal" | "vertical";

/**
 * Space boxes evenly along an axis. Boxes are ordered by their *current*
 * position along the axis (true "distribute" semantics, independent of the
 * input order). With `gap` omitted the gaps between items are equalized while
 * the first and last item stay put; with `gap` set they are packed that many
 * pixels apart starting from the current first item. Cross-axis is unchanged.
 */
export function computeDistribute(
  boxes: LayoutBox[],
  axis: Axis,
  gap?: number,
): Placement[] {
  const horiz = axis === "horizontal";
  const along = (b: LayoutBox) => (horiz ? b.cx : b.cy);
  const size = (b: LayoutBox) => (horiz ? b.w : b.h);
  const cross = (b: LayoutBox) => (horiz ? b.cy : b.cx);

  const sorted = [...boxes].sort((a, b) => along(a) - along(b));
  const startEdge = along(sorted[0]) - size(sorted[0]) / 2;

  let g: number;
  if (gap != null) {
    g = gap;
  } else {
    const last = sorted[sorted.length - 1];
    const lastEdge = along(last) + size(last) / 2;
    const span = lastEdge - startEdge;
    const sum = sorted.reduce((s, b) => s + size(b), 0);
    g = sorted.length > 1 ? (span - sum) / (sorted.length - 1) : 0;
  }

  const out: Placement[] = [];
  let cursor = startEdge;
  for (const b of sorted) {
    const centerAlong = cursor + size(b) / 2;
    out.push({
      id: b.id,
      cx: horiz ? centerAlong : cross(b),
      cy: horiz ? cross(b) : centerAlong,
    });
    cursor += size(b) + g;
  }
  return out;
}

export type FitMode = "contain" | "cover" | "fill";

export interface FitResult {
  /** Native FabricImage crop props (source-pixel space) + scale. */
  cropX: number;
  cropY: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Fit an image of natural size natW×natH into a boxW×boxH target.
 * `contain` scales uniformly to fit inside (no crop); `cover` crops the
 * overflow via native crop (so bounds equal the box, not the overflow);
 * `fill` stretches to the box (may distort). Uses native crop rather than a
 * clipPath so `getBoundingRect` reflects the visible box and the values
 * survive undo serialization. Read natW/natH from the source element, never
 * from a possibly-already-cropped `img.width`, so re-fitting composes.
 */
export function computeFit(
  natW: number,
  natH: number,
  boxW: number,
  boxH: number,
  mode: FitMode,
): FitResult {
  if (mode === "contain") {
    const s = Math.min(boxW / natW, boxH / natH);
    return { cropX: 0, cropY: 0, width: natW, height: natH, scaleX: s, scaleY: s };
  }
  if (mode === "fill") {
    return {
      cropX: 0,
      cropY: 0,
      width: natW,
      height: natH,
      scaleX: boxW / natW,
      scaleY: boxH / natH,
    };
  }
  // cover: crop to the box's aspect ratio, then scale uniformly to the box
  const aspect = boxW / boxH;
  let cropW: number;
  let cropH: number;
  if (natW / natH > aspect) {
    cropH = natH;
    cropW = natH * aspect;
  } else {
    cropW = natW;
    cropH = natW / aspect;
  }
  const s = boxW / cropW;
  return {
    cropX: (natW - cropW) / 2,
    cropY: (natH - cropH) / 2,
    width: cropW,
    height: cropH,
    scaleX: s,
    scaleY: s,
  };
}

/** An image's native crop rectangle, in source-pixel space. */
export interface CropRect {
  cropX: number;
  cropY: number;
  width: number;
  height: number;
}

/** Fraction (0–1) to trim off each edge of the current visible region. */
export interface CropTrim {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** An axis-aligned rectangle in artboard coordinates (top-left origin). */
export interface AbsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert "keep this rectangle" — stated absolutely, in artboard coordinates —
 * into the edge fractions computeCrop wants.
 *
 * Absolute is the form a caller can actually reason about: it is the same space
 * layer geometry is reported in, so a second crop can be re-derived from scratch
 * instead of guessing fractions of a region that the first crop already moved.
 * The rectangle is clipped to the layer's box, so overshooting an edge is
 * harmless. Returns null when the two do not overlap at all.
 */
export function rectToTrim(box: AbsRect, keep: AbsRect): CropTrim | null {
  const bx2 = box.x + box.width;
  const by2 = box.y + box.height;
  const kx1 = Math.max(box.x, keep.x);
  const ky1 = Math.max(box.y, keep.y);
  const kx2 = Math.min(bx2, keep.x + keep.width);
  const ky2 = Math.min(by2, keep.y + keep.height);
  if (kx2 <= kx1 || ky2 <= ky1) return null;
  return {
    left: (kx1 - box.x) / box.width,
    right: (bx2 - kx2) / box.width,
    top: (ky1 - box.y) / box.height,
    bottom: (by2 - ky2) / box.height,
  };
}

export interface CropResult extends CropRect {
  /** Center shift in SOURCE pixels. The caller scales and rotates this into
   *  canvas space; applying it keeps the retained pixels where they were. */
  dx: number;
  dy: number;
}

/**
 * Trim fractions off the edges of an image's *current* visible region.
 *
 * Unlike computeFit — which recomputes from the natural size so re-fitting
 * composes — crops stack: each trim is a fraction of what is visible now, so
 * cropping an already-cropped (or cover-fitted) image narrows it further
 * rather than reverting it. Scale is deliberately untouched; cropping removes
 * pixels, it does not resize the ones that remain.
 *
 * `dx`/`dy` express the trim's asymmetry. Trimming only the bottom returns a
 * negative `dy` of half the removed height, which moves the center up by
 * exactly the amount the box shrank — leaving the top edge where it was.
 * Callers that ignore it get a box that visibly jumps.
 *
 * Assumes validated input: each side in [0,1), opposing pairs summing under 1.
 */
export function computeCrop(cur: CropRect, trim: CropTrim): CropResult {
  const left = (trim.left ?? 0) * cur.width;
  const right = (trim.right ?? 0) * cur.width;
  const top = (trim.top ?? 0) * cur.height;
  const bottom = (trim.bottom ?? 0) * cur.height;
  return {
    cropX: cur.cropX + left,
    cropY: cur.cropY + top,
    width: cur.width - left - right,
    height: cur.height - top - bottom,
    dx: (left - right) / 2,
    dy: (top - bottom) / 2,
  };
}

export interface GridResult {
  placements: Placement[];
  /** Top-left corner and total size of the laid-out grid, artboard-relative. */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Lay boxes out on a grid in the given order, row by row, into uniform cells
 * sized to the largest box, `gap` px apart. Position only — items keep their
 * own size. The grid is centered on the artboard unless `origin` (its top-left
 * corner) is provided.
 */
export function computeGrid(
  boxes: LayoutBox[],
  columns: number,
  gap: number,
  origin: { x: number; y: number } | null,
  artboard: { width: number; height: number },
): GridResult {
  const cols = Math.max(1, Math.floor(columns));
  const rows = Math.ceil(boxes.length / cols);
  const cellW = Math.max(...boxes.map((b) => b.w));
  const cellH = Math.max(...boxes.map((b) => b.h));
  const gridW = cols * cellW + (cols - 1) * gap;
  const gridH = rows * cellH + (rows - 1) * gap;
  const ox = origin?.x ?? (artboard.width - gridW) / 2;
  const oy = origin?.y ?? (artboard.height - gridH) / 2;

  const placements = boxes.map((b, i) => {
    const r = Math.floor(i / cols);
    const col = i % cols;
    return {
      id: b.id,
      cx: ox + col * (cellW + gap) + cellW / 2,
      cy: oy + r * (cellH + gap) + cellH / 2,
    };
  });
  return { placements, box: { x: ox, y: oy, width: gridW, height: gridH } };
}

/** Gradient endpoint coordinates in the unit box (fabric gradientUnits:
 *  "percentage"). Linear endpoints are placed like CSS linear-gradient: the
 *  box's extreme corners project exactly onto stops 0 and 1, so both end
 *  colors are fully reached (for non-cardinal angles the endpoints lie
 *  outside the box — that is correct). Angle is the flow direction in
 *  degrees, 0 = left→right, 90 = top→bottom (y grows downward). Radial runs
 *  from the center to the corners (r2 = √½). */
export interface GradientCoords {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r1?: number;
  r2?: number;
}

export function computeGradientCoords(
  type: "linear" | "radial",
  angleDeg: number,
): GradientCoords {
  if (type === "radial")
    return { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, r1: 0, r2: Math.SQRT1_2 };
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const l = (Math.abs(dx) + Math.abs(dy)) / 2;
  const r = (n: number) => Math.round(n * 1e4) / 1e4 + 0; // +0 normalizes -0
  return {
    x1: r(0.5 - dx * l),
    y1: r(0.5 - dy * l),
    x2: r(0.5 + dx * l),
    y2: r(0.5 + dy * l),
  };
}
