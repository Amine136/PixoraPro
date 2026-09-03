/* AI background removal, via this app's own /api/remove-bg proxy.
 *
 * The Cloud Run endpoint and its token deliberately live on the server (see
 * src/app/api/remove-bg/route.ts): a NEXT_PUBLIC_ credential would be compiled
 * into this bundle and readable by every visitor. The browser sends only the
 * image. */

const PROXY_URL = "/api/remove-bg";

/** Public Cloudflare Turnstile site key. A `NEXT_PUBLIC_` value is inlined into
 *  the client bundle, which is fine — the site key is not a secret. The secret
 *  key lives only on the server (route.ts). */
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "0x4AAAAAAEmAF6YuTbifeRXK";
const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Minimal typing for the globals Cloudflare's Turnstile script installs. */
interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id?: string, opts?: Record<string, unknown>) => void;
  remove: (id: string) => void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

/** Load the Turnstile script once and resolve when its API is ready. */
let turnstilePromise: Promise<boolean> | null = null;
function loadTurnstile(): Promise<boolean> {
  if (turnstilePromise) return turnstilePromise;
  turnstilePromise = new Promise((resolve) => {
    const w = window as TurnstileWindow;
    if (w.turnstile) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      turnstilePromise = null; // allow a retry on the next attempt
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return turnstilePromise;
}

/** Run an invisible Turnstile challenge and resolve with the single-use token.
 *  Resolves null if the script can't load or the challenge fails — the caller
 *  decides whether that is fatal. */
function getTurnstileToken(): Promise<string | null> {
  return new Promise((resolve) => {
    void loadTurnstile().then((loaded) => {
      const w = window as TurnstileWindow;
      if (!loaded || !w.turnstile) {
        resolve(null);
        return;
      }
      const container = document.createElement("div");
      container.style.display = "none";
      document.body.appendChild(container);

      const cleanup = () => {
        try {
          w.turnstile?.remove(widgetId);
        } catch {
          // widget already gone
        }
        container.remove();
      };
      const widgetId = w.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        size: "invisible",
        callback: (token: string) => {
          cleanup();
          resolve(token);
        },
        "error-callback": () => {
          cleanup();
          resolve(null);
        },
        "expired-callback": () => {
          cleanup();
          resolve(null);
        },
      });
      w.turnstile.execute(widgetId);
    });
  });
}

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

/** The proxy answers a detected cold start with a 503 + "warming" marker and a
 *  Retry-After. We wait that long and retry automatically instead of surfacing
 *  the 502 the 60s serverless cap would otherwise produce. */
const WARM_RETRY_MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a "warming up" marker from a non-OK proxy response, without consuming
 *  the body the error formatter still needs. */
async function readWarming(
  res: Response,
): Promise<{ retryAfter: number } | null> {
  if (res.status !== 503) return null;
  try {
    const data = (await res.clone().json()) as {
      warming?: boolean;
      retryAfter?: number;
    };
    if (data?.warming === true && typeof data.retryAfter === "number") {
      return { retryAfter: data.retryAfter };
    }
  } catch {
    // not JSON; treat as an ordinary error
  }
  return null;
}

async function postToProxy(
  body: FormData,
  onStatus?: (message: string) => void,
): Promise<Blob> {
  for (let attempt = 1; attempt <= WARM_RETRY_MAX_ATTEMPTS; attempt++) {
    // Prove "human" before touching the paid segmentation service. The server
    // verifies the token with Cloudflare before forwarding anything upstream.
    // Tokens are single-use, so each retry fetches a fresh one.
    const turnstileToken = await getTurnstileToken();
    if (turnstileToken === null) {
      throw new Error(
        "Couldn't verify you're not a bot. Try again, or disable script blockers for this site.",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(PROXY_URL, {
        method: "POST",
        headers: { "X-Turnstile-Token": turnstileToken },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          "Background removal timed out. The service may be starting up — try again.",
        );
      }
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const warming = await readWarming(res);
      if (warming && attempt < WARM_RETRY_MAX_ATTEMPTS) {
        onStatus?.(
          `Warming up the background remover (~${warming.retryAfter}s)…`,
        );
        await delay(warming.retryAfter * 1000);
        continue;
      }
      throw await proxyError(res);
    }

    return await res.blob();
  }

  throw new Error(
    "Background removal couldn't start in time. Please try again.",
  );
}

/** Serverless AI background removal (rembg / ISNet on Cloud Run), reached
 *  through this app's server so the service credential is never exposed.
 *  Images larger than 1024px on the long edge are scaled down first, preserving
 *  aspect ratio. `onStatus`, when given, receives progress notes while a cold
 *  Cloud Run instance is waking up. */
export async function removeBackgroundAI(
  src: string,
  onStatus?: (message: string) => void,
): Promise<Blob> {
  let rawBlob: Blob;

  if (src.startsWith("data:") || src.startsWith("blob:")) {
    const res = await fetch(src);
    rawBlob = await res.blob();
  } else if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const res = await fetch(src);
      rawBlob = await res.blob();
    } catch {
      // The browser can't read these bytes (usually a CORS block). The server
      // no longer fetches remote URLs on our behalf (SSRF), so there is no
      // fallback: report it clearly rather than fail silently.
      throw new Error(
        "This image can't be loaded here (its host blocks cross-origin access). Save it and upload the file instead.",
      );
    }
  } else {
    const res = await fetch(src);
    rawBlob = await res.blob();
  }

  // Constrain to 1024px on the long edge before sending over the wire.
  const preparedBlob = await constrainImageTo1K(rawBlob);

  const formData = new FormData();
  formData.append("file", preparedBlob, "image.png");
  return postToProxy(formData, onStatus);
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
