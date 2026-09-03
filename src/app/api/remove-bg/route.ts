/* Server-side proxy for AI background removal.
 *
 * This exists so the Cloud Run credential stays on the server. It used to be
 * NEXT_PUBLIC_BG_REMOVE_TOKEN, which Next.js inlines into the client bundle —
 * i.e. it was readable by anyone who opened DevTools, and it is the only
 * credential the Cloud Run service has. Reading it here (no NEXT_PUBLIC_ prefix)
 * keeps it out of the bundle entirely.
 *
 * It is also the one place a public deployment can see who is calling: the
 * client IP is forwarded so the Cloud Run service can attribute its per-IP
 * quota, since from Cloud Run's perspective every request otherwise originates
 * from this server. */

import { checkRateLimit } from "@/lib/rate-limit";

/** This route blocks on the upstream service, whose worst case is a Cloud Run
 *  cold start plus segmentation inference. That exceeds the 10s default on
 *  serverless hosts, which would surface as a spurious 504 to the user. */
export const maxDuration = 60;

const BG_REMOVE_URL = process.env.BG_REMOVE_URL ?? "";
const BG_REMOVE_TOKEN = process.env.BG_REMOVE_TOKEN ?? "";

/** Cloudflare Turnstile secret. When unset, verification is skipped so local
 *  development (without a Turnstile account) keeps working; a production build
 *  should always set it. */
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY ?? "";
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Bounds the proxy body. The client already downscales to 1024px on the long
 *  edge before uploading, so a legitimate request is well under this; the limit
 *  is here to reject junk cheaply rather than to constrain real images. */
const MAX_BYTES = 12 * 1024 * 1024;

/** Long edge beyond which a submitted image is rejected. The client downscales
 *  to 1024px before upload, so a legitimate request is always well under this;
 *  anything larger is a client skipping the resize (or a decompression bomb). */
const MAX_DIMENSION = 4096;

/** Bytes read to identify format and dimensions. PNG/WEBP keep their header in
 *  the first ~30 bytes; JPEG's SOF marker is almost always within the first few
 *  KB, and 64KB is generous even for heavy EXIF/app segments. */
const HEAD_BYTES = 64 * 1024;

function readU16BE(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function readU16LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

type SniffedImage = {
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
};

/** Walk JPEG segments to a SOFn marker and read its dimensions. */
function jpegDimensions(
  b: Uint8Array,
): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    while (i < b.length && b[i] === 0xff) i++; // skip fill bytes
    if (i >= b.length) break;
    const marker = b[i];
    // Standalone markers carry no length field.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      i++;
      continue;
    }
    if (i + 2 >= b.length) break;
    const len = readU16BE(b, i + 1);
    if (len < 2) break;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG
      marker !== 0xcc; // DAC
    if (isSof) {
      if (i + 7 >= b.length) return null;
      const height = readU16BE(b, i + 4);
      const width = readU16BE(b, i + 6);
      return { width, height };
    }
    i += 1 + len;
  }
  return null;
}

/** Walk WEBP RIFF chunks to VP8X / VP8 / VP8L and read canvas dimensions. */
function webpDimensions(
  b: Uint8Array,
): { width: number; height: number } | null {
  let i = 12; // past "RIFF" + size + "WEBP"
  while (i + 8 <= b.length) {
    const c0 = b[i];
    const c1 = b[i + 1];
    const c2 = b[i + 2];
    const c3 = b[i + 3];
    const size =
      b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const isVp8x = c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x58;
    const isVp8 = c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x20;
    const isVp8l = c0 === 0x56 && c1 === 0x50 && c2 === 0x38 && c3 === 0x4c;
    if (isVp8x && i + 18 < b.length) {
      const width = 1 + (b[i + 12] | (b[i + 13] << 8) | (b[i + 14] << 16));
      const height = 1 + (b[i + 15] | (b[i + 16] << 8) | (b[i + 17] << 16));
      return { width, height };
    }
    if (isVp8 && i + 17 < b.length) {
      // VP8 payload: 3-byte frame tag, 3-byte start code (0x9D 0x01 0x2A),
      // then 2-byte LE width and height (14 bits each).
      const width = readU16LE(b, i + 14) & 0x3fff;
      const height = readU16LE(b, i + 16) & 0x3fff;
      return { width, height };
    }
    if (isVp8l && i + 13 < b.length) {
      // VP8L payload: 1-byte signature (0x2F) followed by a 32-bit header —
      // 14 bits width-1, 14 bits height-1, 3 bits alpha, 1 bit version.
      const b0 = b[i + 9];
      const b1 = b[i + 10];
      const b2 = b[i + 11];
      const b3 = b[i + 12];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height =
        1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    i += 8 + size + (size & 1); // chunks are padded to an even length
  }
  return null;
}

/** Identify an image by its actual bytes (not the declared MIME type) and read
 *  its dimensions where the header makes them cheap to obtain. Returns null for
 *  anything that isn't PNG / JPEG / WEBP. `width`/`height` are 0 when the bytes
 *  are a valid format but dimensions couldn't be parsed from the header. */
function sniffImage(b: Uint8Array): SniffedImage | null {
  // PNG signature
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    if (b.length >= 24) {
      const width =
        ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
      const height =
        ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
      return { format: "png", width, height };
    }
    return { format: "png", width: 0, height: 0 };
  }
  // JPEG SOI
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const d = jpegDimensions(b);
    return d ? { format: "jpeg", ...d } : { format: "jpeg", width: 0, height: 0 };
  }
  // WEBP RIFF container
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    const d = webpDimensions(b);
    return d ? { format: "webp", ...d } : { format: "webp", width: 0, height: 0 };
  }
  return null;
}

