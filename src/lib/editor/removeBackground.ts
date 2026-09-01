/* AI background removal, via this app's own /api/remove-bg proxy.
 *
 * The Cloud Run endpoint and its token deliberately live on the server (see
 * src/app/api/remove-bg/route.ts): a NEXT_PUBLIC_ credential would be compiled
 * into this bundle and readable by every visitor. The browser sends only the
 * image. */

const PROXY_URL = "/api/remove-bg";

const MAX_DIMENSION = 1024;

/** Cloud Run cold-starts a segmentation model, which can take tens of seconds
 *  on the first request. Without a ceiling a stalled request hangs the UI
 *  spinner with no explanation. */
const REQUEST_TIMEOUT_MS = 90_000;

/** Ensures the image does not exceed 1024px on its longest edge,
 *  preserving aspect ratio for non-square (non-1:1) images.
 *  If both dimensions are <= 1024, it returns the original blob untouched. */
async function constrainImageTo1K(inputBlob: Blob): Promise<Blob> {
  if (typeof window === "undefined") return inputBlob;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(inputBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;

      // If already within 1024x1024 bounds, keep original blob
      if (w <= MAX_DIMENSION && h <= MAX_DIMENSION) {
        resolve(inputBlob);
        return;
      }

      // Proportional aspect-ratio scaling
      let targetW = w;
      let targetH = h;
      if (w > h) {
        targetW = MAX_DIMENSION;
        targetH = Math.max(1, Math.round((h / w) * MAX_DIMENSION));
      } else {
        targetH = MAX_DIMENSION;
        targetW = Math.max(1, Math.round((w / h) * MAX_DIMENSION));
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(inputBlob);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetW, targetH);

      canvas.toBlob(
        (scaledBlob) => {
          resolve(scaledBlob || inputBlob);
        },
        inputBlob.type || "image/png",
        0.95
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(inputBlob);
    };

    img.src = url;
  });
}

/** Turn a failed proxy response into a message worth showing the user. The
 *  proxy relays the service's own quota text, which is the one case where the
 *  upstream wording is more useful than ours. */
async function proxyError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: string };
    detail = body.error ?? "";
  } catch {
    // no JSON body
  }
  if (res.status === 429) {
    return new Error(
      detail ||
        "Background removal limit reached for now. Try again later, or remove the background manually.",
    );
  }
  if (res.status === 503) {
    return new Error(
      detail || "Background removal isn't available on this deployment.",
    );
  }
  if (res.status === 413) {
    return new Error(detail || "This image is too large to process.");
  }
  return new Error(detail || `Background removal failed (${res.status}).`);
}

async function postToProxy(
  body: FormData | string,
  json = false,
): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      ...(json ? { headers: { "Content-Type": "application/json" } } : {}),
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw await proxyError(res);
    return await res.blob();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "Background removal timed out. The service may be starting up — try again.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Serverless AI background removal (rembg / ISNet on Cloud Run), reached
 *  through this app's server so the service credential is never exposed.
 *  Images larger than 1024px on the long edge are scaled down first, preserving
 *  aspect ratio. */
export async function removeBackgroundAI(src: string): Promise<Blob> {
  let rawBlob: Blob;

  if (src.startsWith("data:") || src.startsWith("blob:")) {
    const res = await fetch(src);
    rawBlob = await res.blob();
  } else if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const res = await fetch(src);
      rawBlob = await res.blob();
    } catch {
      // The browser can't read these bytes (CORS); let the service fetch the
      // URL itself. No downscaling is possible on this path.
      return postToProxy(JSON.stringify({ image_url: src }), true);
    }
  } else {
    const res = await fetch(src);
    rawBlob = await res.blob();
  }

  // Constrain to 1024px on the long edge before sending over the wire.
  const preparedBlob = await constrainImageTo1K(rawBlob);

  const formData = new FormData();
  formData.append("file", preparedBlob, "image.png");
  return postToProxy(formData);
}

/** Fraction of the image border that is already transparent (alpha < 16).
 *  Near 1 means the image is already a cutout — running removal again is a
 *  no-op that only wastes an agent round. */
