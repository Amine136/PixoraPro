# Agent mode — manual eval checklist

How to run: `npm run dev`, open the editor, open the agent panel. Paste each
prompt exactly. After the turn ends, check the **Pass** criteria, then mark
Pass / Fail / Notes. Reset between cases with Ctrl+Z (one undo reverts a whole
agent turn) or a page reload, unless the case says it builds on the previous
one.

Cross-cutting checks — apply to **every** case:

- [ ] One Ctrl+Z reverts the entire turn (never a partial revert).
- [ ] The final chat message honestly matches the canvas (no claimed work that
      didn't happen).
- [ ] No endless micro-adjust loop (same property nudged over and over).
- [ ] Turn finishes well under the 15-round cap.

---

## A. Creation & by-id editing

### A1 — Basic composition (smoke test)
- **Setup:** blank artboard.
- **Prompt:** `Make a simple poster: dark blue background, a big title that says "SUMMER SALE" in white, and a yellow circle behind the title.`
- **Pass:** artboard/bg is dark blue; white title reads SUMMER SALE; yellow
  circle sits *behind* the text (stacking order correct); everything inside the
  artboard with sane margins.

### A2 — Follow-up edit by reference (same session as A1)
- **Prompt:** `Make the title red and twice as big, and move the circle to the bottom-right corner.`
- **Pass:** it modifies the *existing* layers (no duplicates appear); title is
  red and visibly larger; circle ends up bottom-right respecting a margin.
- **Exercises:** `set_properties`, `align_layer` / `move_layer` on prior ids.

### A3 — Duplicate + vary
- **Setup:** one text layer saying "Item 1".
- **Prompt:** `Duplicate this text twice so I have Item 1, Item 2, Item 3, stacked vertically with even spacing.`
- **Pass:** three text layers with correct labels, vertically distributed with
  equal gaps (eyeball or check y in state).
- **Exercises:** `duplicate_layer`, `set_properties`, `distribute_layers`.

## B. Layout tools

### B1 — Grid
- **Setup:** blank artboard.
- **Prompt:** `Add 6 squares in different colors and arrange them in a 2x3 grid centered on the artboard.`
- **Pass:** 6 squares, uniform grid cells, whole grid visually centered; no
  overlapping or stray items.
- **Exercises:** `add_shape` ×6, `arrange_grid`.

### B2 — Distribute with endpoints
- **Setup:** 4 shapes placed messily (drag them around by hand first).
- **Prompt:** `Line these up horizontally with equal gaps between them, keep the leftmost and rightmost where they are.`
- **Pass:** endpoints unmoved, middle items re-spaced with equal gaps, vertical
  positions aligned sensibly.
- **Exercises:** `distribute_layers` (equalize mode), `align_layer`.

### B3 — Full layout from intent (hardest layout case)
- **Setup:** blank artboard.
- **Prompt:** `Design an Instagram story (1080x1920) announcing a cafe opening: cafe name at top, "GRAND OPENING" in the middle, date and address near the bottom. Warm colors.`
- **Pass:** artboard switches to 1080×1920 *first*; content distributed across
  the full height (not clustered at top — this was a real past failure);
  readable contrast.
- **Exercises:** `set_artboard`, layout judgment, auto-screenshot verify.

## C. Images

*(Upload any photo or logo first — a logo PNG with a baked-in background color
is ideal for C3.)*

### C1 — Fit without distortion
- **Setup:** one non-square image on the canvas.
- **Prompt:** `Make this image exactly 400x400 but don't distort it — crop it to fill the square.`
- **Pass:** image occupies a 400×400 box, subject not stretched (cover crop,
  not squash). Undo then redo — the crop must survive.
- **Exercises:** `set_image_fit` (cover, native crop).

### C2 — Card tile
- **Setup:** one image (any aspect ratio).
- **Prompt:** `Turn this image into a product card: rounded corners, white background, subtle shadow, about 300x300.`
- **Pass:** one grouped "Card" layer; image cover-fit inside padded rounded
  rect with shadow; moving the card moves everything together.
- **Exercises:** `place_in_card`, grouping.

### C2b — Crop to a visible object (real past failure)
- **Setup:** a photo with a clear off-center subject sitting in a scene (e.g. a
  jar on rocks).
- **Prompt:** `Crop this photo down to just the jar.`
- **Pass:** it calls `get_screenshot` with `layer_id` to look closely, then
  **one** `crop_image` with a `keep` rectangle — not a chain of fraction crops,
  and never delete-and-retry. Result frames the subject roughly right (a bit of
  surrounding scene is fine — a rectangle can't do better).
- **Also pass:** if the subject genuinely can't be isolated by a rectangle, it
  says so instead of looping.
- **Exercises:** `get_screenshot(layer_id)` → artboard-coordinate reasoning →
  `crop_image({keep})`.

### C2c — Adjusting a crop (the delete-and-retry loop)
- **Setup:** continue from C2b, with a crop that came out slightly too tight.
- **Prompt:** `Not quite — give me a bit more room around it.`
- **Pass:** ONE more `crop_image` with a wider `keep`; the layer grows and the
  trimmed-away pixels come back. **Fail** if it duplicates or deletes the layer
  to start over, or if it says the crop can't be widened.
- **Also check:** if the agent moved/resized the layer between the two crops, it
  re-reads state or re-screenshots before recomputing — a `keep` from the old
  position must not be reused.

### C3 — Seam matching (real past bug)
- **Setup:** logo/image with a baked-in solid background color, on a
  differently-colored artboard.
- **Prompt:** `Make the artboard background match this image's background exactly so there's no visible seam.`
- **Pass:** it *samples* the image (not guesses); artboard color matches the
  baked-in bg; zoom to 100% — no visible edge seam.
- **Exercises:** `sample_color`, `set_artboard`.

### C4 — Photo adjustment
- **Setup:** one photo.
- **Prompt:** `Make this photo pop: more contrast and saturation, slightly brighter.`
- **Pass:** visible but tasteful adjustment; no repeated re-adjust loop after
  the screenshot check.
- **Exercises:** `adjust_image`, screenshot verification.

### C5 — Background removal (both engines + no-op guard)
- **Setup:** upload (a) a mascot/logo on a flat baked background, and
  (b) an image on a complex backdrop (photo scene, painted shape, gradient).
- **Prompt:** `Remove the background from this image` (each in turn), on a
  colored artboard so the cutout is checkable.
- **Pass:** (a) peels via flood (`method: "flood"`, pixel-exact, enclosed
  white regions inside the subject survive); (b) escalates to AI
  (`method: "ai"`), backdrop fully gone — first AI call may take minutes
  (model download). Repeating the request on an already-cut image returns
  "background already transparent" and the agent stops WITHOUT re-running
  or adding cover-up shapes (real past failure: 8 calls + 4 junk rects).
- **Exercises:** `remove_background` auto/ai, no-op guard.

## D. Format & RTL

### D1 — Format change with reflow (real past failure case)
- **Setup:** a finished square design (run A1 first, or any layout).
- **Prompt:** `Convert this design to story format (1080x1920), keep everything looking good.`
- **Pass:** artboard resized; elements scaled *uniformly* (no stretched
  logos/circles → ellipses); content redistributed over the new height.

### D2 — RTL document
- **Setup:** blank artboard.
- **Prompt:** `This is an Arabic-language design, set the document direction to RTL. Then add a title "مرحبا" aligned to the start of the artboard.`
- **Pass:** direction set to rtl on the artboard; "start" alignment resolves to
  the **right** edge (mirrored). Follow up with `align that title to the end` —
  it should go to the **left** edge.
- **Exercises:** `set_artboard` direction, `align_layer` start/end.

## E. Guardrails

### E1 — Bulk delete gate (Deny path)
- **Setup:** 4+ layers on canvas.
- **Prompt:** `Delete all the layers, clear the canvas.`
- **Pass:** amber confirmation banner appears **before** anything is deleted;
  click **Keep them** → all layers still present, and the model's reply says
  nothing was deleted (must NOT claim the canvas was cleared).

### E2 — Bulk delete gate (Allow path)
- **Prompt:** same as E1, click **Delete them**.
- **Pass:** all layers removed; **one** Ctrl+Z restores all of them at once.

### E3 — Single delete has no gate
- **Setup:** several layers.
- **Prompt:** `Delete just the circle.`
- **Pass:** no confirmation banner (single delete is undoable, gate would be
  friction); only the circle is gone.

### E4 — Stop button
- **Setup:** blank artboard.
- **Prompt:** `Create an elaborate poster with at least 10 elements.` Hit
  **Stop** mid-turn.
- **Pass:** loop halts promptly; UI not stuck; whatever landed is reverted by
  one Ctrl+Z; a new instruction afterwards works normally.

### E5 — Out-of-scope request
- **Prompt:** `Export this as a PNG and download it to my computer.`
- **Pass:** the agent explains it can't export (tool not exposed) and points to
  the UI, rather than pretending it exported or stalling.

## G. Gradients & staleness (added after first eval round)

### G1 — Gradient background
- **Setup:** blank artboard.
- **Prompt:** `Make the background a smooth gradient from deep blue at the top to black at the bottom.`
- **Pass:** real smooth gradient (one `Gradient` fill, not stacked
  translucent rectangles); undo then redo — the gradient must survive.

### G2 — Logo blend (your original ask)
- **Setup:** logo with a baked-in dark background color.
- **Prompt:** `Put this on a story artboard with the background fading from the logo's own background color into black — the logo should melt into it, no visible seam.`
- **Pass:** it samples the logo edge (not guesses), gradient starts from that
  exact color, no seam at 100% zoom.

### G3 — Stale memory (E3 regression)
- **Setup:** a few layers; ask the agent to delete them all, then press
  **Ctrl+Z yourself**.
- **Prompt:** `Delete just the circle.` (or reference any restored layer)
- **Pass:** the agent re-reads the canvas (never says "the canvas is empty"),
  and acts on the actual layers.

## F. Judgment / free play

### F1 — Vague brief
- **Prompt:** `Make something nice for a bakery's Facebook post.`
- **Pass:** it commits to a design without endless read-only rounds (stall-
  breaker territory); result is coherent — right-ish format, readable text,
  consistent palette.

### F3 — Poster recipe (ad-quality output)
- **Setup:** blank artboard (richer variant: upload a food photo + mascot image first).
- **Prompt:** `Make a fun bold promo poster for a fried chicken shop: headline "DON'T BLAME THE CHICKEN", tagline "blame the flavor", price $12.99, and an ORDER NOW call to action.`
- **Pass:** looks like an ad, not a form: display font headline (Anton/Bebas/Alfa,
  not Arial), zoned/two-tone background (not one flat fill), a tilted accent
  element, a price chip, script-font accent, soft shadows for depth. With
  images uploaded: palette sampled from them, hero image overlaps a zone
  boundary. Must finish well under the 15-round cap (flash-lite failed this
  by micro-nudging; gemini-3.5-flash passes in ~3 rounds).

### F4 — Premium staging recipe (genre B)
- **Setup:** upload ONE clean product photo (bottle, sneaker, watch — something
  with a dominant hue). No price or offer in the brief.
- **Prompt:** `Make a premium product poster for this.`
- **Pass:** it picks recipe B, not the loud-ad recipe. Specifically:
  - **Monochrome** — one hue sampled off the product, varied by lightness only.
    Any second accent hue (especially the warm orange/yellow of recipe A) is a fail.
  - **Stage** — a floor rect meets the wall at a visible horizon line, and that
    line falls behind the product around its lower third. A flat single-fill
    background is a fail.
  - **Depth panels** — 2-4 outline-only rects (fill `transparent` + strokeWidth
    2-3), rotated 8-15°, sitting behind everything. Invisible panels mean
    strokeWidth was omitted — check canvas state, not just the screenshot.
  - **Grounded** — a flattened contact-shadow ellipse under the product, behind it.
  - **Occlusion** — the headline sits *behind* the hero and is partly hidden by it.
    A headline sitting clear of the product is the failure case this exists to catch.
  - **Restraint** — no badge, no price chip, no script font, no pill CTA.
- **Exercises:** genre selection, `sample_color`, transparent-fill `add_shape`,
  `move_layer` behind the subject (the `tools.ts:54` occlusion carve-out).

### F5 — Genre selection doesn't over-trigger
- **Setup:** blank artboard.
- **Prompt:** `Make a poster for a taco truck: "2 FOR $9" all weekend.`
- **Pass:** picks recipe A (price + offer in the brief), so badges, warm accents
  and a CTA are all *correct* here. A monochrome minimal poster is a fail — the
  premium branch must not swallow the loud-ad cases.

### F2 — Critique loop
- **Setup:** after F1.
- **Prompt:** `The text is hard to read, fix the contrast — don't just make things transparent.`
- **Pass:** real fix (color change, backing shape, or reposition), not an
  opacity hack; at most one correction round.

---

## Results

| Case | Pass/Fail | Notes |
|------|-----------|-------|
| A1   |           |       |
| A2   |           |       |
| A3   |           |       |
| B1   |           |       |
| B2   |           |       |
| B3   |           |       |
| C1   |           |       |
| C2   |           |       |
| C3   |           |       |
| C4   |           |       |
| C5   |           |       |
| D1   |           |       |
| D2   |           |       |
| E1   |           |       |
| E2   |           |       |
| E3   |           |       |
| E4   |           |       |
| E5   |           |       |
| F1   |           |       |
| F2   |           |       |
| F3   |           |       |
| F4   |           |       |
| F5   |           |       |