/** First hop in X-Forwarded-For is the original client; the rest are proxies.
 *  Falls back to platform-specific headers when XFF is absent. */
function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    null
  );
}

/** Reject cross-origin browser callers. Not a security boundary on its own —
 *  headers are forgeable outside a browser — but it stops other sites from
 *  quietly spending this deployment's quota from their own pages. */
function isForeignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false; // same-origin fetches and non-browser callers
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

/** Confirm a Turnstile token with Cloudflare. Tokens are single-use and expire
 *  after 5 minutes, so a replay of a captured token fails here. */
async function verifyTurnstile(
  token: string,
  ip: string | null,
): Promise<boolean> {
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!BG_REMOVE_URL || !BG_REMOVE_TOKEN) {
    return Response.json(
      {
        error:
          "Background removal isn't configured on this server (BG_REMOVE_URL / BG_REMOVE_TOKEN).",
      },
      { status: 503 },
    );
  }

  if (isForeignOrigin(request)) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, {
      status: 403,
    });
  }

  const ip = clientIp(request);

  // Per-IP throttle. Checked before Turnstile so an already-throttled caller
  // is rejected without an extra Cloudflare round-trip.
  if (!(await checkRateLimit(ip))) {
    return Response.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  // Human check. Skipped only when the secret isn't configured (local dev);
  // with it set, a missing or invalid token is rejected before any upstream
  // work. This is the real anti-spam gate — the origin check above is not.
  if (TURNSTILE_SECRET_KEY) {
    const token = request.headers.get("x-turnstile-token") ?? "";
    if (!token) {
      return Response.json(
        { error: "Missing verification token." },
        { status: 403 },
      );
    }
    if (!(await verifyTurnstile(token, ip))) {
      return Response.json(
        { error: "Verification failed. Please try again." },
        { status: 403 },
      );
    }
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return Response.json(
      { error: "Image is too large. Try a smaller image." },
      { status: 413 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Expected a multipart/form-data upload." },
      { status: 415 },
    );
  }

  const upstreamHeaders: Record<string, string> = {
    "X-Internal-Secret": BG_REMOVE_TOKEN,
    // Pass the real caller through so per-IP quota is attributed to the user
    // rather than to this server.
    ...(ip ? { "X-Forwarded-For": ip } : {}),
  };

  let file: File;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    if (!(entry instanceof File)) {
      return Response.json(
        { error: "No image file in the request." },
        { status: 400 },
      );
    }
    file = entry;
  } catch {
    return Response.json({ error: "Malformed upload." }, { status: 400 });
  }

  // content-length can be absent or wrong; the parsed size is authoritative.
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "Image is too large. Try a smaller image." },
      { status: 413 },
    );
  }

  // Trust the actual bytes, not the client's declared content-type. This
  // enforces a PNG/JPEG/WEBP whitelist and catches a client that skips the
  // 1024px client-side resize (or uploads a decompression bomb).
  let sniffed: SniffedImage;
  try {
    const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
    const result = sniffImage(head);
    if (!result) {
      return Response.json(
        { error: "Unsupported image format. Use PNG, JPEG, or WEBP." },
        { status: 415 },
      );
    }
    sniffed = result;
  } catch {
    return Response.json({ error: "Could not read image." }, { status: 400 });
  }
  if (
    sniffed.width > 0 &&
    sniffed.height > 0 &&
    Math.max(sniffed.width, sniffed.height) > MAX_DIMENSION
  ) {
    return Response.json(
      {
        error: `Image is too large (${sniffed.width}×${sniffed.height}). Maximum ${MAX_DIMENSION}px on the long edge.`,
      },
      { status: 413 },
    );
  }

  const upstream = new FormData();
  upstream.append("file", file, `image.${sniffed.format}`);
  const upstreamInit: RequestInit = {
    method: "POST",
    headers: upstreamHeaders,
    body: upstream,
  };

  let res: Response;
  try {
    res = await fetch(BG_REMOVE_URL, upstreamInit);
  } catch {
    return Response.json(
      { error: "Background removal service is unreachable. Try again shortly." },
      { status: 502 },
    );
  }

  if (!res.ok) {
    // Relay the upstream body for quota rejections so the UI can tell "you're
    // out of trials" apart from "the service failed".
    const detail = await res.text().catch(() => "");
    let message = detail.slice(0, 300);
    try {
      const parsed = JSON.parse(detail) as { detail?: string; error?: string };
      message = parsed.detail ?? parsed.error ?? message;
    } catch {
      // not JSON; use the raw text
    }
    if (res.status === 429) {
      return Response.json(
        {
          error:
            message ||
            "Background removal limit reached. Please try again later.",
        },
        { status: 429 },
      );
    }
    return Response.json(
      { error: message || `Background removal failed (${res.status}).` },
      { status: res.status === 401 || res.status === 403 ? 502 : res.status },
    );
  }

  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "no-store",
    },
  });
}
