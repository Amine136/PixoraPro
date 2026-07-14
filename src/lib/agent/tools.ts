import type { EditorApi } from "@/lib/editor/useEditor";
import type {
  AgentAlignOptions,
  AgentLayerPatch,
  AgentShapeOptions,
  AgentTextOptions,
  ImageAdjustments,
  ShapeKind,
} from "@/lib/editor/types";
import { FONT_FAMILIES } from "@/lib/editor/types";
import type { ToolDef } from "./protocol";

/** The slice of the editor the agent is allowed to drive. */
export type AgentToolContext = Pick<
  EditorApi,
  | "agentGetState"
  | "agentScreenshot"
  | "agentSampleColor"
  | "agentApplyToLayer"
  | "agentAdjustImage"
  | "agentAddText"
  | "agentAddShape"
  | "agentDuplicateLayer"
  | "agentDeleteLayer"
  | "agentAlignLayer"
  | "agentMoveLayer"
  | "agentGroupLayers"
  | "agentUngroupLayer"
  | "agentSetArtboard"
>;

export const SYSTEM_PROMPT = `You are the editing assistant inside Pixora, a canvas-based image editor. You edit the user's design by calling tools; the user watches your edits happen live and can undo them.

Canvas model:
- The design lives on an artboard. Coordinates are artboard-relative pixels: (0,0) is the artboard's top-left corner. An object's x/y is its CENTER point.
- The scene is a stack of layers (images, text, shapes), each with a stable "id". Layers are listed topmost-first.
- Available fonts: ${FONT_FAMILIES.join(", ")}.
- Common formats (use set_artboard, never stretch content to fake a format): Square 1024×1024, Landscape 1920×1080, Portrait post 1080×1350, Story/Reel 1080×1920, Wide banner 2048×1024.

Working rules:
- ALWAYS call get_canvas_state before your first modification, and re-read it after changing the artboard (layer positions are artboard-relative). Never guess layer ids.
- For placement, prefer align_layer (top/middle/bottom × left/center/right + margin) — it computes the coordinates for you. Use set_properties x/y only for positions alignment can't express, and derive them from the left/top/right/bottom edges in the canvas state instead of guessing.
- PLAN, then act in ONE batch: decide the full layout first, apply all changes, then inspect the screenshot you automatically receive after every mutating step. Apply at most ONE round of corrections — pixel-perfect is not expected, and endless nudging is a failure mode. Never adjust the same property of the same layer more than twice per request.
- Image adjustment values (brightness/contrast/saturation/hueRotate) range from -1 to 1, where 0 means unchanged; blur ranges 0 to 1.
- For repeated elements (badges, list rows, photo grids), style ONE layer fully, then duplicate_layer it and change only what differs — never rebuild each copy from scratch.
- Keep text replies short: one or two sentences on what you did. Don't enumerate every tool call.
- If the request is ambiguous, make a reasonable choice and mention it rather than asking.

Design rules:
- NEVER distort images or logos. To resize one, pass only width OR height (aspect ratio is preserved automatically). Pass both only when deliberate stretching is wanted.
- When the user asks for a platform format ("story", "post", "banner"), resize the ARTBOARD first, then rearrange the layers to fit it.
- Keep sensible margins: don't push content against artboard edges (leave ~4-6% padding) unless it's a full-bleed background.
- Text must stay readable: strong contrast against what's behind it; when the background is busy, add a soft drop shadow (shadowColor rgba, shadowBlur 8-16), a stroke, or a backing shape.
- To place an element "behind" or "in front of" others, use move_layer — not opacity tricks. Lowering opacity is for deliberate translucency only.
- Prefer alignment to the artboard center or thirds; avoid slightly-off positions.
- Use the full canvas: on tall formats (story/portrait), distribute content vertically — don't cluster everything at the top and leave the bottom empty unless asked.
- Uploaded images often carry their own baked-in background (e.g. a logo on a dark square with a glow). A guessed artboard color will NOT match it — the image's rectangle shows as a visible seam in the exported file even if it looks fine at low zoom. To blend such an image: sample_color just inside the image's edge and set the artboard (or a backing shape) to exactly that color, or scale the image to cover the artboard fully.`;

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "get_canvas_state",
    description:
      "Read the current canvas: artboard size/background and every layer with its id, kind, geometry (center x/y, width, height, angle), opacity and type-specific properties. Call this before modifying anything.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_screenshot",
    description:
      "Render the current artboard to an image so you can visually verify the design (alignment, overlaps, readability). Use after making changes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "sample_color",
    description:
      "Eyedropper: returns the exact rendered hex color at up to 10 points (artboard coordinates) in ONE call. Use it to match the artboard or a shape to an image's baked-in background (sample just INSIDE the image's edge), or to check what's behind text before choosing its color. Sample all the points you need in a single call — sampling beats guessing, but one or two calls give you enough information.",
    inputSchema: {
      type: "object",
      properties: {
        points: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
      },
      required: ["points"],
      additionalProperties: false,
    },
  },
  {
    name: "add_text",
    description:
      "Add a text layer to the artboard. Returns the new layer's id. Position defaults to the artboard center.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text content" },
        x: { type: "number", description: "Center x in artboard pixels" },
        y: { type: "number", description: "Center y in artboard pixels" },
        fontSize: { type: "number", description: "Font size in px (default 72)" },
        fontFamily: { type: "string", description: "One of the available fonts" },
        fill: { type: "string", description: "Text color, CSS color string" },
        stroke: { type: "string", description: "Outline color" },
        strokeWidth: { type: "number", description: "Outline width in px (0 = none)" },
        textAlign: { type: "string", enum: ["left", "center", "right"] },
        fontWeight: { type: "string", enum: ["normal", "bold"] },
        fontStyle: { type: "string", enum: ["normal", "italic"] },
        underline: { type: "boolean" },
        lineHeight: {
          type: "number",
          description: "Multiple of the font size (default 1.16)",
        },
        charSpacing: {
          type: "number",
          description: "Letter spacing in 1/1000 em (e.g. 200 = 0.2em)",
        },
        textBackgroundColor: {
          type: "string",
          description: "Highlight color behind the glyphs",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "add_shape",
    description:
      "Add a shape layer (rectangle, ellipse or arrow) to the artboard. Returns the new layer's id.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["rect", "ellipse", "arrow"] },
        x: { type: "number", description: "Center x in artboard pixels" },
        y: { type: "number", description: "Center y in artboard pixels" },
        width: { type: "number" },
        height: { type: "number" },
        fill: { type: "string", description: "Fill color, CSS color string" },
        stroke: { type: "string" },
        strokeWidth: { type: "number" },
        angle: { type: "number", description: "Rotation in degrees" },
        opacity: { type: "number", description: "0 to 1" },
        cornerRadius: {
          type: "number",
          description: "Rectangles only: corner radius in px (cards, buttons, badges)",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "set_properties",
    description:
      "Modify an existing layer by id: move (x/y = new center), resize, rotate (angle in degrees), opacity, visibility, flip, colors, stroke, drop shadow, rename; rectangles: corner radius; text layers: content, font family/size/weight/style, alignment, spacing, underline, highlight. Only the provided fields change. Resizing: pass ONLY width or ONLY height to scale proportionally (use this for images/logos); passing both stretches to exactly that size.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string", description: "Id from get_canvas_state" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        angle: { type: "number" },
        opacity: { type: "number", description: "0 to 1" },
        visible: { type: "boolean" },
        flipX: { type: "boolean", description: "Mirror horizontally" },
        flipY: { type: "boolean", description: "Mirror vertically" },
        name: { type: "string" },
        fill: { type: "string" },
        stroke: { type: "string" },
        strokeWidth: { type: "number" },
        cornerRadius: {
          type: "number",
          description: "Rectangle layers only: corner radius in px",
        },
        shadowColor: {
          type: "string",
          description:
            "Drop-shadow color (CSS color, rgba for soft shadows); \"none\" removes the shadow",
        },
        shadowBlur: { type: "number", description: "Shadow blur radius in px" },
        shadowOffsetX: { type: "number" },
        shadowOffsetY: { type: "number" },
        text: { type: "string", description: "New text content (text layers)" },
        fontFamily: { type: "string" },
        fontSize: { type: "number" },
        textAlign: { type: "string", enum: ["left", "center", "right"] },
        fontWeight: { type: "string", enum: ["normal", "bold"] },
        fontStyle: { type: "string", enum: ["normal", "italic"] },
        underline: { type: "boolean" },
        linethrough: { type: "boolean" },
        lineHeight: {
          type: "number",
          description: "Multiple of the font size (default 1.16)",
        },
        charSpacing: {
          type: "number",
          description: "Letter spacing in 1/1000 em (e.g. 200 = 0.2em)",
        },
        textBackgroundColor: {
          type: "string",
          description: "Highlight color behind the glyphs; \"none\" removes it",
        },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "adjust_image",
    description:
      "Adjust an image layer's filters. brightness/contrast/saturation range -1 to 1 (0 = unchanged); blur ranges 0 to 1; grayscale/sepia toggle; hueRotate ranges -1 to 1 (a full turn around the hue wheel). Only the provided fields change.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
        brightness: { type: "number" },
        contrast: { type: "number" },
        saturation: { type: "number" },
        blur: { type: "number", description: "0 to 1" },
        grayscale: { type: "boolean" },
        sepia: { type: "boolean" },
        hueRotate: { type: "number", description: "-1 to 1" },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "duplicate_layer",
    description:
      "Duplicate a layer by id, keeping all its styling. The copy is placed at x/y (new center) if given, otherwise offset 20px from the original. Returns the new layer's id.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
        x: { type: "number", description: "Center x of the copy" },
        y: { type: "number", description: "Center y of the copy" },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_layer",
    description: "Delete a layer by id.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "align_layer",
    description:
      "Position a layer relative to the artboard WITHOUT computing coordinates: horizontal left/center/right and/or vertical top/middle/bottom, with an optional margin from the edge (defaults to ~5% of the artboard). ALWAYS prefer this over set_properties x/y for placements like \"at the top\", \"centered\", \"bottom right\". Returns the resulting center x/y.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
        horizontal: { type: "string", enum: ["left", "center", "right"] },
        vertical: { type: "string", enum: ["top", "middle", "bottom"] },
        margin: { type: "number", description: "Distance from the artboard edge in px" },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_artboard",
    description:
      "Change the artboard (canvas) size and/or background color. Use this for format changes like story (1080×1920), post (1080×1350), landscape (1920×1080) — never stretch layers to fake a format. Background accepts a CSS color or \"transparent\". Layer coordinates are artboard-relative, so re-read the canvas state and reposition layers after resizing.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
        background: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "move_layer",
    description:
      "Change a layer's stacking order: \"front\"/\"back\" move it above/below all other layers, \"up\"/\"down\" move it one step.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
        position: { type: "string", enum: ["front", "back", "up", "down"] },
      },
      required: ["layer_id", "position"],
      additionalProperties: false,
    },
  },
  {
    name: "group_layers",
    description:
      "Group two or more layers by id into a single group layer (moves/rotates as one). Returns the group's id.",
    inputSchema: {
      type: "object",
      properties: {
        layer_ids: { type: "array", items: { type: "string" } },
      },
      required: ["layer_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "ungroup_layer",
    description:
      "Dissolve a group layer back into its member layers. Returns the member ids.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
];

export interface ToolExecution {
  content: string;
  images?: string[];
  isError?: boolean;
  /** Human-readable entry for the activity log; undefined for read-only tools. */
  label?: string;
  /** True when the tool mutated the canvas (drives undo snapshotting). */
  mutated?: boolean;
}

export async function executeTool(
  ctx: AgentToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  switch (name) {
    case "get_canvas_state": {
      const state = ctx.agentGetState();
      if (!state) return { content: "Editor not ready", isError: true };
      return { content: JSON.stringify(state) };
    }
    case "get_screenshot": {
      const dataUrl = ctx.agentScreenshot();
      if (!dataUrl) return { content: "Editor not ready", isError: true };
      return { content: "Current artboard render:", images: [dataUrl] };
    }
    case "sample_color": {
      const { points } = args as unknown as {
        points: { x: number; y: number }[];
      };
      if (!Array.isArray(points) || points.length === 0)
        return { content: "Provide a non-empty points array", isError: true };
      const samples = points.slice(0, 10).map((p) => {
        const res = ctx.agentSampleColor(p.x, p.y);
        return { x: p.x, y: p.y, color: res.ok ? res.color : `error: ${res.error}` };
      });
      return { content: JSON.stringify({ samples }) };
    }
    case "add_text": {
      const opts = args as unknown as AgentTextOptions;
      const res = ctx.agentAddText(opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, id: res.id }),
        label: `Added text “${truncate(opts.text, 24)}”`,
        mutated: true,
      };
    }
    case "add_shape": {
      const { kind, ...opts } = args as unknown as {
        kind: ShapeKind;
      } & AgentShapeOptions;
      const res = ctx.agentAddShape(kind, opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, id: res.id }),
        label: `Added ${kind === "rect" ? "rectangle" : kind}`,
        mutated: true,
      };
    }
    case "set_properties": {
      const { layer_id, ...patch } = args as unknown as {
        layer_id: string;
      } & AgentLayerPatch;
      const res = ctx.agentApplyToLayer(layer_id, patch);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true }),
        label: `Updated layer ${describePatch(patch)}`,
        mutated: true,
      };
    }
    case "adjust_image": {
      const { layer_id, ...adj } = args as {
        layer_id: string;
      } & Partial<ImageAdjustments>;
      const res = ctx.agentAdjustImage(layer_id, adj);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true }),
        label: "Adjusted image",
        mutated: true,
      };
    }
    case "duplicate_layer": {
      const { layer_id, x, y } = args as {
        layer_id: string;
        x?: number;
        y?: number;
      };
      const res = await ctx.agentDuplicateLayer(layer_id, { x, y });
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, id: res.id }),
        label: "Duplicated layer",
        mutated: true,
      };
    }
    case "delete_layer": {
      const { layer_id } = args as { layer_id: string };
      const res = ctx.agentDeleteLayer(layer_id);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true }),
        label: "Deleted layer",
        mutated: true,
      };
    }
    case "align_layer": {
      const { layer_id, ...opts } = args as unknown as {
        layer_id: string;
      } & AgentAlignOptions;
      const res = ctx.agentAlignLayer(layer_id, opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, x: res.x, y: res.y }),
        label: `Aligned layer ${[opts.vertical, opts.horizontal].filter(Boolean).join(" ")}`,
        mutated: true,
      };
    }
    case "set_artboard": {
      const opts = args as {
        width?: number;
        height?: number;
        background?: string;
      };
      const res = ctx.agentSetArtboard(opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      const size =
        opts.width || opts.height ? ` ${opts.width ?? "·"}×${opts.height ?? "·"}` : "";
      return {
        content: JSON.stringify({ ok: true }),
        label: `Set artboard${size}${opts.background ? ` · ${opts.background}` : ""}`,
        mutated: true,
      };
    }
    case "move_layer": {
      const { layer_id, position } = args as {
        layer_id: string;
        position: "front" | "back" | "up" | "down";
      };
      const res = ctx.agentMoveLayer(layer_id, position);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true }),
        label: `Moved layer to ${position}`,
        mutated: true,
      };
    }
    case "group_layers": {
      const { layer_ids } = args as { layer_ids: string[] };
      const res = ctx.agentGroupLayers(layer_ids ?? []);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, id: res.id }),
        label: `Grouped ${layer_ids.length} layers`,
        mutated: true,
      };
    }
    case "ungroup_layer": {
      const { layer_id } = args as { layer_id: string };
      const res = ctx.agentUngroupLayer(layer_id);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, ids: res.ids }),
        label: "Ungrouped",
        mutated: true,
      };
    }
    default:
      return { content: `Unknown tool "${name}"`, isError: true };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function describePatch(patch: AgentLayerPatch): string {
  const keys = Object.keys(patch);
  if (keys.length === 0) return "";
  return `(${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""})`;
}
