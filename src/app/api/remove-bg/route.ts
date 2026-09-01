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

/** This route blocks on the upstream service, whose worst case is a Cloud Run
 *  cold start plus segmentation inference. That exceeds the 10s default on
 *  serverless hosts, which would surface as a spurious 504 to the user. */
export const maxDuration = 60;

const BG_REMOVE_URL = process.env.BG_REMOVE_URL ?? "";
const BG_REMOVE_TOKEN = process.env.BG_REMOVE_TOKEN ?? "";

/** Bounds the proxy body. The client already downscales to 1024px on the long
 *  edge before uploading, so a legitimate request is well under this; the limit
 *  is here to reject junk cheaply rather than to constrain real images. */
const MAX_BYTES = 12 * 1024 * 1024;

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

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return Response.json(
      { error: "Image is too large. Try a smaller image." },
      { status: 413 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  if (!contentType.includes("multipart/form-data") && !isJson) {
    return Response.json(
      { error: "Expected a multipart/form-data upload or a JSON image_url." },
      { status: 415 },
    );
  }

  const ip = clientIp(request);
  const upstreamHeaders: Record<string, string> = {
    "X-Internal-Secret": BG_REMOVE_TOKEN,
    // Pass the real caller through so per-IP quota is attributed to the user
    // rather than to this server.
    ...(ip ? { "X-Forwarded-For": ip } : {}),
  };

  let upstreamInit: RequestInit;

  if (isJson) {
    // Fallback path: the browser couldn't read the image bytes (a remote URL
    // that blocks CORS), so the service fetches it server-side instead.
    let imageUrl: string;
    try {
      const body = (await request.json()) as { image_url?: unknown };
      if (typeof body.image_url !== "string" || !body.image_url) {
        return Response.json(
          { error: "Missing image_url." },
          { status: 400 },
        );
      }
      const parsed = new URL(body.image_url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return Response.json(
          { error: "image_url must be http(s)." },
          { status: 400 },
        );
      }
      imageUrl = parsed.toString();
    } catch {
      return Response.json({ error: "Malformed JSON body." }, { status: 400 });
    }
    upstreamInit = {
      method: "POST",
      headers: { ...upstreamHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl }),
    };
  } else {
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
    if (file.type && !file.type.startsWith("image/")) {
      return Response.json(
        { error: "Only image files can be processed." },
        { status: 415 },
      );
    }

    const upstream = new FormData();
    upstream.append("file", file, "image.png");
    upstreamInit = { method: "POST", headers: upstreamHeaders, body: upstream };
  }

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
