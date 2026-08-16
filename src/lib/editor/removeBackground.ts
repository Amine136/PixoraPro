const BG_REMOVE_URL =
  process.env.NEXT_PUBLIC_BG_REMOVE_URL ||
  "https://bg-remove-fast-103097152384.europe-west3.run.app/api/remove-bg";

const BG_REMOVE_TOKEN =
  process.env.NEXT_PUBLIC_BG_REMOVE_TOKEN ||
  "bg_fast_2de0fba96726d62084b886b6ae0f87bddfa58e2765e3fd5a932ea28403e7cf40";

const MAX_DIMENSION = 1024;

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

/** Serverless AI background removal powered by Google Cloud Run (rembg / ISNet).
 *  Handles complex photos, gradients, and scenery with zero client-side WASM overhead.
 *  Automatically scales images > 1024px down to 1K while preserving aspect ratio. */
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
      // If client fetch fails due to CORS, send image_url directly in JSON payload
      const jsonRes = await fetch(BG_REMOVE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": BG_REMOVE_TOKEN,
        },
        body: JSON.stringify({ image_url: src }),
      });
      if (!jsonRes.ok) {
        throw new Error(`Serverless background removal failed (${jsonRes.status})`);
      }
      return await jsonRes.blob();
    }
  } else {
    const res = await fetch(src);
    rawBlob = await res.blob();
  }

  // Constrain to 1024px maximum (preserving aspect ratio) before sending over wire
  const preparedBlob = await constrainImageTo1K(rawBlob);

  const formData = new FormData();
  formData.append("file", preparedBlob, "image.png");

  const response = await fetch(BG_REMOVE_URL, {
    method: "POST",
    headers: {
      "X-Internal-Secret": BG_REMOVE_TOKEN,
    },
    body: formData,
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail || errorDetail;
    } catch {
      // ignore
    }
    throw new Error(`Serverless background removal failed: ${errorDetail}`);
  }

  return await response.blob();
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
