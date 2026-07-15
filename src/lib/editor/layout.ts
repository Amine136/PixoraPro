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