export function borderAlphaClearedFraction(image: ImageData): number {
  const { width: w, height: h, data } = image;
  let cleared = 0;
  const total = w * 2 + Math.max(0, h - 2) * 2;
  for (let x = 0; x < w; x++) {
    if (data[x * 4 + 3] < 16) cleared++;
    if (data[((h - 1) * w + x) * 4 + 3] < 16) cleared++;
  }
  for (let y = 1; y < h - 1; y++) {
    if (data[y * w * 4 + 3] < 16) cleared++;
    if (data[(y * w + (w - 1)) * 4 + 3] < 16) cleared++;
  }
  return total > 0 ? cleared / total : 0;
}

export interface RemoveBackgroundStats {
  /** Fraction of all pixels turned transparent (0–1). */
  removed: number;
  /** Fraction of the image border that became transparent (0–1). Near 1 means
   *  the background was uniform and peeled cleanly; low values mean the
   *  background is too complex for flood fill (gradients, shadows, scenery). */
  borderCleared: number;
}

/** Erase a near-solid background in place by flood-filling from the image
 *  edges: every pixel reachable from an edge seed within `tolerance` color
 *  distance of that seed's color becomes fully transparent. Subject pixels
 *  are untouched except for a 1px softened rim against the removed area. */
export function removeBackgroundPixels(
  image: ImageData,
  tolerance = 32,
): RemoveBackgroundStats {
  const { width: w, height: h, data } = image;
  const count = w * h;
  const removedMask = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const tolSq = tolerance * tolerance;

  // Corners + edge midpoints: catches backgrounds interrupted by a subject
  // that touches one side of the frame.
  const seeds = [
    0,
    w - 1,
    (h - 1) * w,
    h * w - 1,
    Math.floor(w / 2),
    (h - 1) * w + Math.floor(w / 2),
    Math.floor(h / 2) * w,
    Math.floor(h / 2) * w + (w - 1),
  ];

  const stack = new Int32Array(count);
  for (const seed of seeds) {
    if (visited[seed]) continue;
    const sr = data[seed * 4];
    const sg = data[seed * 4 + 1];
    const sb = data[seed * 4 + 2];
    let top = 0;
    stack[top++] = seed;
    visited[seed] = 1;
    while (top > 0) {
      const idx = stack[--top];
      const o = idx * 4;
      const dr = data[o] - sr;
      const dg = data[o + 1] - sg;
      const db = data[o + 2] - sb;
      if (dr * dr + dg * dg + db * db > tolSq) continue;
      removedMask[idx] = 1;
      const x = idx % w;
      if (x > 0 && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        stack[top++] = idx - 1;
      }
      if (x < w - 1 && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        stack[top++] = idx + 1;
      }
      if (idx >= w && !visited[idx - w]) {
        visited[idx - w] = 1;
        stack[top++] = idx - w;
      }
      if (idx < count - w && !visited[idx + w]) {
        visited[idx + w] = 1;
        stack[top++] = idx + w;
      }
    }
  }

  let removed = 0;
  for (let i = 0; i < count; i++) {
    if (removedMask[i]) {
      data[i * 4 + 3] = 0;
      removed++;
    }
  }

  // Soften the 1px rim of kept pixels bordering the removed area — they carry
  // a blend of subject and old background and read as a hard halo otherwise.
  for (let i = 0; i < count; i++) {
    if (removedMask[i]) continue;
    const x = i % w;
    const nextToRemoved =
      (x > 0 && removedMask[i - 1]) ||
      (x < w - 1 && removedMask[i + 1]) ||
      (i >= w && removedMask[i - w]) ||
      (i < count - w && removedMask[i + w]);
    if (nextToRemoved) {
      data[i * 4 + 3] = Math.min(data[i * 4 + 3], 140);
    }
  }

  let borderRemoved = 0;
  const borderTotal = w * 2 + Math.max(0, h - 2) * 2;
  for (let x = 0; x < w; x++) {
    if (removedMask[x]) borderRemoved++;
    if (removedMask[(h - 1) * w + x]) borderRemoved++;
  }
  for (let y = 1; y < h - 1; y++) {
    if (removedMask[y * w]) borderRemoved++;
    if (removedMask[y * w + (w - 1)]) borderRemoved++;
  }

  return {
    removed: removed / count,
    borderCleared: borderTotal > 0 ? borderRemoved / borderTotal : 0,
  };
}
