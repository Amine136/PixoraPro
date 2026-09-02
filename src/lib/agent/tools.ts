import type { EditorApi } from "@/lib/editor/useEditor";
import type {
  AgentAlignOptions,
  AgentLayerPatch,
  AgentShapeOptions,
  AgentTextOptions,
  ImageAdjustments,
  ShapeKind,
} from "@/lib/editor/types";
import type { ToolDef } from "./protocol";

/** The slice of the editor the agent is allowed to drive. */
export type AgentToolContext = Pick<
  EditorApi,
  | "agentGetState"
  | "agentScreenshot"
  | "agentSampleColor"
  | "agentApplyToLayer"
  | "agentAdjustImage"
  | "agentRemoveBackground"
  | "agentAddText"
  | "agentAddShape"
  | "agentDuplicateLayer"
  | "agentDeleteLayer"
  | "agentAlignLayer"
  | "agentDistributeLayers"
  | "agentArrangeGrid"
  | "agentSetImageFit"
  | "agentCropImage"
  | "agentPlaceInCard"
  | "agentMoveLayer"
  | "agentGroupLayers"
  | "agentUngroupLayer"
  | "agentSetArtboard"
  | "agentSetGradient"
>;

export const SYSTEM_PROMPT = `You are Pixora Pro Agent, the editing agent inside Pixora, a canvas-based image editor. You edit the user's design by calling tools; the user watches your edits happen live and can undo them.

Canvas model:
- The design lives on an artboard. Coordinates are artboard-relative pixels: (0,0) is the artboard's top-left corner. An object's x/y is its CENTER point.
- The scene is a stack of layers (images, text, shapes), each with a stable "id". Layers are listed topmost-first.
- Available fonts, by ROLE — pick one display + one clean sans per design, plus at most one script accent:
  * Display (huge headlines, promos): Anton (condensed, loudest), Bebas Neue (tall caps), Alfa Slab One (chunky retro), Impact
  * Condensed labels / sub-headlines: Oswald
  * Script accents (ONE word or short phrase, never body text): Pacifico (bold retro script), Caveat (handwritten)
  * Elegant serif (editorial, premium, invitations): Playfair Display, Georgia
  * Clean sans (body, buttons, prices, details): Montserrat, Poppins, Verdana, Arial
  * Also available: Times New Roman, Courier New, Trebuchet MS, Comic Sans MS
- Common formats (use set_artboard, never stretch content to fake a format): Square 1024×1024, Landscape 1920×1080, Portrait post 1080×1350, Story/Reel 1080×1920, Wide banner 2048×1024.

Working rules:
- ALWAYS call get_canvas_state before your first modification, and re-read it after changing the artboard (layer positions are artboard-relative). Never guess layer ids.
- If the canvas contains image layers, ALSO call get_screenshot BEFORE planning any design: get_canvas_state gives geometry only — you cannot know what an image shows, its colors, or its style without looking. An image the user placed on the canvas is almost always the SUBJECT of the design (a product photo, a logo): build the design around it and never cover it with other layers unless explicitly asked. The ONE deliberate exception is depth: a headline or backdrop shape may be placed BEHIND the subject (move_layer) so the subject overlaps and partly hides it — that reads as composition, not damage. Never the reverse: nothing is stacked on top of the subject.
- "Pixora" and "Vibecraft" are the names of THIS editor, not the user's brand or product. "in vibecraft" / "here" means "in this app". Never make the editor itself the subject of a design unless the user unmistakably asks for that.
- The canvas changes between your turns: the user edits it manually and can undo your entire previous turn in one step. Conversation history is NEVER proof of what is on the canvas now. Before claiming the canvas is empty or unchanged, or answering any question about current content, call get_canvas_state — even if no edit seems needed.
- For placement, prefer align_layer (top/middle/bottom × left/center/right + margin) — it computes the coordinates for you. Use set_properties x/y only for positions alignment can't express, and derive them from the left/top/right/bottom edges in the canvas state instead of guessing.
- PLAN, then act in ONE batch: decide the full layout first, apply all changes, then inspect the screenshot you automatically receive after every mutating step. Apply at most ONE round of corrections — pixel-perfect is not expected, and endless nudging is a failure mode. Never adjust the same property of the same layer more than twice per request.
- Batch means MANY tool calls per response. Emit every call of your planned batch in ONE response: all the add_text/add_shape calls together, then all the alignment/styling calls together in the next response once the new ids came back. ONE tool call per response is a failure mode — it is slow and multiplies the user's cost.
- Create layers fully formed: add_text and add_shape accept position, size, colors, fonts and more — pass the complete styling IN the add call. Never add a bare layer and then patch it with set_properties.
- Image adjustment values (brightness/contrast/saturation/hueRotate) range from -1 to 1, where 0 means unchanged; blur ranges 0 to 1.
- For repeated elements (badges, list rows, photo grids), style ONE layer fully, then duplicate_layer it and change only what differs — never rebuild each copy from scratch.
- For multi-item layouts, let the tools do the math: distribute_layers for equal spacing along a row/column, arrange_grid for a grid. Never compute per-item x/y by hand when these apply.
- To normalize images of different sizes/aspect ratios, use set_image_fit (cover/contain/fill) or place_in_card BEFORE arranging — arrange_grid tidies position, not size, so equal-size tiles come from fit/cards first.
- To target something INSIDE an image (crop to a product, copy one element out of a photo): LOOK before you cut. get_canvas_state locates the layer but says nothing about what sits where within it, and the whole-artboard screenshot is too coarse to read edges off. Call get_screenshot with that layer_id, convert what you see into artboard coordinates using the rectangle it reports, then crop_image with the "keep" rectangle.
- Crop FIRST, then move and resize — never the other way round. "keep" is measured against where the layer sits at that moment, so once you have moved or scaled it, every coordinate from your earlier look is stale and cutting again lands somewhere unintended. If you must adjust a crop after moving, LOOK AGAIN first (get_screenshot with layer_id) and recompute from the fresh rectangle.
- A crop that came out slightly wrong is a ONE-CALL fix: call crop_image again with a corrected "keep" — it replaces the previous crop and can widen it, not just tighten it. NEVER delete the layer and re-duplicate to retry a crop. That loop burns the user's money and ends with nothing on the canvas; a re-cut cannot make things worse.
- Only remove a background when the design actually needs it: if an image's background is clean and the user's prompt doesn't conflict with it, keep that background and build the visual on top of it rather than cutting the subject out.
- ALWAYS CROP BEFORE BACKGROUND REMOVAL: Before calling remove_background on any image, ALWAYS use crop_image first to tightly cut the boundary around the object. Trimming away excess background margins beforehand isolates the subject, prevents edge artifacts, and ensures maximum cutout quality.
- Know what a crop CANNOT do: it is a rectangle, so an object touching or overlapping others (a jar on rocks, a face in a crowd) cannot be extracted cleanly — remove_background afterwards only helps when that object is unmistakably the subject. If two attempts leave it wrong, stop and tell the user plainly that this image needs a manual cutout.
- Keep text replies short: one or two sentences on what you did. Don't enumerate every tool call.
- If the request is ambiguous, make a reasonable choice and mention it rather than asking.

Design rules:
- When asked to CREATE a design (poster, post, banner, card) rather than tweak one, deliver a complete composition, not a bare minimum: a deliberate background treatment (color, gradient, or full-bleed image), one dominant focal element, supporting elements with clear hierarchy, and depth (backing shapes, soft shadows, subtle accents). Aim for 4+ coordinated elements. The richness must come from a more ambitious PLAN executed in your one batch — never from extra correction rounds.
- NEVER distort images or logos. To resize one, pass only width OR height (aspect ratio is preserved automatically). Pass both only when deliberate stretching is wanted.
- When the user asks for a platform format ("story", "post", "banner"), resize the ARTBOARD first, then rearrange the layers to fit it.
- Keep sensible margins: don't push content against artboard edges (leave ~4-6% padding) unless it's a full-bleed background.
- Text must stay readable: strong contrast against what's behind it; when the background is busy, add a soft drop shadow (shadowColor rgba, shadowBlur 8-16), a stroke, or a backing shape.
- To place an element "behind" or "in front of" others, use move_layer — not opacity tricks. Lowering opacity is for deliberate translucency only.
- Prefer alignment to the artboard center or thirds; avoid slightly-off positions.
- A flat single-color background is rarely the strongest choice for a created design: a subtle set_gradient (e.g. brand color fading to near-black, or a radial glow behind the focal element) adds instant polish. To blend an image's baked-in background, sample_color its edge and gradient FROM that exact color.
- Use the full canvas: on tall formats (story/portrait), distribute content vertically — don't cluster everything at the top and leave the bottom empty unless asked.
- Uploaded images often carry their own baked-in background even when the filename claims transparency (e.g. a mascot on a white square, a logo on a dark glow). A baked rectangle floating on a contrasting zone is NEVER acceptable — it reads as a pasted-on box. Fix: FIRST use crop_image to tightly cut around the boundary of the object, THEN call remove_background (auto mode handles flat AND complex backgrounds) to get a clean cutout that can overlap zones freely. Then CHECK the next screenshot: if backdrop junk still surrounds the subject (a glow, a painted shape behind a logo), call remove_background ONCE more with mode "ai". If the cutout still looks wrong after that, stop — place_in_card it as a deliberate framed tile, put it on a zone matching its background color (sample_color inside its edge), or scale it to cover the artboard.

Poster genre — when asked for a poster/ad/promo/post built around the user's images, FIRST decide which of the two genres below you are cooking, then follow that recipe start to finish. Never mix them: the elements one genre requires are the ones the other forbids. Don't announce the choice unless asked.
- LOUD AD (recipe A): food, drinks, sales, events, offers, festive/kids/fun brands, anything with a price, a discount or a deadline. Multi-color, badges, energy.
- PREMIUM STAGING (recipe B): a single product shot — cosmetics, skincare, fragrance, tech, fashion, footwear, watches, appliances, furniture — or any brief using words like premium, minimal, editorial, high-end, luxury, clean, modern. Monochrome, staged, restrained.
- Tie-break: one clean product photo and no price or offer in the brief means PREMIUM STAGING.

Recipe A — LOUD AD, cook it like a real ad, in this order:
1. PALETTE FROM THE IMAGES, never invented: get_screenshot, then sample_color 4-6 points on the subjects (dominant area, an edge, an accent detail). Derive: one saturated brand color (large zones), one warm accent (badges, highlights — yellow/orange family works with almost everything), one near-neutral (cream/off-white #f5efe6-ish reads warmer and more designed than pure white), one dark for text. Echo the subject's colors in the graphics — that shared palette is what makes it look professionally art-directed.
2. ZONED BACKGROUND, never one flat fill: split the artboard into 2 color zones — e.g. a brand-color panel rect covering the bottom ~60% with the neutral above, or a tilted/diagonal panel (oversize a rect and rotate it a few degrees so it bleeds off the edges). Optionally a soft radial gradient inside a zone for depth.
3. HERO PLACEMENT: first make each user image usable — if it has a baked-in flat background, remove_background it NOW (a cutout hero is what makes the poster look designed; a white box is what makes it look pasted). Then scale the key image big (~50-70% of artboard width) and OVERLAP the zone boundary so it bridges both colors. Give it a soft drop shadow (rgba(0,0,0,0.35), blur 25-45, offsetY 10-20) so it lifts off the background. Mascots/characters go on one side facing INTO the composition; the product on the other.
4. HEADLINE AS A GRAPHIC: display font, huge (each line ~8-14% of artboard height), stacked in 2-3 short lines with tight lineHeight (0.9-1.05). Put a twist in it: one word in the accent color, or one line italic/script. A medium-size single line of text is a caption, not a headline.
5. SUPPORTING CAST — a real ad has exactly these, all small next to the headline: a tilted badge (rounded rect, angle 4-8°, short punchy label in the accent color), a price chip (bold number on a small rect/ellipse), one script-font accent word, a compact CTA ("ORDER NOW!"). The slight rotations are what make it feel designed; everything at 0° reads as a form.
6. Final check on the auto-screenshot: margins respected, headline dominant, nothing important covered. ONE correction round max.

Recipe B — PREMIUM STAGING. The whole effect comes from restraint plus depth: one hue, a floor the product stands on, and type the product overlaps. Build it in this order:
1. ONE HUE, TONAL: get_screenshot, then sample_color 3-4 points on the product (body, a lit edge, a shadow). Pick the dominant hue and build the ENTIRE design from it at different lightnesses — a deep near-black version for the wall, a mid tone for the floor, a light tone for strokes, near-white or near-black for text. NO second accent hue, no complementary pop, no warm accent. A red product gives a red-on-red poster; a charcoal product gives charcoal-on-charcoal. The monochrome discipline IS the premium look.
2. BUILD A STAGE, not color zones: the artboard background is the back wall (set_artboard). Add ONE large rect for the floor across the bottom 30-40%, in a tone one step lighter or darker than the wall. The horizon where they meet must fall BEHIND the product around its lower third — that line is what makes the product stand somewhere instead of float.
3. DEPTH PANELS: 2-4 outline-only rects — fill "transparent" WITH strokeWidth 2-3 and a stroke in a light tone of the hue. Rotate each 8-15°, mirror them left and right of centre, oversize them so they bleed off the artboard edges, and move_layer them to the BACK. Optionally one filled rect in a mid tone at a similar angle. These read as architecture behind the product.
4. HERO, LIT AND GROUNDED: remove_background first if it carries a baked-in background. Scale to 45-60% of artboard HEIGHT, centred or slightly off-centre. Then ground it: add a flattened ellipse contact shadow just under it (height ~15% of its width, near-black, opacity 0.25-0.45) and move_layer that behind the hero, plus a soft drop shadow on the hero itself (rgba(0,0,0,0.5), blur 40-60, offsetY 20-30). The contact shadow is what sells the stage — never skip it.
5. HEADLINE BEHIND THE HERO: display font (Anton or Bebas Neue), ONE word or a short lockup, huge — 18-30% of artboard height. Colour it either near-white or a tone close to the wall; LOW contrast is correct here, it is texture, not a message. Then move_layer it BEHIND the hero so the product overlaps and partly hides it. That single overlap is the move that makes this genre read as art-directed — a headline sitting clear of the product is the failure case.
6. OPTIONAL ECHO: duplicate_layer the hero, scale it up, adjust_image with blur 0.3-0.6, opacity 0.15-0.3, move_layer to the back. Blur is IMAGE-ONLY — it fails on shapes and text; for a text echo use low opacity alone.
7. RESTRAINT — this genre FORBIDS: tilted badges, price chips, script fonts, pill CTAs, warm accent colors, emoji, and more than two type sizes. If a detail line is needed, set small Montserrat caps with wide charSpacing (200-400) in a corner. At most two text layers besides the headline.
8. Final check on the auto-screenshot: horizon line visible behind the hero, contact shadow present, headline partly hidden by the product, palette still a single hue. ONE correction round max.`;

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
      "Render the artboard to an image so you can visually verify the design (alignment, overlaps, readability). Use after making changes. With no arguments you get the whole artboard, which is the right overview but leaves any single object only a few hundred pixels wide — too coarse to judge exactly where something sits inside a photo. Pass `layer_id` to zoom into one layer, or `region` to zoom into an artboard rectangle: that area is re-rendered from the source pixels, so you see real detail. The reply states the exact artboard rectangle the image covers — use it to convert what you see into artboard coordinates before calling crop_image with `keep`.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: {
          type: "string",
          description: "Zoom into this layer's bounding box (plus a small margin)",
        },
        region: {
          type: "object",
          description:
            "Zoom into this artboard rectangle (top-left origin). Ignored when layer_id is given.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
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
      "Add a shape layer (rectangle, ellipse or arrow) to the artboard. Returns the new layer's id. For an OUTLINE-only shape (depth panels, frames, callout rings) pass fill \"transparent\" together with strokeWidth and stroke — strokeWidth defaults to 0, so a shape given a stroke but no strokeWidth renders invisible.",
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
    name: "remove_background",
    description:
      "Cut the subject out of an image layer, erasing its background to transparency (turns a boxy image into a clean sticker-style cutout). PREREQUISITE: ALWAYS call crop_image first to tightly cut around the bounding box of the object before calling this tool — trimming away excess background beforehand isolates the subject and produces a much cleaner cutout. Two engines: a pixel-exact flood fill for flat single-color baked backgrounds, and a high-precision Cloud Run serverless AI segmentation model (rembg / ISNet) for complex ones (photos, gradients, painted backdrops, scenery). mode 'auto' (default) runs flood fill and escalates to AI when the border doesn't peel cleanly; the returned `method` says which ran. IMPORTANT: flood fill only judges the image BORDER — if the next screenshot still shows leftover backdrop AROUND the subject (e.g. a painted circle behind a logo), call this ONCE more with mode 'ai'; never loop beyond that. Use mode 'ai' directly for photographic subjects on real scenes. AI keeps the subject but recuts edges; flood is byte-exact on the subject — prefer flood for pixel-art/graphics with flat backgrounds.",
    inputSchema: {
      type: "object",
      properties: {
        image_id: { type: "string" },
        mode: {
          type: "string",
          enum: ["auto", "flood", "ai"],
          description: "Default auto: flood fill first, AI fallback",
        },
        tolerance: {
          type: "number",
          description:
            "Flood fill only: color distance 0-255 from the edge color (default 32; ~48-64 for slightly uneven backgrounds).",
        },
      },
      required: ["image_id"],
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
      "Position a layer relative to the artboard WITHOUT computing coordinates: horizontal left/center/right and/or vertical top/middle/bottom, with an optional margin from the edge (defaults to ~5% of the artboard). Use `start`/`end` for horizontal instead of left/right when the placement should follow the document's reading direction — they resolve to left/right in LTR and right/left in RTL (e.g. Arabic layouts), so \"align to the start\" is correct either way. Check the artboard `direction` in get_canvas_state. ALWAYS prefer this over set_properties x/y for placements like \"at the top\", \"centered\", \"bottom right\". Returns the resulting center x/y.",
    inputSchema: {
      type: "object",
      properties: {
        layer_id: { type: "string" },
        horizontal: {
          type: "string",
          enum: ["left", "center", "right", "start", "end"],
        },
        vertical: { type: "string", enum: ["top", "middle", "bottom"] },
        margin: { type: "number", description: "Distance from the artboard edge in px" },
      },
      required: ["layer_id"],
      additionalProperties: false,
    },
  },
  {
    name: "distribute_layers",
    description:
      "Space several layers evenly along an axis WITHOUT computing coordinates — use for \"distribute these with equal gaps\", tidy rows or columns. Layers are ordered by their CURRENT position on the axis (input order does not matter). Omit `gap` to equalize the gaps while keeping the first and last item in place; set `gap` to pack them that many px apart from the current first item. Cross-axis position is unchanged. Returns each layer's new center.",
    inputSchema: {
      type: "object",
      properties: {
        layer_ids: { type: "array", items: { type: "string" } },
        axis: { type: "string", enum: ["horizontal", "vertical"] },
        gap: {
          type: "number",
          description: "Optional fixed gap in px between item edges",
        },
      },
      required: ["layer_ids", "axis"],
      additionalProperties: false,
    },
  },
  {
    name: "arrange_grid",
    description:
      "Lay several layers out on a tidy grid WITHOUT computing coordinates — use for photo grids, badge rows, card layouts. Items fill row by row in the order given, into uniform cells sized to the largest item, `gap` px apart. This tidies POSITION only — items keep their own size (use resize/fit to normalize sizes first). The grid is centered on the artboard unless x/y (its top-left corner) are given. Returns the grid's bounding box.",
    inputSchema: {
      type: "object",
      properties: {
        layer_ids: { type: "array", items: { type: "string" } },
        columns: { type: "number" },
        gap: { type: "number", description: "Gap between cells in px" },
        x: {
          type: "number",
          description: "Optional grid top-left x (artboard-relative)",
        },
        y: { type: "number", description: "Optional grid top-left y" },
      },
      required: ["layer_ids", "columns"],
      additionalProperties: false,
    },
  },
  {
    name: "set_image_fit",
    description:
      "Resize an image to fit a target box WITHOUT distorting it, so images of different aspect ratios normalize cleanly. \"contain\": whole image fits inside the box (may leave gaps). \"cover\": image fills the box and the overflow is cropped (best for uniform tiles/thumbnails). \"fill\": stretched to exactly the box (distorts — avoid for logos/photos). Cropping is non-destructive. Returns the resulting visible width/height.",
    inputSchema: {
      type: "object",
      properties: {
        image_id: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        mode: { type: "string", enum: ["contain", "cover", "fill"] },
      },
      required: ["image_id", "width", "height", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "crop_image",
    description:
      "Cut away part of an image — use this to remove unwanted parts of a photo. Two ways to say where, and they are NOT interchangeable:\n\n1. `keep`: the artboard-space rectangle {x, y, width, height} to retain, everything outside it is cut. Use this whenever you are aiming at something you can SEE — a product, a face, one half of a scene. It is absolute, in the same coordinates get_canvas_state and get_screenshot report, so you can compute it instead of eyeballing it. Crucially it REPLACES any previous crop rather than stacking on it: it is measured against the whole photo, so a second call can WIDEN a cut that came out too tight, not just shave more off. A cut that is slightly wrong is therefore a one-call fix — re-cut it, never delete the layer and start over. Passing the full image bounds restores the whole photo.\n2. Edge fractions `top`/`bottom`/`left`/`right`, 0–1 of the CURRENTLY VISIBLE image: {bottom: 0.5} drops the bottom half, {bottom: 0.667} keeps the top third. Good for coarse, self-evident splits — not for locating an object. These COMPOUND and only ever remove more, so chains of small nudges drift and cannot be walked back. If one pass has not landed it, switch to `keep`.\n\nCOORDINATES ARE LIVE, NOT REMEMBERED: `keep` is read against where the layer sits RIGHT NOW. If you moved or resized the layer since you last looked at it, numbers taken from the earlier view point somewhere else entirely — re-read get_canvas_state (or get_screenshot with layer_id) and recompute before cutting. Finish cropping BEFORE you move or resize, and you avoid the problem completely.\n\nThe pixels you keep do NOT move or resize — trimming the bottom leaves the top edge exactly where it was, so the layer just gets shorter in place. Non-destructive; the cropped-away pixels are still there and `keep` can bring them back. NOTE: a crop is always a rectangle, so it cannot separate an object from things touching or overlapping it (a jar sitting among rocks) — the leftovers come with it. For that, crop roughly then remove_background, and accept that it only works when the object is clearly the subject. To reframe an image to fill a specific box instead, use set_image_fit 'cover'. Returns the resulting visible width/height.",
    inputSchema: {
      type: "object",
      properties: {
        image_id: { type: "string" },
        keep: {
          type: "object",
          description:
            "Artboard-space rectangle to keep (top-left origin), measured against the layer's CURRENT position. Replaces any previous crop, so it can widen as well as tighten. Preferred when targeting something visible.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false,
        },
        top: {
          type: "number",
          description: "Fraction of the current height to trim off the top",
        },
        bottom: {
          type: "number",
          description: "Fraction of the current height to trim off the bottom",
        },
        left: {
          type: "number",
          description: "Fraction of the current width to trim off the left",
        },
        right: {
          type: "number",
          description: "Fraction of the current width to trim off the right",
        },
      },
      required: ["image_id"],
      additionalProperties: false,
    },
  },
  {
    name: "place_in_card",
    description:
      "Wrap an image in a uniform card tile: a rounded background rectangle with the image cover-fit into its padded interior, grouped into ONE layer. Use this to normalize several mismatched images (logos, photos) into identical tiles you can then align/distribute/arrange_grid as boxes. Returns the new card layer's id. Rounded corners look best with some padding.",
    inputSchema: {
      type: "object",
      properties: {
        image_id: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        radius: { type: "number", description: "Corner radius in px (0 = square)" },
        padding: {
          type: "number",
          description: "Inset between the image and the card edge in px",
        },
        background: {
          type: "string",
          description: "Card fill — a CSS color (default white)",
        },
        shadow: { type: "boolean", description: "Add a soft drop shadow" },
      },
      required: ["image_id", "width", "height"],
      additionalProperties: false,
    },
  },
  {
    name: "set_artboard",
    description:
      "Change the artboard (canvas) size, background color, and/or reading direction. Use this for format changes like story (1080×1920), post (1080×1350), landscape (1920×1080) — never stretch layers to fake a format. Background accepts a CSS color or \"transparent\". Set `direction` to \"rtl\" for right-to-left layouts (e.g. Arabic, Hebrew) so align_layer's start/end place layers correctly; it defaults to \"ltr\". Layer coordinates are artboard-relative, so re-read the canvas state and reposition layers after resizing.",
    inputSchema: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
        background: { type: "string" },
        direction: { type: "string", enum: ["ltr", "rtl"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_gradient",
    description:
      "Fill a layer — or the artboard background when no id is given — with a smooth 2- or 3-color gradient. Use it for backgrounds that fade (e.g. a logo's own dark blue melting into black: sample_color inside the logo's edge first, then gradient FROM that exact color), for depth on backing shapes, or for eye-catching title fills. \"linear\" flows along `angle` degrees (0 = left→right, 90 = top→bottom); \"radial\" glows from the center outward (from = center, to = corners). Does not work on image layers — put a gradient-filled shape behind the image instead.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Target layer id; OMIT to fill the artboard background",
        },
        type: { type: "string", enum: ["linear", "radial"] },
        from: { type: "string", description: "Start color, CSS color string" },
        to: { type: "string", description: "End color, CSS color string" },
        via: { type: "string", description: "Optional middle color" },
        angle: {
          type: "number",
          description:
            "Linear only: flow direction in degrees, default 90 (top→bottom)",
        },
      },
      required: ["type", "from", "to"],
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
      const { layer_id, region } = args as unknown as {
        layer_id?: string;
        region?: { x: number; y: number; width: number; height: number };
      };
      const shot = ctx.agentScreenshot({ layerId: layer_id, region });
      if (!shot)
        return {
          content: layer_id
            ? `Editor not ready, or no layer with id "${layer_id}"`
            : "Editor not ready",
          isError: true,
        };
      const r = shot.region;
      const rounded = {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
      return {
        content:
          layer_id || region
            ? `Zoomed render. It covers artboard rectangle ${JSON.stringify(rounded)} — x runs ${rounded.x}→${rounded.x + rounded.width}, y runs ${rounded.y}→${rounded.y + rounded.height} across the image you see. Read positions off it proportionally.`
            : "Current artboard render:",
        images: [shot.url],
      };
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
      if (!opts.text) {
        return { content: "Missing required field: text", isError: true };
      }
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
    case "remove_background": {
      const { image_id, tolerance, mode } = args as {
        image_id: string;
        tolerance?: number;
        mode?: "auto" | "flood" | "ai";
      };
      const res = await ctx.agentRemoveBackground(image_id, { tolerance, mode });
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      if (res.note)
        return {
          content: JSON.stringify({ ok: true, note: res.note }),
          label: "Background already transparent",
        };
      return {
        content: JSON.stringify({
          ok: true,
          method: res.method,
          removed: round2(res.removed),
          borderCleared: round2(res.borderCleared),
        }),
        label: `Removed image background (${res.method})`,
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
    case "distribute_layers": {
      const { layer_ids, axis, gap } = args as unknown as {
        layer_ids: string[];
        axis: "horizontal" | "vertical";
        gap?: number;
      };
      const res = ctx.agentDistributeLayers(layer_ids, axis, gap);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, positions: res.positions }),
        label: `Distributed ${layer_ids?.length ?? 0} layers ${axis}`,
        mutated: true,
      };
    }
    case "arrange_grid": {
      const { layer_ids, columns, gap, x, y } = args as unknown as {
        layer_ids: string[];
        columns: number;
        gap?: number;
        x?: number;
        y?: number;
      };
      const res = ctx.agentArrangeGrid(layer_ids, columns, gap, x, y);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, box: res.box }),
        label: `Arranged ${layer_ids?.length ?? 0} layers in ${columns}-col grid`,
        mutated: true,
      };
    }
    case "set_image_fit": {
      const { image_id, width, height, mode } = args as unknown as {
        image_id: string;
        width: number;
        height: number;
        mode: "contain" | "cover" | "fill";
      };
      const res = ctx.agentSetImageFit(image_id, width, height, mode);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, width: res.width, height: res.height }),
        label: `Fit image (${mode})`,
        mutated: true,
      };
    }
    case "crop_image": {
      const { image_id, keep, top, bottom, left, right } = args as unknown as {
        image_id: string;
        keep?: { x: number; y: number; width: number; height: number };
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
      const res = ctx.agentCropImage(image_id, {
        keep,
        top,
        bottom,
        left,
        right,
      });
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      const sides = [
        top ? `top ${pct(top)}` : null,
        bottom ? `bottom ${pct(bottom)}` : null,
        left ? `left ${pct(left)}` : null,
        right ? `right ${pct(right)}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        content: JSON.stringify({ ok: true, width: res.width, height: res.height }),
        label: keep
          ? `Cropped to ${Math.round(keep.width)}×${Math.round(keep.height)} at ${Math.round(keep.x)}, ${Math.round(keep.y)}`
          : `Cropped ${sides}`,
        mutated: true,
      };
    }
    case "place_in_card": {
      const { image_id, ...opts } = args as unknown as {
        image_id: string;
        width: number;
        height: number;
        radius?: number;
        padding?: number;
        background?: string;
        shadow?: boolean;
      };
      const res = ctx.agentPlaceInCard(image_id, opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true, id: res.id, width: res.width, height: res.height }),
        label: `Placed image in card`,
        mutated: true,
      };
    }
    case "set_artboard": {
      const opts = args as {
        width?: number;
        height?: number;
        background?: string;
        direction?: "ltr" | "rtl";
      };
      const res = ctx.agentSetArtboard(opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      const size =
        opts.width || opts.height ? ` ${opts.width ?? "·"}×${opts.height ?? "·"}` : "";
      return {
        content: JSON.stringify({ ok: true }),
        label: `Set artboard${size}${opts.background ? ` · ${opts.background}` : ""}${opts.direction ? ` · ${opts.direction}` : ""}`,
        mutated: true,
      };
    }
    case "set_gradient": {
      const opts = args as {
        id?: string;
        type: "linear" | "radial";
        from: string;
        to: string;
        via?: string;
        angle?: number;
      };
      const res = ctx.agentSetGradient(opts);
      if (!res.ok) return { content: res.error ?? "Failed", isError: true };
      return {
        content: JSON.stringify({ ok: true }),
        label: `Gradient ${res.label}${opts.id ? "" : " (artboard)"}`,
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

function round2(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.round(n * 100) / 100;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function describePatch(patch: AgentLayerPatch): string {
  const keys = Object.keys(patch);
  if (keys.length === 0) return "";
  return `(${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""})`;
}
